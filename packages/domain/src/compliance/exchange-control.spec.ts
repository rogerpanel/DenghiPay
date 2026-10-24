import { describe, expect, it } from 'vitest';
import { Money } from '../money/money';
import {
  allowanceYearBounds,
  categoryIn,
  checkDeclaration,
  exchangeControlFor,
  requiresDeclaration,
  totalUsed,
} from './exchange-control';

const ZA = exchangeControlFor('ZA')!;
const clean = { throughUsMinorUnits: 0n, declaredElsewhereMinorUnits: 0n };
const adult = 34;

function check(overrides: Partial<Parameters<typeof checkDeclaration>[0]> = {}) {
  return checkDeclaration({
    regime: ZA,
    amount: Money.fromDecimalString('10000.00', 'ZAR'),
    categoryCode: '419',
    usage: clean,
    senderAgeYears: adult,
    ...overrides,
  });
}

describe('exchange-control regimes', () => {
  it('governs South Africa and nowhere else, so far', () => {
    expect(requiresDeclaration('ZA')).toBe(true);
    for (const country of ['NG', 'GH', 'CM', 'BJ', 'RU']) {
      expect(requiresDeclaration(country)).toBe(false);
    }
  });

  it('names the authority, because a sender should be able to look it up', () => {
    expect(ZA.authority).toMatch(/Reserve Bank/);
    expect(ZA.reportedBy).toMatch(/Authorised Dealer/);
  });
});

describe('declaration', () => {
  it('allows a declared payment inside the allowance', () => {
    const decision = check();
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.category.code).toBe('419');
      // R1 000 000 less the R10 000 sent.
      expect(decision.remainingMinorUnits).toBe(99_000_000n);
    }
  });

  it('refuses a payment with no category at all', () => {
    const decision = check({ categoryCode: null });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('CATEGORY_REQUIRED');
  });

  it('refuses a category the regime does not publish', () => {
    const decision = check({ categoryCode: '999' });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('CATEGORY_UNKNOWN');
  });

  it('refuses a currency the regime does not govern', () => {
    const decision = check({ amount: Money.fromDecimalString('10000.00', 'NGN') });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('CURRENCY_MISMATCH');
  });

  /**
   * The load-bearing test. An allowance is personal and spans every provider a
   * person uses, so a sender who has spent it elsewhere has spent it — even
   * though our own records look empty. Counting only what we can see would
   * confidently permit a payment that breaches the regulation.
   */
  it('counts allowance the sender declares they used elsewhere', () => {
    const usage = {
      throughUsMinorUnits: 0n,
      declaredElsewhereMinorUnits: 99_500_000n, // R995 000 at another provider.
    };
    expect(totalUsed(usage)).toBe(99_500_000n);

    const inside = check({ amount: Money.fromDecimalString('5000.00', 'ZAR'), usage });
    expect(inside.allowed).toBe(true);

    const over = check({ amount: Money.fromDecimalString('5000.01', 'ZAR'), usage });
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      expect(over.reason).toBe('ALLOWANCE_EXCEEDED');
      expect(over.remainingMinorUnits).toBe(500_000n);
      // The message has to say why, because "you have R5 000 left" is baffling
      // to somebody who has sent nothing through us.
      expect(over.message).toMatch(/every provider/);
    }
  });

  it('sums our own record and the declaration, keeping them distinct in storage', () => {
    const usage = {
      throughUsMinorUnits: 60_000_000n,
      declaredElsewhereMinorUnits: 39_000_000n,
    };
    const decision = check({ amount: Money.fromDecimalString('20000.00', 'ZAR'), usage });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.remainingMinorUnits).toBe(1_000_000n);
  });

  it('reports a spent allowance as zero remaining, never negative', () => {
    const decision = check({
      usage: { throughUsMinorUnits: 120_000_000n, declaredElsewhereMinorUnits: 0n },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.remainingMinorUnits).toBe(0n);
  });

  /**
   * An age we were never given is not an age that passes. A minor has a smaller
   * allowance which this module does not model, so the safe answer is a refusal
   * rather than quietly granting the adult figure.
   */
  it('refuses when the sender age is unknown or below the adult threshold', () => {
    for (const senderAgeYears of [null, undefined, 17]) {
      const decision = check({ senderAgeYears });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('UNDER_AGE');
    }
  });

  it('requires a tax clearance reference where the allowance demands one', () => {
    // No published category draws on the investment allowance today, so this
    // exercises the rule directly against a synthetic regime rather than
    // pretending one of the real categories is an investment.
    const investmentRegime = {
      ...ZA,
      categories: [{ code: '999', label: 'Test investment', allowance: 'INVESTMENT' as const }],
    };
    const without = checkDeclaration({
      regime: investmentRegime,
      amount: Money.fromDecimalString('10000.00', 'ZAR'),
      categoryCode: '999',
      usage: clean,
      senderAgeYears: adult,
    });
    expect(without.allowed).toBe(false);
    if (!without.allowed) expect(without.reason).toBe('TAX_CLEARANCE_REQUIRED');

    const withRef = checkDeclaration({
      regime: investmentRegime,
      amount: Money.fromDecimalString('10000.00', 'ZAR'),
      categoryCode: '999',
      usage: clean,
      senderAgeYears: adult,
      taxClearanceRef: 'TCS-PIN-ABC123',
    });
    expect(withRef.allowed).toBe(true);
  });

  it('publishes every category against a configured allowance', () => {
    for (const category of ZA.categories) {
      expect(categoryIn(ZA, category.code)).toBe(category);
      expect(ZA.allowances.some((a) => a.kind === category.allowance)).toBe(true);
    }
  });

  /**
   * A refusal is read by the person who was refused, so it names the country
   * and the authority rather than an alpha-2 code. "A payment from ZA" is a
   * database row talking to a human.
   */
  it('names the country and the authority in the message a sender reads', () => {
    const decision = checkDeclaration({
      regime: ZA,
      amount: Money.fromDecimalString('1000.00', 'ZAR'),
      categoryCode: null,
      usage: { throughUsMinorUnits: 0n, declaredElsewhereMinorUnits: 0n },
      taxClearanceRef: null,
      senderAgeYears: 30,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message).toContain('South Africa');
      expect(decision.message).toContain('South African Reserve Bank');
      expect(decision.message).not.toMatch(/payment from ZA\b/);
    }
  });
});

describe('allowance year', () => {
  /**
   * A calendar year, not a rolling twelve months. That is how the allowance is
   * published, and a rolling window would be the more generous reading in
   * December and the stricter one in January — wrong in both directions.
   */
  it('runs from 1 January to 1 January, in UTC', () => {
    const bounds = allowanceYearBounds(new Date('2026-08-20T12:00:00Z'));
    expect(bounds.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rolls over at the turn of the year rather than twelve months back', () => {
    const december = allowanceYearBounds(new Date('2026-12-31T23:59:59Z'));
    const january = allowanceYearBounds(new Date('2027-01-01T00:00:01Z'));
    expect(december.start.getUTCFullYear()).toBe(2026);
    expect(january.start.getUTCFullYear()).toBe(2027);
  });
});
