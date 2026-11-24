import { z } from 'zod';
import {
  COUNTRY_CODES,
  CURRENCY_CODES,
  type CountryCode as DomainCountryCode,
  type CurrencyCode as DomainCurrencyCode,
} from '@morapay/domain';

/**
 * Shared wire vocabulary.
 *
 * One definition of every DTO, imported by the API and by both front ends. The
 * previous generation of this product wrote them twice and they drifted — see
 * ADR 0002.
 */

/**
 * Money on the wire.
 *
 * `minorUnits` is a string, and it is the authoritative field. `amount` and
 * `formatted` are for display. Nothing here is a JSON number, because a JSON
 * number is a double (guardrail 12).
 */
export const moneySchema = z.object({
  amount: z.string(),
  currency: z.string(),
  minorUnits: z.string(),
  formatted: z.string(),
});
export type MoneyDto = z.infer<typeof moneySchema>;

/**
 * Currencies and countries come from `@morapay/domain` rather than being
 * listed again here.
 *
 * They were listed twice until the mesh grew to fifteen African countries, at
 * which point the copies disagreed and the API rejected a registration for a
 * country the corridor engine was happily quoting. The domain is the registry;
 * this is the wire projection of it, and a country added there reaches the API
 * schema and both front ends with no second edit.
 *
 * The casts are zod's requirement for a non-empty tuple, not a widening: the
 * arrays come from the domain typed and non-empty.
 */
export const currencyCodeSchema = z.enum(
  CURRENCY_CODES as unknown as [DomainCurrencyCode, ...DomainCurrencyCode[]],
);
export type CurrencyCodeDto = z.infer<typeof currencyCodeSchema>;

export const countryCodeSchema = z.enum(
  COUNTRY_CODES as unknown as [DomainCountryCode, ...DomainCountryCode[]],
);
export type CountryCodeDto = z.infer<typeof countryCodeSchema>;

export const payoutMethodSchema = z.enum(['BANK_ACCOUNT', 'MOBILE_MONEY']);
export const payinMethodSchema = z.enum(['SBP', 'QR', 'CARD', 'VIRTUAL_ACCOUNT', 'MOBILE_MONEY']);

export const transferStateSchema = z.enum([
  'DRAFT',
  'QUOTED',
  'COMPLIANCE_PENDING',
  'ON_HOLD',
  'AWAITING_PAYIN',
  'PAYIN_CONFIRMED',
  'SETTLING',
  'PAYOUT_INITIATED',
  'PAYOUT_CONFIRMED',
  'COMPLETED',
  'REFUNDING',
  'REFUNDED',
  'FAILED',
]);
export type TransferStateDto = z.infer<typeof transferStateSchema>;

export const transferPurposeSchema = z.enum([
  'FAMILY_SUPPORT',
  'EDUCATION',
  'MEDICAL',
  'GIFT',
  'OWN_ACCOUNT',
]);
export type TransferPurposeDto = z.infer<typeof transferPurposeSchema>;

/** Every error the API returns has this shape. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  correlationId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/**
 * Idempotency key, supplied by the client on every financial write
 * (guardrail 6). A UUID from the client is fine; anything opaque and unique is.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8, 'an idempotency key must be at least 8 characters')
  .max(128);

export const localeSchema = z.enum(['ru', 'en', 'fr']);
export type LocaleDto = z.infer<typeof localeSchema>;
