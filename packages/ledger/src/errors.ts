export class LedgerError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The entries do not sum to zero in some currency. Nothing was persisted. */
export class UnbalancedTransactionError extends LedgerError {
  constructor(
    readonly currency: string,
    readonly debitMinorUnits: bigint,
    readonly creditMinorUnits: bigint,
  ) {
    super(
      `Transaction does not balance in ${currency}: debits ${debitMinorUnits} ≠ credits ${creditMinorUnits}`,
      'UNBALANCED_TRANSACTION',
    );
  }
}

export class InvalidEntryError extends LedgerError {
  constructor(message: string) {
    super(message, 'INVALID_ENTRY');
  }
}

/**
 * The same idempotency key arrived with different content. Returning the
 * original result would be wrong, and applying the new one would duplicate.
 */
export class IdempotencyConflictError extends LedgerError {
  constructor(readonly key: string) {
    super(
      `Idempotency key ${key} was already used with a different request body`,
      'IDEMPOTENCY_CONFLICT',
    );
  }
}

/** A snapshot disagrees with the entries it claims to summarise. */
export class BalanceDriftError extends LedgerError {
  constructor(
    readonly accountId: string,
    readonly snapshotMinorUnits: bigint,
    readonly derivedMinorUnits: bigint,
  ) {
    super(
      `Balance drift on account ${accountId}: snapshot ${snapshotMinorUnits} ≠ derived ${derivedMinorUnits}`,
      'BALANCE_DRIFT',
    );
  }
}

export class AccountNotFoundError extends LedgerError {
  constructor(readonly reference: string) {
    super(`No ledger account ${reference}`, 'ACCOUNT_NOT_FOUND');
  }
}
