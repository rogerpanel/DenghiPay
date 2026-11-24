import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  AllowanceUsage,
  CurrencyCode,
  DeclarationDecision,
  ExchangeControlRegime,
  Money,
  allowanceYearBounds,
  checkDeclaration,
  exchangeControlFor,
} from '@morapay/domain';
import { PrismaService } from '../common/prisma.service';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { AuditService } from '../audit/audit.service';

/**
 * Exchange control (BUILD_PLAN 4.3c, OPEN_ITEMS B8).
 *
 * Some origins permit an outward payment only when it is declared under a
 * published category and counted against the sender's personal annual
 * allowance. This service is the enforcement point, and it runs **before** a
 * transfer row exists — the alternative is creating a transfer and then
 * discovering it may not proceed, which leaves a record of an attempt that was
 * never permissible.
 *
 * The load-bearing honesty here: an allowance is personal and spans every
 * provider the sender uses. Our own tally is a floor, not a ceiling. The sender
 * declares what they have already used elsewhere, we count that too, and the
 * Authorised Dealer holds the complete picture. Treating our own total as
 * authoritative would confidently permit a payment that breaches the
 * regulation — which is precisely the failure guardrail 4 forbids.
 */
@Injectable()
export class ExchangeControlService {
  private readonly logger = new Logger(ExchangeControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly partitions: PartitionGateway,
    private readonly audit: AuditService,
  ) {}

  /** The regime governing this origin, or undefined if it has none. */
  regimeFor(sourceCountry: string): ExchangeControlRegime | undefined {
    return exchangeControlFor(sourceCountry);
  }

  /**
   * What a sender has consumed of an allowance this calendar year.
   *
   * Two figures kept apart on purpose. The first is what we observed and can
   * prove from our own declarations; the second is the largest amount the
   * sender has ever told us they used elsewhere this year.
   *
   * Why the maximum rather than a sum: the declaration is a running total, not
   * an increment. Somebody who says "I have used R200 000 elsewhere" on two
   * separate transfers has used R200 000, not R400 000. Summing would punish an
   * honest sender for declaring twice, which is the fastest way to teach people
   * to under-declare.
   */
  async usage(
    userId: string,
    regime: ExchangeControlRegime,
    at = new Date(),
  ): Promise<AllowanceUsage> {
    const year = at.getUTCFullYear();
    const rows = await this.prisma.exchangeControlDeclaration.findMany({
      where: { userId, regimeCountry: regime.country, allowanceYear: year },
      select: { amountMinorUnits: true, declaredElsewhereMinorUnits: true, transferId: true },
    });

    // A transfer that failed or was refunded never left the country, so it
    // never consumed allowance. Refusing to release it would strand a sender's
    // headroom on a payment that did not happen.
    const refunded = new Set(
      (
        await this.prisma.transfer.findMany({
          where: {
            id: { in: rows.map((r) => r.transferId) },
            state: { in: ['FAILED', 'REFUNDED'] },
          },
          select: { id: true },
        })
      ).map((t) => t.id),
    );

    let throughUs = 0n;
    let declaredElsewhere = 0n;
    for (const row of rows) {
      if (!refunded.has(row.transferId)) throughUs += row.amountMinorUnits;
      if (row.declaredElsewhereMinorUnits > declaredElsewhere) {
        declaredElsewhere = row.declaredElsewhereMinorUnits;
      }
    }
    return { throughUsMinorUnits: throughUs, declaredElsewhereMinorUnits: declaredElsewhere };
  }

  /**
   * Everything a sender needs to fill the declaration in: the categories, the
   * allowance, and what is left of it. Read-only — deciding happens in
   * `assertMayProceed`.
   */
  async allowanceStatus(
    userId: string,
    piiToken: string,
    partition: string,
    sourceCountry: string,
    at = new Date(),
  ): Promise<{
    regime: ExchangeControlRegime;
    usage: AllowanceUsage;
    remainingMinorUnits: bigint;
    annualMinorUnits: bigint;
    year: number;
    hasTaxReference: boolean;
  } | null> {
    const regime = this.regimeFor(sourceCountry);
    if (regime === undefined) return null;

    const usage = await this.usage(userId, regime, at);
    const discretionary = regime.allowances.find((a) => a.kind === 'DISCRETIONARY');
    const annual = discretionary?.annualMinorUnits ?? 0n;
    const used = usage.throughUsMinorUnits + usage.declaredElsewhereMinorUnits;
    const subject = await this.partitions.exchangeControlSubject(piiToken, partition);

    return {
      regime,
      usage,
      annualMinorUnits: annual,
      remainingMinorUnits: annual - used > 0n ? annual - used : 0n,
      year: at.getUTCFullYear(),
      hasTaxReference: (subject?.taxReference ?? null) !== null,
    };
  }

