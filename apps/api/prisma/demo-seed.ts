/**
 * Demo fixtures (BUILD_PLAN 13, docs/DEMO.md).
 *
 * Creates the people a walkthrough needs:
 *   - a verified sender at KYC tier 2 who can send today;
 *   - a sender at tier 0 who cannot, so the limit and the upgrade prompt are
 *     demonstrable;
 *   - a sender whose identity matches the mock sanctions list, so guardrail G3
 *     can be shown blocking a real attempt rather than described;
 *   - saved recipients in Nigeria and Ghana, including the "magic" account
 *     numbers that drive the failure scenarios.
 *
 * Never runs in production, and never with live funds enabled.
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { createHmac } from 'node:crypto';

const prisma = new PrismaClient();
const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

const DEMO_PASSWORD = 'morapay-demo-2026';
const SALT = process.env.TOKENISATION_SALT ?? 'change-me-tokenisation-salt';

function tokenise(kind: string, value: string): string {
  return `${kind}_${createHmac('sha256', SALT).update(`${kind}:${value}`).digest('hex').slice(0, 32)}`;
}

interface DemoSender {
  email: string;
  /** Which partition holds this person. Also decides which corridors they see. */
  residency: 'RU' | 'NG' | 'GH' | 'ZA' | 'CM' | 'BJ';
  kycTier: number;
  verified: boolean;
  person: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationality: string;
    phone: string;
    addressLine: string;
    city: string;
    /** Nigeria: the identity anchor CBN tiering is built on. */
    bvn?: string;
    /** Ghana: the national identifier, and the wallet we debit to collect. */
    ghanaCardNo?: string;
    /** Cameroon, Benin and South Africa: the national identity number. */
    nationalIdNo?: string;
    /** South Africa: SARS tax reference, and exchange-control residency. */
    taxReference?: string;
    exchangeControlStatus?: string;
    walletMsisdn?: string;
    walletNetwork?: string;
  };
  note: string;
}

