import { z } from 'zod';

export const documentTypeSchema = z.enum([
  'PASSPORT',
  'MIGRATION_CARD',
  'RESIDENCE_REGISTRATION',
  'WORK_PERMIT',
  'PATENT',
  'STUDENT_VISA',
  'RESIDENCE_PERMIT',
  'NATIONAL_ID',
  'SELFIE',
  'PROOF_OF_ADDRESS',
  'SOURCE_OF_FUNDS',
]);
export type DocumentTypeDto = z.infer<typeof documentTypeSchema>;

export const kycTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/**
 * A KYC submission.
 *
 * The document list is open enough to carry what an African student or worker
 * in Russia actually holds — a national passport plus a migration card and a
 * registration, and either a work patent or a study visa (BUILD_PLAN 3.3).
 */
export const kycSubmitRequestSchema = z.object({
  targetTier: kycTierSchema,
  person: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    middleName: z.string().max(100).optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
    nationality: z.string().length(2, 'ISO 3166-1 alpha-2'),
    phone: z.string().min(6).max(20).optional(),
    addressLine: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    postcode: z.string().max(20).optional(),
    /**
     * Jurisdiction-specific identity anchors. Each is stored only in its own
     * residency partition and is never echoed back to the client.
     */
    bvn: z
      .string()
      .regex(/^\d{11}$/, 'a BVN is eleven digits')
      .optional(),
    ghanaCardNo: z
      .string()
      .regex(/^GHA-\d{9}-\d$/, 'a Ghana Card number looks like GHA-123456789-0')
      .optional(),
    /** South Africa: the identity number an Authorised Dealer reports against. */
    nationalIdNo: z.string().min(6).max(20).optional(),
    /**
     * SARS tax reference. Required before the investment allowance may be used,
     * and captured at verification because that is where identity evidence
     * already is.
     */
    taxReference: z.string().min(6).max(20).optional(),
    /**
     * Exchange-control status. Only RESIDENT is supported today: temporary and
     * non-residents have different allowances, and guessing which would be
     * worse than refusing.
     */
    exchangeControlStatus: z.enum(['RESIDENT', 'TEMPORARY_RESIDENT', 'NON_RESIDENT']).optional(),
    /**
     * The wallet we debit when collecting inside Ghana. Asked for at
     * verification because that is where identity evidence already is, and
     * because a wallet whose name does not match the verified name is a
     * finding, not a convenience.
     */
    collectionWallet: z
      .object({
        msisdn: z.string().regex(/^233\d{9}$/, 'a Ghanaian MSISDN is 233 then nine digits'),
        network: z.enum(['MTN', 'TELECEL', 'AIRTELTIGO']),
      })
      .optional(),
  }),
  documents: z
    .array(
      z.object({
        type: documentTypeSchema,
        /** Object-store key from the upload step. The bytes never touch the API. */
        storageKey: z.string().min(1).max(300),
        issuingCountry: z.string().length(2).optional(),
        documentNumber: z.string().max(60).optional(),
        expiresAt: z.string().optional(),
      }),
    )
    .min(1)
    .max(10),
});
export type KycSubmitRequest = z.infer<typeof kycSubmitRequestSchema>;

export const kycStatusSchema = z.enum([
  'NOT_STARTED',
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
]);

export const kycCaseResponseSchema = z.object({
  id: z.string(),
  targetTier: kycTierSchema,
  status: kycStatusSchema,
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});
export type KycCaseResponse = z.infer<typeof kycCaseResponseSchema>;

export const kycRequirementsResponseSchema = z.object({
  tier: kycTierSchema,
  residencyCountry: z.string(),
  requiredDocuments: z.array(documentTypeSchema),
  /** Alternatives that satisfy the same requirement, e.g. a study visa for a work permit. */
  alternatives: z.record(z.string(), z.array(documentTypeSchema)),
  limits: z.object({
    perTransfer: z.string(),
    daily: z.string(),
    monthly: z.string(),
    currency: z.string(),
    /**
     * Decimal places in this currency's minor unit. Sent because the client
     * must not guess: XAF and XOF have none, and a client assuming two would
     * show a Beninese sender a limit a hundred times smaller than it is.
     */
    decimals: z.number().int().min(0).max(8),
  }),
});
export type KycRequirementsResponse = z.infer<typeof kycRequirementsResponseSchema>;
