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
});
export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;

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
