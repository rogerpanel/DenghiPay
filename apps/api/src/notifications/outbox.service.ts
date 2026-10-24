import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

/**
 * Transactional outbox for outbound messages.
 *
 * Mail is written to the database first and delivered by a worker. A failed
 * SMTP call therefore never loses a verification link, and a demo can read the
 * outbox instead of needing a mail server.
 *
 * In production `MAIL_TRANSPORT=smtp` adds a delivery worker; the write path
 * below does not change.
 */
export interface OutboxMessageInput {
  readonly channel: 'EMAIL' | 'SMS' | 'PUSH';
  readonly recipient: string;
  readonly subject: string;
  readonly body: string;
  readonly kind: string;
  readonly metadata?: Record<string, string>;
}

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(input: OutboxMessageInput): Promise<string> {
    const row = await this.prisma.outboxMessage.create({
      data: {
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        kind: input.kind,
        metadata: input.metadata ?? {},
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * Local development mailbox. Exposed through the admin app so a demo can
   * click the verification link without a mail server; disabled in production
   * by the controller that serves it.
   */
  async recent(limit = 50): Promise<
    Array<{
      id: string;
      recipient: string;
      subject: string;
      body: string;
      kind: string;
      createdAt: Date;
      sentAt: Date | null;
    }>
  > {
    return this.prisma.outboxMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        recipient: true,
        subject: true,
        body: true,
        kind: true,
        createdAt: true,
        sentAt: true,
      },
    });
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({ where: { id }, data: { sentAt: new Date() } });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: { failedAt: new Date(), failureReason: reason },
    });
  }

  /** Notify a sender that their transfer changed state (BUILD_PLAN 10.5). */
  async notifyTransferUpdate(input: {
    readonly email: string;
    readonly reference: string;
    readonly senderStatus: string;
    readonly detail?: string;
  }): Promise<void> {
    const headline: Record<string, string> = {
      awaiting_your_payment: 'Complete your payment',
      payment_received: 'We have your payment',
      converting: 'Converting your money',
      sending_to_recipient: 'Sending to your recipient',
      delivered: 'Delivered',
      completed: 'Transfer complete',
      under_review: 'Your transfer is being reviewed',
      refund_in_progress: 'We are refunding your transfer',
      refunded: 'Your refund has been sent',
      failed: 'Your transfer could not be completed',
    };

    await this.enqueue({
      channel: 'EMAIL',
      recipient: input.email,
      kind: 'TRANSFER_UPDATE',
      subject: `${headline[input.senderStatus] ?? 'Transfer update'} — ${input.reference}`,
      body:
        `Transfer ${input.reference}\n\n` +
        `${headline[input.senderStatus] ?? 'Status updated'}.\n` +
        (input.detail === undefined ? '' : `\n${input.detail}\n`) +
        `\nTrack it in the app.`,
      metadata: { reference: input.reference, status: input.senderStatus },
    });
  }
}
