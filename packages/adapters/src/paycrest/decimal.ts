import { RoundingMode, divideRounded } from '@morapay/domain';
import { ProviderContractViolation, normaliseProviderAmount } from '../callback/signature';

/**
 * Exact decimal handling at the Paycrest boundary.
 *
 * Orders are created in the recipient's own currency (`amountIn: "fiat"`), so
 * Paycrest does the token conversion and the adapter never divides by a rate.
 * The one conversion left is reading a settled order back: Paycrest records the
 * token amount and the rate, not the fiat paid, so a statement line recomputes
 * the fiat — in integers, rounded down, here and nowhere else.
 */

/** A decimal as an integer and a count of decimal places: 1580.25 → (158025, 2). */
export interface ScaledDecimal {
  readonly digits: bigint;
  readonly scale: number;
}

export function parseDecimal(raw: unknown): ScaledDecimal {
  const text = normaliseProviderAmount(raw);
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = BigInt(`${whole}${fraction}`);
  return { digits: negative ? -digits : digits, scale: fraction.length };
}

/**
 * A provider decimal as minor units of a currency with `exponent` decimals.
 *
 * Exact or refused: "12.5" is 1250 cents, "12.505" is not a number of cents,
 * and rounding it would be choosing which half-cent the ledger loses.
 */
export function decimalToMinorUnits(raw: unknown, exponent: number): bigint {
  const { digits, scale } = parseDecimal(raw);
  if (scale <= exponent) return digits * 10n ** BigInt(exponent - scale);
  const divisor = 10n ** BigInt(scale - exponent);
  if (digits % divisor !== 0n) {
    throw new ProviderContractViolation(
      `Provider amount has more than ${exponent} decimal places; refusing to round`,
    );
  }
  return digits / divisor;
}

/** Minor units back to a decimal string with exactly `exponent` places. */
export function formatMinorUnits(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  if (exponent === 0) return `${negative ? '-' : ''}${abs}`;
  const unit = 10n ** BigInt(exponent);
  const whole = abs / unit;
  const fraction = (abs % unit).toString().padStart(exponent, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * The fiat a token amount delivers at `rate`, rounded **down** — what a
 * provider can actually have paid out, never more.
 */
export function fiatMinorForToken(
  tokenMinor: bigint,
  tokenExponent: number,
  rate: ScaledDecimal,
  fiatExponent: number,
): bigint {
  const numerator = tokenMinor * rate.digits * 10n ** BigInt(fiatExponent);
  const denominator = 10n ** BigInt(tokenExponent) * 10n ** BigInt(rate.scale);
  return divideRounded(numerator, denominator, RoundingMode.DOWN);
}
