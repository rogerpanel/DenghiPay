import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  CURRENCY_CODES,
  getCurrency,
  isCurrencyCode,
  requireCurrencyCode,
} from './currency';
import { Money } from './money';

describe('currency registry', () => {
  it('carries the ISO 4217 exponent for every corridor currency', () => {
    expect(getCurrency('RUB').exponent).toBe(2);
    expect(getCurrency('NGN').exponent).toBe(2);
    expect(getCurrency('GHS').exponent).toBe(2);
    expect(getCurrency('USD').exponent).toBe(2);
    // Not two — USDT is a six-decimal ERC-20.
    expect(getCurrency('USDT').exponent).toBe(6);
  });

  it('lists every registered code', () => {
    expect(CURRENCY_CODES).toContain('RUB');
    expect(CURRENCY_CODES).toContain('BYN');
    expect(CURRENCY_CODES.length).toBe(Object.keys(CURRENCIES).length);
  });

  it('recognises only registered codes', () => {
    expect(isCurrencyCode('RUB')).toBe(true);
    expect(isCurrencyCode('rub')).toBe(false);
    expect(isCurrencyCode('XYZ')).toBe(false);
    expect(isCurrencyCode(undefined)).toBe(false);
    expect(isCurrencyCode('toString')).toBe(false);
  });

  it('throws on an unknown code from an external system rather than defaulting', () => {
    expect(requireCurrencyCode('NGN')).toBe('NGN');
    expect(() => requireCurrencyCode('CDF')).toThrow();
    expect(() => requireCurrencyCode(null)).toThrow();
  });
});

describe('Money — comparison surface', () => {
  const ten = Money.fromDecimalString('10.00', 'RUB');
  const twenty = Money.fromDecimalString('20.00', 'RUB');

  it('orders amounts', () => {
    expect(ten.lessThan(twenty)).toBe(true);
    expect(ten.lessThanOrEqual(ten)).toBe(true);
    expect(twenty.greaterThan(ten)).toBe(true);
    expect(twenty.greaterThanOrEqual(twenty)).toBe(true);
    expect(ten.compare(twenty)).toBe(-1);
    expect(twenty.compare(ten)).toBe(1);
    expect(ten.compare(ten)).toBe(0);
  });

  it('reports sign', () => {
    expect(Money.zero('RUB').isZero).toBe(true);
    expect(ten.isPositive).toBe(true);
    expect(ten.negate().isNegative).toBe(true);
    expect(ten.negate().abs().equals(ten)).toBe(true);
    expect(ten.abs().equals(ten)).toBe(true);
  });

  it('multiplies by an exact integer', () => {
    expect(ten.multiply(3).toDecimalString()).toBe('30.00');
    expect(ten.multiply(3n).toDecimalString()).toBe('30.00');
  });

  it('rejects malformed allocation weights', () => {
    expect(() => ten.allocate([])).toThrow();
    expect(() => ten.allocate([0n, 0n])).toThrow();
    expect(() => ten.allocate([-1n, 2n])).toThrow();
  });

  it('allocates a negative amount without changing its sign', () => {
    const shares = ten.negate().allocate([1n, 1n, 1n]);
    expect(shares.every((s) => s.isNegative)).toBe(true);
    expect(shares.reduce((a, b) => a.add(b)).toDecimalString()).toBe('-10.00');
  });

  it('refuses a zero denominator in multiplyRatio', () => {
    expect(() => ten.multiplyRatio(1n, 0n, 'DOWN' as never)).toThrow();
  });
});
