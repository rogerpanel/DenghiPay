import { CurrencyCode } from '../money/currency';
import { Money } from '../money/money';

/**
 * Tiered KYC limits (BUILD_PLAN 3.2).
 *
 * Tier 0 exists and can hold an account but cannot move money. That is
 * deliberate: registration is not a financial action, and separating them keeps
 * "verified email" and "verified identity" from collapsing into one flag.
 */
export const KYC_TIERS = [0, 1, 2, 3] as const;
export type KycTier = (typeof KYC_TIERS)[number];

export type LimitWindow = 'PER_TRANSFER' | 'DAILY' | 'MONTHLY';

export interface TierLimits {
  readonly perTransferMinorUnits: bigint;
  readonly dailyMinorUnits: bigint;
  readonly monthlyMinorUnits: bigint;
}

/**
 * Caps are held per tier per send currency. Values are placeholders pending the
 * risk assessment in docs/compliance — they are configuration, not a constant
 * of nature, and the compliance officer owns them.
 */
export type TierLimitTable = Readonly<
  Record<KycTier, Readonly<Partial<Record<CurrencyCode, TierLimits>>>>
>;

/**
 * The naira and cedi rows exist because those currencies are now send
 * currencies, not only receive currencies (the NG→GH and GH→NG corridors).
 *
 * They are anchored to the tiered limits the local regulators already publish,
 * rather than converted from the ruble rows, because a sender in Lagos is
 * bounded by what the CBN permits and not by what we permit in Moscow:
 *
 *   - **NGN** follows the shape of the CBN's three-tier KYC regime, where a
 *     tier-1 account is capped at a low single-transaction value and the caps
 *     rise with the evidence of identity supplied.
 *   - **GHS** follows the Bank of Ghana's mobile-money tiers, which are stated
 *     as daily and monthly aggregates rather than per-transaction values, so
 *     the per-transfer cap here is set at the daily aggregate.
 *
 *   - **XAF and XOF** follow the BEAC and BCEAO electronic-money tiers. The two
 *     are at par, so the tables are identical — but they are still two rows,
 *     because they are two currencies under two central banks and collapsing
 *     them is exactly the mistake the parity invites.
 *
 * Watch the magnitudes on the CFA and shilling rows. **XAF, XOF and UGX have
 * no decimals**, so `200_000n` is two hundred thousand francs and `500_000n` is
 * five hundred thousand shillings — not two thousand and five thousand. Copying
 * a naira or a Kenyan-shilling figure across without dividing by a hundred is
 * the obvious way to get this wrong by two orders of magnitude, and the wrong
 * number still reads as plausible.
 *
 * UGX is the newest member of that set and the easiest to miss, because KES and
 * TZS sit beside it and both have two decimals.
 *
 *   - **ZAR** rows exist as of BUILD_PLAN 4.3c, when South Africa became an
 *     origin. They are the tier caps only. The binding constraint on a South
 *     African sender is usually the exchange-control allowance rather than the
 *     KYC tier, and that is enforced separately in `exchange-control.ts` — two
 *     different questions with two different answers, deliberately not merged.
 *
 * Like the ruble rows, these are placeholders pending the risk assessment in
 * docs/compliance, and the compliance officer owns the final numbers. What is
 * not a placeholder is that they exist at all: `checkLimits` refuses a currency
 * it has no row for, so an unlisted send currency fails closed.
 */
