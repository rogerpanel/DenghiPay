import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Money, RoundingMode, divideRounded, sumMoney } from './money';
import { CurrencyMismatchError, MoneyError } from '../errors';
import { ExchangeRate } from './exchange-rate';

const safeMinorUnits = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });

describe('Money — construction', () => {
  it('refuses to be constructed from a float (guardrail: money code rules)', () => {
    expect(() => Money.fromMinorUnits(10.5, 'RUB')).toThrow(MoneyError);
    expect(() => Money.fromMinorUnits(0.1 + 0.2, 'RUB')).toThrow(MoneyError);
    expect(() => Money.fromMinorUnits(Number.NaN, 'RUB')).toThrow(MoneyError);
    expect(() => Money.fromMinorUnits(Number.POSITIVE_INFINITY, 'RUB')).toThrow(MoneyError);
  });

  it('refuses unsafe integers rather than silently losing precision', () => {
    expect(() => Money.fromMinorUnits(Number.MAX_SAFE_INTEGER + 2, 'NGN')).toThrow(MoneyError);
    // The bigint path has no such ceiling.
    expect(Money.fromMinorUnits(9_007_199_254_740_993n, 'NGN').minorUnits).toBe(
      9_007_199_254_740_993n,
    );
  });

  it('parses decimal strings exactly', () => {
    expect(Money.fromDecimalString('1888590.00', 'NGN').minorUnits).toBe(188_859_000n);
    expect(Money.fromDecimalString('-12.5', 'RUB').minorUnits).toBe(-1250n);
    expect(Money.fromDecimalString('0', 'GHS').minorUnits).toBe(0n);
    expect(Money.fromDecimalString('1.234567', 'USDT').minorUnits).toBe(1_234_567n);
  });

  it('rejects more precision than the currency has, rather than rounding it away', () => {
    expect(() => Money.fromDecimalString('10.005', 'RUB')).toThrow(MoneyError);
    expect(() => Money.fromDecimalString('not a number', 'RUB')).toThrow(MoneyError);
    expect(() => Money.fromDecimalString('1,888,590.00', 'NGN')).toThrow(MoneyError);
  });

  it('round-trips through its decimal string with no precision loss', () => {
    fc.assert(
      fc.property(safeMinorUnits, (units) => {
        const money = Money.fromMinorUnits(units, 'RUB');
        expect(Money.fromDecimalString(money.toDecimalString(), 'RUB').minorUnits).toBe(units);
      }),
    );
  });

  it('round-trips through JSON', () => {
    fc.assert(
      fc.property(safeMinorUnits, (units) => {
        const money = Money.fromMinorUnits(units, 'USDT');
        expect(Money.fromJSON(money.toJSON()).equals(money)).toBe(true);
      }),
    );
  });
});

describe('Money — arithmetic laws', () => {
  it('addition is associative', () => {
    fc.assert(
      fc.property(safeMinorUnits, safeMinorUnits, safeMinorUnits, (a, b, c) => {
        const [x, y, z] = [
          Money.fromMinorUnits(a, 'NGN'),
          Money.fromMinorUnits(b, 'NGN'),
          Money.fromMinorUnits(c, 'NGN'),
        ];
        expect(
          x
            .add(y)
            .add(z)
            .equals(x.add(y.add(z))),
        ).toBe(true);
      }),
    );
  });

  it('addition is commutative and has zero as identity', () => {
    fc.assert(
      fc.property(safeMinorUnits, safeMinorUnits, (a, b) => {
        const x = Money.fromMinorUnits(a, 'GHS');
        const y = Money.fromMinorUnits(b, 'GHS');
        expect(x.add(y).equals(y.add(x))).toBe(true);
        expect(x.add(Money.zero('GHS')).equals(x)).toBe(true);
      }),
    );
  });

  it('subtraction inverts addition', () => {
    fc.assert(
      fc.property(safeMinorUnits, safeMinorUnits, (a, b) => {
        const x = Money.fromMinorUnits(a, 'RUB');
        const y = Money.fromMinorUnits(b, 'RUB');
        expect(x.add(y).subtract(y).equals(x)).toBe(true);
      }),
    );
  });

  it('never loses or creates a minor unit when allocating', () => {
    fc.assert(
      fc.property(
        safeMinorUnits,
        fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 8 }),
        (units, weights) => {
          fc.pre(weights.reduce((a, b) => a + b, 0n) > 0n);
          const money = Money.fromMinorUnits(units, 'NGN');
          const shares = money.allocate(weights);
          expect(shares).toHaveLength(weights.length);
          expect(sumMoney(shares, 'NGN').equals(money)).toBe(true);
        },
      ),
    );
  });

  it('applies basis points without floating point', () => {
    const amount = Money.fromDecimalString('100000.00', 'RUB');
    // 150 bps of 100 000,00 ₽ = 1 500,00 ₽
    expect(amount.multiplyRatio(150n, 10_000n, RoundingMode.HALF_EVEN).toDecimalString()).toBe(
      '1500.00',
    );
  });

  it('refuses to multiply by a non-integer', () => {
    expect(() => Money.fromMinorUnits(100, 'RUB').multiply(1.5)).toThrow(MoneyError);
  });
});

