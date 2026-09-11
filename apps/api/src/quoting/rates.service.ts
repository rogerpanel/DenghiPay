import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurrencyCode, ExchangeRate, RateUnavailableError } from '@morapay/domain';
import { RateSource } from '@morapay/adapters';
import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { APP_CONFIG, RATE_SOURCE } from '../config/tokens';

/**
 * Rate ingestion with staleness detection (BUILD_PLAN 4.1).
 *
 * The rule the plan is emphatic about: if rates are stale beyond the threshold,
 * quoting halts. It does not extrapolate, it does not fall back to the last
 * known good rate, and it does not quietly widen the margin to cover the
 * uncertainty. It stops and raises an alert.
 */
@Injectable()
export class RatesService implements OnModuleInit {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RATE_SOURCE) private readonly source: RateSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Ingest once at boot, so the application can quote as soon as it answers.
   *
   * Without this there is a gap of up to a minute after every deploy in which
   * the newest observation is whatever the seed wrote — possibly already past
   * the staleness threshold — and every quote is refused with
   * RATE_UNAVAILABLE. The halt is correct behaviour; being in that state
   * immediately after a deploy, for a reason unrelated to the feed, is not.
   *
   * Failures are logged and swallowed: a rate feed that is down must not stop
   * the API from starting, because everything else it does still works and
   * quoting will halt on its own once the observations age out.
   */
  async onModuleInit(): Promise<void> {
    await this.ingest();
  }

  /** Poll the feed and persist observations. Every minute is ample for FX at our size. */
  @Cron(CronExpression.EVERY_MINUTE)
  async ingest(): Promise<void> {
    for (const [from, to] of this.source.pairs) {
      try {
        const observation = await this.source.fetch(from, to);
        await this.prisma.rateObservation.create({
          data: {
            baseCurrency: from,
            quoteCurrency: to,
            numerator: observation.rate.numerator,
            scale: observation.rate.scale,
            source: observation.source,
            observedAt: observation.observedAt,
          },
        });
      } catch (error) {
        this.logger.warn(`Rate ingestion failed for ${from}/${to}: ${String(error)}`);
      }
    }
  }

  /**
   * The latest observation for a pair, with its age.
   *
   * Returns the age rather than a boolean so the caller decides what "fresh"
   * means. The quote engine applies the threshold; a dashboard may want to show
   * amber before red.
   */
  async latest<From extends CurrencyCode, To extends CurrencyCode>(
    from: From,
    to: To,
    now = new Date(),
  ): Promise<{
    rate: ExchangeRate<From, To>;
    observedAt: Date;
    ageMs: number;
    source: string;
  } | null> {
    const row = await this.prisma.rateObservation.findFirst({
      where: { baseCurrency: from, quoteCurrency: to },
      orderBy: { observedAt: 'desc' },
    });
    if (row === null) return null;

    return {
      rate: ExchangeRate.of(from, to, row.numerator, row.scale),
      observedAt: row.observedAt,
      ageMs: now.getTime() - row.observedAt.getTime(),
      source: row.source,
    };
  }

  /**
   * The rate to quote with, or a refusal.
   *
   * Throwing here is the point: a caller cannot accidentally proceed with a
   * stale rate, because there is no value to proceed with.
   */
  async rateForQuoting<From extends CurrencyCode, To extends CurrencyCode>(
    from: From,
    to: To,
    now = new Date(),
  ): Promise<{ rate: ExchangeRate<From, To>; observedAt: Date; ageMs: number }> {
    /*
     * A currency against itself is exactly one, and no feed is involved.
     *
     * Fourteen corridors are same-currency: the four XOF countries send to each
     * other and the two XAF countries do, and none of those is an exchange.
     * Before them every corridor crossed a currency, so this case had never
     * arisen — NE→ML halted with "no rate has ever been observed for XOF/XOF",
     * which was the feed correctly reporting that it had never been asked for a
     * rate that does not exist.
     *
     * Identity, not a synthesised observation: it can never be stale, it is not
     * attributed to a source, and it is not written to rate_observation, so
     * nothing downstream can mistake it for something a market said.
     */
    if ((from as CurrencyCode) === (to as CurrencyCode)) {
      return {
        rate: ExchangeRate.of(from, to, 1n, 0),
        observedAt: now,
        ageMs: 0,
      };
    }

    const latest = await this.latest(from, to, now);
    if (latest === null) {
      throw new RateUnavailableError(
        `No rate has ever been observed for ${from}/${to}; quoting is halted`,
      );
    }
    if (latest.ageMs > this.config.RATE_MAX_AGE_MS) {
      throw new RateUnavailableError(
        `Rate for ${from}/${to} is ${Math.round(latest.ageMs / 1000)}s old, beyond the ` +
          `${Math.round(this.config.RATE_MAX_AGE_MS / 1000)}s threshold; quoting is halted`,
      );
    }
    return { rate: latest.rate, observedAt: latest.observedAt, ageMs: latest.ageMs };
  }

  /** Feed health, for the treasury dashboard and the alerting rules. */
  async health(now = new Date()): Promise<
    Array<{
      pair: string;
      rate: string | null;
      observedAt: Date | null;
      ageMs: number | null;
      usable: boolean;
      source: string;
    }>
  > {
    const results = [];
    for (const [from, to] of this.source.pairs) {
      const latest = await this.latest(from, to, now);
      results.push({
        pair: `${from}/${to}`,
        rate: latest?.rate.toDecimalString() ?? null,
        observedAt: latest?.observedAt ?? null,
        ageMs: latest?.ageMs ?? null,
        usable: latest !== null && latest.ageMs <= this.config.RATE_MAX_AGE_MS,
        source: latest?.source ?? this.source.id,
      });
    }
    return results;
  }
}
