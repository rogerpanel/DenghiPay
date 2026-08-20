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

/**
 * Units of each currency per one US dollar.
 *
 * Every corridor pair is derived from this table rather than written out by
 * hand. With four origins and five destinations there are sixteen ordered pairs
 * today and more with every country; typing them individually guarantees that
 * one eventually disagrees with its own reciprocal by more than a spread, and
 * nobody notices until a treasury reconciliation.
 *
 * The CFA francs sit at the euro peg — 655.957 XAF or XOF to the euro, fixed
 * and guaranteed — carried through to the dollar at roughly 1.08 USD/EUR. They
 * are identical to one another because the two pegs are identical, which is
 * exactly why they are still listed twice: the parity is a fact about today's
 * peg, not a licence to treat one currency as the other.
 */
const USD_ANCHOR: Readonly<Partial<Record<CurrencyCode, number>>> = {
  USD: 1,
  RUB: 77.0,
  BYN: 2.53,
  NGN: 1455.0,
  GHS: 10.38,
  ZAR: 18.5,
  XAF: 607.37,
  XOF: 607.37,
};

/** Pairs quoted directly, outside the dollar cross. */
const DIRECT_RATES: Readonly<Record<string, string>> = {
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

/**
 * The currencies that actually trade against each other on a corridor.
 *
 * Origins first — a pair is only generated where somebody can send.
 */
const ORIGIN_CURRENCIES: readonly CurrencyCode[] = ['NGN', 'GHS', 'XAF', 'XOF'];
const DESTINATION_CURRENCIES: readonly CurrencyCode[] = ['NGN', 'GHS', 'ZAR', 'XAF', 'XOF'];

/**
 * Format a computed cross to a roughly constant number of significant figures,
 * rather than a constant number of decimal places.
 *
 * The crosses here span five orders of magnitude — 0.0071 NGN per GHS against
 * 140 GHS per NGN — and a fixed decimal count would either round the small
 * rates away to nothing or pad the large ones with digits that look like
 * precision we do not have. Seven significant figures is comfortably more than
 * any rail settles at and comfortably less than a float's honest range.
 */
function formatRate(value: number): string {
  const magnitude = Math.floor(Math.log10(value));
  const decimals = Math.min(10, Math.max(2, 6 - magnitude));
  return value.toFixed(decimals);
}

function buildBaseRates(): Readonly<Record<string, string>> {
  const rates: Record<string, string> = { ...DIRECT_RATES };
  for (const from of ORIGIN_CURRENCIES) {
    for (const to of DESTINATION_CURRENCIES) {
      if (from === to) continue;
      const fromAnchor = USD_ANCHOR[from];
      const toAnchor = USD_ANCHOR[to];
      if (fromAnchor === undefined || toAnchor === undefined) continue;
      // One cross, here, where the number is observable and can be compared
      // against what a settlement partner actually fills at.
      rates[`${from}:${to}`] = formatRate(toAnchor / fromAnchor);
    }
  }
  return rates;
}

const BASE_RATES: Readonly<Record<string, string>> = buildBaseRates();

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
