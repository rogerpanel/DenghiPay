import { CurrencyCode, getCurrency } from './currency';
import { CurrencyMismatchError, MoneyError } from '../errors';

/**
 * Rounding modes available when a computation cannot land exactly on a minor unit.
 *
 * There is no default at the call sites that matter (FX conversion, fee
 * computation): the caller states the mode, so the choice is visible in review.
 */
export enum RoundingMode {
  /** Round half away from zero. */
  HALF_UP = 'HALF_UP',
  /** Round half to the nearest even minor unit — least biased over many operations. */
  HALF_EVEN = 'HALF_EVEN',
  /** Truncate toward zero. */
  DOWN = 'DOWN',
  /** Round away from zero. */
  UP = 'UP',
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * An amount of money in a single currency, stored as an integer number of
 * minor units.
 *
 * Two properties are load-bearing:
 *
 * 1. It cannot be built from a floating-point value. There is no constructor
 *    that accepts a non-integer `number`. `fromDecimalString` parses digits, it
 *    does not go through IEEE-754.
 * 2. The currency is a type parameter, so `rub.add(ngn)` does not compile when
 *    the currencies are statically known, and throws when they are not.
 */
export class Money<C extends CurrencyCode = CurrencyCode> {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: C,
  ) {
    Object.freeze(this);
  }

  // ---------------------------------------------------------------- factories

