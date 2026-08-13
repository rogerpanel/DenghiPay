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
    expect(limitsFor(2, 'GHS')).toBeUndefined();
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
