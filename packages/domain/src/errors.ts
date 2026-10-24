/** Base class for every error the domain raises deliberately. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Money was constructed or combined in a way that is not representable. */
export class MoneyError extends DomainError {
  constructor(message: string) {
    super(message, 'MONEY_ERROR');
  }
}

/** Two different currencies met in one arithmetic operation. */
export class CurrencyMismatchError extends MoneyError {
  constructor(left: string, right: string) {
    super(`Cannot combine ${left} and ${right}: cross-currency arithmetic is not defined`);
  }
}

/** A provider sent something that violates the contract we hold it to. */
export class ProviderContractError extends DomainError {
  constructor(message: string) {
    super(message, 'PROVIDER_CONTRACT_ERROR');
  }
}

/** A state machine was asked for a transition that does not exist. */
export class IllegalTransitionError extends DomainError {
  constructor(
    readonly from: string,
    readonly event: string,
  ) {
    super(`Illegal transition: no edge leaves ${from} on ${event}`, 'ILLEGAL_TRANSITION');
  }
}

/** Quoting was attempted with no usable rate. */
export class RateUnavailableError extends DomainError {
  constructor(message: string) {
    super(message, 'RATE_UNAVAILABLE');
  }
}
