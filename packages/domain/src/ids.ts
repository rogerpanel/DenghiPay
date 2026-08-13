/**
 * Branded identifiers.
 *
 * These are compile-time only: at runtime every one of them is a string. The
 * brand exists so a `TransferId` cannot be passed where a `QuoteId` is expected,
 * which is the kind of mistake that is otherwise invisible in a call with five
 * string arguments.
 */

declare const brand: unique symbol;

export type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, 'UserId'>;
export type TransferId = Branded<string, 'TransferId'>;
export type QuoteId = Branded<string, 'QuoteId'>;
export type RecipientId = Branded<string, 'RecipientId'>;
export type AccountId = Branded<string, 'AccountId'>;
export type LedgerTransactionId = Branded<string, 'LedgerTransactionId'>;
export type IdempotencyKey = Branded<string, 'IdempotencyKey'>;
export type ProviderId = Branded<string, 'ProviderId'>;
export type ProviderRef = Branded<string, 'ProviderRef'>;
export type CorridorId = Branded<string, 'CorridorId'>;
export type ScreeningRecordId = Branded<string, 'ScreeningRecordId'>;

export const asUserId = (value: string): UserId => value as UserId;
export const asTransferId = (value: string): TransferId => value as TransferId;
export const asQuoteId = (value: string): QuoteId => value as QuoteId;
export const asRecipientId = (value: string): RecipientId => value as RecipientId;
export const asAccountId = (value: string): AccountId => value as AccountId;
export const asLedgerTransactionId = (value: string): LedgerTransactionId =>
  value as LedgerTransactionId;
export const asIdempotencyKey = (value: string): IdempotencyKey => value as IdempotencyKey;
export const asProviderId = (value: string): ProviderId => value as ProviderId;
export const asProviderRef = (value: string): ProviderRef => value as ProviderRef;
export const asCorridorId = (value: string): CorridorId => value as CorridorId;
export const asScreeningRecordId = (value: string): ScreeningRecordId => value as ScreeningRecordId;
