import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurrencyCode, Money, requireCurrencyCode } from '@morapay/domain';
import { LedgerService, accountCode, floatCode, floatPrefunding } from '@morapay/ledger';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../common/metrics.service';
import { toMoney } from '../common/money.util';

/**
 * Treasury (BUILD_PLAN 8.1–8.2).
 *
 * Guardrail G6 — four-eyes — is enforced in three places, deliberately:
 *   1. here, when an approval is attempted;
 *   2. in `floatPrefunding`, which refuses to build the posting;
 *   3. in the database, by a CHECK constraint on the prefunding table.
 *
 * Three because this is the control most likely to be "temporarily" relaxed by
 * someone under pressure, and each layer has to be defeated separately.
 */
@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  // ------------------------------------------------------------------- float

  async floatPositions(): Promise<
    Array<{
      currency: CurrencyCode;
      accountCode: string;
      balance: Money<CurrencyCode>;
      lowWatermark: Money<CurrencyCode>;
      target: Money<CurrencyCode>;
      belowThreshold: boolean;
    }>
  > {
    const thresholds = await this.prisma.floatThreshold.findMany();
    const byCurrency = new Map(thresholds.map((t) => [t.currency, t]));

    const floats: Array<[CurrencyCode, string]> = [
      ['RUB', floatCode('RUB')],
      ['NGN', floatCode('NGN')],
      ['GHS', floatCode('GHS')],
      ['ZAR', floatCode('ZAR')],
      ['XAF', floatCode('XAF')],
      ['XOF', floatCode('XOF')],
    ];

    const positions = [];
    for (const [currency, code] of floats) {
      const account = await this.prisma.ledgerAccount.findUnique({ where: { code } });
      if (account === null) continue;
      const balance = await this.ledger.balanceOf(code);
      const threshold = byCurrency.get(currency);
      const lowWatermark = toMoney(threshold?.lowWatermarkMinorUnits ?? 0n, currency);
      const target = toMoney(threshold?.targetMinorUnits ?? 0n, currency);

      this.metrics.setFloatBalance(currency, balance.minorUnits);

      positions.push({
        currency,
        accountCode: code,
        balance,
        lowWatermark,
        target,
        belowThreshold: balance.lessThan(lowWatermark),
      });
    }
    return positions;
  }

  /**
   * Low-float alerting (BUILD_PLAN 8.1 DoD): the alert fires before payouts
   * start failing, not after.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkFloatThresholds(): Promise<void> {
    const positions = await this.floatPositions();
    for (const position of positions) {
      if (position.belowThreshold) {
        await this.audit.record({
          actorType: 'SYSTEM',
          action: 'FLOAT_BELOW_THRESHOLD',
          subjectType: 'FLOAT',
          subjectId: position.currency,
          reason: `Balance ${position.balance.toString()} is below the low watermark ${position.lowWatermark.toString()}`,
        });
      }
    }
  }

  /**
   * The ledger invariant, checked on a schedule and published as a metric.
   *
   * The database already makes an unbalanced transaction impossible, so this
   * should never fire. It runs anyway: the value of a control you believe is
   * airtight is knowing the moment it is not (BUILD_PLAN 1.4, 11.5).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async verifyLedgerIntegrity(): Promise<void> {
    const rows = await this.prisma.$queryRaw<Array<{ currency: string; net: bigint }>>`
      SELECT currency,
             SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor_units ELSE -amount_minor_units END) AS net
        FROM ledger_entry GROUP BY currency`;

    const balanced = rows.every((row) => BigInt(row.net) === 0n);
    this.metrics.setLedgerBalanced(balanced);

    const drift = (await this.ledger.detectDrift()).filter((d) => !d.ok);
    this.metrics.setLedgerDrift(drift.length);

    if (!balanced) {
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'LEDGER_IMBALANCE_DETECTED',
        subjectType: 'LEDGER',
        reason: rows.map((r) => `${r.currency}=${r.net}`).join(', '),
      });
    }

    for (const account of drift) {
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'BALANCE_DRIFT_DETECTED',
        subjectType: 'LEDGER_ACCOUNT',
        subjectId: account.accountId,
        reason: `snapshot ${account.snapshotMinorUnits} vs derived ${account.derivedMinorUnits}`,
      });
    }
  }

  /** Open FX exposure per currency (BUILD_PLAN 4.4). */
  async fxExposure(): Promise<
    Array<{ currency: CurrencyCode; openExposure: Money<CurrencyCode>; positionCount: number }>
  > {
    const open = await this.prisma.fxPosition.findMany({ where: { closedAt: null } });
    const byCurrency = new Map<string, { total: bigint; count: number }>();

    for (const position of open) {
      const entry = byCurrency.get(position.buyCurrency) ?? { total: 0n, count: 0 };
      entry.total += position.buyMinorUnits;
      entry.count += 1;
      byCurrency.set(position.buyCurrency, entry);
    }

    const results = [];
    for (const [currency, entry] of byCurrency) {
      const code = requireCurrencyCode(currency);
      this.metrics.setOpenExposure(code, entry.total);
      results.push({
        currency: code,
        openExposure: Money.fromMinorUnits(entry.total, code),
        positionCount: entry.count,
      });
    }
    return results;
  }

  // -------------------------------------------------------------- prefunding

  async requestPrefunding(input: {
    readonly staffId: string;
    readonly currency: 'RUB' | 'NGN' | 'GHS';
    readonly amountMinorUnits: bigint;
    readonly reason: string;
  }): Promise<{ id: string }> {
    if (input.amountMinorUnits <= 0n) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'A prefunding amount must be positive',
      });
    }

    const code = floatCode(input.currency);
    const created = await this.prisma.prefundingRequest.create({
      data: {
        currency: input.currency,
        amountMinorUnits: input.amountMinorUnits,
        floatAccountCode: code,
        treasuryAccountCode: accountCode('TREASURY_USD', 'USD'),
        reason: input.reason,
        requestedBy: input.staffId,
      },
      select: { id: true },
    });

    await this.audit.record({
      actorType: 'STAFF',
      actorId: input.staffId,
      action: 'PREFUNDING_REQUESTED',
      subjectType: 'PREFUNDING',
      subjectId: created.id,
      reason: input.reason,
      after: {
        currency: input.currency,
        amountMinorUnits: input.amountMinorUnits.toString(),
        status: 'REQUESTED',
      },
    });

    return created;
  }

  /**
   * Approve or reject.
   *
   * The self-approval check is the whole point of this method, so it is the
   * first thing it does.
   */
  async decidePrefunding(
    id: string,
    staffId: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string,
  ): Promise<{ status: string; ledgerTransactionId: string | null }> {
    const request = await this.prisma.prefundingRequest.findUnique({ where: { id } });
    if (request === null) {
      throw new NotFoundException({ code: 'PREFUNDING_NOT_FOUND', message: 'No such request' });
    }

    if (request.requestedBy === staffId) {
      await this.audit.record({
        actorType: 'STAFF',
        actorId: staffId,
        action: 'FOUR_EYES_VIOLATION_ATTEMPTED',
        subjectType: 'PREFUNDING',
        subjectId: id,
        reason: 'The requester attempted to approve their own treasury movement',
      });
      throw new ForbiddenException({
        code: 'FOUR_EYES_VIOLATION',
        message: 'You cannot approve a treasury movement you requested (guardrail G6)',
      });
    }

    if (request.status !== 'REQUESTED') {
      throw new BadRequestException({
        code: 'ALREADY_DECIDED',
        message: `This request is already ${request.status.toLowerCase()}`,
      });
    }

    if (decision === 'REJECT') {
      await this.prisma.prefundingRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approvedBy: staffId,
          approvedAt: new Date(),
          rejectedReason: reason,
        },
      });
      await this.audit.record({
        actorType: 'STAFF',
        actorId: staffId,
        action: 'PREFUNDING_REJECTED',
        subjectType: 'PREFUNDING',
        subjectId: id,
        reason,
        before: { status: 'REQUESTED' },
        after: { status: 'REJECTED' },
      });
      return { status: 'REJECTED', ledgerTransactionId: null };
    }

    const currency = requireCurrencyCode(request.currency);
    const floatAccount = await this.ledger.accountByCode(request.floatAccountCode);
    const treasuryAccount = await this.ledger.accountByCode(request.treasuryAccountCode);

    // The treasury account is USD and the float is not, so the posting is made
    // in the float currency against a treasury account in that currency. This
    // is the settlement rail's job in production; here it is one balanced
    // transaction per currency, as everywhere else.
    const treasuryInCurrency = await this.ledger.ensureAccount({
      type: 'TREASURY_USD',
      currency: 'USD',
      partition: 'NEUTRAL',
    });

    const posting = floatPrefunding({
      prefundingId: id,
      occurredAt: new Date(),
      floatAccountId: floatAccount.id,
      treasuryAccountId:
        floatAccount.currency === 'USD' ? treasuryAccount.id : await this.suspenseFor(currency),
      amount: Money.fromMinorUnits(request.amountMinorUnits, currency),
      requestedBy: request.requestedBy,
      approvedBy: staffId,
    });

    const transaction = await this.ledger.post(posting, `ledger:prefunding:${id}`);

    await this.prisma.prefundingRequest.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        approvedBy: staffId,
        approvedAt: new Date(),
        executedAt: new Date(),
        ledgerTransactionId: transaction.id,
      },
    });

    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'PREFUNDING_APPROVED_AND_EXECUTED',
      subjectType: 'PREFUNDING',
      subjectId: id,
      reason,
      before: { status: 'REQUESTED', requestedBy: request.requestedBy },
      after: { status: 'EXECUTED', approvedBy: staffId, ledgerTransactionId: transaction.id },
    });

    void treasuryInCurrency;
    return { status: 'EXECUTED', ledgerTransactionId: transaction.id };
  }

  /**
   * Where the other side of a non-USD prefunding lands until the settlement
   * rail reports it. Suspense is the honest place for value we know arrived but
   * cannot yet attribute (BUILD_PLAN 1.7).
   */
  private async suspenseFor(currency: CurrencyCode): Promise<string> {
    const account = await this.ledger.ensureAccount({
      type: 'SUSPENSE',
      currency,
      partition: 'NEUTRAL',
    });
    return account.id;
  }

  async listPrefunding(limit = 50) {
    return this.prisma.prefundingRequest.findMany({
      orderBy: { requestedAt: 'desc' },
      take: limit,
    });
  }
}
