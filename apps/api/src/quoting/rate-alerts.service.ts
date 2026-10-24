import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateRateAlertRequest, RateAlertDto } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { CorridorsService } from './corridors.service';
import { RatesService } from './rates.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OutboxService } from '../notifications/outbox.service';

/** How many alerts one person may hold. A thousand alerts is a denial of service. */
const MAX_ACTIVE_PER_USER = 20;

/**
 * Rate alerts (BUILD_PLAN 14.5).
 *
 * "Tell me when the naira passes 1500." Cheap to build because the rate feed
 * already exists, and the feature diaspora senders ask for most — people time
 * remittances around the rate whether or not we help them.
 *
 * Two decisions worth defending:
 *
 *  - **It compares the rate we would actually quote**, margin included, not the
 *    mid-market rate. Telling somebody the rate hit their number and then
 *    quoting them something worse is the kind of small dishonesty that costs a
 *    customer permanently.
 *  - **It fires once and disarms.** A rate hovering either side of a threshold
 *    would otherwise produce a notification every minute, which teaches people
 *    to ignore notifications — including the ones about their money.
 */
@Injectable()
export class RateAlertsService {
  private readonly logger = new Logger(RateAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly corridors: CorridorsService,
    private readonly rates: RatesService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  async create(userId: string, input: CreateRateAlertRequest): Promise<RateAlertDto> {
    const corridor = await this.corridors.get(input.corridorId);

    const active = await this.prisma.rateAlert.count({ where: { userId, active: true } });
    if (active >= MAX_ACTIVE_PER_USER) {
      throw new BadRequestException({
        code: 'TOO_MANY_ALERTS',
        message: `You can hold ${MAX_ACTIVE_PER_USER} alerts at once. Delete one to add another.`,
      });
    }

    if (Number(input.thresholdRate) <= 0) {
      throw new BadRequestException({
        code: 'INVALID_THRESHOLD',
        message: 'A threshold rate must be greater than zero',
      });
    }

    const row = await this.prisma.rateAlert.create({
      data: {
        userId,
        corridorId: corridor.id,
        direction: input.direction,
        thresholdRate: input.thresholdRate,
      },
    });
    return this.toDto(row);
  }

  async list(userId: string): Promise<RateAlertDto[]> {
    const rows = await this.prisma.rateAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.rateAlert.findUnique({ where: { id } });
    if (existing === null || existing.userId !== userId) {
      throw new NotFoundException({ code: 'ALERT_NOT_FOUND', message: 'No such alert' });
    }
    await this.prisma.rateAlert.delete({ where: { id } });
  }

  /**
   * Check every armed alert against the current quote for its corridor.
   *
   * Runs a minute behind the feed rather than inside it: an alert that throws
   * must never be able to stop rates being ingested, because the ingest is what
   * keeps quoting alive.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async check(now = new Date()): Promise<number> {
    const alerts = await this.prisma.rateAlert.findMany({
      where: { active: true },
      take: 500,
    });
    if (alerts.length === 0) return 0;

    // One rate lookup per corridor, not per alert.
    const rateByCorridor = new Map<string, string | null>();
    let fired = 0;

    for (const alert of alerts) {
      try {
        if (!rateByCorridor.has(alert.corridorId)) {
          rateByCorridor.set(alert.corridorId, await this.currentRate(alert.corridorId, now));
        }
        const current = rateByCorridor.get(alert.corridorId) ?? null;
        if (current === null) continue; // Feed is stale; say nothing rather than guess.

        if (!crossed(alert.direction, current, alert.thresholdRate)) continue;

        await this.prisma.rateAlert.update({
          where: { id: alert.id },
          data: { active: false, triggeredAt: now, triggeredRate: current },
        });

        const heading = `${alert.corridorId} is at ${current}`;
        const body =
          `Your alert was set for ${alert.direction === 'ABOVE' ? 'above' : 'below'} ` +
          `${alert.thresholdRate}. This rate is not held — open the app to get a live quote.`;

        await this.notifications.notify({
          userId: alert.userId,
          kind: 'RATE_ALERT',
          title: heading,
          body,
          link: `/send?corridorId=${encodeURIComponent(alert.corridorId)}`,
        });

        const user = await this.prisma.user.findUnique({
          where: { id: alert.userId },
          select: { email: true },
        });
        if (user !== null) {
          await this.outbox.enqueue({
            channel: 'EMAIL',
            recipient: user.email,
            kind: 'RATE_ALERT',
            subject: heading,
            body: `${heading}\n\n${body}\n`,
            metadata: { corridorId: alert.corridorId },
          });
        }
        fired += 1;
      } catch (error) {
        // Alert ids only; an alert belongs to a person (guardrail G9).
        this.logger.warn(`rate alert ${alert.id} could not be checked: ${String(error)}`);
      }
    }

    if (fired > 0) this.logger.log(`rate alerts fired: ${fired}`);
    return fired;
  }

  /**
   * The rate a sender would actually be quoted on this corridor right now,
   * margin applied. Null when the feed is too stale to quote from — the same
   * refusal the quote engine makes, for the same reason.
   */
  private async currentRate(corridorId: string, now = new Date()): Promise<string | null> {
    try {
      const corridor = await this.corridors.get(corridorId);
      const { rate } = await this.rates.rateForQuoting(
        corridor.sourceCurrency,
        corridor.destinationCurrency,
        now,
      );
      // The rate they would be quoted, margin included — not the mid-market
      // rate. Alerting on a number we would not honour is a small dishonesty
      // that costs a customer permanently.
      return rate.applyMarginBps(corridor.fees.fxMarginBps).toDecimalString();
    } catch {
      return null;
    }
  }

  private async toDto(row: {
    id: string;
    corridorId: string;
    direction: string;
    thresholdRate: string;
    active: boolean;
    triggeredAt: Date | null;
    triggeredRate: string | null;
    createdAt: Date;
  }): Promise<RateAlertDto> {
    return {
      id: row.id,
      corridorId: row.corridorId,
      direction: row.direction as 'ABOVE' | 'BELOW',
      thresholdRate: row.thresholdRate,
      currentRate: await this.currentRate(row.corridorId),
      active: row.active,
      triggeredAt: row.triggeredAt?.toISOString() ?? null,
      triggeredRate: row.triggeredRate,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/**
 * Has the rate crossed the threshold?
 *
 * Compared as scaled integers rather than as numbers. These are exchange rates,
 * not money, so a float would not corrupt a balance — but the rule in this
 * codebase is that decimal strings are compared exactly, and a rule with an
 * exception is a rule somebody will apply to money next.
 */
export function crossed(direction: string, current: string, threshold: string): boolean {
  const scale = Math.max(decimalsOf(current), decimalsOf(threshold));
  const a = scaled(current, scale);
  const b = scaled(threshold, scale);
  return direction === 'ABOVE' ? a >= b : a <= b;
}

function decimalsOf(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

function scaled(value: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`);
}
