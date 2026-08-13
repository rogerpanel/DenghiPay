import { Inject, Injectable, Logger } from '@nestjs/common';
import { ScreeningProvider, ScreeningSubjectInput } from '@morapay/adapters';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG, SCREENING_PROVIDER } from '../config/tokens';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../common/metrics.service';

/**
 * Sanctions and PEP screening (BUILD_PLAN 3.4, guardrail G3).
 *
 * This service has no bypass. There is no `force` parameter, no environment
 * check, no "skip in dev". A caller that wants to advance a transfer must hold
 * a screening record whose status is CLEAR, and the only way to obtain one is
 * to have screened and passed.
 *
 * `assertClear` is the gate the transfer saga calls. It reads the recorded
 * result rather than trusting an in-memory value, so a code path that skipped
 * screening cannot fabricate one.
 */
@Injectable()
export class ScreeningService {
  private readonly logger = new Logger(ScreeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCREENING_PROVIDER) private readonly provider: ScreeningProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  async screen(
    subject: ScreeningSubjectInput,
    transferId: string | null,
  ): Promise<{ recordId: string; status: 'CLEAR' | 'HIT'; topScore: number; blocking: boolean }> {
    let result;
    try {
      result = await this.provider.screen(subject);
    } catch (error) {
      // A screening provider that is down does not mean "clear". It means we
      // cannot proceed, and the record says so.
      const record = await this.prisma.screeningRecord.create({
        data: {
          subjectType: subject.kind,
          subjectRef: subject.subjectRef,
          transferId,
          provider: String(this.provider.id),
          status: 'ERROR',
          score: 0,
          matches: [],
          listVersion: 'unavailable',
        },
      });
      this.metrics.screeningResult('error');
      this.logger.error(`Screening provider failed: ${String(error)}`);
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'SCREENING_ERROR',
        subjectType: 'SCREENING',
        subjectId: record.id,
        reason: 'Screening provider unavailable; transfer cannot proceed',
      });
      return { recordId: record.id, status: 'HIT', topScore: 0, blocking: true };
    }

    const hit = result._tag === 'HIT' ? result : null;
    const isHit = hit !== null;
    const topScore = hit?.topScore ?? 0;
    const blocking = isHit && topScore >= this.config.SCREENING_BLOCK_THRESHOLD;

    const record = await this.prisma.screeningRecord.create({
      data: {
        subjectType: subject.kind,
        subjectRef: subject.subjectRef,
        transferId,
        provider: String(this.provider.id),
        status: isHit ? 'HIT' : 'CLEAR',
        score: topScore,
        matches: (hit?.matches ?? []) as unknown as object[],
        listVersion: result.listVersion,
        screenedAt: result.screenedAt,
      },
    });

    this.metrics.screeningResult(isHit ? 'hit' : 'clear');

    await this.audit.record({
      actorType: 'SYSTEM',
      action: isHit ? 'SCREENING_HIT' : 'SCREENING_CLEAR',
      subjectType: 'SCREENING',
      subjectId: record.id,
      reason: blocking ? 'Score at or above the blocking threshold' : null,
      // Note what is not recorded: the subject's name. The audit log lives in
      // the neutral tier and only ever sees the token.
      after: {
        subjectRef: subject.subjectRef,
        subjectType: subject.kind,
        status: record.status,
        score: topScore,
        listVersion: result.listVersion,
        transferId,
      },
    });

    return {
      recordId: record.id,
      status: isHit ? 'HIT' : 'CLEAR',
      topScore,
      blocking,
    };
  }

  /**
   * Guardrail G3 enforcement point.
   *
   * Throws unless this transfer has a persisted CLEAR screening record for both
   * the sender and the recipient. The transfer saga calls this immediately
   * before any state transition toward settlement.
   */
  async assertClear(transferId: string): Promise<void> {
    const records = await this.prisma.screeningRecord.findMany({
      where: { transferId },
      orderBy: { screenedAt: 'desc' },
    });

    const latestByKind = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!latestByKind.has(record.subjectType)) latestByKind.set(record.subjectType, record);
    }

    for (const kind of ['SENDER', 'RECIPIENT'] as const) {
      const record = latestByKind.get(kind);
      if (record === undefined) {
        throw new Error(
          `Guardrail G3: transfer ${transferId} has no ${kind} screening record. ` +
            'No code path may advance a transfer toward settlement without one.',
        );
      }
      if (record.status !== 'CLEAR') {
        throw new Error(
          `Guardrail G3: transfer ${transferId} has a ${record.status} ${kind} screening record ` +
            `(score ${record.score}). It cannot advance.`,
        );
      }
    }
  }

  async recordsFor(transferId: string) {
    return this.prisma.screeningRecord.findMany({
      where: { transferId },
      orderBy: { screenedAt: 'desc' },
    });
  }

  get blockThreshold(): number {
    return this.config.SCREENING_BLOCK_THRESHOLD;
  }
}
