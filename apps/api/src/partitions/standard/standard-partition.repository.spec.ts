import { PrismaService } from '../../common/prisma.service';
import {
  STANDARD_PARTITIONS,
  StandardPartition,
  StandardPartitionRepository,
  isStandardPartition,
} from './standard-partition.repository';

/**
 * Guardrail G8. Ten residencies now share one repository, so the thing that
 * used to be obvious from the filename — that the Kenyan row goes to the Kenyan
 * schema — is a line in a lookup table instead.
 *
 * That is the whole risk of the generic repository and it is the only thing
 * these tests are really about. A transposed pair in `SENDER_TABLES` moves
 * personal data across a border, breaks nothing, throws nothing, and passes
 * every test of a transfer that does not look at which table was written. So it
 * is asserted directly, for every country, in both directions.
 *
 * The Prisma delegates are replaced with recorders. There is no database here
 * on purpose: the question is which delegate was called, and a real database
 * would answer a different and easier question.
 */

interface Recorded {
  readonly delegate: string;
  readonly op: 'upsert' | 'findUnique' | 'count';
  readonly args: unknown;
}

function fakePrisma(): { prisma: PrismaService; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const target: Record<string, unknown> = {};

  // Every `senderProfileXx` / `recipientProfileXx` the repository reaches for
  // is manufactured on access and reports its own name, so a wrong lookup shows
  // up as the wrong name rather than as an undefined property.
  const prisma = new Proxy(target, {
    get(_t, property: string) {
      return {
        upsert: (args: unknown) => {
          calls.push({ delegate: property, op: 'upsert', args });
          return Promise.resolve({});
        },
        findUnique: (args: unknown) => {
          calls.push({ delegate: property, op: 'findUnique', args });
          return Promise.resolve(null);
        },
        count: () => {
          calls.push({ delegate: property, op: 'count', args: undefined });
          return Promise.resolve(0);
        },
      };
    },
  }) as unknown as PrismaService;

  return { prisma, calls };
}

/** The single call a test expected to see, or a failure naming what it got. */
function only(calls: readonly Recorded[]): Recorded {
  if (calls.length !== 1) {
    throw new Error(
      `expected exactly one delegate call, got ${calls.map((c) => c.delegate).join(', ') || 'none'}`,
    );
  }
  return calls[0] as Recorded;
}

const SENDER_INPUT = {
  piiToken: 'tok_sender',
  firstName: 'Amina',
  lastName: 'Wanjiru',
  dateOfBirth: '1990-04-02',
  nationality: 'KE',
  documents: [],
};

