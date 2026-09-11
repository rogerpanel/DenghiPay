import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  KycTier,
  LimitDecision,
  Money,
  checkLimits,
  detectStructuring,
} from '@morapay/domain';
import { PrismaService } from '../common/prisma.service';

/**
 * Tier limits and velocity rules (BUILD_PLAN 3.2, 3.5).
 *
 * Every decision here is server-side. The web app may show a hint about what a
 * tier allows, but the hint is advisory and this service is authoritative — the
 * DoD for 3.2 says limits are "enforced server-side only".
 */
@Injectable()
export class LimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async check(userId: string, amount: Money<CurrencyCode>, tier: KycTier): Promise<LimitDecision> {
    const usage = await this.usage(userId, amount.currency);
    return checkLimits(tier, amount, usage);
  }

  /**
   * Sent totals for today and this calendar month.
   *
   * Counts every transfer that is not terminally failed or refunded: money in
   * flight still consumes the limit, otherwise a burst of pending transfers
   * would each see an empty allowance.
   */
  async usage(
    userId: string,
    currency: CurrencyCode,
    now = new Date(),
  ): Promise<{ todayMinorUnits: bigint; monthMinorUnits: bigint }> {
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const consuming = {
      userId,
      sendCurrency: currency,
      state: { notIn: ['FAILED', 'REFUNDED', 'DRAFT'] },
    };

    const [today, month] = await Promise.all([
      this.prisma.transfer.aggregate({
        where: { ...consuming, createdAt: { gte: startOfDay } },
        _sum: { sendMinorUnits: true },
      }),
      this.prisma.transfer.aggregate({
        where: { ...consuming, createdAt: { gte: startOfMonth } },
        _sum: { sendMinorUnits: true },
      }),
    ]);

    return {
      todayMinorUnits: today._sum.sendMinorUnits ?? 0n,
      monthMinorUnits: month._sum.sendMinorUnits ?? 0n,
    };
  }

  /**
   * Velocity and fraud signals (BUILD_PLAN 3.5).
   *
   * Four patterns, each one a thing that has actually happened in remittance
   * corridors: too many transfers too quickly, one sender fanning out to many
   * recipients, a run of amounts just under a threshold, and a sudden jump in
   * ticket size.
   */
  async velocitySignals(
    userId: string,
    amount: Money<CurrencyCode>,
    now = new Date(),
  ): Promise<{
    readonly triggered: boolean;
    readonly reasons: readonly string[];
    readonly detail: Record<string, unknown>;
  }> {
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recent = await this.prisma.transfer.findMany({
      where: { userId, createdAt: { gte: since7d }, state: { notIn: ['DRAFT'] } },
      select: { sendMinorUnits: true, recipientId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const last24h = recent.filter((t) => t.createdAt >= since24h);
    const distinctRecipients = new Set(recent.map((t) => t.recipientId));
    const reasons: string[] = [];

    if (last24h.length >= 10) {
      reasons.push(`${last24h.length} transfers in 24 hours`);
    }

    if (distinctRecipients.size >= 8) {
      reasons.push(`${distinctRecipients.size} distinct recipients in 7 days`);
    }

    // Structuring: a run of amounts sitting just under the tier-2 per-transfer
    // cap, which is the threshold a sender would be trying to stay beneath.
    const structuring = detectStructuring(
      [...recent.map((t) => t.sendMinorUnits), amount.minorUnits],
      10_000_000n,
    );
    if (structuring.detected) {
      reasons.push(
        `${structuring.nearThresholdCount} transfers just below the ${structuring.thresholdMinorUnits} minor-unit threshold`,
      );
    }

    // A tenfold jump on an established pattern is worth a look.
    if (recent.length >= 3) {
      const historical = recent.map((t) => t.sendMinorUnits);
      const average = historical.reduce((a, b) => a + b, 0n) / BigInt(historical.length);
      if (average > 0n && amount.minorUnits > average * 10n) {
        reasons.push('transfer is more than ten times this sender’s recent average');
      }
    }

    return {
      triggered: reasons.length > 0,
      reasons,
      detail: {
        transfersLast24h: last24h.length,
        distinctRecipients7d: distinctRecipients.size,
        structuringCount: structuring.nearThresholdCount,
      },
    };
  }
}