const SENDERS: DemoSender[] = [
  {
    email: 'chidi@demo.morapay.local',
    residency: 'RU',
    kycTier: 2,
    verified: true,
    person: {
      firstName: 'Chidi',
      lastName: 'Okafor',
      dateOfBirth: '2002-05-14',
      nationality: 'NG',
      phone: '79161234567',
      addressLine: 'ul. Miklukho-Maklaya 6',
      city: 'Moscow',
    },
    note: 'Nigerian student in Moscow, tier 2 — the main demo account',
  },
  {
    email: 'ama@demo.morapay.local',
    residency: 'RU',
    kycTier: 0,
    verified: true,
    person: {
      firstName: 'Ama',
      lastName: 'Boateng',
      dateOfBirth: '1996-11-02',
      nationality: 'GH',
      phone: '79169876543',
      addressLine: 'Leninskiy prospekt 32',
      city: 'Moscow',
    },
    note: 'Tier 0 — shows the limit block and the KYC upgrade prompt',
  },
  {
    email: 'blocked@demo.morapay.local',
    residency: 'RU',
    kycTier: 2,
    verified: true,
    person: {
      // Matches an entry in the mock sanctions list.
      firstName: 'Viktor',
      lastName: 'Sokolov',
      dateOfBirth: '1971-03-14',
      nationality: 'RU',
      phone: '79150000000',
      addressLine: 'Tverskaya 7',
      city: 'Moscow',
    },
    note: 'Matches the mock SDN list — every transfer is blocked and queued (G3)',
  },
  {
    // The intra-African corridors need a sender who actually lives at the
    // origin. This one is in Lagos: her naira is collected inside Nigeria and
    // her data never leaves the NG partition.
    email: 'folake@demo.morapay.local',
    residency: 'NG',
    kycTier: 2,
    verified: true,
    person: {
      firstName: 'Folake',
      lastName: 'Adeyemi',
      dateOfBirth: '1994-07-21',
      nationality: 'NG',
      phone: '2348031234567',
      addressLine: '14 Adeola Odeku Street, Victoria Island',
      city: 'Lagos',
      bvn: '22212345678',
    },
    note: 'Lagos resident, tier 2 — sends NGN to Ghana on NG-GH',
  },
  {
    email: 'kofi@demo.morapay.local',
    residency: 'GH',
    kycTier: 2,
    verified: true,
    person: {
      firstName: 'Kofi',
      lastName: 'Mensah',
      dateOfBirth: '1990-02-09',
      nationality: 'GH',
      phone: '233241110000',
      addressLine: '7 Oxford Street, Osu',
      city: 'Accra',
      ghanaCardNo: 'GHA-123456789-0',
      // The wallet the pay-in debits. Without it a GH-NG transfer cannot be
      // collected at all — which is the failure the saga reports explicitly.
      walletMsisdn: '233241110000',
      walletNetwork: 'MTN',
    },
    note: 'Accra resident, tier 2 — sends GHS to Nigeria on GH-NG',
  },
  {
    // The francophone origins. Both collect by wallet debit, and both send in a
    // zero-decimal currency, which is the detail most likely to be got wrong.
    email: 'marie@demo.morapay.local',
    residency: 'CM',
    kycTier: 2,
    verified: true,
    person: {
      firstName: 'Marie',
      lastName: 'Ngono',
      dateOfBirth: '1991-04-03',
      nationality: 'CM',
      phone: '237671234567',
      addressLine: '42 rue Joseph Essono Balla, Bastos',
      city: 'Yaoundé',
      nationalIdNo: 'CM-1991-0403778',
      walletMsisdn: '237671234567',
      walletNetwork: 'ORANGE',
    },
    note: 'Yaoundé resident, tier 2 — sends XAF, francophone journey',
  },
  {
    email: 'kossi@demo.morapay.local',
    residency: 'BJ',
    kycTier: 2,
    verified: true,
    person: {
      firstName: 'Kossi',
      lastName: 'Dossou',
      dateOfBirth: '1988-12-19',
      nationality: 'BJ',
      phone: '22997123456',
      addressLine: '11 rue des Cheminots, Cadjèhoun',
      city: 'Cotonou',
      nationalIdNo: 'BJ-8812-19004',
      walletMsisdn: '22997123456',
      walletNetwork: 'MOOV',
    },
    note: 'Cotonou resident, tier 2 — sends XOF, francophone journey',
  },
  {
    // The only sender subject to exchange control. Every outward payment she
    // makes needs a declared category and counts against an annual allowance.
    email: 'thandi@demo.morapay.local',
    residency: 'ZA',
    kycTier: 2,
    verified: true,
    person: {
      firstName: 'Thandi',
      lastName: 'Molefe',
      dateOfBirth: '1987-06-11',
      nationality: 'ZA',
      phone: '27821234567',
      addressLine: '18 Loop Street, Cape Town City Centre',
      city: 'Cape Town',
      nationalIdNo: '8706115012087',
      taxReference: '0123456789',
      exchangeControlStatus: 'RESIDENT',
    },
    note: 'Cape Town resident, tier 2 — SARB exchange control applies to every send',
  },
];

interface DemoRecipient {
  ownerEmail: string;
  country: 'NG' | 'GH' | 'ZA' | 'CM' | 'BJ';
  nickname: string;
  accountNumber?: string;
  bankCode?: string;
  msisdn?: string;
  network?: string;
  name: string;
  note: string;
}

