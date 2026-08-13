/**
 * Currency registry.
 *
 * The exponent is the number of decimal digits in the minor unit, exactly as
 * defined by ISO 4217. Money is stored as an integer count of minor units;
 * the exponent exists only for parsing and display.
 *
 * Adding a currency here is the only supported way to introduce one. There is
 * deliberately no "unknown currency" fallback: an unrecognised code from a
 * provider is a contract error, not something to guess at.
 */

export const CURRENCIES = {
  RUB: { code: 'RUB', exponent: 2, name: 'Russian ruble', symbol: '₽' },
  BYN: { code: 'BYN', exponent: 2, name: 'Belarusian ruble', symbol: 'Br' },
  NGN: { code: 'NGN', exponent: 2, name: 'Nigerian naira', symbol: '₦' },
  GHS: { code: 'GHS', exponent: 2, name: 'Ghanaian cedi', symbol: '₵' },
  USD: { code: 'USD', exponent: 2, name: 'United States dollar', symbol: '$' },
  /** Settlement asset. Six decimals, per the ERC-20 contract — not two. */
  USDT: { code: 'USDT', exponent: 6, name: 'Tether USD', symbol: 'USDT' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export type Currency = (typeof CURRENCIES)[CurrencyCode];

export const CURRENCY_CODES = Object.keys(CURRENCIES) as readonly CurrencyCode[];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getCurrency<C extends CurrencyCode>(code: C): (typeof CURRENCIES)[C] {
  return CURRENCIES[code];
}

/**
 * Resolve a currency code received from an external system.
 * Throws rather than defaulting — see guardrail 12.
 */
export function requireCurrencyCode(value: unknown): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new Error(`Unknown currency code: ${JSON.stringify(value)}`);
  }
  return value;
}
