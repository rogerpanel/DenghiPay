import { z } from 'zod';
import { moneySchema, transferStateSchema } from './common';
import { staffRoleSchema } from './auth';

/**
 * Back-office contracts.
 *
 * Every mutating admin action carries a `reason`. That is not paperwork: the
 * DoD for Phase 9 is that every admin action is audit-logged with actor, reason
 * and before/after state, and a reason that is optional is a reason nobody
 * writes.
 */

export const reasonSchema = z.string().min(5, 'a reason is required').max(500);

// --------------------------------------------------------------- compliance

export const complianceCaseStatusSchema = z.enum(['OPEN', 'IN_REVIEW', 'CLEARED', 'REJECTED']);

export const complianceCaseSchema = z.object({
  id: z.string(),
  type: z.enum([
    'SCREENING_HIT',
    'VELOCITY',
    'STRUCTURING',
    'ENHANCED_DUE_DILIGENCE',
    'MANUAL_REVIEW',
  ]),
  status: complianceCaseStatusSchema,
  summary: z.string(),
  transferId: z.string().nullable(),
  transferReference: z.string().nullable(),
  userId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decisionReason: z.string().nullable(),
  notes: z.array(
    z.object({ id: z.string(), authorId: z.string(), body: z.string(), createdAt: z.string() }),
  ),
});
export type ComplianceCaseDto = z.infer<typeof complianceCaseSchema>;

export const decideComplianceCaseRequestSchema = z.object({
  decision: z.enum(['CLEAR', 'REJECT']),
  reason: reasonSchema,
});
export type DecideComplianceCaseRequest = z.infer<typeof decideComplianceCaseRequestSchema>;

export const addCaseNoteRequestSchema = z.object({ body: z.string().min(1).max(2000) });

export const decideKycRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: reasonSchema,
  grantedTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
});
export type DecideKycRequest = z.infer<typeof decideKycRequestSchema>;

// --------------------------------------------------------------- operations

export const adminTransferSearchSchema = z.object({
  reference: z.string().optional(),
  state: transferStateSchema.optional(),
  corridorId: z.string().optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminTransferSchema = z.object({
  id: z.string(),
  reference: z.string(),
  state: transferStateSchema,
  corridorId: z.string(),
  userId: z.string(),
  sendAmount: moneySchema,
  recipientAmount: moneySchema,
  fee: moneySchema,
  payinProviderRef: z.string().nullable(),
  payoutProviderRef: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  screeningStatus: z.string().nullable(),
  timeline: z.array(
    z.object({
      event: z.string(),
      fromState: transferStateSchema,
      toState: transferStateSchema,
      actorType: z.string(),
      at: z.string(),
    }),
  ),
  ledger: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      description: z.string(),
      occurredAt: z.string(),
      entries: z.array(
        z.object({ account: z.string(), direction: z.string(), amount: moneySchema }),
      ),
    }),
  ),
});
export type AdminTransferDto = z.infer<typeof adminTransferSchema>;

/** Manual intervention always requires a reason code plus free text. */
export const REASON_CODES = [
  'PARTNER_OUTAGE',
  'RECIPIENT_UNREACHABLE',
  'SENDER_REQUEST',
  'SUSPECTED_FRAUD',
  'DUPLICATE_TRANSFER',
  'DATA_ENTRY_ERROR',
  'REGULATORY_HOLD',
] as const;

export const reasonCodeSchema = z.enum(REASON_CODES);

export const initiateRefundRequestSchema = z.object({
  reasonCode: reasonCodeSchema,
  reason: reasonSchema,
});
export type InitiateRefundRequest = z.infer<typeof initiateRefundRequestSchema>;

// ----------------------------------------------------------------- treasury

export const floatPositionSchema = z.object({
  currency: z.string(),
  accountCode: z.string(),
  balance: moneySchema,
  lowWatermark: moneySchema,
  target: moneySchema,
  belowThreshold: z.boolean(),
});
export type FloatPositionDto = z.infer<typeof floatPositionSchema>;

export const fxExposureSchema = z.object({
  currency: z.string(),
  openExposure: moneySchema,
  positionCount: z.number().int(),
});
export type FxExposureDto = z.infer<typeof fxExposureSchema>;

export const createPrefundingRequestSchema = z.object({
  currency: z.enum(['RUB', 'NGN', 'GHS']),
  amountMinorUnits: z.string().regex(/^\d+$/),
  reason: reasonSchema,
});
export type CreatePrefundingRequest = z.infer<typeof createPrefundingRequestSchema>;

export const approvePrefundingRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: reasonSchema,
});
export type ApprovePrefundingRequest = z.infer<typeof approvePrefundingRequestSchema>;

export const prefundingSchema = z.object({
  id: z.string(),
  currency: z.string(),
  amount: moneySchema,
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED']),
  reason: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  executedAt: z.string().nullable(),
  /** True when the viewing staff member is the requester and so may not approve. */
  selfApprovalBlocked: z.boolean().optional(),
});
export type PrefundingDto = z.infer<typeof prefundingSchema>;

// ---------------------------------------------------------- reconciliation

export const reconciliationRunSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  ranAt: z.string(),
  matchedCount: z.number().int(),
  breakCount: z.number().int(),
  findings: z.array(z.record(z.string(), z.unknown())),
});
export type ReconciliationRunDto = z.infer<typeof reconciliationRunSchema>;

// ---------------------------------------------------------------- reporting

export const reportQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
  corridorId: z.string().optional(),
});

export const volumeReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      corridorId: z.string(),
      count: z.number().int(),
      sendTotal: moneySchema,
      recipientTotal: moneySchema,
      feeTotal: moneySchema,
      completed: z.number().int(),
      failed: z.number().int(),
      refunded: z.number().int(),
    }),
  ),
});
export type VolumeReportDto = z.infer<typeof volumeReportSchema>;

export const staffSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  roles: z.array(staffRoleSchema),
});
export type StaffSummaryDto = z.infer<typeof staffSummarySchema>;
