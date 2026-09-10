import { z } from 'zod';
import {
  MobileMoneyNetwork,
  WALLET_COUNTRIES,
  WalletCountry,
  msisdnHint,
  msisdnPattern,
  networksFor,
} from '@morapay/domain';
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

/**
 * The wallet shapes, one per country, generated from the domain.
 *
 * Thirteen countries pay out to wallets and every one differs in two details:
 * the dialling prefix with its national digit count, and which operators are
 * licensed there. Both are already stated in the domain — `MSISDN_FORMAT` and
 * `MOBILE_MONEY_NETWORKS` — and the payout simulator reads the same tables, so
 * generating these keeps one answer to "what is a valid Gambian number" rather
 * than three that can disagree.
 *
 * Written out by hand this would be thirteen near-identical objects differing
 * in two literals each, which is exactly the shape of code where a wrong prefix
 * reads as correct.
 */
const walletRecipientSchemas = WALLET_COUNTRIES.map((country) =>
  z.object({
    method: z.literal('MOBILE_MONEY'),
    country: z.literal(country),
    // E.164 without the plus.
    msisdn: z.string().regex(msisdnPattern(country)!, msisdnHint(country)!),
    // A network licensed somewhere else is refused here rather than at the
    // rail. Offering MOOV for a Kenyan wallet gets a usable error at the API
    // boundary instead of a payout failure an hour later.
    network: z.enum(networksFor(country) as unknown as [string, ...string[]]),
    declaredName,
  }),
);

/**
 * Discriminated on method **and** country.
 *
 * Zod's `discriminatedUnion` takes a single key, so with two bank shapes and
 * thirteen wallet shapes this is a plain union of per-country objects. The cost
 * is a less precise error when nothing matches; the benefit is that a Ghanaian
 * network offered for a Beninese wallet is rejected at the API boundary.
 */
export const recipientDetailsSchema = z.union([
  ngRecipientSchema,
  zaRecipientSchema,
  ...walletRecipientSchemas,
] as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);

/**
 * Stated rather than inferred.
 *
 * `z.infer` over a generated array collapses the thirteen country literals into
 * one, so the inferred type would claim any wallet country accepts any licensed
 * network. Writing the type out says what is actually true at compile time — a
 * wallet in one of the wallet countries — and leaves the country-to-network
 * pairing to the runtime check above, which is where it was always enforced.
 */
export type RecipientDetailsDto =
  | z.infer<typeof ngRecipientSchema>
  | z.infer<typeof zaRecipientSchema>
  | {
      method: 'MOBILE_MONEY';
      country: WalletCountry;
      msisdn: string;
      network: MobileMoneyNetwork;
      declaredName: string;
    };

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