  /**
   * Build from an exact integer count of minor units.
   *
   * A `number` argument must be a safe integer. `Money.fromMinorUnits(10.5)`
   * throws — that is the guard that keeps floats out of the system.
   */
  static fromMinorUnits<C extends CurrencyCode>(value: bigint | number, currency: C): Money<C> {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new MoneyError(`Money cannot be created from ${value}`);
      }
      if (!Number.isInteger(value)) {
        throw new MoneyError(
          `Money cannot be created from the non-integer value ${value}: ` +
            'floating point money is a bug, always',
        );
      }
      if (!Number.isSafeInteger(value)) {
        throw new MoneyError(`Money value ${value} exceeds the safe integer range`);
      }
      return new Money(BigInt(value), currency);
    }
    return new Money(value, currency);
  }

  /** Zero in the given currency. */
  static zero<C extends CurrencyCode>(currency: C): Money<C> {
    return new Money(0n, currency);
  }

  /**
   * Parse a decimal string such as "1888590.00" or "-12.5" into minor units.
   *
   * More fractional digits than the currency's exponent is an error rather than
   * a silent rounding: if a provider sends more precision than the currency
   * has, we do not know what they meant.
   */
  static fromDecimalString<C extends CurrencyCode>(input: string, currency: C): Money<C> {
    const trimmed = input.trim().replace(/\s|_/g, '');
    if (!DECIMAL_PATTERN.test(trimmed)) {
      throw new MoneyError(`"${input}" is not a well-formed decimal amount`);
    }

    const negative = trimmed.startsWith('-');
    const unsigned = negative ? trimmed.slice(1) : trimmed;
    const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
    const whole = wholeRaw ?? '';
    const { exponent } = getCurrency(currency);

    if (fractionRaw.length > exponent) {
      throw new MoneyError(
        `"${input}" has ${fractionRaw.length} fractional digits but ${currency} has ${exponent}: ` +
          'refusing to guess precision',
      );
    }

    const fraction = fractionRaw.padEnd(exponent, '0');
    const magnitude = BigInt(`${whole}${fraction}` || '0');
    return new Money(negative ? -magnitude : magnitude, currency);
  }

  // -------------------------------------------------------------- arithmetic

  add(other: Money<C>): Money<C> {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money<C>): Money<C> {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money<C> {
    return new Money(-this.minorUnits, this.currency);
  }

  abs(): Money<C> {
    return new Money(this.minorUnits < 0n ? -this.minorUnits : this.minorUnits, this.currency);
  }

  /** Multiply by an exact integer. Scaling by a fraction goes through `multiplyRatio`. */
  multiply(factor: bigint | number): Money<C> {
    if (typeof factor === 'number' && !Number.isInteger(factor)) {
      throw new MoneyError(
        `Money cannot be multiplied by the non-integer ${factor}; use multiplyRatio`,
      );
    }
    return new Money(this.minorUnits * BigInt(factor), this.currency);
  }

  /**
   * Multiply by the exact rational `numerator / denominator`.
   *
   * This is how percentages and basis points are applied: 25 bps is
   * `multiplyRatio(25n, 10_000n, mode)`, never `* 0.0025`.
   */
  multiplyRatio(numerator: bigint, denominator: bigint, mode: RoundingMode): Money<C> {
    if (denominator === 0n) {
      throw new MoneyError('Division by zero in multiplyRatio');
    }
    return new Money(divideRounded(this.minorUnits * numerator, denominator, mode), this.currency);
  }

  /**
   * Split into `parts` shares whose sum is exactly this amount.
   *
   * Remainder minor units are handed out one at a time from the first share, so
   * nothing is created or destroyed by a split. Weights must be non-negative
   * and sum to more than zero.
   */
  allocate(weights: readonly bigint[]): Money<C>[] {
    if (weights.length === 0) {
      throw new MoneyError('allocate requires at least one weight');
    }
    if (weights.some((w) => w < 0n)) {
      throw new MoneyError('allocate weights must be non-negative');
    }
    const total = weights.reduce((a, b) => a + b, 0n);
    if (total === 0n) {
      throw new MoneyError('allocate weights must sum to more than zero');
    }

    const sign = this.minorUnits < 0n ? -1n : 1n;
    const magnitude = this.minorUnits * sign;

    const shares: bigint[] = weights.map((w) => (magnitude * w) / total);
    let remainder = magnitude - shares.reduce((a, b) => a + b, 0n);
    for (let i = 0; remainder > 0n; i = (i + 1) % shares.length) {
      shares[i] = (shares[i] ?? 0n) + 1n;
      remainder -= 1n;
    }

    return shares.map((s) => new Money(s * sign, this.currency));
  }

  // -------------------------------------------------------------- comparison

  compare(other: Money<C>): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money<C>): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  greaterThan(other: Money<C>): boolean {
    return this.compare(other) === 1;
  }

  greaterThanOrEqual(other: Money<C>): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Money<C>): boolean {
    return this.compare(other) === -1;
  }

  lessThanOrEqual(other: Money<C>): boolean {
    return this.compare(other) <= 0;
  }

  get isZero(): boolean {
    return this.minorUnits === 0n;
  }

  get isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  get isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  // ----------------------------------------------------------- serialisation

  /** Canonical decimal string, always with the currency's full precision. */
  toDecimalString(): string {
    // Widened to `number` deliberately: every currency registered today has a
    // non-zero exponent, but zero-decimal currencies (JPY, KRW) are a normal
    // thing to add and this branch should keep working when one appears.
    const exponent: number = getCurrency(this.currency).exponent;
    const negative = this.minorUnits < 0n;
    const digits = (negative ? -this.minorUnits : this.minorUnits)
      .toString()
      .padStart(exponent + 1, '0');
    const whole = digits.slice(0, digits.length - exponent);
    const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;
    return `${negative ? '-' : ''}${whole}${fraction}`;
  }

  /** Grouped for display, e.g. "1 888 590.00". Never used for arithmetic. */
  format(
    options: { readonly withSymbol?: boolean; readonly groupSeparator?: string } = {},
  ): string {
    const { withSymbol = true, groupSeparator = ' ' } = options;
    const decimal = this.toDecimalString();
    const negative = decimal.startsWith('-');
    const unsigned = negative ? decimal.slice(1) : decimal;
    const [whole = '0', fraction] = unsigned.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
    const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
    const symbol = withSymbol ? `${getCurrency(this.currency).symbol} ` : '';
    return `${negative ? '-' : ''}${symbol}${body}`;
  }

  /** Wire representation. Minor units as a string so no JSON parser sees a float. */
  toJSON(): { readonly amount: string; readonly currency: C; readonly minorUnits: string } {
    return {
      amount: this.toDecimalString(),
      currency: this.currency,
      minorUnits: this.minorUnits.toString(),
    };
  }

  static fromJSON<C extends CurrencyCode>(value: {
    readonly minorUnits: string;
    readonly currency: C;
  }): Money<C> {
    return new Money(BigInt(value.minorUnits), value.currency);
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  // ------------------------------------------------------------------ guards

  private assertSameCurrency(other: Money<CurrencyCode>): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

/**
 * Integer division of `numerator / denominator` under an explicit rounding mode.
 * Exported because the ledger and FX code both need identical semantics.
 */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new MoneyError('Division by zero');
  }

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;

  if (remainder === 0n) {
    return negative ? -quotient : quotient;
  }

  let rounded: bigint;
  switch (mode) {
    case RoundingMode.DOWN:
      rounded = quotient;
      break;
    case RoundingMode.UP:
      rounded = quotient + 1n;
      break;
    case RoundingMode.HALF_UP:
      rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
      break;
    case RoundingMode.HALF_EVEN: {
      const doubled = remainder * 2n;
      if (doubled > absDenominator) rounded = quotient + 1n;
      else if (doubled < absDenominator) rounded = quotient;
      else rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
      break;
    }
  }

  return negative ? -rounded : rounded;
}

/** Sum a list of same-currency amounts. Empty lists need an explicit currency. */
export function sumMoney<C extends CurrencyCode>(
  amounts: readonly Money<C>[],
  currency: C,
): Money<C> {
  return amounts.reduce<Money<C>>((acc, m) => acc.add(m), Money.zero(currency));
}
