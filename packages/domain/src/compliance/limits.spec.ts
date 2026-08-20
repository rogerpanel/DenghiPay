import { describe, expect, it } from 'vitest';
import { Money } from '../money/money';
import { checkLimits, detectStructuring, limitsFor } from './limits';
import {
  TRANSFER_PURPOSES,
  formatTransferReference,
  isPersonalPurpose,
  maskRecipientAccount,
  recipientMethod,
} from '../transfer/transfer';

const noUsage = { todayMinorUnits: 0n, monthMinorUnits: 0n };

describe('tiered KYC limits', () => {
  it('lets tier 0 hold an account but move nothing', () => {
    const decision = checkLimits(0, Money.fromDecimalString('100.00', 'RUB'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.window).toBe('PER_TRANSFER');
      expect(decision.upgradeTo).toBe(1);
    }
  });

  it('allows a transfer inside the tier cap', () => {
    expect(checkLimits(1, Money.fromDecimalString('10000.00', 'RUB'), noUsage).allowed).toBe(true);
  });

  it('rejects a transfer above the per-transfer cap and names the upgrade tier', () => {
    const decision = checkLimits(1, Money.fromDecimalString('50000.00', 'RUB'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.window).toBe('PER_TRANSFER');
      expect(decision.upgradeTo).toBe(2);
    }
  });

  it('counts prior usage against the daily window', () => {
    const decision = checkLimits(1, Money.fromDecimalString('15000.00', 'RUB'), {
      todayMinorUnits: 2_000_000n,
      monthMinorUnits: 2_000_000n,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.window).toBe('DAILY');
  });

  it('counts prior usage against the monthly window', () => {
    const decision = checkLimits(2, Money.fromDecimalString('100000.00', 'RUB'), {
      todayMinorUnits: 0n,
      monthMinorUnits: 99_500_000n,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.window).toBe('MONTHLY');
  });

  it('rejects a currency the tier has no configured limit for', () => {
    const decision = checkLimits(2, Money.fromDecimalString('10.00', 'USD'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.upgradeTo).toBeNull();
  });

  it('reports no upgrade when even the top tier will not permit the amount', () => {
    const decision = checkLimits(1, Money.fromDecimalString('9000000.00', 'RUB'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.upgradeTo).toBeNull();
  });

  it('exposes the configured limits for display', () => {
    expect(limitsFor(2, 'RUB')?.perTransferMinorUnits).toBe(10_000_000n);
    // USD is a treasury currency, never a send currency, so it has no row.
    expect(limitsFor(2, 'USD')).toBeUndefined();
  });
});

/**
 * NGN and GHS became send currencies with the intra-African corridors. Before
 * that they had no rows at all, and `checkLimits` fails closed on a missing
 * row — so a Nigerian sender would have been refused with "no configured
 * limit" rather than by a limit. These tests exist to keep the rows present.
 */
describe('intra-African send limits', () => {
  it('caps a tier 1 naira sender and names the upgrade tier', () => {
    expect(checkLimits(1, Money.fromDecimalString('40000.00', 'NGN'), noUsage).allowed).toBe(true);

    const decision = checkLimits(1, Money.fromDecimalString('120000.00', 'NGN'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.window).toBe('PER_TRANSFER');
      expect(decision.upgradeTo).toBe(2);
    }
  });

  it('caps a tier 1 cedi sender at the daily aggregate, not per transfer', () => {
    // The Bank of Ghana states the minimum-KYC wallet tier as a daily total,
    // so one transfer at the cap is allowed and the next one is not.
    expect(checkLimits(1, Money.fromDecimalString('1000.00', 'GHS'), noUsage).allowed).toBe(true);

    const decision = checkLimits(1, Money.fromDecimalString('1.00', 'GHS'), {
      todayMinorUnits: 100_000n,
      monthMinorUnits: 100_000n,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.window).toBe('DAILY');
  });

  it('gives tier 0 a row in every send currency, so nobody moves money unverified', () => {
    for (const currency of ['RUB', 'BYN', 'NGN', 'GHS', 'ZAR', 'XAF', 'XOF'] as const) {
      expect(limitsFor(0, currency)?.perTransferMinorUnits).toBe(0n);
    }
  });

  /**
   * The CFA francs have no decimals, so a limit reads as whole francs. A row
   * copied across from a two-decimal currency would be wrong by a hundredfold
   * and would still look like a plausible number, which is why this asserts the
   * magnitude rather than merely the presence of the row.
   */
  it('caps a tier 1 CFA sender in whole francs', () => {
    expect(limitsFor(1, 'XOF')?.perTransferMinorUnits).toBe(200_000n);
    expect(checkLimits(1, Money.fromDecimalString('200000', 'XOF'), noUsage).allowed).toBe(true);

    const decision = checkLimits(1, Money.fromDecimalString('200001', 'XOF'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.window).toBe('PER_TRANSFER');
  });

  it('holds XAF and XOF at par but keeps them separate rows', () => {
    expect(limitsFor(2, 'XAF')).toEqual(limitsFor(2, 'XOF'));
    // Parity is a fact about the peg, not permission to substitute one for the
    // other: the money type refuses to mix them.
    expect(() =>
      Money.fromDecimalString('1000', 'XAF').add(Money.fromDecimalString('1000', 'XOF') as never),
    ).toThrow();
  });

  /**
   * The rand gained tier rows when South Africa became an origin. These are the
   * KYC caps only: a South African sender is usually bounded first by their
   * exchange-control allowance, which is a different question answered in
   * `exchange-control.ts`. Both apply, and the tighter one wins.
   */
  it('caps a rand sender by tier, independently of exchange control', () => {
    expect(checkLimits(2, Money.fromDecimalString('40000.00', 'ZAR'), noUsage).allowed).toBe(true);

    const decision = checkLimits(2, Money.fromDecimalString('60000.00', 'ZAR'), noUsage);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.window).toBe('PER_TRANSFER');
      expect(decision.upgradeTo).toBe(3);
    }
  });
});

describe('structuring detection', () => {
  it('flags a run of transfers sitting just under a threshold', () => {
    const threshold = 10_000_000n; // 100 000,00 ₽
    const amounts = [9_600_000n, 9_800_000n, 9_500_000n];
    const signal = detectStructuring(amounts, threshold);
    expect(signal.detected).toBe(true);
    expect(signal.nearThresholdCount).toBe(3);
  });

  it('does not flag ordinary small transfers', () => {
    const signal = detectStructuring([100_000n, 250_000n, 90_000n], 10_000_000n);
    expect(signal.detected).toBe(false);
  });

  it('does not flag amounts at or above the threshold — those are reported, not structured', () => {
    const signal = detectStructuring([10_000_000n, 12_000_000n, 20_000_000n], 10_000_000n);
    expect(signal.nearThresholdCount).toBe(0);
    expect(signal.detected).toBe(false);
  });

  it('honours a custom band and count', () => {
    const signal = detectStructuring([9_000_000n, 9_100_000n], 10_000_000n, {
      bandBps: 2000,
      minCount: 2,
    });
    expect(signal.detected).toBe(true);
  });
});

describe('recipient details', () => {
  const bank = {
    method: 'BANK_ACCOUNT',
    country: 'NG',
    accountNumber: '0123456789',
    bankCode: '058',
    declaredName: 'ADEBAYO OKONKWO',
  } as const;

  const momo = {
    method: 'MOBILE_MONEY',
    country: 'GH',
    msisdn: '233241234567',
    network: 'MTN',
    declaredName: 'AMA MENSAH',
  } as const;

  it('reports its payout method', () => {
    expect(recipientMethod(bank)).toBe('BANK_ACCOUNT');
    expect(recipientMethod(momo)).toBe('MOBILE_MONEY');
  });

  it('masks all but the last four digits', () => {
    expect(maskRecipientAccount(bank)).toBe('******6789');
    expect(maskRecipientAccount(momo)).toBe('********4567');
    expect(maskRecipientAccount({ ...bank, accountNumber: '12' })).toBe('**');
  });

  it('accepts only personal transfer purposes (guardrail G2)', () => {
    for (const purpose of TRANSFER_PURPOSES) {
      expect(isPersonalPurpose(purpose)).toBe(true);
    }
    expect(isPersonalPurpose('INVOICE_SETTLEMENT')).toBe(false);
    expect(isPersonalPurpose('SUPPLIER_PAYMENT')).toBe(false);
    expect(isPersonalPurpose(42)).toBe(false);
  });

  it('formats a human-quotable reference', () => {
    expect(formatTransferReference('a1b2c3d4e5')).toBe('MP-A1B2-C3D4');
    expect(formatTransferReference('xy')).toBe('MP-XY00-0000');
  });
});
