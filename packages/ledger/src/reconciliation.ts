import { CurrencyCode, Money } from '@morapay/domain';

/**
 * Reconciliation primitives (BUILD_PLAN 1.7, 8.3).
 *
 * The statement is the authority (TECHNICAL_ARCHITECTURE §5). Where our ledger
 * and a partner statement disagree, the difference is reported and investigated
 * — it is never silently written over our own record.
 */

export interface StatementLine {
  /** The partner's own reference for the movement. */
  readonly providerRef: string;
  readonly amount: Money<CurrencyCode>;
  readonly valueDate: Date;
  readonly description: string;
}

export interface LedgerMovement {
  /** Our reference — the transfer id or prefunding id we keyed the posting on. */
  readonly reference: string;
  /** The provider reference we recorded, if the provider had given us one yet. */
  readonly providerRef: string | null;
  readonly amount: Money<CurrencyCode>;
  readonly occurredAt: Date;
  readonly ledgerTransactionId: string;
}

export type ReconciliationFinding =
  | {
      readonly kind: 'MATCHED';
      readonly providerRef: string;
      readonly ledgerTransactionId: string;
    }
  | {
      readonly kind: 'AMOUNT_MISMATCH';
      readonly providerRef: string;
      readonly ledgerTransactionId: string;
      readonly statementAmount: Money<CurrencyCode>;
      readonly ledgerAmount: Money<CurrencyCode>;
    }
  | {
      /** On the statement, absent from our ledger. Money moved that we did not book. */
      readonly kind: 'MISSING_IN_LEDGER';
      readonly providerRef: string;
      readonly statementAmount: Money<CurrencyCode>;
    }
  | {
      /** In our ledger, absent from the statement. We booked a movement the partner did not make. */
      readonly kind: 'MISSING_IN_STATEMENT';
      readonly reference: string;
      readonly ledgerTransactionId: string;
      readonly ledgerAmount: Money<CurrencyCode>;
    }
  | {
      readonly kind: 'DUPLICATE_STATEMENT_LINE';
      readonly providerRef: string;
      readonly occurrences: number;
    };

export interface ReconciliationReport {
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly findings: readonly ReconciliationFinding[];
  readonly matchedCount: number;
  readonly breakCount: number;
}

export function reconcile(
  statement: readonly StatementLine[],
  ledger: readonly LedgerMovement[],
  window: { readonly start: Date; readonly end: Date },
): ReconciliationReport {
  const findings: ReconciliationFinding[] = [];

  const statementByRef = new Map<string, StatementLine[]>();
  for (const line of statement) {
    const list = statementByRef.get(line.providerRef) ?? [];
    list.push(line);
    statementByRef.set(line.providerRef, list);
  }

  const ledgerByProviderRef = new Map<string, LedgerMovement>();
  for (const movement of ledger) {
    if (movement.providerRef !== null) {
      ledgerByProviderRef.set(movement.providerRef, movement);
    }
  }

  // Duplicates first: a repeated provider reference on one statement means the
  // partner has double-reported, and matching it once would hide the second.
  for (const [providerRef, lines] of statementByRef) {
    if (lines.length > 1) {
      findings.push({ kind: 'DUPLICATE_STATEMENT_LINE', providerRef, occurrences: lines.length });
    }
  }

  for (const [providerRef, lines] of statementByRef) {
    const line = lines[0];
    if (line === undefined) continue;
    const movement = ledgerByProviderRef.get(providerRef);
    if (movement === undefined) {
      findings.push({ kind: 'MISSING_IN_LEDGER', providerRef, statementAmount: line.amount });
      continue;
    }
    if (
      movement.amount.currency !== line.amount.currency ||
      movement.amount.minorUnits !== line.amount.minorUnits
    ) {
      findings.push({
        kind: 'AMOUNT_MISMATCH',
        providerRef,
        ledgerTransactionId: movement.ledgerTransactionId,
        statementAmount: line.amount,
        ledgerAmount: movement.amount,
      });
      continue;
    }
    findings.push({
      kind: 'MATCHED',
      providerRef,
      ledgerTransactionId: movement.ledgerTransactionId,
    });
  }

  for (const movement of ledger) {
    const seen = movement.providerRef !== null && statementByRef.has(movement.providerRef);
    if (!seen) {
      findings.push({
        kind: 'MISSING_IN_STATEMENT',
        reference: movement.reference,
        ledgerTransactionId: movement.ledgerTransactionId,
        ledgerAmount: movement.amount,
      });
    }
  }

  const matchedCount = findings.filter((f) => f.kind === 'MATCHED').length;
  return {
    windowStart: window.start,
    windowEnd: window.end,
    findings,
    matchedCount,
    breakCount: findings.length - matchedCount,
  };
}

/** Breaks only — what the ops team actually works through each morning. */
export function breaksOf(report: ReconciliationReport): readonly ReconciliationFinding[] {
  return report.findings.filter((f) => f.kind !== 'MATCHED');
}

export interface AgeingBucket {
  readonly label: string;
  readonly maxAgeDays: number;
  readonly count: number;
}

/** Ageing report for unresolved suspense items (BUILD_PLAN 8.3). */
export function ageSuspenseItems(
  items: readonly { readonly openedAt: Date }[],
  now: Date,
): readonly AgeingBucket[] {
  const buckets: { label: string; maxAgeDays: number; count: number }[] = [
    { label: '0-1d', maxAgeDays: 1, count: 0 },
    { label: '2-7d', maxAgeDays: 7, count: 0 },
    { label: '8-30d', maxAgeDays: 30, count: 0 },
    { label: '30d+', maxAgeDays: Number.POSITIVE_INFINITY, count: 0 },
  ];
  for (const item of items) {
    const ageDays = (now.getTime() - item.openedAt.getTime()) / 86_400_000;
    const bucket = buckets.find((b) => ageDays <= b.maxAgeDays) ?? buckets[buckets.length - 1];
    if (bucket !== undefined) bucket.count += 1;
  }
  return buckets;
}
