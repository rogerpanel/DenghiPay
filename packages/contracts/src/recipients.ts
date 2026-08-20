import { z } from 'zod';
import { countryCodeSchema } from './common';

/**
 * Recipient details, discriminated by payout method.
 *
 * A bank account and a mobile-money wallet are genuinely different shapes, so
 * they are a discriminated union rather than one object with optional fields: a
 * Ghanaian wallet has no bank code and never will.
 *
 * Within each shape the **country decides the format**. A Nigerian NUBAN is ten
 * digits and a South African account is nine to eleven; a Nigerian bank code is
 * three digits and a South African universal branch code is six. Validating
 * these here means a mistyped number is refused with a message about the
 * country the sender actually chose, rather than reaching a rail that rejects
 * it minutes later with a reference number.
 */

const declaredName = z.string().min(2).max(120);

export const ngRecipientSchema = z.object({
  method: z.literal('BANK_ACCOUNT'),
  country: z.literal('NG'),
  /** NUBAN is exactly ten digits. */
  accountNumber: z.string().regex(/^\d{10}$/, 'a Nigerian account number is 10 digits'),
  bankCode: z.string().regex(/^\d{3}$/, 'a Nigerian bank code is 3 digits'),
  declaredName,
});

export const zaRecipientSchema = z.object({
  method: z.literal('BANK_ACCOUNT'),
  country: z.literal('ZA'),
  accountNumber: z.string().regex(/^\d{9,11}$/, 'a South African account number is 9 to 11 digits'),
  /** Universal branch code: six digits, identifying the bank rather than a branch. */
  bankCode: z.string().regex(/^\d{6}$/, 'a South African universal branch code is 6 digits'),
  declaredName,
});

export const ghRecipientSchema = z.object({
  method: z.literal('MOBILE_MONEY'),
  country: z.literal('GH'),
  /** E.164 without the plus: 233 followed by nine digits. */
  msisdn: z.string().regex(/^233\d{9}$/, 'a Ghanaian mobile number is 233 followed by 9 digits'),
  network: z.enum(['MTN', 'TELECEL', 'AIRTELTIGO']),
  declaredName,
});

export const cmRecipientSchema = z.object({
  method: z.literal('MOBILE_MONEY'),
  country: z.literal('CM'),
  msisdn: z.string().regex(/^237\d{9}$/, 'a Cameroonian mobile number is 237 followed by 9 digits'),
  /** MTN and Orange are the two licensed wallet operators in Cameroon. */
  network: z.enum(['MTN', 'ORANGE']),
  declaredName,
});

export const bjRecipientSchema = z.object({
  method: z.literal('MOBILE_MONEY'),
  country: z.literal('BJ'),
  msisdn: z
    .string()
    .regex(/^229\d{8,10}$/, 'a Beninese mobile number is 229 followed by 8 to 10 digits'),
  network: z.enum(['MTN', 'MOOV', 'CELTIIS']),
  declaredName,
});

/**
 * Discriminated on method **and** country.
 *
 * Zod's `discriminatedUnion` takes a single key, so with two bank shapes and
 * three wallet shapes this is a plain union of per-country objects. The cost is
 * a less precise error when nothing matches; the benefit is that a Ghanaian
 * network offered for a Beninese wallet is rejected at the API boundary.
 */
export const recipientDetailsSchema = z.union([
  ngRecipientSchema,
  zaRecipientSchema,
  ghRecipientSchema,
  cmRecipientSchema,
  bjRecipientSchema,
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
