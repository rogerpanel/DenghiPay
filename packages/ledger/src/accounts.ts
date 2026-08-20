import { CurrencyCode } from '@morapay/domain';

/**
 * Chart of accounts (BUILD_PLAN 1.2).
 *
 * Nine account types, no more. If a movement does not fit one of them, that is
 * a signal to think, not to add a tenth.
 */
export const ACCOUNT_TYPES = [
  /** Our liability to a sender: their money, held by us, until payout confirms. */
  'USER_PAYABLE',
  /**
   * Money we hold at a partner or bank, ready to pay out, in one currency.
   *
   * One type, not one per currency. It used to be `FLOAT_RUB`, `FLOAT_NGN`,
   * `FLOAT_GHS` — the currency baked into the type name, duplicated in the
   * `currency` column beside it, and needing a new enum member plus a new
   * branch in two `floatTypeFor` functions for every country we opened. At
   * three currencies that was tolerable; at six it was a chore that would be
   * got wrong. The currency lives in the currency column, where it always was.
   */
  'FLOAT',
  'TREASURY_USD',
  'FEE_REVENUE',
  'FX_PNL',
  'PARTNER_RECEIVABLE',
  /** Where anything we cannot match lands, loudly. */
  'SUSPENSE',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Which side increases the account.
 *
 * Assets and receivables are debit-normal; liabilities, revenue and P&L are
 * credit-normal. Balance derivation applies this so a healthy account reads
 * positive.
 */
export const NORMAL_BALANCE: Readonly<Record<AccountType, 'DEBIT' | 'CREDIT'>> = {
  USER_PAYABLE: 'CREDIT',
  FLOAT: 'DEBIT',
  TREASURY_USD: 'DEBIT',
  FEE_REVENUE: 'CREDIT',
  FX_PNL: 'CREDIT',
  PARTNER_RECEIVABLE: 'DEBIT',
  SUSPENSE: 'DEBIT',
};

/** The currency an account type must be denominated in, where it is fixed. */
export const FIXED_CURRENCY: Readonly<Partial<Record<AccountType, CurrencyCode>>> = {
  TREASURY_USD: 'USD',
};

/** Data-residency partition an account belongs to (BUILD_PLAN 12.1). */
export const PARTITIONS = ['RU', 'NG', 'GH', 'NEUTRAL'] as const;
export type Partition = (typeof PARTITIONS)[number];

export interface Account {
  readonly id: string;
  /** Stable, human-readable key: `TYPE:CURRENCY[:scope]`. */
  readonly code: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly partition: Partition;
  /**
   * Tokenised owner reference for per-user accounts. Never a name, never an
   * email — only an opaque id, because the ledger lives in the neutral tier.
   */
  readonly ownerRef: string | null;
}

export function accountCode(type: AccountType, currency: CurrencyCode, scope?: string): string {
  return scope === undefined ? `${type}:${currency}` : `${type}:${currency}:${scope}`;
}

export function userPayableCode(currency: CurrencyCode, userRef: string): string {
  return accountCode('USER_PAYABLE', currency, userRef);
}

/**
 * Currencies the ledger holds positions in.
 *
 * Every one of these gets a float, a fee-revenue account, an FX P&L account, a
 * suspense account and a settlement receivable. That is more accounts than the
 * strict minimum — a destination-only currency never earns a fee, because fees
 * are charged at the origin — but the cost of an unused account is a row, and
 * the cost of a missing one is a transfer that cannot post. The saga looks
 * accounts up by code, so a gap is a hard failure at settlement time rather
 * than a warning at boot.
 *
 * USD is absent: it is the treasury asset, not a corridor currency, and it has
 * its own fixed-currency account type.
 */
export const LEDGER_CURRENCIES: readonly CurrencyCode[] = [
  'RUB',
  'BYN',
  'NGN',
  'GHS',
  'ZAR',
  'XAF',
  'XOF',
];

/**
 * The system accounts every environment must have. Per-user `USER_PAYABLE`
 * accounts are created on demand; everything here is created by the seed.
 *
 * Generated rather than listed, so opening a country is one entry in
 * `LEDGER_CURRENCIES` instead of five easily-forgotten rows.
 */
export const SYSTEM_ACCOUNTS: ReadonlyArray<{
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly partition: Partition;
  readonly scope?: string;
}> = [
  { type: 'TREASURY_USD' as const, currency: 'USD' as const, partition: 'NEUTRAL' as const },
  ...LEDGER_CURRENCIES.flatMap((currency) => [
    { type: 'FLOAT' as const, currency, partition: 'NEUTRAL' as const },
    { type: 'FEE_REVENUE' as const, currency, partition: 'NEUTRAL' as const },
    { type: 'FX_PNL' as const, currency, partition: 'NEUTRAL' as const },
    { type: 'SUSPENSE' as const, currency, partition: 'NEUTRAL' as const },
    {
      type: 'PARTNER_RECEIVABLE' as const,
      currency,
      partition: 'NEUTRAL' as const,
      scope: 'SETTLEMENT',
    },
  ]),
];

/** The float account holding our position in a currency. */
export function floatCode(currency: CurrencyCode): string {
  return accountCode('FLOAT', currency);
}

export function assertAccountCurrency(type: AccountType, currency: CurrencyCode): void {
  const required = FIXED_CURRENCY[type];
  if (required !== undefined && required !== currency) {
    throw new Error(`${type} accounts must be denominated in ${required}, not ${currency}`);
  }
}