  /**
   * The gate. Throws unless this payment may lawfully proceed.
   *
   * Returns the decision so the caller can persist it: the declaration record
   * has to capture what the allowance was believed to be **at the moment it was
   * decided**, not what it looks like when somebody queries it later.
   */
  async assertMayProceed(input: {
    readonly userId: string;
    readonly piiToken: string;
    readonly partition: string;
    readonly sourceCountry: string;
    readonly amount: Money<CurrencyCode>;
    readonly categoryCode: string | null;
    readonly declaredElsewhereMinorUnits: bigint;
    readonly at?: Date;
  }): Promise<{
    regime: ExchangeControlRegime;
    decision: Extract<DeclarationDecision, { allowed: true }>;
    usage: AllowanceUsage;
    taxClearanceRef: string | null;
  } | null> {
    const regime = this.regimeFor(input.sourceCountry);
    if (regime === undefined) return null;

    const at = input.at ?? new Date();
    const subject = await this.partitions.exchangeControlSubject(input.piiToken, input.partition);
    if (subject === null) {
      // No store entry means no verified date of birth and no tax reference, so
      // nothing can be decided. Refuse rather than assume.
      throw new ForbiddenException({
        code: 'EXCHANGE_CONTROL_SUBJECT_MISSING',
        message:
          'This payment is subject to exchange control and your verified details are not on ' +
          'file. Complete verification before sending.',
      });
    }

    // Only a resident's allowances are modelled. A temporary or non-resident
    // has a different regime — often more permissive on repatriation and more
    // restrictive elsewhere — and guessing which would be worse than refusing.
    if (subject.status !== 'RESIDENT') {
      throw new ForbiddenException({
        code: 'EXCHANGE_CONTROL_STATUS_UNSUPPORTED',
        message:
          `Only residents are supported on this corridor today. ${regime.authority} applies ` +
          'different rules to temporary and non-residents, and those are not yet built.',
      });
    }

    // The sender's own running total of what they used elsewhere replaces the
    // stored one only when it is larger; a smaller number is not evidence that
    // allowance was returned.
    const observed = await this.usage(input.userId, regime, at);
    const usage: AllowanceUsage = {
      throughUsMinorUnits: observed.throughUsMinorUnits,
      declaredElsewhereMinorUnits:
        input.declaredElsewhereMinorUnits > observed.declaredElsewhereMinorUnits
          ? input.declaredElsewhereMinorUnits
          : observed.declaredElsewhereMinorUnits,
    };

    const decision = checkDeclaration({
      regime,
      amount: input.amount,
      categoryCode: input.categoryCode,
      usage,
      taxClearanceRef: subject.taxReference,
      senderAgeYears: subject.ageYears,
    });

    if (!decision.allowed) {
      // Every refusal is auditable. A regulator asking "why was this stopped"
      // and a sender asking "why can I not send" are the same question, and the
      // answer has to survive the session it happened in.
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'EXCHANGE_CONTROL_REFUSED',
        subjectType: 'USER',
        subjectId: input.userId,
        reason: decision.reason,
        after: {
          regime: regime.country,
          categoryCode: input.categoryCode,
          amountMinorUnits: input.amount.minorUnits.toString(),
          remainingMinorUnits: (decision.remainingMinorUnits ?? 0n).toString(),
        },
      });