export const DEFAULT_TIER_LIMITS: TierLimitTable = {
  0: {
    RUB: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    BYN: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    NGN: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    GHS: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    XAF: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    XOF: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    ZAR: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    CDF: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    UGX: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    KES: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    TZS: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    ZMW: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
    GMD: { perTransferMinorUnits: 0n, dailyMinorUnits: 0n, monthlyMinorUnits: 0n },
  },
  1: {
    // 15 000 ₽ per transfer, 30 000 ₽ per day, 100 000 ₽ per month.
    RUB: {
      perTransferMinorUnits: 1_500_000n,
      dailyMinorUnits: 3_000_000n,
      monthlyMinorUnits: 10_000_000n,
    },
    BYN: {
      perTransferMinorUnits: 50_000n,
      dailyMinorUnits: 100_000n,
      monthlyMinorUnits: 300_000n,
    },
    // ₦50 000 per transfer, ₦200 000 per day, ₦500 000 per month.
    NGN: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 20_000_000n,
      monthlyMinorUnits: 50_000_000n,
    },
    // GH₵1 000 per day, GH₵3 000 per month — the minimum-KYC wallet tier.
    GHS: {
      perTransferMinorUnits: 100_000n,
      dailyMinorUnits: 100_000n,
      monthlyMinorUnits: 300_000n,
    },
    // R5 000 per transfer, R10 000 per day, R25 000 per month.
    ZAR: {
      perTransferMinorUnits: 500_000n,
      dailyMinorUnits: 1_000_000n,
      monthlyMinorUnits: 2_500_000n,
    },
    // 200 000 FCFA per transfer and per day, 1 000 000 per month. Whole francs.
    XAF: {
      perTransferMinorUnits: 200_000n,
      dailyMinorUnits: 200_000n,
      monthlyMinorUnits: 1_000_000n,
    },
    XOF: {
      perTransferMinorUnits: 200_000n,
      dailyMinorUnits: 200_000n,
      monthlyMinorUnits: 1_000_000n,
    },
    // FC 500 000 per transfer, FC 1 000 000 per day. Two decimals.
    CDF: {
      perTransferMinorUnits: 50_000_000n,
      dailyMinorUnits: 100_000_000n,
      monthlyMinorUnits: 300_000_000n,
    },
    // USh 500 000 per transfer and per day — the Bank of Uganda's low-KYC
    // wallet band. **Whole shillings**: UGX has no minor unit, so this is five
    // hundred thousand, not five thousand.
    UGX: {
      perTransferMinorUnits: 500_000n,
      dailyMinorUnits: 500_000n,
      monthlyMinorUnits: 2_000_000n,
    },
    // KSh 70 000 per transaction is the long-standing M-Pesa ceiling; the daily
    // aggregate sits above it.
    KES: {
      perTransferMinorUnits: 7_000_000n,
      dailyMinorUnits: 15_000_000n,
      monthlyMinorUnits: 50_000_000n,
    },
    // TSh 1 000 000 per transfer, 3 000 000 per day.
    TZS: {
      perTransferMinorUnits: 100_000_000n,
      dailyMinorUnits: 300_000_000n,
      monthlyMinorUnits: 1_000_000_000n,
    },
    // ZK 5 000 per transfer, ZK 10 000 per day.
    ZMW: {
      perTransferMinorUnits: 500_000n,
      dailyMinorUnits: 1_000_000n,
      monthlyMinorUnits: 3_000_000n,
    },
    // D 5 000 per transfer, D 10 000 per day.
    GMD: {
      perTransferMinorUnits: 500_000n,
      dailyMinorUnits: 1_000_000n,
      monthlyMinorUnits: 3_000_000n,
    },
  },
  2: {
    // 100 000 ₽ per transfer, 300 000 ₽ per day, 1 000 000 ₽ per month.
    RUB: {
      perTransferMinorUnits: 10_000_000n,
      dailyMinorUnits: 30_000_000n,
      monthlyMinorUnits: 100_000_000n,
    },
    BYN: {
      perTransferMinorUnits: 300_000n,
      dailyMinorUnits: 900_000n,
      monthlyMinorUnits: 3_000_000n,
    },
    // ₦500 000 per transfer, ₦1 000 000 per day, ₦5 000 000 per month.
    NGN: {
      perTransferMinorUnits: 50_000_000n,
      dailyMinorUnits: 100_000_000n,
      monthlyMinorUnits: 500_000_000n,
    },
    // GH₵5 000 per day, GH₵20 000 per month — the medium-KYC wallet tier.
    GHS: {
      perTransferMinorUnits: 500_000n,
      dailyMinorUnits: 500_000n,
      monthlyMinorUnits: 2_000_000n,
    },
    // R50 000 per transfer, R100 000 per day, R250 000 per month.
    ZAR: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 10_000_000n,
      monthlyMinorUnits: 25_000_000n,
    },
    // 1 000 000 FCFA per transfer, 2 000 000 per day, 5 000 000 per month.
    XAF: {
      perTransferMinorUnits: 1_000_000n,
      dailyMinorUnits: 2_000_000n,
      monthlyMinorUnits: 5_000_000n,
    },
    XOF: {
      perTransferMinorUnits: 1_000_000n,
      dailyMinorUnits: 2_000_000n,
      monthlyMinorUnits: 5_000_000n,
    },
    CDF: {
      perTransferMinorUnits: 300_000_000n,
      dailyMinorUnits: 600_000_000n,
      monthlyMinorUnits: 2_000_000_000n,
    },
    // USh 5 000 000 per transfer. Whole shillings.
    UGX: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 10_000_000n,
      monthlyMinorUnits: 30_000_000n,
    },
    // KSh 500 000 per transfer, the enhanced wallet band.
    KES: {
      perTransferMinorUnits: 50_000_000n,
      dailyMinorUnits: 100_000_000n,
      monthlyMinorUnits: 300_000_000n,
    },
    TZS: {
      perTransferMinorUnits: 500_000_000n,
      dailyMinorUnits: 1_000_000_000n,
      monthlyMinorUnits: 3_000_000_000n,
    },
    ZMW: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 10_000_000n,
      monthlyMinorUnits: 30_000_000n,
    },
    GMD: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 10_000_000n,
      monthlyMinorUnits: 30_000_000n,
    },
  },
  3: {
    // Enhanced due diligence: higher caps, and every transfer still screened.
    RUB: {
      perTransferMinorUnits: 60_000_000n,
      dailyMinorUnits: 100_000_000n,
      monthlyMinorUnits: 500_000_000n,
    },
    BYN: {
      perTransferMinorUnits: 2_000_000n,
      dailyMinorUnits: 3_000_000n,
      monthlyMinorUnits: 10_000_000n,
    },
    // ₦5 000 000 per transfer, ₦10 000 000 per day, ₦50 000 000 per month.
    NGN: {
      perTransferMinorUnits: 500_000_000n,
      dailyMinorUnits: 1_000_000_000n,
      monthlyMinorUnits: 5_000_000_000n,
    },
    // GH₵10 000 per day, GH₵50 000 per month — the enhanced-KYC wallet tier.
    GHS: {
      perTransferMinorUnits: 1_000_000n,
      dailyMinorUnits: 1_000_000n,
      monthlyMinorUnits: 5_000_000n,
    },
    // R100 000 per transfer, R250 000 per day, R1 000 000 per month — the last
    // being the whole discretionary allowance, so exchange control binds first.
    ZAR: {
      perTransferMinorUnits: 10_000_000n,
      dailyMinorUnits: 25_000_000n,
      monthlyMinorUnits: 100_000_000n,
    },
    // 5 000 000 FCFA per transfer, 10 000 000 per day, 25 000 000 per month.
    XAF: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 10_000_000n,
      monthlyMinorUnits: 25_000_000n,
    },
    XOF: {
      perTransferMinorUnits: 5_000_000n,
      dailyMinorUnits: 10_000_000n,
      monthlyMinorUnits: 25_000_000n,
    },
    CDF: {
      perTransferMinorUnits: 1_500_000_000n,
      dailyMinorUnits: 3_000_000_000n,
      monthlyMinorUnits: 10_000_000_000n,
    },
    // USh 25 000 000 per transfer. Whole shillings.
    UGX: {
      perTransferMinorUnits: 25_000_000n,
      dailyMinorUnits: 50_000_000n,
      monthlyMinorUnits: 150_000_000n,
    },
    KES: {
      perTransferMinorUnits: 250_000_000n,
      dailyMinorUnits: 500_000_000n,
      monthlyMinorUnits: 1_500_000_000n,
    },
    TZS: {
      perTransferMinorUnits: 2_500_000_000n,
      dailyMinorUnits: 5_000_000_000n,
      monthlyMinorUnits: 15_000_000_000n,
    },
    ZMW: {
      perTransferMinorUnits: 25_000_000n,
      dailyMinorUnits: 50_000_000n,
      monthlyMinorUnits: 150_000_000n,
    },
    GMD: {
      perTransferMinorUnits: 25_000_000n,
      dailyMinorUnits: 50_000_000n,
      monthlyMinorUnits: 150_000_000n,
    },
  },
};

