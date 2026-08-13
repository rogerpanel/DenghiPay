import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DEFAULT_TIER_LIMITS, KycTier, limitsFor, Money } from '@morapay/domain';
import { DocumentType, KycProvider } from '@morapay/adapters';
import { KycCaseResponse, KycRequirementsResponse, KycSubmitRequest } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { KYC_PROVIDER } from '../config/tokens';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { AuditService } from '../audit/audit.service';
import { ScreeningService } from '../compliance/screening.service';
import { ComplianceService } from '../compliance/compliance.service';

/**
 * Tiered KYC (BUILD_PLAN 3.1–3.3).
 *
 * Two things worth pointing at:
 *
 *  - personal data goes to the residency partition and to the KYC provider; the
 *    neutral tier keeps a case row with a token and a status;
 *  - approval screens the person before granting a tier, so an approved
 *    identity that matches a designated person never reaches a transfer at all.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
    private readonly partitions: PartitionGateway,
    private readonly audit: AuditService,
    private readonly screening: ScreeningService,
    private readonly compliance: ComplianceService,
  ) {}

  requirements(tier: KycTier, residencyCountry: string): KycRequirementsResponse {
    const limits = limitsFor(tier, 'RUB', DEFAULT_TIER_LIMITS);
    return {
      tier,
      residencyCountry,
      requiredDocuments: [...this.provider.requiredDocuments(tier, residencyCountry)],
      // BUILD_PLAN 3.3: the realistic document set for African students and
      // workers in Russia. A work patent, a study visa and a residence permit
      // all answer the same question.
      alternatives: {
        WORK_PERMIT: ['PATENT', 'STUDENT_VISA', 'RESIDENCE_PERMIT'],
      },
      limits: {
        perTransfer: (limits?.perTransferMinorUnits ?? 0n).toString(),
        daily: (limits?.dailyMinorUnits ?? 0n).toString(),
        monthly: (limits?.monthlyMinorUnits ?? 0n).toString(),
        currency: 'RUB',
      },
    };
  }

  async submit(userId: string, input: KycSubmitRequest): Promise<KycCaseResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (input.targetTier <= user.kycTier) {
      throw new BadRequestException({
        code: 'TIER_NOT_AN_UPGRADE',
        message: `This account already holds tier ${user.kycTier}`,
      });
    }

    // Personal data goes to the residency partition, never to the neutral tier.
    await this.partitions.upsertSenderProfile({
      piiToken: user.piiToken,
      partition: user.piiPartition,
      firstName: input.person.firstName,
      lastName: input.person.lastName,
      ...(input.person.middleName === undefined ? {} : { middleName: input.person.middleName }),
      dateOfBirth: input.person.dateOfBirth,
      nationality: input.person.nationality,
      ...(input.person.phone === undefined ? {} : { phone: input.person.phone }),
      ...(input.person.addressLine === undefined ? {} : { addressLine: input.person.addressLine }),
      ...(input.person.city === undefined ? {} : { city: input.person.city }),
      ...(input.person.postcode === undefined ? {} : { postcode: input.person.postcode }),
      documents: input.documents.map((doc) => ({ ...doc })),
    });

    const decision = await this.provider.submit({
      subjectToken: user.piiToken,
      targetTier: input.targetTier,
      person: {
        firstName: input.person.firstName,
        lastName: input.person.lastName,
        dateOfBirth: input.person.dateOfBirth,
        nationality: input.person.nationality,
      },
      documents: input.documents.map((doc) => ({
        type: doc.type as DocumentType,
        storageKey: doc.storageKey,
        ...(doc.issuingCountry === undefined ? {} : { issuingCountry: doc.issuingCountry }),
        ...(doc.documentNumber === undefined ? {} : { documentNumber: doc.documentNumber }),
        ...(doc.expiresAt === undefined ? {} : { expiresAt: doc.expiresAt }),
      })),
    });

    const kycCase = await this.prisma.kycCase.create({
      data: {
        userId,
        targetTier: input.targetTier,
        provider: String(this.provider.id),
        providerRef: decision.providerRef,
        documentTypes: input.documents.map((d) => d.type),
        status:
          decision._tag === 'APPROVED'
            ? 'APPROVED'
            : decision._tag === 'REJECTED'
              ? 'REJECTED'
              : 'IN_REVIEW',
        rejectionReason: decision._tag === 'REJECTED' ? decision.reason : null,
        decidedAt: decision._tag === 'PENDING' ? null : new Date(),
      },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'KYC_SUBMITTED',
      subjectType: 'KYC_CASE',
      subjectId: kycCase.id,
      after: {
        targetTier: input.targetTier,
        documentTypes: input.documents.map((d) => d.type),
        outcome: decision._tag,
      },
    });

    if (decision._tag === 'APPROVED') {
      await this.grantTier(userId, kycCase.id, decision.grantedTier, 'SYSTEM', null);
    }

    if (decision._tag === 'PENDING') {
      await this.compliance.openCase({
        type: 'MANUAL_REVIEW',
        summary: `KYC tier ${input.targetTier} held for manual review`,
        userId,
        detail: { kycCaseId: kycCase.id, providerRef: decision.providerRef },
      });
    }

    return toResponse(kycCase);
  }

  /**
   * Grant a tier — after screening the person, not before.
   *
   * Screening at onboarding is required by guardrail G3, and doing it here
   * means an identity that matches a designated person is stopped at the point
   * of verification rather than at the point of their first transfer.
   */
  async grantTier(
    userId: string,
    kycCaseId: string,
    tier: KycTier,
    actorType: 'SYSTEM' | 'STAFF',
    actorId: string | null,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const subject = await this.partitions.screeningSubject(user.piiToken, user.piiPartition);

    if (subject !== null) {
      const result = await this.screening.screen(
        {
          kind: 'SENDER',
          subjectRef: user.piiToken,
          fullName: subject.fullName,
          dateOfBirth: subject.dateOfBirth,
          nationality: subject.nationality,
        },
        null,
      );

      if (result.blocking) {
        await this.prisma.kycCase.update({
          where: { id: kycCaseId },
          data: {
            status: 'IN_REVIEW',
            rejectionReason: 'Screening hit — referred to compliance',
          },
        });
        await this.compliance.openCase({
          type: 'SCREENING_HIT',
          summary: `Onboarding screening hit at score ${result.topScore}`,
          userId,
          detail: { screeningRecordId: result.recordId, kycCaseId, stage: 'ONBOARDING' },
        });
        await this.audit.record({
          actorType: 'SYSTEM',
          action: 'KYC_BLOCKED_BY_SCREENING',
          subjectType: 'USER',
          subjectId: userId,
          reason: 'Screening hit at or above the blocking threshold',
        });
        return;
      }
    }

    const before = { kycTier: user.kycTier };
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { kycTier: tier } }),
      this.prisma.kycCase.update({
        where: { id: kycCaseId },
        data: { status: 'APPROVED', decidedAt: new Date(), decidedBy: actorId },
      }),
    ]);

    await this.audit.record({
      actorType,
      actorId,
      action: 'KYC_TIER_GRANTED',
      subjectType: 'USER',
      subjectId: userId,
      before,
      after: { kycTier: tier },
    });
  }

  async reject(kycCaseId: string, staffId: string, reason: string): Promise<void> {
    const kycCase = await this.prisma.kycCase.findUniqueOrThrow({ where: { id: kycCaseId } });
    await this.prisma.kycCase.update({
      where: { id: kycCaseId },
      data: {
        status: 'REJECTED',
        decidedAt: new Date(),
        decidedBy: staffId,
        rejectionReason: reason,
      },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'KYC_REJECTED',
      subjectType: 'KYC_CASE',
      subjectId: kycCaseId,
      reason,
      before: { status: kycCase.status },
      after: { status: 'REJECTED' },
    });
  }

  async casesFor(userId: string): Promise<KycCaseResponse[]> {
    const rows = await this.prisma.kycCase.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toResponse);
  }

  async pendingCases() {
    return this.prisma.kycCase.findMany({
      where: { status: { in: ['PENDING', 'IN_REVIEW'] } },
      orderBy: { submittedAt: 'asc' },
      take: 100,
    });
  }

  /** What a tier permits, for the upgrade prompt in the web app. */
  tierAllowance(tier: KycTier): { perTransfer: Money<'RUB'> } | null {
    const limits = limitsFor(tier, 'RUB', DEFAULT_TIER_LIMITS);
    if (limits === undefined) return null;
    return { perTransfer: Money.fromMinorUnits(limits.perTransferMinorUnits, 'RUB') };
  }
}

function toResponse(row: {
  id: string;
  targetTier: number;
  status: string;
  submittedAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
}): KycCaseResponse {
  return {
    id: row.id,
    targetTier: row.targetTier as KycTier,
    status: row.status as KycCaseResponse['status'],
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
  };
}
