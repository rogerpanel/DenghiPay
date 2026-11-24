import { PrismaService } from '../common/prisma.service';
import { AppConfig } from '../config/config';
import { RateSource } from '@morapay/adapters';
import { RatesService } from './rates.service';

/**
 * A currency against itself.
 *
 * Fourteen of the mesh's 210 corridors are same-currency — the four XOF
 * countries sending to each other and the two XAF ones — and until they existed
 * every corridor crossed a currency, so this case had never been exercised.
 * NE→ML halted with "no rate has ever been observed for XOF/XOF", which was the
 * feed correctly reporting that nobody had ever quoted a rate that does not
 * exist.
 *
 * The tests below are mostly about what the identity rate must NOT do: consult
 * the feed, age, or be attributed to a source.
 */

function serviceWith(latest: unknown): { service: RatesService; reads: number } {
  let reads = 0;
  const prisma = {
    rateObservation: {
      findFirst: () => {
        reads += 1;
        return Promise.resolve(latest);
      },
    },
  } as unknown as PrismaService;

  const source: RateSource = {
    id: 'test-source',
    pairs: [],
    fetch: () => Promise.reject(new Error('the feed must not be consulted for an identity rate')),
  };
  const config = { RATE_MAX_AGE_MS: 120_000 } as AppConfig;

  const service = new RatesService(prisma, source, config);
  return {
    service,
    get reads() {
      return reads;
    },
  };
}

describe('RatesService — a currency against itself', () => {
  it('quotes exactly one, without consulting the feed', async () => {
    const ctx = serviceWith(null);
    const result = await ctx.service.rateForQuoting('XOF', 'XOF');

    expect(result.rate.toDecimalString()).toBe('1');
    // The feed is not asked. If it were, this would halt: there is no XOF/XOF
    // observation and there never will be.
    expect(ctx.reads).toBe(0);
  });

  it('never goes stale', async () => {
    const ctx = serviceWith(null);
    // An hour past the two-minute threshold that halts every other pair.
    const later = new Date(Date.now() + 3_600_000);
    const result = await ctx.service.rateForQuoting('XAF', 'XAF', later);

    expect(result.ageMs).toBe(0);
    expect(result.observedAt).toEqual(later);
  });

  it('still halts for a genuine pair with no observation', async () => {
    const ctx = serviceWith(null);
    await expect(ctx.service.rateForQuoting('XOF', 'XAF')).rejects.toThrow(/No rate has ever/);
    expect(ctx.reads).toBe(1);
  });

  it('still halts for a pair whose observation has aged out', async () => {
    const ctx = serviceWith({
      numerator: 1_000_000n,
      scale: 6,
      observedAt: new Date(Date.now() - 3_600_000),
      source: 'test',
    });
    await expect(ctx.service.rateForQuoting('XOF', 'XAF')).rejects.toThrow(/beyond the/);
  });
});
