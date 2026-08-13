import { z } from 'zod';
import { countryCodeSchema } from './common';

/**
 * Recipient details, discriminated by payout method.
 *
 * Nigeria and Ghana are genuinely different shapes, so they are a discriminated
 * union rather than one object with optional fields. A Ghanaian mobile-money
 * recipient has no bank code and never will.
 */

export const ngRecipientSchema = z.object({
  method: z.literal('BANK_ACCOUNT'),
  country: z.literal('NG'),
  /** NUBAN is exactly ten digits. */
  accountNumber: z.string().regex(/^\d{10}$/, 'a Nigerian account number is 10 digits'),
  bankCode: z.string().regex(/^\d{3}$/, 'a Nigerian bank code is 3 digits'),
  declaredName: z.string().min(2).max(120),
});

export const ghRecipientSchema = z.object({
  method: z.literal('MOBILE_MONEY'),
  country: z.literal('GH'),
  /** E.164 without the plus: 233 followed by nine digits. */
  msisdn: z.string().regex(/^233\d{9}$/, 'a Ghanaian mobile number is 233 followed by 9 digits'),
  network: z.enum(['MTN', 'TELECEL', 'AIRTELTIGO']),
  declaredName: z.string().min(2).max(120),
});

export const recipientDetailsSchema = z.discriminatedUnion('method', [
  ngRecipientSchema,
  ghRecipientSchema,
]);
export type RecipientDetailsDto = z.infer<typeof recipientDetailsSchema>;

export const createRecipientRequestSchema = z.object({
  details: recipientDetailsSchema,
  nickname: z.string().max(60).optional(),
});
export type CreateRecipientRequest = z.infer<typeof createRecipientRequestSchema>;

/**
 * Name enquiry (BUILD_PLAN 7.2).
 *
 * This is the single feature that prevents most misdirected transfers: the
 * sender sees the name the institution holds before they commit, not after.
 */
export const nameEnquiryRequestSchema = z.object({
  details: recipientDetailsSchema,
});
export type NameEnquiryRequest = z.infer<typeof nameEnquiryRequestSchema>;

export const nameEnquiryResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('RESOLVED'),
    resolvedName: z.string(),
    institution: z.string(),
    /** Whether the resolved name is close enough to what the sender typed. */
    matchesDeclaredName: z.boolean(),
  }),
  z.object({ status: z.literal('NOT_FOUND'), reason: z.string() }),
  z.object({ status: z.literal('UNSUPPORTED'), reason: z.string() }),
]);
export type NameEnquiryResponse = z.infer<typeof nameEnquiryResponseSchema>;

export const recipientResponseSchema = z.object({
  id: z.string(),
  method: z.enum(['BANK_ACCOUNT', 'MOBILE_MONEY']),
  country: countryCodeSchema,
  /** Last four digits only. The full number lives in the destination partition. */
  maskedAccount: z.string(),
  resolvedName: z.string().nullable(),
  nickname: z.string().nullable(),
  createdAt: z.string(),
});
export type RecipientResponse = z.infer<typeof recipientResponseSchema>;

export const bankListResponseSchema = z.object({
  banks: z.array(z.object({ code: z.string(), name: z.string() })),
  networks: z.array(z.object({ code: z.string(), name: z.string() })),
});
export type BankListResponse = z.infer<typeof bankListResponseSchema>;