const RECIPIENTS: DemoRecipient[] = [
  {
    ownerEmail: 'chidi@demo.morapay.local',
    country: 'NG',
    nickname: 'Mum — Lagos',
    accountNumber: '0123456789',
    bankCode: '058',
    name: 'ADEBAYO OKONKWO',
    note: 'Happy path: settles on the first status poll',
  },
  {
    ownerEmail: 'chidi@demo.morapay.local',
    country: 'NG',
    nickname: 'Test — acknowledged then failed',
    accountNumber: '0123451111',
    bankCode: '058',
    name: 'CHIAMAKA NWOSU',
    note: 'The FreshPay bug: acknowledged, then failed. Ends in an automatic refund',
  },
  {
    ownerEmail: 'chidi@demo.morapay.local',
    country: 'NG',
    nickname: 'Test — slow settlement',
    accountNumber: '0123452222',
    bankCode: '058',
    name: 'IBRAHIM MUSA',
    note: 'Pending for three polls, then settles — shows the backoff schedule',
  },
  {
    ownerEmail: 'chidi@demo.morapay.local',
    country: 'GH',
    nickname: 'Cousin — Accra',
    msisdn: '233241234567',
    network: 'MTN',
    name: 'AMA MENSAH',
    note: 'Ghana corridor over MTN mobile money',
  },
  {
    ownerEmail: 'folake@demo.morapay.local',
    country: 'GH',
    nickname: 'Sister — Kumasi',
    msisdn: '233241200002',
    network: 'MTN',
    name: 'AMA BOATENG',
    note: 'NG-GH: naira collected in Lagos, cedis delivered to an MTN wallet',
  },
  {
    ownerEmail: 'kofi@demo.morapay.local',
    country: 'NG',
    nickname: 'Brother — Abuja',
    accountNumber: '0123400002',
    bankCode: '058',
    name: 'ADEBAYO OKONKWO',
    note: 'GH-NG: cedi wallet debited in Accra, naira delivered over NIP',
  },
  {
    ownerEmail: 'marie@demo.morapay.local',
    country: 'BJ',
    nickname: 'Frère — Cotonou',
    msisdn: '22997123456',
    network: 'MTN',
    name: 'KOSSI DOSSOU',
    note: 'CM-BJ: the CFA pair, XAF to XOF at par across two central banks',
  },
  {
    ownerEmail: 'marie@demo.morapay.local',
    country: 'ZA',
    nickname: 'Cousin — Johannesburg',
    accountNumber: '1234567890',
    bankCode: '470010',
    name: 'THABO MOLEFE',
    note: 'CM-ZA: francs collected in Yaoundé, rand delivered to a Standard Bank account',
  },
  {
    ownerEmail: 'kossi@demo.morapay.local',
    country: 'CM',
    nickname: 'Sœur — Douala',
    msisdn: '237671234567',
    network: 'MTN',
    name: 'MARIE NGONO',
    note: 'BJ-CM: the CFA pair, the other way',
  },
  {
    ownerEmail: 'thandi@demo.morapay.local',
    country: 'NG',
    nickname: 'Brother — Lagos',
    accountNumber: '0123400003',
    bankCode: '058',
    name: 'CHIAMAKA NWOSU',
    note: 'ZA-NG: rand collected in Cape Town under a declared BoP category',
  },
  {
    ownerEmail: 'folake@demo.morapay.local',
    country: 'ZA',
    nickname: 'Friend — Cape Town',
    accountNumber: '9876543210',
    bankCode: '632005',
    name: 'THABO MOLEFE',
    note: 'NG-ZA: naira collected in Lagos, rand delivered to an Absa account',
  },
];

/** Mirrors PayoutSimulator.pseudoName, so the demo data matches name enquiry. */
const NAME_POOL = [
  'ADEBAYO OKONKWO',
  'CHIAMAKA NWOSU',
  'IBRAHIM MUSA',
  'FUNMILAYO ADEYEMI',
  'KWAME MENSAH',
  'AMA BOATENG',
  'YAW ASANTE',
  'ABENA OWUSU',
];

function resolvedNameFor(identifier: string): string {
  let hash = 0;
  for (const char of identifier) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  }
  return NAME_POOL[hash % NAME_POOL.length] ?? 'UNKNOWN BENEFICIARY';
}

