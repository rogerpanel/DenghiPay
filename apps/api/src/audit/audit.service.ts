import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { scrub } from '../common/logger';

/**
 * Tamper-evident audit log (BUILD_PLAN 2.5).
 *
 * Each row carries the hash of the row before it, so altering any historical
 * row breaks every hash after it. The database refuses UPDATE and DELETE on the
 * table outright (see the ledger integrity migration), which means the only way
 * to tamper is to rewrite the chain — and `verifyChain` detects that.
 *
 * The log is written in a serialisable transaction so two concurrent appends
 * cannot both claim the same predecessor.
 */

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  readonly actorType: 'USER' | 'STAFF' | 'SYSTEM' | 'PROVIDER';
  readonly actorId?: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId?: string | null;
  readonly reason?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ipHash?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<{ sequence: bigint; hash: string }> {
    // Personal data must not reach the audit log any more than it reaches
    // stdout. The before/after snapshots go through the same scrubber.
    const before = input.before === undefined ? null : (scrub(input.before) as object);
    const after = input.after === undefined ? null : (scrub(input.after) as object);

    return this.prisma.$transaction(
      async (tx) => {
        const previous = await tx.auditEvent.findFirst({
          orderBy: { sequence: 'desc' },
          select: { hash: true },
        });
        const prevHash = previous?.hash ?? GENESIS_HASH;

        const createdAt = new Date();
        const hash = computeHash({
          prevHash,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          subjectType: input.subjectType,
          subjectId: input.subjectId ?? null,
          reason: input.reason ?? null,
          before,
          after,
          createdAt,
        });

        const row = await tx.auditEvent.create({
          data: {
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            action: input.action,
            subjectType: input.subjectType,
            subjectId: input.subjectId ?? null,
            reason: input.reason ?? null,
            beforeState: before ?? undefined,
            afterState: after ?? undefined,
            ipHash: input.ipHash ?? null,
            createdAt,
            prevHash,
            hash,
          },
          select: { sequence: true, hash: true },
        });

        return row;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  /**
   * Walk the chain and report the first row whose hash does not follow from its
   * contents and its predecessor.
   */
  async verifyChain(
    limit = 10_000,
  ): Promise<
    | { readonly ok: true; readonly checked: number }
    | { readonly ok: false; readonly checked: number; readonly brokenAtSequence: bigint }
  > {
    const rows = await this.prisma.auditEvent.findMany({
      orderBy: { sequence: 'asc' },
      take: limit,
    });

    let prevHash = GENESIS_HASH;
    let checked = 0;

    for (const row of rows) {
      const expected = computeHash({
        prevHash,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        reason: row.reason,
        before: (row.beforeState as object | null) ?? null,
        after: (row.afterState as object | null) ?? null,
        createdAt: row.createdAt,
      });

      if (row.prevHash !== prevHash || row.hash !== expected) {
        return { ok: false, checked, brokenAtSequence: row.sequence };
      }

      prevHash = row.hash;
      checked += 1;
    }

    return { ok: true, checked };
  }

  async list(filter: {
    readonly subjectType?: string;
    readonly subjectId?: string;
    readonly actorId?: string;
    readonly limit?: number;
  }): Promise<
    Array<{
      sequence: bigint;
      actorType: string;
      actorId: string | null;
      action: string;
      subjectType: string;
      subjectId: string | null;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    return this.prisma.auditEvent.findMany({
      where: {
        ...(filter.subjectType === undefined ? {} : { subjectType: filter.subjectType }),
        ...(filter.subjectId === undefined ? {} : { subjectId: filter.subjectId }),
        ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
      },
      orderBy: { sequence: 'desc' },
      take: filter.limit ?? 100,
      select: {
        sequence: true,
        actorType: true,
        actorId: true,
        action: true,
        subjectType: true,
        subjectId: true,
        reason: true,
        createdAt: true,
      },
    });
  }
}

interface HashInput {
  readonly prevHash: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly reason: string | null;
  readonly before: object | null;
  readonly after: object | null;
  readonly createdAt: Date;
}

/**
 * Canonical serialisation, deliberately positional rather than JSON-of-an-object:
 * key ordering must not be able to change the hash.
 */
export function computeHash(input: HashInput): string {
  const canonical = [
    input.prevHash,
    input.actorType,
    input.actorId ?? '',
    input.action,
    input.subjectType,
    input.subjectId ?? '',
    input.reason ?? '',
    input.before === null ? '' : stableStringify(input.before),
    input.after === null ? '' : stableStringify(input.after),
    input.createdAt.toISOString(),
  ].join('');

  return createHash('sha256').update(canonical).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
