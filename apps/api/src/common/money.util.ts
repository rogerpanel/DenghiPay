import { CurrencyCode, Money, requireCurrencyCode } from '@morapay/domain';

/**
 * Conversion between the database representation (BigInt minor units + a
 * currency string) and `Money`.
 *
 * Both directions go through `requireCurrencyCode`, so a currency string that
 * is not in the registry fails loudly rather than propagating.
 */

export function toMoney(minorUnits: bigint, currency: string): Money<CurrencyCode> {
  return Money.fromMinorUnits(minorUnits, requireCurrencyCode(currency));
}

export function fromMoney(money: Money<CurrencyCode>): {
  minorUnits: bigint;
  currency: CurrencyCode;
} {
  return { minorUnits: money.minorUnits, currency: money.currency };
}

/**
 * Wire representation for an amount.
 *
 * `minorUnits` is a string, not a number: a naira amount in kobo can exceed
 * what a JSON parser will hold exactly, and sending a float would violate
 * guardrail 12 at our own boundary rather than a provider's.
 */
export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly formatted: string;
}

export function toMoneyDto(money: Money<CurrencyCode>): MoneyDto {
  return {
    amount: money.toDecimalString(),
    currency: money.currency,
    minorUnits: money.minorUnits.toString(),
    formatted: money.format(),
  };
}

export function moneyDtoFrom(minorUnits: bigint, currency: string): MoneyDto {
  return toMoneyDto(toMoney(minorUnits, currency));
}
