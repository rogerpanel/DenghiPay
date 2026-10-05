import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSupportThreadRequest, SupportThreadDto } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../notifications/outbox.service';
import { AuditService } from '../audit/audit.service';

/**
 * Customer support (BUILD_PLAN 14.6).
 *
 * Deliberately **not** a `ComplianceCase`. A compliance case is a regulated
 * record: it has a decision, a reason, an officer and four-eyes around it. A
 * support thread is a conversation about a payment that has not arrived yet.
 * Merging them would either drip customer chatter into the queue a regulator
 * reads, or put regulated decisions somewhere with none of the controls.
 *
 * They do touch in one place, on purpose: a thread about a transfer carries the
 * transfer id, so an agent can open the timeline without asking the customer to
 * recite it.
 *
 * The bodies live in the neutral tier. Correspondence is not identity data —
 * but staff must not paste identity numbers into a reply, because that would
 * make it identity data in a schema with no residency guarantee.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async open(userId: string, input: CreateSupportThreadRequest): Promise<SupportThreadDto> {
    // A transfer id is accepted only if it is this customer's, so a thread can
    // never be used to confirm that somebody else's transfer exists.
    let transferId: string | null = null;
    if (input.transferId !== undefined) {
      const transfer = await this.prisma.transfer.findUnique({
        where: { id: input.transferId },
        select: { id: true, userId: true },
      });
      transferId = transfer !== null && transfer.userId === userId ? transfer.id : null;
    }

    const thread = await this.prisma.supportThread.create({
      data: {
        userId,
        subject: input.subject,
        transferId,
        messages: { create: { authorType: 'USER', authorId: userId, body: input.body } },
      },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'SUPPORT_THREAD_OPENED',
      subjectType: 'SUPPORT_THREAD',
      subjectId: thread.id,
      // The subject line is the customer's own words and may name a person, so
      // the audit trail records that a thread exists rather than what it says.
      after: { transferId },
    });

    return this.get(userId, thread.id);
  }

  async listForUser(userId: string): Promise<SupportThreadDto[]> {
    const rows = await this.prisma.supportThread.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async get(userId: string, threadId: string): Promise<SupportThreadDto> {
    const thread = await this.prisma.supportThread.findUnique({
      where: { id: threadId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (thread === null || thread.userId !== userId) {
      throw new NotFoundException({ code: 'THREAD_NOT_FOUND', message: 'No such conversation' });
    }
    return this.toDto(thread);
  }

  /** The customer replies. Reopens a resolved thread rather than starting a new one. */
  async reply(userId: string, threadId: string, body: string): Promise<SupportThreadDto> {
    const thread = await this.prisma.supportThread.findUnique({ where: { id: threadId } });
    if (thread === null || thread.userId !== userId) {
      throw new NotFoundException({ code: 'THREAD_NOT_FOUND', message: 'No such conversation' });
    }

    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { threadId, authorType: 'USER', authorId: userId, body },
      }),
      this.prisma.supportThread.update({
        where: { id: threadId },
        data: { status: 'OPEN', resolvedAt: null },
      }),
    ]);

    return this.get(userId, threadId);
  }

  /* ------------------------------------------------------------ back office */

  async queue(status?: string) {
    const rows = await this.prisma.supportThread.findMany({
      where: status === undefined ? { status: { not: 'RESOLVED' } } : { status },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  /**
   * Staff replies.
   *
   * The customer is told twice — in the app and by email — because a support
   * answer nobody sees is the same as no answer, and it is the second most
   * common reason a person opens a duplicate thread.
   */
  async staffReply(
    threadId: string,
    staffId: string,
    staffName: string,
    body: string,
  ): Promise<SupportThreadDto> {
    const thread = await this.prisma.supportThread.findUnique({ where: { id: threadId } });
    if (thread === null) {
      throw new NotFoundException({ code: 'THREAD_NOT_FOUND', message: 'No such conversation' });
    }

    await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { threadId, authorType: 'STAFF', authorId: staffId, body },
      }),
      this.prisma.supportThread.update({ where: { id: threadId }, data: { status: 'ANSWERED' } }),
    ]);

    await this.notifications.notify({
      userId: thread.userId,
      kind: 'SUPPORT_REPLY',
      title: 'Support replied',
      body: thread.subject,
      link: `/support/${threadId}`,
    });

    const user = await this.prisma.user.findUnique({
      where: { id: thread.userId },
      select: { email: true },
    });
    if (user !== null) {
      await this.outbox.enqueue({
        channel: 'EMAIL',
        recipient: user.email,
        kind: 'SUPPORT_REPLY',
        subject: `Re: ${thread.subject}`,
        body: `${body}\n\nReply in the app to continue this conversation.\n`,
        metadata: { threadId },
      });
    }

    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'SUPPORT_REPLIED',
      subjectType: 'SUPPORT_THREAD',
      subjectId: threadId,
      after: { by: staffName },
    });

    const updated = await this.prisma.supportThread.findUniqueOrThrow({
      where: { id: threadId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    return this.toDto(updated);
  }

  async resolve(threadId: string, staffId: string): Promise<void> {
    await this.prisma.supportThread.update({
      where: { id: threadId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'SUPPORT_RESOLVED',
      subjectType: 'SUPPORT_THREAD',
      subjectId: threadId,
    });
  }

  private async toDto(thread: {
    id: string;
    subject: string;
    status: string;
    transferId: string | null;
    createdAt: Date;
    updatedAt: Date;
    messages: Array<{
      id: string;
      authorType: string;
      authorId: string;
      body: string;
      createdAt: Date;
    }>;
  }): Promise<SupportThreadDto> {
    // The reference, not the id, is what a customer can read back to an agent.
    const transferReference =
      thread.transferId === null
        ? null
        : ((
            await this.prisma.transfer.findUnique({
              where: { id: thread.transferId },
              select: { reference: true },
            })
          )?.reference ?? null);

    // Staff display names, resolved in one query rather than per message.
    const staffIds = [
      ...new Set(thread.messages.filter((m) => m.authorType === 'STAFF').map((m) => m.authorId)),
    ];
    const staff =
      staffIds.length === 0
        ? []
        : await this.prisma.staffUser.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, displayName: true },
          });
    const nameById = new Map(staff.map((s) => [s.id, s.displayName]));

    return {
      id: thread.id,
      subject: thread.subject,
      status: thread.status as SupportThreadDto['status'],
      transferId: thread.transferId,
      transferReference,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      messages: thread.messages.map((message) => ({
        id: message.id,
        authorType: message.authorType as 'USER' | 'STAFF',
        authorLabel:
          message.authorType === 'STAFF'
            ? (nameById.get(message.authorId) ?? 'MoraPay support')
            : 'You',
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }
}
