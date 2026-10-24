import { randomUUID } from 'node:crypto';
import { ProviderId, asProviderId } from '@morapay/domain';
import { DocumentType, KycDecision, KycProvider, KycSubmission } from '../ports/kyc-provider';

/**
 * Mock KYC provider (BUILD_PLAN 3.1).
 *
 * The document requirements are the substantive part. BUILD_PLAN 3.3 is
 * explicit that we must not assume a Russian internal passport: our senders are
 * African students and workers, and the documents they actually hold are a
 * national passport plus a migration card, a residence registration, and
 * either a work patent or a study visa.
 */
export class MockKycProvider implements KycProvider {
  readonly id: ProviderId = asProviderId('kyc-mock');
  readonly supportedTiers = [0, 1, 2, 3] as const;

  private readonly decisions = new Map<string, KycDecision>();

  requiredDocuments(tier: 0 | 1 | 2 | 3, residencyCountry: string): readonly DocumentType[] {
    if (tier === 0) return [];

    const foreignNationalInRussia = residencyCountry === 'RU';

    if (tier === 1) {
      return foreignNationalInRussia ? ['PASSPORT'] : ['NATIONAL_ID'];
    }

    if (tier === 2) {
      return foreignNationalInRussia
        ? ['PASSPORT', 'MIGRATION_CARD', 'RESIDENCE_REGISTRATION', 'SELFIE']
        : ['NATIONAL_ID', 'PROOF_OF_ADDRESS', 'SELFIE'];
    }

    // Tier 3 is enhanced due diligence: everything for tier 2, plus the right
    // to be in the country lawfully and an account of where the money came from.
    return foreignNationalInRussia
      ? [
          'PASSPORT',
          'MIGRATION_CARD',
          'RESIDENCE_REGISTRATION',
          'WORK_PERMIT',
          'SELFIE',
          'SOURCE_OF_FUNDS',
        ]
      : ['NATIONAL_ID', 'PROOF_OF_ADDRESS', 'SELFIE', 'SOURCE_OF_FUNDS'];
  }

  async submit(submission: KycSubmission): Promise<KycDecision> {
    const providerRef = `KYC-SIM-${randomUUID().slice(0, 12).toUpperCase()}`;
    const supplied = new Set(submission.documents.map((d) => d.type));

    // A work permit and a study visa are alternatives, not both.
    const required = this.requiredDocuments(
      submission.targetTier,
      submission.residencyCountry ?? 'RU',
    ).filter((type) => {
      if (type !== 'WORK_PERMIT') return true;
      return (
        !supplied.has('STUDENT_VISA') &&
        !supplied.has('PATENT') &&
        !supplied.has('RESIDENCE_PERMIT')
      );
    });

    const missing = required.filter((type) => !supplied.has(type));
    if (missing.length > 0) {
      const decision: KycDecision = {
        _tag: 'REJECTED',
        providerRef,
        code: 'MISSING_DOCUMENTS',
        reason: `Missing required documents: ${missing.join(', ')}`,
      };
      this.decisions.set(providerRef, decision);
      return decision;
    }

    // Deterministic hooks so a demo can show every branch:
    //   surname REVIEW  → held for manual review
    //   surname REJECT  → rejected outright
    const surname = submission.person.lastName.trim().toUpperCase();
    const decision: KycDecision =
      surname === 'REVIEW'
        ? { _tag: 'PENDING', providerRef }
        : surname === 'REJECT'
          ? {
              _tag: 'REJECTED',
              providerRef,
              code: 'DOCUMENT_UNREADABLE',
              reason: 'Document image could not be verified',
            }
          : { _tag: 'APPROVED', providerRef, grantedTier: submission.targetTier };

    this.decisions.set(providerRef, decision);
    return decision;
  }

  async getDecision(providerRef: string): Promise<KycDecision> {
    return (
      this.decisions.get(providerRef) ?? {
        _tag: 'REJECTED',
        providerRef,
        code: 'UNKNOWN_REFERENCE',
        reason: 'No KYC case with that reference',
      }
    );
  }

  /** Test and back-office hook: a compliance officer decides a held case. */
  resolvePending(providerRef: string, approve: boolean, tier: 0 | 1 | 2 | 3): KycDecision {
    const decision: KycDecision = approve
      ? { _tag: 'APPROVED', providerRef, grantedTier: tier }
      : { _tag: 'REJECTED', providerRef, code: 'MANUAL_REJECTION', reason: 'Rejected on review' };
    this.decisions.set(providerRef, decision);
    return decision;
  }
}
