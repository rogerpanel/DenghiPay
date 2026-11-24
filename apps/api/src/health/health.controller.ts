import { Controller, Get, Header, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MetricsService } from '../common/metrics.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { MailDeliveryService } from '../notifications/mail-delivery.service';
import { LedgerService } from '@morapay/ledger';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly partitions: PartitionGateway,
    private readonly ledger: LedgerService,
    private readonly mail: MailDeliveryService,
  ) {}

  /** Liveness. Cheap enough to poll every second. */
  @Get('health')
  health(): { status: 'ok'; liveFundsEnabled: boolean; environment: string } {
    return {
      status: 'ok',
      // Surfaced deliberately: the single most important fact about a running
      // instance is whether it can move real money.
      liveFundsEnabled: this.config.LIVE_FUNDS_ENABLED,
      environment: this.config.NODE_ENV,
    };
  }

  /** Readiness. Checks the things a request actually depends on. */
  @Get('health/ready')
  async ready(): Promise<{
    status: 'ok' | 'degraded';
    checks: Record<string, boolean>;
  }> {
    const checks: Record<string, boolean> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }

    const partitions = await this.partitions.health();
    for (const [name, ok] of Object.entries(partitions)) {
      checks[`partition_${name}`] = ok;
    }

    /*
     * Mail is a readiness concern, not a nicety.
     *
     * A deployment with MAIL_TRANSPORT=outbox accepts registrations and never
     * sends a confirmation link, so every new customer is stranded unverified
     * and nothing anywhere says so — it looks exactly like a healthy service.
     * That is the failure this check exists to make visible, and it is the one
     * this deployment actually had.
     *
     * `mail_deliverable` is about configuration; `mail_not_stuck` is about
     * whether delivery is in fact working, because a correct configuration
     * pointed at a rejecting server fails just as quietly.
     */
    checks.mail_deliverable = this.config.MAIL_TRANSPORT === 'smtp';
    checks.mail_not_stuck = (await this.mail.stuck(1)).length === 0;

    return {
      status: Object.values(checks).every(Boolean) ? 'ok' : 'degraded',
      checks,
    };
  }

  /**
   * Mail delivery, in detail. For the back office and for whoever is asked
   * "why did the customer not get their email".
   *
   * Carries no message bodies and no recipients: a verification token is enough
   * to take over an account, and a recipient address is personal data
   * (guardrail G9). Counts and failure reasons are enough to diagnose.
   */
  @Get('health/mail')
  async mailHealth(): Promise<{
    transport: string;
    deliverable: boolean;
    pending: number;
    stuck: number;
    lastFailureReason: string | null;
    hint: string | null;
  }> {
    const [pending, stuckRows] = await Promise.all([
      this.prisma.outboxMessage.count({
        where: { sentAt: null, attempts: { lt: this.config.MAIL_MAX_ATTEMPTS } },
      }),
      this.mail.stuck(50),
    ]);

    const deliverable = this.config.MAIL_TRANSPORT === 'smtp';
    return {
      transport: this.config.MAIL_TRANSPORT,
      deliverable,
      pending,
      stuck: stuckRows.length,
      lastFailureReason: stuckRows[0]?.failureReason ?? null,
      hint: deliverable
        ? stuckRows.length > 0
          ? 'Mail is configured but delivery is failing. See lastFailureReason.'
          : null
        : 'MAIL_TRANSPORT=outbox: messages are stored and never sent, so nobody ' +
          'receives a confirmation link. Set MAIL_TRANSPORT=smtp with SMTP_HOST, ' +
          'SMTP_USER, SMTP_PASSWORD and MAIL_FROM. See docs/MAIL_SETUP.md.',
    };
  }

  /**
   * The ledger invariant, exposed as a health check.
   *
   * If this ever reports `balanced: false`, stop the world: debits and credits
   * have diverged somewhere and no further movement should be trusted.
   */
  @Get('health/ledger')
  async ledgerHealth(): Promise<{
    balanced: boolean;
    byCurrency: Record<string, string>;
    driftingAccounts: number;
  }> {
    const rows = await this.prisma.$queryRaw<
      Array<{ currency: string; net: bigint }>
    >`SELECT currency,
             SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor_units ELSE -amount_minor_units END) AS net
        FROM ledger_entry GROUP BY currency`;

    const byCurrency: Record<string, string> = {};
    let balanced = true;
    for (const row of rows) {
      byCurrency[row.currency] = String(row.net);
      if (BigInt(row.net) !== 0n) balanced = false;
    }

    const drift = await this.ledger.detectDrift();
    return {
      balanced,
      byCurrency,
      driftingAccounts: drift.filter((d) => !d.ok).length,
    };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  async scrape(): Promise<string> {
    if (!this.config.METRICS_ENABLED) return '# metrics disabled\n';
    return this.metrics.scrape();
  }
}
