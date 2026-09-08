import { z } from 'zod';
import { moneySchema, payinMethodSchema, transferPurposeSchema } from './common';

/* ------------------------------------------------------------- notifications */

export const notificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  /** An in-app path such as `/transfers/abc`. Never an external URL. */
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unread: z.number().int().min(0),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

/* ------------------------------------------------------------------ receipt */

/**
 * A receipt for a settled transfer.
 *
 * Deliberately more than the transfer response already carries: it names the
 * sender, because a receipt with no payer on it is not evidence of anything,
 * and that name has to be fetched from the residency partition rather than the
 * neutral tier.
 *
 * Only issued for a transfer that has reached a terminal state. A receipt for
 * a payment still in flight is a promise, and people forward these to
 * landlords and universities.
 */
export const receiptSchema = z.object({
  reference: z.string(),
  status: z.string(),
  issuedAt: z.string(),
  valueDate: z.string(),
  completedAt: z.string().nullable(),
  senderName: z.string().nullable(),
  senderCountry: z.string(),
  recipientName: z.string().nullable(),
  recipientMasked: z.string(),
  recipientCountry: z.string(),
  recipientMethod: z.string(),
  corridorId: z.string(),
  purpose: transferPurposeSchema,
  sendAmount: moneySchema,
  fee: moneySchema,
  totalPaid: moneySchema,
  recipientAmount: moneySchema,
  midRate: z.string(),
  effectiveRate: z.string(),
  fxMarginBps: z.number().int(),
  /** Present only where the origin has an exchange-control regime. */
  declaration: z
    .object({
      regime: z.string(),
      categoryCode: z.string(),
      categoryLabel: z.string(),
      allowanceYear: z.number().int(),
    })
    .nullable(),
});
export type ReceiptDto = z.infer<typeof receiptSchema>;

/* ---------------------------------------------------------------- schedules */

export const scheduleFrequencySchema = z.enum(['WEEKLY', 'MONTHLY']);
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>;

/**
 * A standing instruction.
 *
 * `dayOfPeriod` caps at 28 for a monthly schedule on purpose: the 29th, 30th
 * and 31st do not exist in every month, and a schedule that silently skips
 * February is worse than one that refuses to be created.
 */
export const createScheduleRequestSchema = z.object({
  corridorId: z.string().min(1),
  recipientId: z.string().min(1),
  sendMinorUnits: z.string().regex(/^\d+$/, 'minor units, as a whole number'),
  payinMethod: payinMethodSchema,
  purpose: transferPurposeSchema,
  frequency: scheduleFrequencySchema,
  dayOfPeriod: z.number().int().min(1).max(28),
});
export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

export const scheduleSchema = z.object({
  id: z.string(),
  corridorId: z.string(),
  recipientId: z.string(),
  recipientName: z.string().nullable(),
  recipientMasked: z.string(),
  amount: moneySchema,
  payinMethod: payinMethodSchema,
  purpose: transferPurposeSchema,
  frequency: scheduleFrequencySchema,
  dayOfPeriod: z.number().int(),
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable(),
  /** Why the last occurrence produced no transfer, if it produced none. */
  lastFailure: z.string().nullable(),
  occurrences: z.number().int(),
  active: z.boolean(),
});
export type ScheduleDto = z.infer<typeof scheduleSchema>;

export const scheduleListResponseSchema = z.object({ schedules: z.array(scheduleSchema) });
export type ScheduleListResponse = z.infer<typeof scheduleListResponseSchema>;

/* -------------------------------------------------------------- rate alerts */

export const rateAlertDirectionSchema = z.enum(['ABOVE', 'BELOW']);

export const createRateAlertRequestSchema = z.object({
  corridorId: z.string().min(1),
  direction: rateAlertDirectionSchema,
  /** A decimal string. Parsed, never floated. */
  thresholdRate: z.string().regex(/^\d+(\.\d+)?$/, 'a positive decimal, e.g. 1500.00'),
});
export type CreateRateAlertRequest = z.infer<typeof createRateAlertRequestSchema>;

export const rateAlertSchema = z.object({
  id: z.string(),
  corridorId: z.string(),
  direction: rateAlertDirectionSchema,
  thresholdRate: z.string(),
  /** What the corridor is quoting now, so the threshold can be judged. */
  currentRate: z.string().nullable(),
  active: z.boolean(),
  triggeredAt: z.string().nullable(),
  triggeredRate: z.string().nullable(),
  createdAt: z.string(),
});
export type RateAlertDto = z.infer<typeof rateAlertSchema>;

export const rateAlertListResponseSchema = z.object({ alerts: z.array(rateAlertSchema) });
export type RateAlertListResponse = z.infer<typeof rateAlertListResponseSchema>;

/* ----------------------------------------------------------------- support */

export const supportStatusSchema = z.enum(['OPEN', 'ANSWERED', 'RESOLVED']);

export const createSupportThreadRequestSchema = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(1).max(4000),
  /** Optional, and the reason most threads exist. */
  transferId: z.string().optional(),
});
export type CreateSupportThreadRequest = z.infer<typeof createSupportThreadRequestSchema>;

export const supportReplyRequestSchema = z.object({
  body: z.string().min(1).max(4000),
});
export type SupportReplyRequest = z.infer<typeof supportReplyRequestSchema>;

export const supportMessageSchema = z.object({
  id: z.string(),
  authorType: z.enum(['USER', 'STAFF']),
  /** A display name for staff, "You" resolved client-side for the sender. */
  authorLabel: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type SupportMessageDto = z.infer<typeof supportMessageSchema>;

export const supportThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  status: supportStatusSchema,
  transferId: z.string().nullable(),
  transferReference: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(supportMessageSchema),
});
export type SupportThreadDto = z.infer<typeof supportThreadSchema>;

export const supportThreadListResponseSchema = z.object({
  threads: z.array(supportThreadSchema),
});
export type SupportThreadListResponse = z.infer<typeof supportThreadListResponseSchema>;
