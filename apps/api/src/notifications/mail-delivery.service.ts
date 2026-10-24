import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { PrismaService } from '../common/prisma.service';
import { APP_CONFIG } from '../config/tokens';
import type { AppConfig } from '../config/config';

/**
 * The half of the outbox that actually delivers.
 *
 * `OutboxService` writes; this drains. Splitting them is what makes an SMTP
 * outage survivable: a verification link is durable in the database before any
 * network call is attempted, so a provider being down delays mail rather than
 * losing it.
 *
 * Three properties worth stating, because each is a failure someone has shipped
 * before:
 *
 *  - **A message is claimed before it is sent.** The claim is a conditional
 *    update on the `attempts` value that was read, so two API instances racing
 *    for the same row produce one winner and one no-op. Mail is at-least-once
 *    by nature; this keeps it from being gratuitously more than once.
 *  - **Failure is bounded and visible.** Attempts back off, stop at
 *    `MAIL_MAX_ATTEMPTS`, and leave `failure_reason` on the row. A message that
 *    can never be delivered becomes a thing a human can find, not an infinite
 *    retry loop.
 *  - **Nothing personal is logged** (guardrail G9). The log carries a message
 *    id and a kind. The recipient address, the subject and the body — which
 *    holds a verification token — stay in the database.
 */
@Injectable()
export class MailDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailDeliveryService.name);
  private transporter: Transporter | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.MAIL_TRANSPORT !== 'smtp') {
      // Said out loud at boot. "Why did no email arrive" should be answerable
      // from the startup log rather than from the source.
      this.logger.log(
        'MAIL_TRANSPORT=outbox — mail is written to the outbox and not delivered. ' +
          'Read it at GET /simulator/outbox.',
      );
      return;
    }

    // `loadConfig` has already refused to boot on missing credentials, so these
    // are present; the assertions are for the type, not for the check.
    this.transporter = createTransport({
      host: this.config.SMTP_HOST ?? '',
      port: this.config.SMTP_PORT,
      // Implicit TLS on 465; STARTTLS is negotiated on 587 and 25.
      secure: this.config.SMTP_SECURE || this.config.SMTP_PORT === 465,
      auth: {
        user: this.config.SMTP_USER ?? '',
        pass: this.config.SMTP_PASSWORD ?? '',
      },
      /*
       * Timeouts, stated rather than inherited.
       *
       * `drain` holds a reentrancy flag for its whole run, so a single socket
       * that opens and then goes quiet stops *all* mail until it resolves.
       * Nodemailer's default socket timeout is ten minutes, which would be ten
       * minutes of no verification emails with nothing in the log to say why.
       * Fifteen seconds is far longer than any healthy provider needs and short
       * enough that the next tick recovers.
       */
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    this.logger.log(
      `MAIL_TRANSPORT=smtp — draining the outbox to ${this.config.SMTP_HOST}:${this.config.SMTP_PORT} ` +
        `every ${this.config.MAIL_POLL_SECONDS}s`,
    );
    this.timer = setInterval(() => {
      void this.drain();
    }, this.config.MAIL_POLL_SECONDS * 1000);
    // Do not hold the process open for a mail poll.
    this.timer.unref?.();
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.transporter?.close();
  }

  /**
   * Send everything that is due.
   *
   * Reentrancy guard rather than a queue: if a drain overruns its interval, the
   * next tick does nothing instead of sending the same batch twice.
   */
  async drain(limit = 25): Promise<{ sent: number; failed: number }> {
    if (this.transporter === null || this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    let sent = 0;
    let failed = 0;
    try {
      const due = await this.prisma.outboxMessage.findMany({
        where: {
          sentAt: null,
          channel: 'EMAIL',
          attempts: { lt: this.config.MAIL_MAX_ATTEMPTS },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          id: true,
          recipient: true,
          subject: true,
          body: true,
          kind: true,
          attempts: true,
          failedAt: true,
        },
      });

      const now = Date.now();
      for (const message of due) {
        if (
          message.failedAt !== null &&
          now < message.failedAt.getTime() + backoffMs(message.attempts)
        ) {
          continue; // Still inside this message's backoff window.
        }

        // Claim it. Conditioning on the attempts value we read means a second
        // instance that read the same row loses the update and skips.
        const claim = await this.prisma.outboxMessage.updateMany({
          where: { id: message.id, sentAt: null, attempts: message.attempts },
          data: { attempts: message.attempts + 1 },
        });
        if (claim.count === 0) continue;

        try {
          await this.transporter.sendMail({
            from: this.config.MAIL_FROM,
            to: message.recipient,
            subject: message.subject,
            text: message.body,
            // Both parts, and the HTML one is not decoration. A verification
            // token is long enough that quoted-printable wraps the URL across a
            // soft line break; a conforming client rejoins it, but many clients
            // auto-linkify only as far as the break and produce a dead link
            // that looks real. An explicit anchor cannot be split.
            html: htmlFrom(message.body),
          });
          await this.prisma.outboxMessage.update({
            where: { id: message.id },
            data: { sentAt: new Date(), failedAt: null, failureReason: null },
          });
          sent += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          await this.prisma.outboxMessage.update({
            where: { id: message.id },
            data: { failedAt: new Date(), failureReason: reason.slice(0, 500) },
          });
          failed += 1;
          // Id and kind only. The recipient is personal data (guardrail G9).
          this.logger.warn(
            `mail delivery failed id=${message.id} kind=${message.kind} ` +
              `attempt=${message.attempts + 1}/${this.config.MAIL_MAX_ATTEMPTS}: ${reason}`,
          );
        }
      }
    } finally {
      this.draining = false;
    }

    if (sent > 0 || failed > 0) {
      this.logger.log(`outbox drained: ${sent} sent, ${failed} failed`);
    }
    return { sent, failed };
  }

  /** Undelivered mail that has run out of attempts — a queue for a human. */
  async stuck(limit = 50) {
    return this.prisma.outboxMessage.findMany({
      where: { sentAt: null, attempts: { gte: this.config.MAIL_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      // Deliberately not the body: it carries verification tokens.
      select: {
        id: true,
        kind: true,
        attempts: true,
        failedAt: true,
        failureReason: true,
        createdAt: true,
      },
    });
  }
}

/**
 * Exponential backoff, capped.
 *
 * 30s, 1m, 2m, 4m, 8m — fast enough that a brief provider blip resolves before
 * a user gives up on the email, slow enough not to hammer a rejecting server.
 */
function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 480_000);
}

/**
 * A minimal HTML alternative for a plain-text message.
 *
 * Escapes first and links second, so a body that happens to contain angle
 * brackets cannot inject markup into somebody's mail client.
 */
function htmlFrom(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" style="color:#b45309">${url}</a>`,
  );
  return (
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6">' +
    linked.replace(/\n/g, '<br>') +
    '</div>'
  );
}