export type LimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly window: LimitWindow;
      readonly limitMinorUnits: bigint;
      readonly attemptedMinorUnits: bigint;
      /** The tier that would permit this transfer, if any. */
      readonly upgradeTo: KycTier | null;
    };

export interface LimitUsage {
  /** Total already sent today, in minor units of the same currency. */
  readonly todayMinorUnits: bigint;
  /** Total already sent this calendar month, in minor units. */
  readonly monthMinorUnits: bigint;
}

export function limitsFor<C extends CurrencyCode>(
  tier: KycTier,
  currency: C,
  table: TierLimitTable = DEFAULT_TIER_LIMITS,
): TierLimits | undefined {
  return table[tier][currency];
}

/**
 * Server-side limit check. There is no client-side equivalent: the web app may
 * show a helpful hint, but the decision is only ever made here.
 */
export function checkLimits<C extends CurrencyCode>(
  tier: KycTier,
  amount: Money<C>,
  usage: LimitUsage,
  table: TierLimitTable = DEFAULT_TIER_LIMITS,
): LimitDecision {
  const limits = limitsFor(tier, amount.currency, table);
  if (limits === undefined) {
    return {
      allowed: false,
      window: 'PER_TRANSFER',
      limitMinorUnits: 0n,
      attemptedMinorUnits: amount.minorUnits,
      upgradeTo: findUpgradeTier(tier, amount, usage, table),
    };
  }

  const checks: ReadonlyArray<readonly [LimitWindow, bigint, bigint]> = [
    ['PER_TRANSFER', limits.perTransferMinorUnits, amount.minorUnits],
    ['DAILY', limits.dailyMinorUnits, usage.todayMinorUnits + amount.minorUnits],
    ['MONTHLY', limits.monthlyMinorUnits, usage.monthMinorUnits + amount.minorUnits],
  ];

  for (const [window, limit, attempted] of checks) {
    if (attempted > limit) {
      return {
        allowed: false,
        window,
        limitMinorUnits: limit,
        attemptedMinorUnits: attempted,
        upgradeTo: findUpgradeTier(tier, amount, usage, table),
      };
    }
  }

  return { allowed: true };
}

