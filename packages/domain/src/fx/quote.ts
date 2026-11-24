import { Corridor, isCorridorOpen } from '../corridors/corridor';
import { CurrencyCode } from '../money/currency';
import { ExchangeRate } from '../money/exchange-rate';
import { Money, RoundingMode } from '../money/money';
import { DomainError, RateUnavailableError } from '../errors';

/**
 * Quote engine (BUILD_PLAN 4.2).
 *
 * Open question 1 in the Technical Architecture asked how much of the FX spread
 * we surface. The answer implemented here is: all of it. The sender sees the
 * mid-market rate, our margin in basis points and in money, the fixed fee, and
 * the total cost. If that policy changes it changes here, in one function, and
 * the UI follows.
 */

export class QuoteError extends DomainError {
  constructor(message: string, code = 'QUOTE_ERROR') {
    super(message, code);
  }
}

export interface QuoteInput<Src extends CurrencyCode, Dst extends CurrencyCode> {
  readonly corridor: Corridor;
  /** The amount to be converted, excluding our fee. */
  readonly sendAmount: Money<Src>;
  /** Mid-market rate from the rate feed, before any margin. */
  readonly midRate: ExchangeRate<Src, Dst>;
  readonly at: Date;
  /** Age of the rate observation, in milliseconds. */
  readonly rateAgeMs: number;
  /** Beyond this age quoting halts rather than guessing (BUILD_PLAN 4.1). */
  readonly maxRateAgeMs: number;
  readonly ttlSeconds: number;
}

export interface QuoteBreakdown<Src extends CurrencyCode, Dst extends CurrencyCode> {
  readonly corridorId: string;
  /** What the sender asked to send. */
  readonly sendAmount: Money<Src>;
  /** Flat fee, charged on top of the send amount. */
  readonly fixedFee: Money<Src>;
  /** Our FX margin expressed in the send currency — exactly bps × sendAmount. */
  readonly fxMargin: Money<Src>;
  /** What the sender pays us in total: send amount + fixed fee. */
  readonly totalToPay: Money<Src>;
  /** What the service costs the sender: fixed fee + FX margin. */
  readonly totalCost: Money<Src>;
  /** Mid-market rate, shown for comparison. */
  readonly midRate: ExchangeRate<Src, Dst>;
  /** The rate actually applied to this transfer. */
  readonly effectiveRate: ExchangeRate<Src, Dst>;
  readonly fxMarginBps: number;
  /** What the recipient receives. Rounded DOWN — we never promise more than we hold. */
  readonly recipientAmount: Money<Dst>;
  /** What the recipient would receive with no margin, shown for transparency. */
  readonly recipientAmountAtMid: Money<Dst>;
  readonly quotedAt: Date;
  readonly expiresAt: Date;
}

export function computeQuote<Src extends CurrencyCode, Dst extends CurrencyCode>(
  input: QuoteInput<Src, Dst>,
): QuoteBreakdown<Src, Dst> {
  const { corridor, sendAmount, midRate, at, rateAgeMs, maxRateAgeMs, ttlSeconds } = input;

  if (rateAgeMs > maxRateAgeMs) {
    // BUILD_PLAN 4.1: stale rates halt quoting. They do not get extrapolated.
    throw new RateUnavailableError(
      `Rate for ${corridor.id} is ${rateAgeMs}ms old, beyond the ${maxRateAgeMs}ms threshold; quoting halted`,
    );
  }
  if (!isCorridorOpen(corridor, at)) {
    throw new QuoteError(
      `Corridor ${corridor.id} is not open at ${at.toISOString()}`,
      'CORRIDOR_CLOSED',
    );
  }
  if (sendAmount.currency !== corridor.sourceCurrency) {
    throw new QuoteError(
      `Corridor ${corridor.id} sends ${corridor.sourceCurrency}, received ${sendAmount.currency}`,
      'CURRENCY_MISMATCH',
    );
  }
  if (midRate.from !== corridor.sourceCurrency || midRate.to !== corridor.destinationCurrency) {
    throw new QuoteError(
      `Rate ${midRate.from}→${midRate.to} does not match corridor ${corridor.id}`,
      'RATE_MISMATCH',
    );
  }
  if (sendAmount.minorUnits < corridor.limits.minSendMinorUnits) {
    throw new QuoteError(
      `Amount below the corridor minimum of ${corridor.limits.minSendMinorUnits} minor units`,
      'BELOW_MINIMUM',
    );
  }
  if (sendAmount.minorUnits > corridor.limits.maxSendMinorUnits) {
    throw new QuoteError(
      `Amount above the corridor maximum of ${corridor.limits.maxSendMinorUnits} minor units`,
      'ABOVE_MAXIMUM',
    );
  }

  const bps = corridor.fees.fxMarginBps;
  const effectiveRate = midRate.applyMarginBps(bps);

  const fixedFee = Money.fromMinorUnits(corridor.fees.fixedFeeMinorUnits, sendAmount.currency);
  // Exact: effectiveRate = mid × (1 − bps/10000), so the shortfall in send-currency
  // terms is sendAmount × bps/10000. No inverse conversion, no compounding rounding.
  const fxMargin = sendAmount.multiplyRatio(BigInt(bps), 10_000n, RoundingMode.HALF_EVEN);

  return {
    corridorId: corridor.id,
    sendAmount,
    fixedFee,
    fxMargin,
    totalToPay: sendAmount.add(fixedFee),
    totalCost: fixedFee.add(fxMargin),
    midRate,
    effectiveRate,
    fxMarginBps: bps,
    recipientAmount: effectiveRate.convert(sendAmount, RoundingMode.DOWN),
    recipientAmountAtMid: midRate.convert(sendAmount, RoundingMode.DOWN),
    quotedAt: at,
    expiresAt: new Date(at.getTime() + ttlSeconds * 1000),
  };
}

/**
 * Canonical bytes for signing a quote.
 *
 * Everything that determines what the sender was promised is in here. The
 * signature is checked on confirmation, so a client that edits the recipient
 * amount before posting it back gets a rejection rather than a transfer.
 */
export function quoteSigningPayload(
  quoteId: string,
  breakdown: QuoteBreakdown<CurrencyCode, CurrencyCode>,
): string {
  return [
    quoteId,
    breakdown.corridorId,
    `${breakdown.sendAmount.minorUnits}:${breakdown.sendAmount.currency}`,
    `${breakdown.fixedFee.minorUnits}`,
    `${breakdown.fxMargin.minorUnits}`,
    `${breakdown.recipientAmount.minorUnits}:${breakdown.recipientAmount.currency}`,
    breakdown.effectiveRate.numerator.toString(),
    String(breakdown.effectiveRate.scale),
    breakdown.expiresAt.toISOString(),
  ].join('|');
}

export function isQuoteExpired(
  breakdown: Pick<QuoteBreakdown<CurrencyCode, CurrencyCode>, 'expiresAt'>,
  now: Date,
): boolean {
  return now.getTime() >= breakdown.expiresAt.getTime();
}
