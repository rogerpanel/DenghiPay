import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * The compliance case queue (BUILD_PLAN 3.4, 9.1).
 *
 * A blocked transfer becomes a case. A case is decided by a named
 * COMPLIANCE_OFFICER with a written reason, and both the decision and the
 * reason go into the hash-chained audit log. Nothing clears itself, and a
 * timeout does not clear anything either — an unreviewed case stays open.
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async openCase(input: {
    readonly type:
      'SCREENING_HIT' | 'VELOCITY' | 'STRUCTURING' | 'ENHANCED_DUE_DILIGENCE' | 'MANUAL_REVIEW';
    readonly summary: string;
    readonly userId?: string | null;
    readonly transferId?: string | null;
    readonly detail?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const created = await this.prisma.complianceCase.create({
      data: {
        type: input.type,
        summary: input.summary,
        userId: input.userId ?? null,
        transferId: input.transferId ?? null,
        detail: (input.detail ?? {}) as object,
      },
      select: { id: true },
    });

    await this.audit.record({
      actorType: 'SYSTEM',
      action: 'COMPLIANCE_CASE_OPENED',
      subjectType: 'COMPLIANCE_CASE',
      subjectId: created.id,
      reason: input.summary,
      after: { type: input.type, transferId: input.transferId ?? null, status: 'OPEN' },
    });

    return created;
  }

  async listQueue(status?: 'OPEN' | 'IN_REVIEW' | 'CLEARED' | 'REJECTED', limit = 50) {
    return this.prisma.complianceCase.findMany({
      where: status === undefined ? { status: { in: ['OPEN', 'IN_REVIEW'] } } : { status },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        notes: { orderBy: { createdAt: 'asc' } },
        transfer: { select: { reference: true, state: true, corridorId: true } },
      },
    });
  }

  async get(id: string) {
    const found = await this.prisma.complianceCase.findUnique({
      where: { id },
      include: {
        notes: { orderBy: { createdAt: 'asc' } },
        transfer: { select: { reference: true, state: true, corridorId: true } },
      },
    });
    if (found === null) {
      throw new NotFoundException({ code: 'CASE_NOT_FOUND', message: 'No such case' });
    }
    return found;
  }

  async claim(caseId: string, staffId: string): Promise<void> {
    const existing = await this.get(caseId);
    if (existing.status !== 'OPEN') {
      throw new ForbiddenException({
        code: 'CASE_NOT_OPEN',
        message: `Case is ${existing.status} and cannot be claimed`,
      });
    }
    await this.prisma.complianceCase.update({
      where: { id: caseId },
      data: { status: 'IN_REVIEW', assignedTo: staffId },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'COMPLIANCE_CASE_CLAIMED',
      subjectType: 'COMPLIANCE_CASE',
      subjectId: caseId,
      before: { status: existing.status },
      after: { status: 'IN_REVIEW', assignedTo: staffId },
    });
  }

  async addNote(caseId: string, staffId: string, body: string): Promise<void> {
    await this.get(caseId);
    await this.prisma.complianceCaseNote.create({
      data: { caseId, authorId: staffId, body },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'COMPLIANCE_NOTE_ADDED',
      subjectType: 'COMPLIANCE_CASE',
      subjectId: caseId,
    });
  }

  /**
   * Decide a case.
   *
   * The decision is returned rather than applied to the transfer here: the
   * transfer service owns state transitions, so that the state machine stays
   * the only thing that moves a transfer.
   */
  async decide(
    caseId: string,
    staffId: string,
    decision: 'CLEAR' | 'REJECT',
    reason: string,
  ): Promise<{ transferId: string | null; decision: 'CLEAR' | 'REJECT' }> {
    const existing = await this.get(caseId);
    if (existing.status === 'CLEARED' || existing.status === 'REJECTED') {
      throw new ForbiddenException({
        code: 'CASE_ALREADY_DECIDED',
        message: `Case was already ${existing.status.toLowerCase()}`,
      });
    }

    await this.prisma.complianceCase.update({
      where: { id: caseId },
      data: {
        status: decision === 'CLEAR' ? 'CLEARED' : 'REJECTED',
        decidedAt: new Date(),
        decidedBy: staffId,
        decisionReason: reason,
      },
    });

    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: decision === 'CLEAR' ? 'COMPLIANCE_CASE_CLEARED' : 'COMPLIANCE_CASE_REJECTED',
      subjectType: 'COMPLIANCE_CASE',
      subjectId: caseId,
      reason,
      before: { status: existing.status },
      after: { status: decision === 'CLEAR' ? 'CLEARED' : 'REJECTED', decidedBy: staffId },
    });

    return { transferId: existing.transferId, decision };
  }

  async openCaseCount(): Promise<number> {
    return this.prisma.complianceCase.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } });
  }
}
