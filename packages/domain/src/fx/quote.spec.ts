import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, Corridor, corridorIdFor, isCorridorOpen } from '../corridors/corridor';
import { ExchangeRate } from '../money/exchange-rate';
import { Money, RoundingMode } from '../money/money';
import { RateUnavailableError } from '../errors';
import { QuoteError, computeQuote, isQuoteExpired, quoteSigningPayload } from './quote';

const RU_NG: Corridor = {
  id: corridorIdFor('RU', 'NG'),
  sourceCountry: 'RU',
  sourceCurrency: 'RUB',
  destinationCountry: 'NG',
  destinationCurrency: 'NGN',
  payinMethods: ['SBP', 'QR'],
  payoutMethods: ['BANK_ACCOUNT'],
  limits: { minSendMinorUnits: 50_000n, maxSendMinorUnits: 100_000_000n },
  fees: { fixedFeeMinorUnits: 15_000n, fxMarginBps: 150 },
  operatingHours: ALWAYS_OPEN,
  enabled: true,
};

const MID = ExchangeRate.fromDecimalString('RUB', 'NGN', '18.9123');
const AT = new Date('2026-08-13T10:00:00Z');

function quoteFor(
  sendDecimal: string,
  overrides: Partial<Parameters<typeof computeQuote>[0]> = {},
) {
  return computeQuote({
    corridor: RU_NG,
    sendAmount: Money.fromDecimalString(sendDecimal, 'RUB'),
    midRate: MID,
    at: AT,
    rateAgeMs: 1_000,
    maxRateAgeMs: 60_000,
    ttlSeconds: 90,
    ...overrides,
  } as Parameters<typeof computeQuote>[0]);
}

describe('quote engine', () => {
  it('decomposes the spread so the sender sees every component', () => {
    const q = quoteFor('100000.00');

    expect(q.sendAmount.toDecimalString()).toBe('100000.00');
    expect(q.fixedFee.toDecimalString()).toBe('150.00');
    // 150 bps of 100 000,00 ₽
    expect(q.fxMargin.toDecimalString()).toBe('1500.00');
    expect(q.totalToPay.toDecimalString()).toBe('100150.00');
    expect(q.totalCost.toDecimalString()).toBe('1650.00');
    expect(q.fxMarginBps).toBe(150);
  });

  it('reproduces the recipient amount exactly from the recorded rate (DoD 4.2)', () => {
    const q = quoteFor('100000.00');
    // Rebuild the rate from only what the quote record stores.
    const storedRate = ExchangeRate.of(
      'RUB',
      'NGN',
      q.effectiveRate.numerator,
      q.effectiveRate.scale,
    );
    const rebuilt = storedRate.convert(
      Money.fromMinorUnits(q.sendAmount.minorUnits, 'RUB'),
      RoundingMode.DOWN,
    );
    expect(rebuilt.equals(q.recipientAmount)).toBe(true);
  });

  it('gives the recipient less than the mid-market rate would, by exactly the margin', () => {
    const q = quoteFor('100000.00');
    expect(q.recipientAmount.lessThan(q.recipientAmountAtMid)).toBe(true);

    // The shortfall in destination currency equals the margin converted at mid,
    // to within one minor unit of rounding.
    const shortfall = q.recipientAmountAtMid.subtract(q.recipientAmount);
    const marginAtMid = MID.convert(q.fxMargin, RoundingMode.DOWN);
    const difference = shortfall.subtract(marginAtMid).abs();
    expect(difference.minorUnits <= 1n).toBe(true);
  });

  it('halts rather than guessing when the rate feed is stale', () => {
    expect(() => quoteFor('100000.00', { rateAgeMs: 120_000, maxRateAgeMs: 60_000 })).toThrow(
      RateUnavailableError,
    );
  });

  it('enforces corridor minimum and maximum', () => {
    expect(() => quoteFor('100.00')).toThrow(QuoteError);
    expect(() => quoteFor('2000000.00')).toThrow(QuoteError);
  });

  it('refuses to quote a closed corridor', () => {
    expect(() => quoteFor('100000.00', { corridor: { ...RU_NG, enabled: false } })).toThrow(
      QuoteError,
    );
  });

  it('refuses a rate that does not match the corridor', () => {
    expect(() =>
      quoteFor('100000.00', {
        midRate: ExchangeRate.fromDecimalString('RUB', 'GHS', '0.13') as never,
      }),
    ).toThrow(QuoteError);
  });

  it('refuses an amount denominated in the wrong currency', () => {
    expect(() =>
      quoteFor('100000.00', { sendAmount: Money.fromDecimalString('1000.00', 'USD') as never }),
    ).toThrow(QuoteError);
  });

  it('expires', () => {
    const q = quoteFor('100000.00');
    expect(q.expiresAt.getTime() - q.quotedAt.getTime()).toBe(90_000);
    expect(isQuoteExpired(q, new Date(AT.getTime() + 89_000))).toBe(false);
    expect(isQuoteExpired(q, new Date(AT.getTime() + 90_000))).toBe(true);
  });

  it('signs everything that determines the promise', () => {
    const q = quoteFor('100000.00');
    const payload = quoteSigningPayload('quote-1', q);
    expect(payload).toContain('quote-1');
    expect(payload).toContain(q.recipientAmount.minorUnits.toString());
    expect(payload).toContain(q.effectiveRate.numerator.toString());
    expect(payload).toContain(q.expiresAt.toISOString());

    // Changing any component changes the signed payload.
    const tampered = quoteSigningPayload('quote-1', {
      ...q,
      recipientAmount: q.recipientAmount.add(Money.fromMinorUnits(1, 'NGN')),
    });
    expect(tampered).not.toBe(payload);
  });
});

describe('corridor scheduling', () => {
  it('is closed outside operating hours and on excluded weekdays', () => {
    const officeHours: Corridor = {
      ...RU_NG,
      operatingHours: { openUtcHour: 6, closeUtcHour: 18, weekdays: [1, 2, 3, 4, 5] },
    };
    // 2026-08-13 is a Thursday.
    expect(isCorridorOpen(officeHours, new Date('2026-08-13T10:00:00Z'))).toBe(true);
    expect(isCorridorOpen(officeHours, new Date('2026-08-13T03:00:00Z'))).toBe(false);
    // 2026-08-16 is a Sunday — ISO weekday 7.
    expect(isCorridorOpen(officeHours, new Date('2026-08-16T10:00:00Z'))).toBe(false);
  });

  it('treats Sunday as ISO weekday 7', () => {
    const sundayOnly: Corridor = {
      ...RU_NG,
      operatingHours: { openUtcHour: 0, closeUtcHour: 24, weekdays: [7] },
    };
    expect(isCorridorOpen(sundayOnly, new Date('2026-08-16T10:00:00Z'))).toBe(true);
    expect(isCorridorOpen(sundayOnly, new Date('2026-08-13T10:00:00Z'))).toBe(false);
  });

  it('is closed when disabled regardless of the clock', () => {
    expect(isCorridorOpen({ ...RU_NG, enabled: false }, AT)).toBe(false);
  });
});
