import { Controller, Get, Header, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { MetricsService } from '../common/metrics.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/tokens';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { LedgerService } from '@morapay/ledger';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly partitions: PartitionGateway,
    private readonly ledger: LedgerService,
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

    return {
      status: Object.values(checks).every(Boolean) ? 'ok' : 'degraded',
      checks,
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
