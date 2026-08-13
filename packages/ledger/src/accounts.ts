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
  'FLOAT_RUB',
  'FLOAT_NGN',
  'FLOAT_GHS',
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
  FLOAT_RUB: 'DEBIT',
  FLOAT_NGN: 'DEBIT',
  FLOAT_GHS: 'DEBIT',
  TREASURY_USD: 'DEBIT',
  FEE_REVENUE: 'CREDIT',
  FX_PNL: 'CREDIT',
  PARTNER_RECEIVABLE: 'DEBIT',
  SUSPENSE: 'DEBIT',
};

/** The currency each float/treasury account must be denominated in. */
export const FIXED_CURRENCY: Readonly<Partial<Record<AccountType, CurrencyCode>>> = {
  FLOAT_RUB: 'RUB',
  FLOAT_NGN: 'NGN',
  FLOAT_GHS: 'GHS',
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
 * The system accounts every environment must have. Per-user `USER_PAYABLE`
 * accounts are created on demand; everything here is created by the seed.
 */
export const SYSTEM_ACCOUNTS: ReadonlyArray<{
  readonly type: AccountType;
  readonly currency: CurrencyCode;
  readonly partition: Partition;
  readonly scope?: string;
}> = [
  { type: 'FLOAT_RUB', currency: 'RUB', partition: 'NEUTRAL' },
  { type: 'FLOAT_NGN', currency: 'NGN', partition: 'NEUTRAL' },
  { type: 'FLOAT_GHS', currency: 'GHS', partition: 'NEUTRAL' },
  { type: 'TREASURY_USD', currency: 'USD', partition: 'NEUTRAL' },
  { type: 'FEE_REVENUE', currency: 'RUB', partition: 'NEUTRAL' },
  { type: 'FEE_REVENUE', currency: 'BYN', partition: 'NEUTRAL' },
  { type: 'FX_PNL', currency: 'RUB', partition: 'NEUTRAL' },
  { type: 'FX_PNL', currency: 'NGN', partition: 'NEUTRAL' },
  { type: 'FX_PNL', currency: 'GHS', partition: 'NEUTRAL' },
  { type: 'PARTNER_RECEIVABLE', currency: 'RUB', partition: 'NEUTRAL', scope: 'SETTLEMENT' },
  { type: 'PARTNER_RECEIVABLE', currency: 'BYN', partition: 'NEUTRAL', scope: 'SETTLEMENT' },
  { type: 'PARTNER_RECEIVABLE', currency: 'NGN', partition: 'NEUTRAL', scope: 'SETTLEMENT' },
  { type: 'PARTNER_RECEIVABLE', currency: 'GHS', partition: 'NEUTRAL', scope: 'SETTLEMENT' },
  { type: 'FEE_REVENUE', currency: 'NGN', partition: 'NEUTRAL' },
  { type: 'SUSPENSE', currency: 'RUB', partition: 'NEUTRAL' },
  { type: 'SUSPENSE', currency: 'NGN', partition: 'NEUTRAL' },
  { type: 'SUSPENSE', currency: 'GHS', partition: 'NEUTRAL' },
];

export function assertAccountCurrency(type: AccountType, currency: CurrencyCode): void {
  const required = FIXED_CURRENCY[type];
  if (required !== undefined && required !== currency) {
    throw new Error(`${type} accounts must be denominated in ${required}, not ${currency}`);
  }
}