function findUpgradeTier<C extends CurrencyCode>(
  current: KycTier,
  amount: Money<C>,
  usage: LimitUsage,
  table: TierLimitTable,
): KycTier | null {
  for (const tier of KYC_TIERS) {
    if (tier <= current) continue;
    const limits = limitsFor(tier, amount.currency, table);
    if (limits === undefined) continue;
    if (
      amount.minorUnits <= limits.perTransferMinorUnits &&
      usage.todayMinorUnits + amount.minorUnits <= limits.dailyMinorUnits &&
      usage.monthMinorUnits + amount.minorUnits <= limits.monthlyMinorUnits
    ) {
      return tier;
    }
  }
  return null;
}

/**
 * Structuring detection (BUILD_PLAN 3.5): a run of transfers sitting just under
 * a reporting or tier threshold is the pattern we care about, not any single
 * amount.
 */
export interface StructuringSignal {
  readonly detected: boolean;
  readonly nearThresholdCount: number;
  readonly thresholdMinorUnits: bigint;
}

export function detectStructuring(
  recentAmountsMinorUnits: readonly bigint[],
  thresholdMinorUnits: bigint,
  options: { readonly bandBps?: number; readonly minCount?: number } = {},
): StructuringSignal {
  const { bandBps = 1000, minCount = 3 } = options;
  const lowerBound = thresholdMinorUnits - (thresholdMinorUnits * BigInt(bandBps)) / 10_000n;
  const nearThresholdCount = recentAmountsMinorUnits.filter(
    (a) => a >= lowerBound && a < thresholdMinorUnits,
  ).length;
  return {
    detected: nearThresholdCount >= minCount,
    nearThresholdCount,
    thresholdMinorUnits,
  };
}