describe('StandardPartitionRepository — the residency table (guardrail G8)', () => {
  /**
   * The expected mapping, written out by hand rather than derived from
   * STANDARD_PARTITIONS.
   *
   * Deriving it would make this test pass for any consistent-looking naming
   * scheme, including a wrong one. Typing it out is the point: two independent
   * statements of the same fact, and a transposition has to be made twice to
   * survive.
   */
  const EXPECTED: Record<StandardPartition, { sender: string; recipient: string }> = {
    CD: { sender: 'senderProfileCd', recipient: 'recipientProfileCd' },
    CG: { sender: 'senderProfileCg', recipient: 'recipientProfileCg' },
    UG: { sender: 'senderProfileUg', recipient: 'recipientProfileUg' },
    KE: { sender: 'senderProfileKe', recipient: 'recipientProfileKe' },
    TZ: { sender: 'senderProfileTz', recipient: 'recipientProfileTz' },
    ZM: { sender: 'senderProfileZm', recipient: 'recipientProfileZm' },
    GM: { sender: 'senderProfileGm', recipient: 'recipientProfileGm' },
    NE: { sender: 'senderProfileNe', recipient: 'recipientProfileNe' },
    ML: { sender: 'senderProfileMl', recipient: 'recipientProfileMl' },
    SN: { sender: 'senderProfileSn', recipient: 'recipientProfileSn' },
  };

  it.each(STANDARD_PARTITIONS)(
    'writes a %s sender only to that partition schema',
    async (partition) => {
      const { prisma, calls } = fakePrisma();
      await new StandardPartitionRepository(prisma).senderStore(partition).upsert(SENDER_INPUT);

      expect(only(calls).delegate).toBe(EXPECTED[partition].sender);
    },
  );

  it.each(STANDARD_PARTITIONS)(
    'writes a %s recipient only to that partition schema',
    async (partition) => {
      const { prisma, calls } = fakePrisma();
      await new StandardPartitionRepository(prisma).recipientStore(partition).upsert({
        piiToken: 'tok_recipient',
        msisdn: '254712345678',
        network: 'MPESA',
        accountName: 'Amina Wanjiru',
      });

      expect(only(calls).delegate).toBe(EXPECTED[partition].recipient);
    },
  );

  it.each(STANDARD_PARTITIONS)(
    'reads %s personal data only from that partition schema',
    async (partition) => {
      const { prisma, calls } = fakePrisma();
      const repo = new StandardPartitionRepository(prisma);
      await repo.senderStore(partition).screeningProjection('tok_sender');
      await repo.senderStore(partition).collectionWallet('tok_sender');
      await repo.recipientStore(partition).find('tok_recipient');

      expect(calls.map((c) => c.delegate)).toEqual([
        EXPECTED[partition].sender,
        EXPECTED[partition].sender,
        EXPECTED[partition].recipient,
      ]);
    },
  );

  it('gives every partition a table of its own', () => {
    const delegates = STANDARD_PARTITIONS.flatMap((p) => [
      EXPECTED[p].sender,
      EXPECTED[p].recipient,
    ]);
    expect(new Set(delegates).size).toBe(delegates.length);
  });

  /**
   * The two Congos. CD is the Democratic Republic (Congolese franc, BCC) and CG
   * is the Republic (Central African CFA franc, BEAC) — different countries,
   * different central banks, adjacent two-letter codes and the same name in
   * conversation. Filing one in the other's schema is the single most plausible
   * mistake in this table, so it gets its own assertion.
   */
  it('keeps the two Congos apart', async () => {
    const { prisma, calls } = fakePrisma();
    const repo = new StandardPartitionRepository(prisma);
    await repo.senderStore('CD').upsert(SENDER_INPUT);
    await repo.senderStore('CG').upsert(SENDER_INPUT);

    expect(calls.map((c) => c.delegate)).toEqual(['senderProfileCd', 'senderProfileCg']);
  });
});

describe('StandardPartitionRepository — projections', () => {
  it('sends only name, date of birth and nationality to screening', async () => {
    const { prisma, calls } = fakePrisma();
    await new StandardPartitionRepository(prisma).senderStore('KE').screeningProjection('tok');

    const select = (only(calls).args as { select: Record<string, boolean> }).select;
    expect(Object.keys(select).sort()).toEqual([
      'dateOfBirth',
      'firstName',
      'lastName',
      'middleName',
      'nationality',
    ]);
    // The national identity number is the thing that must not leave, and it is
    // the field most likely to be added to this select by someone who needs one
    // more piece of information.
    expect(select.nationalIdNo).toBeUndefined();
    expect(select.addressLine).toBeUndefined();
    expect(select.phone).toBeUndefined();
  });

  it('sends only a number and a network to the collection rail', async () => {
    const { prisma, calls } = fakePrisma();
    await new StandardPartitionRepository(prisma).senderStore('UG').collectionWallet('tok');

    const select = (only(calls).args as { select: Record<string, boolean> }).select;
    expect(Object.keys(select).sort()).toEqual(['walletMsisdn', 'walletNetwork']);
  });

  it('treats a sender with no wallet as having none rather than failing', async () => {
    // findUnique returns null in the recorder — the ordinary case for a push
    // rail, and it must read as "nothing to debit", not as an error.
    const { prisma } = fakePrisma();
    const wallet = await new StandardPartitionRepository(prisma)
      .senderStore('TZ')
      .collectionWallet('tok');
    expect(wallet).toBeNull();
  });
});

describe('isStandardPartition', () => {
  it('accepts the ten and nothing else', () => {
    for (const partition of STANDARD_PARTITIONS) {
      expect(isStandardPartition(partition)).toBe(true);
    }
    // Hand-written partitions are not standard: they carry jurisdiction-specific
    // fields this repository has no columns for, and routing one here would
    // silently drop a BVN or a tax reference.
    for (const partition of ['RU', 'NG', 'GH', 'ZA', 'CM', 'BJ']) {
      expect(isStandardPartition(partition)).toBe(false);
    }
    expect(isStandardPartition('ke')).toBe(false);
    expect(isStandardPartition('ZW')).toBe(false);
  });
});
