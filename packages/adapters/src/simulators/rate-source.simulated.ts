import { CurrencyCode, ExchangeRate } from '@morapay/domain';
import { RateObservation, RateSource } from '../ports/rate-source';

/**
 * Simulated rate feed.
 *
 * Base rates are anchored to the worked example in TECHNICAL_ARCHITECTURE §1.1
 * — 100 000 ₽ → 1 298 USDT → ₦1 888 590, implying roughly 77 ₽/USDT and
 * ₦1 455/USDT — so a demo shows numbers a reader can check against the deck.
 *
 * A small deterministic wobble is applied per minute so the quote screen looks
 * alive without becoming unreproducible: the same minute always yields the same
 * rate.
 */

const BASE_RATES: Readonly<Record<string, string>> = {
  'RUB:NGN': '18.9123',
  'RUB:GHS': '0.1348',
  'RUB:USD': '0.01299',
  'RUB:USDT': '0.012987',
  'BYN:NGN': '575.4100',
  'BYN:GHS': '4.1020',
  'USD:NGN': '1455.0000',
  'USD:GHS': '10.3800',
  'USDT:NGN': '1455.0000',
};

export interface SimulatedRateOptions {
  /** Maximum deterministic wobble, in basis points. Zero makes the feed constant. */
  readonly wobbleBps?: number;
  /** Pairs to report as stale, so the "quoting halts" path can be demonstrated. */
  readonly stalePairs?: readonly string[];
  /** How old a stale observation claims to be. */
  readonly staleAgeMs?: number;
}

export class SimulatedRateSource implements RateSource {
  readonly id = 'simulated';

  constructor(private readonly options: SimulatedRateOptions = {}) {}

  get pairs(): readonly (readonly [CurrencyCode, CurrencyCode])[] {
    return Object.keys(BASE_RATES).map((key) => {
      const [from, to] = key.split(':') as [CurrencyCode, CurrencyCode];
      return [from, to] as const;
    });
  }

  async fetch<From extends CurrencyCode, To extends CurrencyCode>(
    from: From,
    to: To,
  ): Promise<RateObservation<From, To>> {
    const key = `${from}:${to}`;
    const base = BASE_RATES[key];
    if (base === undefined) {
      throw new Error(`Simulated feed has no rate for ${key}`);
    }

    const wobbleBps = this.options.wobbleBps ?? 8;
    const now = new Date();
    const rate = applyWobble(
      ExchangeRate.fromDecimalString(from, to, base),
      wobbleBps,
      minuteSeed(key, now),
    );

    const stale = (this.options.stalePairs ?? []).includes(key);
    const observedAt = stale
      ? new Date(now.getTime() - (this.options.staleAgeMs ?? 10 * 60 * 1000))
      : now;

    return { rate, observedAt, source: this.id };
  }
}

/**
 * Deterministic per-minute variation. Uses integer arithmetic on the rate
 * numerator so the wobble never introduces a float into a rate.
 */
function applyWobble<From extends CurrencyCode, To extends CurrencyCode>(
  rate: ExchangeRate<From, To>,
  wobbleBps: number,
  seed: number,
): ExchangeRate<From, To> {
  if (wobbleBps === 0) return rate;
  // seed ∈ [0, 2·wobbleBps] → offset ∈ [−wobbleBps, +wobbleBps]
  const offset = (seed % (2 * wobbleBps + 1)) - wobbleBps;
  const adjusted = (rate.numerator * BigInt(10_000 + offset)) / 10_000n;
  return ExchangeRate.of(
    rate.from,
    rate.to,
    adjusted <= 0n ? rate.numerator : adjusted,
    rate.scale,
  );
}

function minuteSeed(key: string, now: Date): number {
  const minute = Math.floor(now.getTime() / 60_000);
  let hash = minute % 100_000;
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  }
  return hash;
}

/** Exposed so the seed script can write the same base rates into the database. */
export function baseRates(): Readonly<Record<string, string>> {
  return BASE_RATES;
}
