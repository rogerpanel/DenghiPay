import { ProviderId } from '@morapay/domain';

/**
 * KYC port (BUILD_PLAN 3.1). Swapping Smile ID for Sumsub must require no
 * change outside `packages/adapters`.
 *
 * The document set is the realistic one for African students and workers in
 * Russia (BUILD_PLAN 3.3). There is no assumption of a Russian internal
 * passport anywhere in this interface.
 */
export const DOCUMENT_TYPES = [
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
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface KycSubmission {
  /** Tokenised subject reference. The provider sees personal data; we store a token. */
  readonly subjectToken: string;
  readonly targetTier: 0 | 1 | 2 | 3;
  readonly documents: readonly SubmittedDocument[];
  readonly person: {
    readonly firstName: string;
    readonly lastName: string;
    readonly dateOfBirth: string;
    readonly nationality: string;
  };
}

export interface SubmittedDocument {
  readonly type: DocumentType;
  /** Object-store key. The bytes never pass through the neutral tier's database. */
  readonly storageKey: string;
  readonly issuingCountry?: string;
  readonly documentNumber?: string;
  readonly expiresAt?: string;
}

export type KycDecision =
  | { readonly _tag: 'APPROVED'; readonly providerRef: string; readonly grantedTier: 0 | 1 | 2 | 3 }
  | { readonly _tag: 'PENDING'; readonly providerRef: string }
  | {
      readonly _tag: 'REJECTED';
      readonly providerRef: string;
      readonly code: string;
      readonly reason: string;
    };

export interface KycProvider {
  readonly id: ProviderId;
  /** Which tiers this provider can decide. Tier 3 is usually manual. */
  readonly supportedTiers: readonly (0 | 1 | 2 | 3)[];

  submit(submission: KycSubmission): Promise<KycDecision>;
  getDecision(providerRef: string): Promise<KycDecision>;
  /** Documents this provider requires for a tier in a given residency country. */
  requiredDocuments(tier: 0 | 1 | 2 | 3, residencyCountry: string): readonly DocumentType[];
}