describe('Money — currency safety', () => {
  it('throws when currencies are mixed at runtime', () => {
    const rub = Money.fromMinorUnits(100, 'RUB') as Money;
    const ngn = Money.fromMinorUnits(100, 'NGN') as Money;
    expect(() => rub.add(ngn)).toThrow(CurrencyMismatchError);
    expect(() => rub.subtract(ngn)).toThrow(CurrencyMismatchError);
    expect(() => rub.compare(ngn)).toThrow(CurrencyMismatchError);
  });

  it('treats amounts in different currencies as unequal', () => {
    const rub = Money.fromMinorUnits(100, 'RUB') as Money;
    const ngn = Money.fromMinorUnits(100, 'NGN') as Money;
    expect(rub.equals(ngn)).toBe(false);
  });
});

describe('divideRounded', () => {
  it('rounds according to the requested mode', () => {
    expect(divideRounded(5n, 2n, RoundingMode.DOWN)).toBe(2n);
    expect(divideRounded(5n, 2n, RoundingMode.UP)).toBe(3n);
    expect(divideRounded(5n, 2n, RoundingMode.HALF_UP)).toBe(3n);
    expect(divideRounded(5n, 2n, RoundingMode.HALF_EVEN)).toBe(2n);
    expect(divideRounded(7n, 2n, RoundingMode.HALF_EVEN)).toBe(4n);
    expect(divideRounded(-5n, 2n, RoundingMode.HALF_UP)).toBe(-3n);
    expect(divideRounded(-5n, 2n, RoundingMode.DOWN)).toBe(-2n);
  });

  it('is exact when there is no remainder', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (a) => {
        expect(divideRounded(a * 7n, 7n, RoundingMode.HALF_EVEN)).toBe(a);
      }),
    );
  });

  it('refuses division by zero', () => {
    expect(() => divideRounded(1n, 0n, RoundingMode.DOWN)).toThrow(MoneyError);
  });
});

describe('ExchangeRate', () => {
  const rubToNgn = ExchangeRate.fromDecimalString('RUB', 'NGN', '18.9123');

  it('converts through integers only', () => {
    // 100 000,00 ₽ × 18.9123 = ₦1 891 230,00
    const sent = Money.fromDecimalString('100000.00', 'RUB');
    expect(rubToNgn.convert(sent, RoundingMode.DOWN).toDecimalString()).toBe('1891230.00');
  });

  it('rounds down in the direction we choose, never in the direction of a float', () => {
    const sent = Money.fromDecimalString('0.01', 'RUB');
    expect(rubToNgn.convert(sent, RoundingMode.DOWN).toDecimalString()).toBe('0.18');
    expect(rubToNgn.convert(sent, RoundingMode.UP).toDecimalString()).toBe('0.19');
  });

  it('applies a margin in basis points exactly, without rounding at the rate scale', () => {
    const withMargin = rubToNgn.applyMarginBps(150);
    // 18.9123 × 0.9850 = 18.62861550 — exact, at scale 8.
    expect(withMargin.toDecimalString()).toBe('18.62861550');
    expect(withMargin.scale).toBe(rubToNgn.scale + 4);

    const sent = Money.fromDecimalString('100000.00', 'RUB');
    expect(
      withMargin
        .convert(sent, RoundingMode.DOWN)
        .lessThan(rubToNgn.convert(sent, RoundingMode.DOWN)),
    ).toBe(true);
  });

  it('rejects a rate applied to the wrong currency', () => {
    const ngn = Money.fromMinorUnits(100, 'NGN') as unknown as Money<'RUB'>;
    expect(() => rubToNgn.convert(ngn, RoundingMode.DOWN)).toThrow(MoneyError);
  });

  it('rejects non-positive and malformed rates', () => {
    expect(() => ExchangeRate.of('RUB', 'NGN', 0n, 4)).toThrow(MoneyError);
    expect(() => ExchangeRate.of('RUB', 'NGN', -1n, 4)).toThrow(MoneyError);
    expect(() => ExchangeRate.fromDecimalString('RUB', 'NGN', '-1.0')).toThrow(MoneyError);
    expect(() => ExchangeRate.fromDecimalString('RUB', 'NGN', 'abc')).toThrow(MoneyError);
  });

  it('compares rates as rationals regardless of scale', () => {
    expect(
      ExchangeRate.fromDecimalString('RUB', 'NGN', '18.90').equals(
        ExchangeRate.fromDecimalString('RUB', 'NGN', '18.9'),
      ),
    ).toBe(true);
  });

  it('inverts approximately back to itself', () => {
    const back = rubToNgn.invert(10).invert(4);
    expect(back.toDecimalString()).toBe('18.9123');
  });

  it('never produces a negative recipient amount from a positive send amount', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), (units) => {
        const out = rubToNgn.convert(Money.fromMinorUnits(units, 'RUB'), RoundingMode.DOWN);
        expect(out.isNegative).toBe(false);
      }),
    );
  });
});

describe('Money — formatting', () => {
  it('groups thousands for display without touching the underlying value', () => {
    const amount = Money.fromDecimalString('1888590.00', 'NGN');
    expect(amount.format()).toBe('₦ 1 888 590.00');
    expect(amount.format({ withSymbol: false, groupSeparator: ',' })).toBe('1,888,590.00');
    expect(amount.toDecimalString()).toBe('1888590.00');
  });

  it('formats negative amounts with the sign outside the symbol', () => {
    expect(Money.fromDecimalString('-42.50', 'USD').format()).toBe('-$ 42.50');
  });

  it('describes itself with its currency', () => {
    expect(Money.fromDecimalString('10.00', 'GHS').toString()).toBe('10.00 GHS');
  });
});
