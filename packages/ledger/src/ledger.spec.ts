import { describe, expect, it } from 'vitest';
import { Money, PayoutOutcome, asProviderRef } from '@morapay/domain';
import { InMemoryLedgerStore } from './memory-store';
import { LedgerService } from './service';
import { SYSTEM_ACCOUNTS, accountCode, assertAccountCurrency, userPayableCode } from './accounts';
import { IdempotencyConflictError, InvalidEntryError, UnbalancedTransactionError } from './errors';
import {
  DraftTransaction,
  fingerprintDraft,
  transactionTotals,
  validateDraft,
} from './transaction';
import { assertNoDrift, ledgerIsBalanced } from './balances';
import {
  fxDifference,
  floatPrefunding,
  payinConfirmed,
  postPayoutResult,
  refundExecuted,
  settlementIn,
  settlementOut,
  suspenseEntry,
} from './postings';

const OCCURRED = new Date('2026-08-13T10:00:00Z');

async function setup() {
  const store = new InMemoryLedgerStore();
  const ledger = new LedgerService(store);
  for (const spec of SYSTEM_ACCOUNTS) {
    await ledger.ensureAccount(spec);
  }
  const userPayable = await ledger.ensureAccount({
    type: 'USER_PAYABLE',
    currency: 'RUB',
    partition: 'NEUTRAL',
    scope: 'user_demo',
    ownerRef: 'user_demo',
  });
  return { store, ledger, userPayable };
}

describe('ledger — the balance invariant', () => {
  it('refuses to persist a transaction that does not balance (DoD 1.2)', async () => {
    const { ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));

    const unbalanced: DraftTransaction = {
      reason: 'PAYIN_CONFIRMED',
      description: 'deliberately wrong',
      occurredAt: OCCURRED,
      reference: 'transfer_1',
      entries: [
        {
          accountId: floatRub.id,
          direction: 'DEBIT',
          amount: Money.fromDecimalString('100.00', 'RUB'),
        },
        {
          accountId: userPayable.id,
          direction: 'CREDIT',
          amount: Money.fromDecimalString('99.00', 'RUB'),
        },
      ],
    };

    await expect(ledger.post(unbalanced, 'key-unbalanced')).rejects.toThrow(
      UnbalancedTransactionError,
    );
    // And nothing was written.
    expect(await ledger.transactionsFor('transfer_1')).toHaveLength(0);
  });

  it('does not let two currencies net each other out', async () => {
    const { ledger } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const floatNgn = await ledger.accountByCode(accountCode('FLOAT_NGN', 'NGN'));

    const crossCurrency: DraftTransaction = {
      reason: 'SETTLEMENT_OUT',
      description: 'rubles against naira',
      occurredAt: OCCURRED,
      reference: null,
      entries: [
        {
          accountId: floatNgn.id,
          direction: 'DEBIT',
          amount: Money.fromDecimalString('100.00', 'NGN'),
        },
        {
          accountId: floatRub.id,
          direction: 'CREDIT',
          amount: Money.fromDecimalString('100.00', 'RUB'),
        },
      ],
    };

    expect(() => validateDraft(crossCurrency)).toThrow(UnbalancedTransactionError);
  });

  it('rejects single-entry and non-positive-amount drafts', async () => {
    const { ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));

    expect(() =>
      validateDraft({
        reason: 'GENESIS',
        description: 'one-sided',
        occurredAt: OCCURRED,
        reference: null,
        entries: [
          {
            accountId: floatRub.id,
            direction: 'DEBIT',
            amount: Money.fromDecimalString('1.00', 'RUB'),
          },
        ],
      }),
    ).toThrow(InvalidEntryError);

    expect(() =>
      validateDraft({
        reason: 'GENESIS',
        description: 'negative amount',
        occurredAt: OCCURRED,
        reference: null,
        entries: [
          {
            accountId: floatRub.id,
            direction: 'DEBIT',
            amount: Money.fromDecimalString('-1.00', 'RUB'),
          },
          {
            accountId: userPayable.id,
            direction: 'CREDIT',
            amount: Money.fromDecimalString('-1.00', 'RUB'),
          },
        ],
      }),
    ).toThrow(InvalidEntryError);
  });
});

