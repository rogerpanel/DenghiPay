import { CurrencyCode, getCurrency } from './currency';
import { Money, RoundingMode, divideRounded } from './money';
import { MoneyError } from '../errors';

const TEN = 10n;

function pow10(exponent: number): bigint {
  if (exponent < 0) throw new MoneyError(`Negative exponent ${exponent}`);
  return TEN ** BigInt(exponent);
}

/**
 * A directed exchange rate held as an exact rational: `numerator / 10^scale`.
 *
 * There is no `number` anywhere in the conversion path. A rate of 18.9 NGN per
 * RUB at scale 8 is the integer 1_890_000_000, and conversion is integer
 * multiplication followed by one explicit rounding step.
 */
export class ExchangeRate<
  From extends CurrencyCode = CurrencyCode,
  To extends CurrencyCode = CurrencyCode,
> {
  private constructor(
    readonly from: From,
    readonly to: To,
    readonly numerator: bigint,
    readonly scale: number,
  ) {
    if (numerator <= 0n) {
      throw new MoneyError('An exchange rate must be strictly positive');
    }
    if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
      throw new MoneyError(`Unsupported rate scale ${scale}`);
    }
    Object.freeze(this);
  }

  static of<From extends CurrencyCode, To extends CurrencyCode>(
    from: From,
    to: To,
    numerator: bigint,
    scale: number,
  ): ExchangeRate<From, To> {
    return new ExchangeRate(from, to, numerator, scale);
  }

  /**
   * Parse a decimal rate string, e.g. "18.9123". The scale is taken from the
   * string, so "18.90" and "18.9" are the same rate held at different scales
   * and compare equal through `equals`.
   */
  static fromDecimalString<From extends CurrencyCode, To extends CurrencyCode>(
    from: From,
    to: To,
    input: string,
  ): ExchangeRate<From, To> {
    const trimmed = input.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new MoneyError(`"${input}" is not a well-formed positive rate`);
    }
    const [whole = '0', fraction = ''] = trimmed.split('.');
    return new ExchangeRate(from, to, BigInt(`${whole}${fraction}`), fraction.length);
  }

  /**
   * Convert an amount. The rounding mode is required: for a recipient amount we
   * round DOWN so we never promise more than we hold; for a cost we round UP.
   */
  convert(amount: Money<From>, mode: RoundingMode): Money<To> {
    if (amount.currency !== this.from) {
      throw new MoneyError(
        `Rate converts ${this.from}→${this.to} but was given ${amount.currency}`,
      );
    }
    const sourceExponent = getCurrency(this.from).exponent;
    const targetExponent = getCurrency(this.to).exponent;

    const numerator = amount.minorUnits * this.numerator * pow10(targetExponent);
    const denominator = pow10(this.scale) * pow10(sourceExponent);

    return Money.fromMinorUnits(divideRounded(numerator, denominator, mode), this.to);
  }

  /**
   * Apply a margin in basis points, reducing what the recipient receives.
   *
   * The result is exact: the scale grows by 4 (the width of a basis point)
   * rather than the numerator being rounded back to the original scale. That
   * matters because a rate rounded at scale 4 and then multiplied by a hundred
   * thousand carries the rounding error into the recipient's pocket.
   */
  applyMarginBps(bps: number): ExchangeRate<From, To> {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new MoneyError(`Margin must be an integer 0–10000 bps, received ${bps}`);
    }
    const adjusted = this.numerator * BigInt(10_000 - bps);
    if (adjusted <= 0n) {
      throw new MoneyError('Margin would reduce the rate to zero');
    }
    return new ExchangeRate(this.from, this.to, adjusted, this.scale + 4);
  }

  invert(scale = this.scale): ExchangeRate<To, From> {
    const numerator = divideRounded(
      pow10(scale + this.scale),
      this.numerator,
      RoundingMode.HALF_EVEN,
    );
    return new ExchangeRate(this.to, this.from, numerator, scale);
  }

  equals(other: ExchangeRate<CurrencyCode, CurrencyCode>): boolean {
    if (this.from !== other.from || this.to !== other.to) return false;
    // Compare as rationals so differing scales still compare correctly.
    return this.numerator * pow10(other.scale) === other.numerator * pow10(this.scale);
  }

  toDecimalString(): string {
    const digits = this.numerator.toString().padStart(this.scale + 1, '0');
    if (this.scale === 0) return digits;
    return `${digits.slice(0, digits.length - this.scale)}.${digits.slice(digits.length - this.scale)}`;
  }

  toJSON(): {
    readonly from: From;
    readonly to: To;
    readonly numerator: string;
    readonly scale: number;
    readonly rate: string;
  } {
    return {
      from: this.from,
      to: this.to,
      numerator: this.numerator.toString(),
      scale: this.scale,
      rate: this.toDecimalString(),
    };
  }

  toString(): string {
    return `1 ${this.from} = ${this.toDecimalString()} ${this.to}`;
  }
}
