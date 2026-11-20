import { z } from 'zod';
import {
  moneySchema,
  payinMethodSchema,
  transferPurposeSchema,
  transferStateSchema,
} from './common';

export const createTransferRequestSchema = z.object({
  quoteId: z.string().min(1),
  recipientId: z.string().min(1),
  payinMethod: payinMethodSchema,
  /**
   * Guardrail G2: personal, non-commercial remittances only. The enum has no
   * commercial member, so an invoice payment cannot be expressed.
   */
  purpose: transferPurposeSchema,
  /** The sender confirms the name the institution returned, not the one they typed. */
  confirmedRecipientName: z.string().min(2).max(120),
  /**
   * Exchange-control declaration, required only on corridors whose origin has a
   * regime (today: South Africa under SARB).
   *
   * Optional in the schema and mandatory in the service, deliberately. The
   * requirement depends on the corridor, which the schema cannot see; making it
   * required here would break every other corridor, and making it optional in
   * both places would let an undeclared payment through. The API refuses with
   * EXCHANGE_CONTROL_CATEGORY_REQUIRED when the corridor needs one and it is
   * absent.
   */
  exchangeControl: z
    .object({
      /** Published reason code, e.g. a SARB balance-of-payments category. */
      categoryCode: z.string().min(1).max(16),
      /**
       * What the sender says they have already used of this year's allowance
       * through other providers. Minor units, as a string.
       *
       * We cannot verify it and we must not ignore it: an allowance is personal
       * and spans every provider a person uses, so counting only what we can
       * see would permit a payment that breaches the regulation.
       */
      declaredElsewhereMinorUnits: z
        .string()
        .regex(/^\d+$/, 'must be a whole number of minor units')
        .default('0'),
      /** The sender affirms the declaration is true. Recorded, not decorative. */
      declarationAccepted: z.literal(true, {
        errorMap: () => ({ message: 'the declaration must be affirmed' }),
      }),
    })
    .optional(),
});
export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;

/**
 * What a sender needs to complete a declaration, and what is left of their
 * allowance. Served per corridor, because most corridors need none of it.
 */
export const exchangeControlInfoSchema = z.object({
  required: z.boolean(),
  regimeCountry: z.string().nullable(),
  /** The country's name, because a sender reads a sentence, not a code. */
  regimeCountryName: z.string().nullable(),
  authority: z.string().nullable(),
  reportedBy: z.string().nullable(),
  categories: z.array(z.object({ code: z.string(), label: z.string(), allowance: z.string() })),
  allowanceYear: z.number().int().nullable(),
  annualMinorUnits: z.string().nullable(),
  /** What we believe is left. A ceiling we can see, not the true one. */
  remainingMinorUnits: z.string().nullable(),
  usedThroughUsMinorUnits: z.string().nullable(),
  declaredElsewhereMinorUnits: z.string().nullable(),
  currency: z.string().nullable(),
});
export type ExchangeControlInfo = z.infer<typeof exchangeControlInfoSchema>;

export const payinInstructionsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SBP'), deepLink: z.string(), expiresAt: z.string() }),
  z.object({ kind: z.literal('QR'), payload: z.string(), expiresAt: z.string() }),
  z.object({
    kind: z.literal('VIRTUAL_ACCOUNT'),
    accountNumber: z.string(),
    bankName: z.string(),
    reference: z.string(),
  }),
  z.object({ kind: z.literal('CARD'), redirectUrl: z.string(), expiresAt: z.string() }),
  z.object({
    kind: z.literal('MOBILE_MONEY'),
    /** The sender's own wallet — already theirs, so showing it confirms rather than reveals. */
    msisdn: z.string(),
    network: z.string(),
    /** Approval prompts get dropped; the short code is how a sender recovers. */
    ussdFallback: z.string(),
    expiresAt: z.string(),
  }),
]);
export type PayinInstructionsDto = z.infer<typeof payinInstructionsSchema>;

/**
 * Sender-facing status.
 *
 * `state` is the internal state machine value; `senderStatus` is the key the
 * i18n layer renders. Renaming an internal state must never change what a
 * sender reads (BUILD_PLAN 10.5).
 */
export const transferResponseSchema = z.object({
  id: z.string(),
  reference: z.string(),
  state: transferStateSchema,
  senderStatus: z.string(),
  corridorId: z.string(),
  purpose: transferPurposeSchema,
  sendAmount: moneySchema,
  fee: moneySchema,
  totalToPay: moneySchema,
  recipientAmount: moneySchema,
  recipient: z.object({
    id: z.string(),
    maskedAccount: z.string(),
    resolvedName: z.string().nullable(),
    country: z.string(),
    method: z.string(),
  }),
  payinMethod: payinMethodSchema,
  payinInstructions: payinInstructionsSchema.nullable(),
  failureCode: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  timeline: z.array(
    z.object({
      event: z.string(),
      fromState: transferStateSchema,
      toState: transferStateSchema,
      senderStatus: z.string(),
      at: z.string(),
    }),
  ),
});
export type TransferResponse = z.infer<typeof transferResponseSchema>;

export const transferListResponseSchema = z.object({
  transfers: z.array(transferResponseSchema),
  nextCursor: z.string().nullable(),
});
export type TransferListResponse = z.infer<typeof transferListResponseSchema>;

export const cancelTransferRequestSchema = z.object({
  reason: z.string().min(3).max(200),
});
export type CancelTransferRequest = z.infer<typeof cancelTransferRequestSchema>;
