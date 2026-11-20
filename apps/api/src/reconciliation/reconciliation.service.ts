import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { requireCurrencyCode } from '@morapay/domain';
import { LedgerMovement, StatementLine, reconcile } from '@morapay/ledger';
import { ProviderRegistry } from '@morapay/adapters';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../common/metrics.service';
import { toMoney } from '../common/money.util';

/**
 * Daily reconciliation (BUILD_PLAN 8.3, TECHNICAL_ARCHITECTURE §5).
 *
 * The statement is the authority. Where our ledger and a partner statement
 * disagree, the difference is reported and investigated — it is never silently
 * written over our own record, and the job does not "fix" anything by itself.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /** 02:00 UTC daily, over the previous 24 hours. */
  @Cron('0 2 * * *')
  async runDaily(): Promise<void> {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    for (const entry of this.registry.describe()) {
      try {
        await this.run(entry.id, start, end);
      } catch (error) {
        this.logger.error(`Reconciliation failed for ${entry.id}: ${String(error)}`);
      }
    }
  }

  async run(
    providerId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ runId: string; matchedCount: number; breakCount: number }> {
    const provider = this.registry.payoutById(providerId) ?? this.registry.payinById(providerId);
    if (provider === null) {
      throw new Error(`No provider ${providerId} is registered`);
    }

    const lines = await provider.fetchStatement({ start: windowStart, end: windowEnd });

    const statement = await this.prisma.partnerStatement.create({
      data: {
        providerId,
        windowStart,
        windowEnd,
        lines: {
          create: lines.map((line) => ({
            providerRef: String(line.providerRef),
            amountMinorUnits: line.amount.minorUnits,
            currency: line.amount.currency,
            valueDate: line.valueDate,
            description: line.description,
          })),
        },
      },
      include: { lines: true },
    });

    const movements = await this.ledgerMovements(providerId, windowStart, windowEnd);
    const statementLines: StatementLine[] = statement.lines.map((line) => ({
      providerRef: line.providerRef,
      amount: toMoney(line.amountMinorUnits, line.currency),
      valueDate: line.valueDate,
      description: line.description,
    }));

    const report = reconcile(statementLines, movements, { start: windowStart, end: windowEnd });

    const run = await this.prisma.reconciliationRun.create({
      data: {
        statementId: statement.id,
        matchedCount: report.matchedCount,
        breakCount: report.breakCount,
        findings: report.findings.map(serialiseFinding) as object[],
      },
      select: { id: true },
    });

    this.metrics.setReconciliationBreaks(providerId, report.breakCount);

    // Every unmatched item becomes a tracked suspense item with an owner and an
    // age, not a line in a log nobody reads.
    for (const finding of report.findings) {
      if (finding.kind === 'MATCHED') continue;
      await this.openSuspenseItem(providerId, finding);
    }

    await this.audit.record({
      actorType: 'SYSTEM',
      action: 'RECONCILIATION_RUN',
      subjectType: 'RECONCILIATION',
      subjectId: run.id,
      after: {
        providerId,
        matched: report.matchedCount,
        breaks: report.breakCount,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      },
    });

    if (report.breakCount > 0) {
      this.logger.warn(`Reconciliation for ${providerId}: ${report.breakCount} break(s)`);
    }

    return { runId: run.id, matchedCount: report.matchedCount, breakCount: report.breakCount };
  }

  /**
   * The ledger side of the comparison: what we booked against this provider in
   * the window, keyed by the provider reference we recorded at the time.
   */
  private async ledgerMovements(
    providerId: string,
    start: Date,
    end: Date,
  ): Promise<LedgerMovement[]> {
    const transfers = await this.prisma.transfer.findMany({
      where: {
        OR: [{ payoutProviderId: providerId }, { payinProviderId: providerId }],
        updatedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        reference: true,
        payinProviderId: true,
        payinProviderRef: true,
        payoutProviderRef: true,
        sendMinorUnits: true,
        sendCurrency: true,
        recipientMinorUnits: true,
        recipientCurrency: true,
        updatedAt: true,
        state: true,
      },
    });

    const movements: LedgerMovement[] = [];
    for (const transfer of transfers) {
      const isPayin = transfer.payinProviderId === providerId;
      const providerRef = isPayin ? transfer.payinProviderRef : transfer.payoutProviderRef;
      // Only settled movements should appear on a statement.
      const settled = isPayin
        ? !['DRAFT', 'QUOTED', 'COMPLIANCE_PENDING', 'ON_HOLD', 'AWAITING_PAYIN'].includes(
            transfer.state,
          )
        : ['PAYOUT_CONFIRMED', 'COMPLETED'].includes(transfer.state);
      if (!settled) continue;

      const postings = await this.prisma.ledgerTransaction.findFirst({
        where: { reference: transfer.id },
        orderBy: { recordedAt: 'asc' },
        select: { id: true },
      });

      movements.push({
        reference: transfer.reference,
        providerRef,
        amount: isPayin
          ? toMoney(transfer.sendMinorUnits, transfer.sendCurrency)
          : toMoney(transfer.recipientMinorUnits, transfer.recipientCurrency),
        occurredAt: transfer.updatedAt,
        ledgerTransactionId: postings?.id ?? transfer.id,
      });
    }
    return movements;
  }

  private async openSuspenseItem(
    providerId: string,
    finding: ReturnType<typeof reconcile>['findings'][number],
  ): Promise<void> {
    const { reference, amountMinorUnits, currency, note } = describeFinding(finding);
    const existing = await this.prisma.suspenseItem.findFirst({
      where: { reference, resolvedAt: null },
    });
    if (existing !== null) return;

    await this.prisma.suspenseItem.create({
      data: {
        reference,
        currency,
        amountMinorUnits,
        note: `${providerId}: ${note}`,
      },
    });
  }

  async openSuspenseItems() {
    return this.prisma.suspenseItem.findMany({
      where: { resolvedAt: null },
      orderBy: { openedAt: 'asc' },
    });
  }

  async resolveSuspenseItem(id: string, staffId: string, note: string): Promise<void> {
    await this.prisma.suspenseItem.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedBy: staffId, note },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'SUSPENSE_RESOLVED',
      subjectType: 'SUSPENSE',
      subjectId: id,
      reason: note,
    });
  }

  async recentRuns(limit = 20) {
    return this.prisma.reconciliationRun.findMany({
      orderBy: { ranAt: 'desc' },
      take: limit,
      include: { statement: true },
    });
  }
}