function maskTail(value: string): string {
  return `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
}

async function main(): Promise<void> {
  // Live funds is absolute and has no override: these senders share one
  // published password, and one of them is on the screening list on purpose.
  if (process.env.LIVE_FUNDS_ENABLED === 'true') {
    throw new Error(
      'Refusing to create demo fixtures: LIVE_FUNDS_ENABLED is true. These accounts ' +
        'share a published password and must never exist where real money moves.',
    );
  }

  // A demonstration server runs the production build, so production alone
  // cannot be the test — but it must be stated deliberately. See the longer
  // explanation in seed.ts.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMONSTRATION_SEED !== 'true') {
    throw new Error(
      'Refusing to create demo fixtures: NODE_ENV is production. If this really is a ' +
        'demonstration environment, set ALLOW_DEMONSTRATION_SEED=true to say so.',
    );
  }

  const passwordHash = await argonHash(DEMO_PASSWORD, ARGON_OPTIONS);

  console.log('→ demo senders');
  for (const sender of SENDERS) {
    const piiToken = tokenise('usr', sender.email);

    const user = await prisma.user.upsert({
      where: { email: sender.email },
      update: {
        kycTier: sender.kycTier,
        status: sender.verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
        emailVerifiedAt: sender.verified ? new Date() : null,
      },
      create: {
        email: sender.email,
        passwordHash,
        status: sender.verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
        emailVerifiedAt: sender.verified ? new Date() : null,
        kycTier: sender.kycTier,
        roles: ['SENDER'],
        locale: 'en',
        piiPartition: sender.residency,
        piiToken,
      },
    });

    // Personal data goes to the residency partition, exactly as the
    // application does — and the document set differs by jurisdiction, because
    // a Lagos resident holds a national ID and a proof of address, not a
    // migration card.
    const common = {
      firstName: sender.person.firstName,
      lastName: sender.person.lastName,
      dateOfBirth: new Date(`${sender.person.dateOfBirth}T00:00:00Z`),
      nationality: sender.person.nationality,
      phone: sender.person.phone,
      addressLine: sender.person.addressLine,
      city: sender.person.city,
    };
    const localDocuments = [
      { type: 'NATIONAL_ID', storageKey: 'demo://national-id' },
      { type: 'PROOF_OF_ADDRESS', storageKey: 'demo://proof-of-address' },
      { type: 'SELFIE', storageKey: 'demo://selfie' },
    ];

    if (sender.residency === 'NG') {
      await prisma.senderProfileNg.upsert({
        where: { piiToken },
        update: {},
        create: {
          piiToken,
          ...common,
          bvn: sender.person.bvn ?? null,
          documents: localDocuments,
        },
      });
    } else if (sender.residency === 'ZA') {
      await prisma.senderProfileZa.upsert({
        where: { piiToken },
        update: {},
        create: {
          piiToken,
          ...common,
          nationalIdNo: sender.person.nationalIdNo ?? null,
          taxReference: sender.person.taxReference ?? null,
          exchangeControlStatus: sender.person.exchangeControlStatus ?? null,
          documents: localDocuments,
        },
      });
    } else if (sender.residency === 'CM' || sender.residency === 'BJ') {
      // Written out twice rather than through a shared variable: Prisma
      // generates a distinct delegate type per model, so a union of two of them
      // is not callable. The duplication is three lines and the alternative is
      // an `any`.
      const data = {
        piiToken,
        ...common,
        nationalIdNo: sender.person.nationalIdNo ?? null,
        walletMsisdn: sender.person.walletMsisdn ?? null,
        walletNetwork: sender.person.walletNetwork ?? null,
        documents: localDocuments,
      };
      if (sender.residency === 'CM') {
        await prisma.senderProfileCm.upsert({ where: { piiToken }, update: {}, create: data });
      } else {
        await prisma.senderProfileBj.upsert({ where: { piiToken }, update: {}, create: data });
      }
    } else if (sender.residency === 'GH') {
      await prisma.senderProfileGh.upsert({
        where: { piiToken },
        update: {},
        create: {
          piiToken,
          ...common,
          ghanaCardNo: sender.person.ghanaCardNo ?? null,
          walletMsisdn: sender.person.walletMsisdn ?? null,
          walletNetwork: sender.person.walletNetwork ?? null,
          documents: localDocuments,
        },
      });
    } else {
      await prisma.senderProfileRu.upsert({
        where: { piiToken },
        update: {},
        create: {
          piiToken,
          ...common,
          documents: [
            {
              type: 'PASSPORT',
              storageKey: 'demo://passport',
              issuingCountry: sender.person.nationality,
            },
            { type: 'MIGRATION_CARD', storageKey: 'demo://migration-card' },
            { type: 'RESIDENCE_REGISTRATION', storageKey: 'demo://registration' },
          ],
        },
      });
    }

    if (sender.kycTier > 0) {
      const existing = await prisma.kycCase.findFirst({ where: { userId: user.id } });
      if (existing === null) {
        await prisma.kycCase.create({
          data: {
            userId: user.id,
            targetTier: sender.kycTier,
            status: 'APPROVED',
            provider: 'kyc-mock',
            providerRef: `KYC-DEMO-${user.id.slice(0, 8).toUpperCase()}`,
            documentTypes:
              sender.residency === 'RU'
                ? ['PASSPORT', 'MIGRATION_CARD', 'RESIDENCE_REGISTRATION', 'SELFIE']
                : ['NATIONAL_ID', 'PROOF_OF_ADDRESS', 'SELFIE'],
            decidedAt: new Date(),
          },
        });
      }
    }

    console.log(
      `  ${sender.email.padEnd(34)} ${sender.residency}  tier ${sender.kycTier}  — ${sender.note}`,
    );
  }

  console.log('→ demo recipients');
  for (const recipient of RECIPIENTS) {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: recipient.ownerEmail } });
    const identifier = recipient.accountNumber ?? recipient.msisdn ?? '';
    const piiToken = tokenise('rcp', `${owner.id}:${identifier}`);
    const resolvedName = resolvedNameFor(identifier);

    // Recipients go to the partition of the country they live in — dispatching
    // on payout method would file a Johannesburg account in the Nigerian store.
    const bankData = {
      piiToken,
      accountNumber: recipient.accountNumber ?? '',
      bankCode: recipient.bankCode ?? '058',
      // The institution's record of the name, which is what a name enquiry
      // returns. Kept in step with the simulator so the demo is coherent.
      accountName: resolvedName,
    };
    const walletData = {
      piiToken,
      msisdn: recipient.msisdn ?? '',
      network: recipient.network ?? 'MTN',
      accountName: resolvedName,
    };
    const where = { piiToken };

    switch (recipient.country) {
      case 'NG':
        await prisma.recipientProfileNg.upsert({ where, update: {}, create: bankData });
        break;
      case 'ZA':
        await prisma.recipientProfileZa.upsert({ where, update: {}, create: bankData });
        break;
      case 'GH':
        await prisma.recipientProfileGh.upsert({ where, update: {}, create: walletData });
        break;
      case 'CM':
        await prisma.recipientProfileCm.upsert({ where, update: {}, create: walletData });
        break;
      case 'BJ':
        await prisma.recipientProfileBj.upsert({ where, update: {}, create: walletData });
        break;
    }

    await prisma.recipient.upsert({
      where: { piiToken },
      update: { resolvedName, nickname: recipient.nickname, archivedAt: null },
      create: {
        userId: owner.id,
        method:
          recipient.country === 'NG' || recipient.country === 'ZA'
            ? 'BANK_ACCOUNT'
            : 'MOBILE_MONEY',
        country: recipient.country,
        piiToken,
        piiPartition: recipient.country,
        maskedAccount: maskTail(identifier),
        resolvedName,
        nickname: recipient.nickname,
      },
    });

    console.log(`  ${recipient.nickname.padEnd(34)} ${maskTail(identifier)} — ${recipient.note}`);
  }

  console.log('');
  console.log('  Sender app: http://localhost:3000');
  console.log(`    password (development only): ${DEMO_PASSWORD}`);
  console.log('');
  console.log('Demo fixtures ready. Walkthrough: docs/DEMO.md');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