      const body = {
        code: `EXCHANGE_CONTROL_${decision.reason}`,
        message: decision.message,
        ...(decision.remainingMinorUnits === undefined
          ? {}
          : { remainingMinorUnits: decision.remainingMinorUnits.toString() }),
      };
      // A missing or unknown category is the caller sending a malformed
      // request; an exhausted allowance is a permitted request that is refused.
      // Different problems deserve different status codes.
      throw decision.reason === 'CATEGORY_REQUIRED' || decision.reason === 'CATEGORY_UNKNOWN'
        ? new BadRequestException(body)
        : new ForbiddenException(body);
    }

    return { regime, decision, usage, taxClearanceRef: subject.taxReference };
  }

  /**
   * Record the declaration against a transfer, once it exists.
   *
   * Stores what the allowance was believed to be when the decision was made,
   * which is what an investigation needs. The unique index on `transferId`
   * means a retry cannot count one payment twice.
   */
  async record(input: {
    readonly transferId: string;
    readonly userId: string;
    readonly regime: ExchangeControlRegime;
    readonly decision: Extract<DeclarationDecision, { allowed: true }>;
    readonly usage: AllowanceUsage;
    readonly amount: Money<CurrencyCode>;
    readonly taxClearanceRef: string | null;
    readonly at?: Date;
  }): Promise<void> {
    const at = input.at ?? new Date();
    await this.prisma.exchangeControlDeclaration.create({
      data: {
        transferId: input.transferId,
        userId: input.userId,
        regimeCountry: input.regime.country,
        categoryCode: input.decision.category.code,
        categoryLabel: input.decision.category.label,
        allowanceKind: input.decision.category.allowance,
        allowanceYear: allowanceYearBounds(at).start.getUTCFullYear(),
        amountMinorUnits: input.amount.minorUnits,
        currency: input.amount.currency,
        usedThroughUsMinorUnits: input.usage.throughUsMinorUnits,
        declaredElsewhereMinorUnits: input.usage.declaredElsewhereMinorUnits,
        taxClearanceRef: input.taxClearanceRef,
      },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: input.userId,
      action: 'EXCHANGE_CONTROL_DECLARED',
      subjectType: 'TRANSFER',
      subjectId: input.transferId,
      after: {
        regime: input.regime.country,
        categoryCode: input.decision.category.code,
        allowanceKind: input.decision.category.allowance,
        remainingMinorUnits: input.decision.remainingMinorUnits.toString(),
      },
    });
  }

  /**
   * The reporting extract for the Authorised Dealer.
   *
   * We do not file with the regulator — the AD does, and they need these fields
   * joined to the sender's identity. That join is the one place a name and a
   * national identity number come together, so it happens here, in memory, at
   * the moment the extract is produced, and the result is never persisted.
   */
  async reportingExtract(
    options: { readonly includeReported?: boolean; readonly limit?: number } = {},
  ) {
    const rows = await this.prisma.exchangeControlDeclaration.findMany({
      where: options.includeReported === true ? {} : { reportedAt: null },
      orderBy: { createdAt: 'asc' },
      take: options.limit ?? 500,
      include: {
        transfer: { select: { reference: true, state: true, createdAt: true } },
      },
    });

    const out = [];
    for (const row of rows) {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { piiToken: true, piiPartition: true },
      });
      const subject =
        user === null
          ? null
          : await this.partitions.reportingSubject(user.piiToken, user.piiPartition);

      out.push({
        declarationId: row.id,
        transferReference: row.transfer.reference,
        transferState: row.transfer.state,
        valueDate: row.transfer.createdAt.toISOString(),
        regime: row.regimeCountry,
        categoryCode: row.categoryCode,
        categoryLabel: row.categoryLabel,
        allowanceKind: row.allowanceKind,
        allowanceYear: row.allowanceYear,
        amountMinorUnits: row.amountMinorUnits.toString(),
        currency: row.currency,
        // Null when the partition has no record — which is a finding for the
        // AD, not something to paper over with a placeholder name.
        senderName: subject?.fullName ?? null,
        senderIdentityNumber: subject?.nationalIdNo ?? null,
        senderTaxReference: subject?.taxReference ?? null,
        reportedAt: row.reportedAt?.toISOString() ?? null,
      });
    }
    return out;
  }

  /** Mark declarations as handed to the Authorised Dealer. */
  async markReported(ids: readonly string[], staffId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.exchangeControlDeclaration.updateMany({
      where: { id: { in: [...ids] }, reportedAt: null },
      data: { reportedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'EXCHANGE_CONTROL_REPORTED',
      subjectType: 'EXCHANGE_CONTROL',
      after: { count: result.count },
    });
    return result.count;
  }
}