function serialiseFinding(finding: ReturnType<typeof reconcile>['findings'][number]): object {
  return JSON.parse(
    JSON.stringify(finding, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as object;
}

function describeFinding(finding: ReturnType<typeof reconcile>['findings'][number]): {
  reference: string;
  amountMinorUnits: bigint;
  currency: string;
  note: string;
} {
  switch (finding.kind) {
    case 'MISSING_IN_LEDGER':
      return {
        reference: finding.providerRef,
        amountMinorUnits: finding.statementAmount.minorUnits,
        currency: finding.statementAmount.currency,
        note: 'On the partner statement, absent from our ledger',
      };
    case 'MISSING_IN_STATEMENT':
      return {
        reference: finding.reference,
        amountMinorUnits: finding.ledgerAmount.minorUnits,
        currency: finding.ledgerAmount.currency,
        note: 'In our ledger, absent from the partner statement',
      };
    case 'AMOUNT_MISMATCH':
      return {
        reference: finding.providerRef,
        amountMinorUnits: finding.statementAmount.minorUnits - finding.ledgerAmount.minorUnits,
        currency: finding.statementAmount.currency,
        note: `Amount mismatch: statement ${finding.statementAmount.toDecimalString()} vs ledger ${finding.ledgerAmount.toDecimalString()}`,
      };
    case 'DUPLICATE_STATEMENT_LINE':
      return {
        reference: finding.providerRef,
        amountMinorUnits: 0n,
        currency: requireCurrencyCode('RUB'),
        note: `Partner reported the same reference ${finding.occurrences} times`,
      };
    default:
      return {
        reference: 'unknown',
        amountMinorUnits: 0n,
        currency: 'RUB',
        note: 'Unclassified reconciliation break',
      };
  }
}