describe('ledger — idempotency (DoD 1.3)', () => {
  it('creates exactly one transaction under 100 concurrent identical requests', async () => {
    const { ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const feeRevenue = await ledger.accountByCode(accountCode('FEE_REVENUE', 'RUB'));

    const draft = payinConfirmed({
      transferId: 'transfer_concurrent',
      occurredAt: OCCURRED,
      floatAccountId: floatRub.id,
      userPayableAccountId: userPayable.id,
      feeRevenueAccountId: feeRevenue.id,
      totalReceived: Money.fromDecimalString('100150.00', 'RUB'),
      fee: Money.fromDecimalString('150.00', 'RUB'),
    });

    const results = await Promise.all(
      Array.from({ length: 100 }, () => ledger.postWithReplayFlag(draft, 'idem-payin-1')),
    );

    const ids = new Set(results.map((r) => r.transaction.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await ledger.transactionsFor('transfer_concurrent')).toHaveLength(1);

    // And the money only moved once.
    expect((await ledger.balanceOfAccount(floatRub)).toDecimalString()).toBe('100150.00');
    expect((await ledger.balanceOfAccount(userPayable)).toDecimalString()).toBe('100000.00');
    expect((await ledger.balanceOfAccount(feeRevenue)).toDecimalString()).toBe('150.00');
  });

  it('rejects a reused key carrying different content', async () => {
    const { ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const feeRevenue = await ledger.accountByCode(accountCode('FEE_REVENUE', 'RUB'));

    const first = payinConfirmed({
      transferId: 'transfer_a',
      occurredAt: OCCURRED,
      floatAccountId: floatRub.id,
      userPayableAccountId: userPayable.id,
      feeRevenueAccountId: feeRevenue.id,
      totalReceived: Money.fromDecimalString('100.00', 'RUB'),
      fee: Money.fromDecimalString('0.00', 'RUB'),
    });
    const second = {
      ...first,
      entries: first.entries.map((e) => ({ ...e })),
      reference: 'transfer_b',
    };

    await ledger.post(first, 'same-key');
    await expect(ledger.post(second, 'same-key')).rejects.toThrow(IdempotencyConflictError);
  });

  it('fingerprints ignore entry ordering but not entry content', () => {
    const base: DraftTransaction = {
      reason: 'GENESIS',
      description: 'x',
      occurredAt: OCCURRED,
      reference: 'r',
      entries: [
        { accountId: 'a', direction: 'DEBIT', amount: Money.fromDecimalString('1.00', 'RUB') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.fromDecimalString('1.00', 'RUB') },
      ],
    };
    const reordered: DraftTransaction = { ...base, entries: [...base.entries].reverse() };
    const changed: DraftTransaction = {
      ...base,
      entries: [
        { accountId: 'a', direction: 'DEBIT', amount: Money.fromDecimalString('2.00', 'RUB') },
        { accountId: 'b', direction: 'CREDIT', amount: Money.fromDecimalString('2.00', 'RUB') },
      ],
    };
    expect(fingerprintDraft(base)).toBe(fingerprintDraft(reordered));
    expect(fingerprintDraft(base)).not.toBe(fingerprintDraft(changed));
  });
});

describe('ledger — derived balances and drift (DoD 1.4)', () => {
  it('derives balances from entries and refreshes the snapshot', async () => {
    const { ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const feeRevenue = await ledger.accountByCode(accountCode('FEE_REVENUE', 'RUB'));

    await ledger.post(
      payinConfirmed({
        transferId: 't1',
        occurredAt: OCCURRED,
        floatAccountId: floatRub.id,
        userPayableAccountId: userPayable.id,
        feeRevenueAccountId: feeRevenue.id,
        totalReceived: Money.fromDecimalString('50150.00', 'RUB'),
        fee: Money.fromDecimalString('150.00', 'RUB'),
      }),
      'idem-t1',
    );

    expect((await ledger.balanceOf(userPayableCode('RUB', 'user_demo'))).toDecimalString()).toBe(
      '50000.00',
    );
    const verification = await ledger.refreshSnapshot(floatRub);
    expect(verification).toBeNull(); // first snapshot, nothing to compare against
    const second = await ledger.refreshSnapshot(floatRub);
    expect(second?.ok).toBe(true);
  });

  it('catches a manually corrupted snapshot', async () => {
    const { store, ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const feeRevenue = await ledger.accountByCode(accountCode('FEE_REVENUE', 'RUB'));

    await ledger.post(
      payinConfirmed({
        transferId: 't2',
        occurredAt: OCCURRED,
        floatAccountId: floatRub.id,
        userPayableAccountId: userPayable.id,
        feeRevenueAccountId: feeRevenue.id,
        totalReceived: Money.fromDecimalString('1000.00', 'RUB'),
        fee: Money.fromDecimalString('0.00', 'RUB'),
      }),
      'idem-t2',
    );
    await ledger.refreshSnapshot(floatRub);

    store.corruptSnapshotForTest(floatRub.id, 999_999n);

    const drifts = (await ledger.detectDrift()).filter((d) => !d.ok);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]?.accountId).toBe(floatRub.id);
    expect(() => assertNoDrift(drifts[0]!)).toThrow(/Balance drift/);
  });
});

describe('ledger — a complete transfer lifecycle balances to zero (DoD 5.3)', () => {
  it('books pay-in, settlement, FX difference and payout with a zero net ledger', async () => {
    const { store, ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const floatNgn = await ledger.accountByCode(accountCode('FLOAT_NGN', 'NGN'));
    const feeRevenue = await ledger.accountByCode(accountCode('FEE_REVENUE', 'RUB'));
    const prRub = await ledger.accountByCode(
      accountCode('PARTNER_RECEIVABLE', 'RUB', 'SETTLEMENT'),
    );
    const prNgn = await ledger.accountByCode(
      accountCode('PARTNER_RECEIVABLE', 'NGN', 'SETTLEMENT'),
    );
    const fxPnlNgn = await ledger.accountByCode(accountCode('FX_PNL', 'NGN'));

    const sendAmount = Money.fromDecimalString('100000.00', 'RUB');
    const fee = Money.fromDecimalString('150.00', 'RUB');
    const recipientAmount = Money.fromDecimalString('1862861.55', 'NGN');

    await ledger.post(
      payinConfirmed({
        transferId: 'lifecycle',
        occurredAt: OCCURRED,
        floatAccountId: floatRub.id,
        userPayableAccountId: userPayable.id,
        feeRevenueAccountId: feeRevenue.id,
        totalReceived: sendAmount.add(fee),
        fee,
      }),
      'lc-payin',
    );

    await ledger.post(
      settlementOut({
        transferId: 'lifecycle',
        occurredAt: OCCURRED,
        sourceFloatAccountId: floatRub.id,
        partnerReceivableAccountId: prRub.id,
        amount: sendAmount,
      }),
      'lc-settle-out',
    );

    await ledger.post(
      settlementIn({
        transferId: 'lifecycle',
        occurredAt: OCCURRED,
        destinationFloatAccountId: floatNgn.id,
        partnerReceivableAccountId: prNgn.id,
        amount: recipientAmount,
      }),
      'lc-settle-in',
    );

    // The NGN receivable is now negative — value arrived that nothing had yet
    // been booked against on that side. The FX difference squares it.
    await ledger.post(
      fxDifference({
        transferId: 'lifecycle',
        occurredAt: OCCURRED,
        partnerReceivableAccountId: prNgn.id,
        fxPnlAccountId: fxPnlNgn.id,
        difference: recipientAmount,
      }),
      'lc-fx',
    );

    const settled: PayoutOutcome = {
      _tag: 'SETTLED',
      providerRef: asProviderRef('PAYCREST-123'),
      institutionRef: 'NIP-998877',
      settledAt: OCCURRED,
    };
    for (const draft of postPayoutResult(settled, {
      transferId: 'lifecycle',
      occurredAt: OCCURRED,
      userPayableAccountId: userPayable.id,
      destinationFloatAccountId: floatNgn.id,
      userPayableAmount: sendAmount,
      payoutAmount: recipientAmount,
    })) {
      await ledger.post(draft, 'lc-payout');
    }

    // Whole-ledger invariant.
    const { balanced, byCurrency } = ledgerIsBalanced(await store.allEntries());
    expect(balanced).toBe(true);
    expect(byCurrency.get('RUB')).toBe(0n);
    expect(byCurrency.get('NGN')).toBe(0n);

    // The sender is no longer owed anything, and the fee stayed with us.
    expect((await ledger.balanceOfAccount(userPayable)).isZero).toBe(true);
    expect((await ledger.balanceOfAccount(feeRevenue)).toDecimalString()).toBe('150.00');
    expect((await ledger.balanceOfAccount(prRub)).toDecimalString()).toBe('100000.00');
  });

  it('posts nothing at all for a pending or failed payout', () => {
    const input = {
      transferId: 'x',
      occurredAt: OCCURRED,
      userPayableAccountId: 'up',
      destinationFloatAccountId: 'fl',
      userPayableAmount: Money.fromDecimalString('1.00', 'RUB'),
      payoutAmount: Money.fromDecimalString('18.00', 'NGN'),
    };
    expect(
      postPayoutResult({ _tag: 'PENDING', providerRef: asProviderRef('r') }, input),
    ).toHaveLength(0);
    expect(
      postPayoutResult(
        {
          _tag: 'FAILED',
          providerRef: asProviderRef('r'),
          code: 'ACCOUNT_CLOSED',
          reason: 'closed',
          retryable: false,
        },
        input,
      ),
    ).toHaveLength(0);
  });
});

describe('ledger — refunds, prefunding and suspense', () => {
  it('mirrors the original entries on refund', async () => {
    const { ledger, userPayable } = await setup();
    const floatRub = await ledger.accountByCode(accountCode('FLOAT_RUB', 'RUB'));
    const feeRevenue = await ledger.accountByCode(accountCode('FEE_REVENUE', 'RUB'));

    await ledger.post(
      payinConfirmed({
        transferId: 'refundable',
        occurredAt: OCCURRED,
        floatAccountId: floatRub.id,
        userPayableAccountId: userPayable.id,
        feeRevenueAccountId: feeRevenue.id,
        totalReceived: Money.fromDecimalString('5000.00', 'RUB'),
        fee: Money.fromDecimalString('0.00', 'RUB'),
      }),
      'r-payin',
    );

    await ledger.post(
      refundExecuted({
        transferId: 'refundable',
        occurredAt: OCCURRED,
        userPayableAccountId: userPayable.id,
        sourceFloatAccountId: floatRub.id,
        amount: Money.fromDecimalString('5000.00', 'RUB'),
        approvedBy: 'officer_2',
        reasonCode: 'RECIPIENT_UNREACHABLE',
      }),
      'r-refund',
    );

    expect((await ledger.balanceOfAccount(userPayable)).isZero).toBe(true);
    expect((await ledger.balanceOfAccount(floatRub)).isZero).toBe(true);

    const postings = await ledger.transactionsFor('refundable');
    expect(postings.map((p) => p.reason)).toEqual(['PAYIN_CONFIRMED', 'REFUND_EXECUTED']);
    expect(postings[1]?.metadata.approvedBy).toBe('officer_2');
  });

  it('refuses prefunding where requester and approver are the same identity (G6)', () => {
    expect(() =>
      floatPrefunding({
        prefundingId: 'pf_1',
        occurredAt: OCCURRED,
        floatAccountId: 'float',
        treasuryAccountId: 'treasury',
        amount: Money.fromDecimalString('1000.00', 'USD'),
        requestedBy: 'same_person',
        approvedBy: 'same_person',
      }),
    ).toThrow(/Four-eyes/);
  });

  it('refuses to post a zero FX difference', () => {
    expect(() =>
      fxDifference({
        transferId: 't',
        occurredAt: OCCURRED,
        partnerReceivableAccountId: 'pr',
        fxPnlAccountId: 'fx',
        difference: Money.zero('NGN'),
      }),
    ).toThrow(/zero/i);
  });

  it('books an FX loss on the other side from an FX gain', () => {
    const loss = fxDifference({
      transferId: 't',
      occurredAt: OCCURRED,
      partnerReceivableAccountId: 'pr',
      fxPnlAccountId: 'fx',
      difference: Money.fromDecimalString('-25.00', 'NGN'),
    });
    expect(loss.entries[0]?.accountId).toBe('fx');
    expect(loss.entries[0]?.direction).toBe('DEBIT');
  });

  it('books unmatched items to suspense', () => {
    const draft = suspenseEntry({
      reference: 'stmt-line-9',
      occurredAt: OCCURRED,
      suspenseAccountId: 'susp',
      counterpartyAccountId: 'float',
      amount: Money.fromDecimalString('10.00', 'NGN'),
      note: 'unmatched credit',
    });
    expect(() => validateDraft(draft)).not.toThrow();
    expect(transactionTotals(draft).get('NGN')).toBe(1000n);
  });

  it('rejects a fee larger than the amount received', () => {
    expect(() =>
      payinConfirmed({
        transferId: 't',
        occurredAt: OCCURRED,
        floatAccountId: 'f',
        userPayableAccountId: 'u',
        feeRevenueAccountId: 'fee',
        totalReceived: Money.fromDecimalString('10.00', 'RUB'),
        fee: Money.fromDecimalString('11.00', 'RUB'),
      }),
    ).toThrow(/Fee exceeds/);
  });
});

describe('chart of accounts', () => {
  it('pins float accounts to their currency', () => {
    expect(() => assertAccountCurrency('FLOAT_NGN', 'RUB')).toThrow();
    expect(() => assertAccountCurrency('FLOAT_NGN', 'NGN')).not.toThrow();
    expect(() => assertAccountCurrency('FEE_REVENUE', 'GHS')).not.toThrow();
  });

  it('seeds a reproducible, balanced account tree (DoD 1.5)', async () => {
    const { store, ledger } = await setup();
    const accounts = await store.listAccounts();
    expect(accounts.length).toBe(
      new Set(SYSTEM_ACCOUNTS.map((s) => accountCode(s.type, s.currency, s.scope))).size + 1,
    );

    // A freshly seeded ledger has no entries, so it trivially balances — and
    // every account resolves by its code.
    for (const spec of SYSTEM_ACCOUNTS) {
      const account = await ledger.accountByCode(accountCode(spec.type, spec.currency, spec.scope));
      expect(account.currency).toBe(spec.currency);
    }
    expect(ledgerIsBalanced(await store.allEntries()).balanced).toBe(true);
  });

  it('is idempotent when seeded twice', async () => {
    const { store, ledger } = await setup();
    const before = (await store.listAccounts()).length;
    for (const spec of SYSTEM_ACCOUNTS) await ledger.ensureAccount(spec);
    expect((await store.listAccounts()).length).toBe(before);
  });

  it('raises a clear error for an unknown account code', async () => {
    const { ledger } = await setup();
    await expect(ledger.accountByCode('FLOAT_RUB:ZZZ')).rejects.toThrow(/No ledger account/);
  });
});
