import { z } from 'zod';
import { moneySchema, payinMethodSchema, payoutMethodSchema } from './common';

export const createQuoteRequestSchema = z.object({
  corridorId: z.string().min(3).max(20),
  /**
   * The amount to convert, in minor units, as a string.
   *
   * A string, not a number, and minor units, not a decimal: the client never
   * gets the chance to send us 100000.1 and make us guess what it meant.
   */
  sendMinorUnits: z.string().regex(/^\d+$/, 'minor units must be a non-negative integer string'),
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

/**
 * The full decomposition of what a transfer costs.
 *
 * Technical Architecture open question 1 asked how much of the spread we
 * surface. This is the answer: the mid-market rate, our margin in basis points
 * and in money, the fixed fee, and what the recipient would have received with
 * no margin at all.
 */
export const quoteResponseSchema = z.object({
  id: z.string(),
  corridorId: z.string(),
  sendAmount: moneySchema,
  fixedFee: moneySchema,
  fxMargin: moneySchema,
  totalToPay: moneySchema,
  totalCost: moneySchema,
  recipientAmount: moneySchema,
  recipientAmountAtMid: moneySchema,
  midRate: z.string(),
  effectiveRate: z.string(),
  fxMarginBps: z.number().int(),
  rateObservedAt: z.string(),
  quotedAt: z.string(),
  expiresAt: z.string(),
  expiresInSeconds: z.number().int(),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export const corridorResponseSchema = z.object({
  id: z.string(),
  sourceCountry: z.string(),
  sourceCurrency: z.string(),
  destinationCountry: z.string(),
  destinationCurrency: z.string(),
  payinMethods: z.array(payinMethodSchema),
  payoutMethods: z.array(payoutMethodSchema),
  minSend: moneySchema,
  maxSend: moneySchema,
  fixedFee: moneySchema,
  fxMarginBps: z.number().int(),
  enabled: z.boolean(),
  open: z.boolean(),
});
export type CorridorResponse = z.infer<typeof corridorResponseSchema>;

export const rateResponseSchema = z.object({
  pair: z.string(),
  rate: z.string(),
  observedAt: z.string(),
  ageMs: z.number().int(),
  /** False when the feed is beyond the staleness threshold and quoting has halted. */
  usable: z.boolean(),
  source: z.string(),
});
export type RateResponse = z.infer<typeof rateResponseSchema>;
