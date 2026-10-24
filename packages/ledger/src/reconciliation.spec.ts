import { describe, expect, it } from 'vitest';
import { Money } from '@morapay/domain';
import {
  LedgerMovement,
  StatementLine,
  ageSuspenseItems,
  breaksOf,
  reconcile,
} from './reconciliation';

const WINDOW = { start: new Date('2026-08-12T00:00:00Z'), end: new Date('2026-08-13T00:00:00Z') };
const DATE = new Date('2026-08-12T12:00:00Z');

function line(providerRef: string, amount: string): StatementLine {
  return {
    providerRef,
    amount: Money.fromDecimalString(amount, 'NGN'),
    valueDate: DATE,
    description: `partner line ${providerRef}`,
  };
}

function movement(reference: string, providerRef: string | null, amount: string): LedgerMovement {
  return {
    reference,
    providerRef,
    amount: Money.fromDecimalString(amount, 'NGN'),
    occurredAt: DATE,
    ledgerTransactionId: `ltx_${reference}`,
  };
}

describe('reconciliation (DoD 1.7)', () => {
  it('flags a statement with one missing and one duplicate line', () => {
    const statement = [
      line('P-1', '1000.00'),
      line('P-2', '2000.00'),
      line('P-2', '2000.00'), // duplicate delivery from the partner
      line('P-4', '4000.00'), // we never booked this
    ];
    const ledger = [
      movement('t1', 'P-1', '1000.00'),
      movement('t2', 'P-2', '2000.00'),
      movement('t3', 'P-3', '3000.00'), // we booked it, the partner did not report it
    ];

    const report = reconcile(statement, ledger, WINDOW);
    const kinds = report.findings.map((f) => f.kind).sort();

    expect(kinds).toContain('DUPLICATE_STATEMENT_LINE');
    expect(kinds).toContain('MISSING_IN_LEDGER');
    expect(kinds).toContain('MISSING_IN_STATEMENT');
    expect(report.matchedCount).toBe(2);
    expect(breaksOf(report)).toHaveLength(3);
  });

  it('flags an amount mismatch rather than overwriting our record', () => {
    const report = reconcile([line('P-1', '999.00')], [movement('t1', 'P-1', '1000.00')], WINDOW);
    const finding = report.findings[0];
    expect(finding?.kind).toBe('AMOUNT_MISMATCH');
    if (finding?.kind === 'AMOUNT_MISMATCH') {
      expect(finding.statementAmount.toDecimalString()).toBe('999.00');
      expect(finding.ledgerAmount.toDecimalString()).toBe('1000.00');
    }
  });

  it('treats a currency difference as a mismatch, not a match', () => {
    const statement: StatementLine[] = [
      {
        providerRef: 'P-1',
        amount: Money.fromDecimalString('1000.00', 'GHS'),
        valueDate: DATE,
        description: 'wrong currency',
      },
    ];
    const report = reconcile(statement, [movement('t1', 'P-1', '1000.00')], WINDOW);
    expect(report.findings[0]?.kind).toBe('AMOUNT_MISMATCH');
  });

  it('reports a ledger movement with no provider reference as missing from the statement', () => {
    // TECHNICAL_ARCHITECTURE §1.2 issue 10: the provider ref does not exist at
    // submit time, so an unreconciled movement legitimately has none yet.
    const report = reconcile([], [movement('t1', null, '500.00')], WINDOW);
    expect(report.findings[0]?.kind).toBe('MISSING_IN_STATEMENT');
    expect(report.breakCount).toBe(1);
  });

  it('reports a clean window with no breaks', () => {
    const report = reconcile([line('P-1', '10.00')], [movement('t1', 'P-1', '10.00')], WINDOW);
    expect(report.breakCount).toBe(0);
    expect(breaksOf(report)).toHaveLength(0);
  });
});

describe('suspense ageing', () => {
  it('buckets open items by age', () => {
    const now = new Date('2026-08-13T00:00:00Z');
    const buckets = ageSuspenseItems(
      [
        { openedAt: new Date('2026-08-12T18:00:00Z') },
        { openedAt: new Date('2026-08-09T00:00:00Z') },
        { openedAt: new Date('2026-07-25T00:00:00Z') },
        { openedAt: new Date('2026-05-01T00:00:00Z') },
      ],
      now,
    );
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]);
    expect(buckets.map((b) => b.label)).toEqual(['0-1d', '2-7d', '8-30d', '30d+']);
  });

  it('returns empty buckets for an empty list', () => {
    const buckets = ageSuspenseItems([], new Date());
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });
});
