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
  };
  note: string;
}

const SENDERS: DemoSender[] = [
  {
    email: 'chidi@demo.morapay.local',
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
];

interface DemoRecipient {
  ownerEmail: string;
  country: 'NG' | 'GH';
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
        piiPartition: 'RU',
        piiToken,
      },
    });

    // Personal data goes to the RU partition, exactly as the application does.
    await prisma.senderProfileRu.upsert({
      where: { piiToken },
      update: {},
      create: {
        piiToken,
        firstName: sender.person.firstName,
        lastName: sender.person.lastName,
        dateOfBirth: new Date(`${sender.person.dateOfBirth}T00:00:00Z`),
        nationality: sender.person.nationality,
        phone: sender.person.phone,
        addressLine: sender.person.addressLine,
        city: sender.person.city,
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
            documentTypes: ['PASSPORT', 'MIGRATION_CARD', 'RESIDENCE_REGISTRATION', 'SELFIE'],
            decidedAt: new Date(),
          },
        });
      }
    }

    console.log(`  ${sender.email.padEnd(34)} tier ${sender.kycTier}  — ${sender.note}`);
  }

  console.log('→ demo recipients');
  for (const recipient of RECIPIENTS) {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: recipient.ownerEmail } });
    const identifier = recipient.accountNumber ?? recipient.msisdn ?? '';
    const piiToken = tokenise('rcp', `${owner.id}:${identifier}`);
    const resolvedName = resolvedNameFor(identifier);

    if (recipient.country === 'NG') {
      await prisma.recipientProfileNg.upsert({
        where: { piiToken },
        update: {},
        create: {
          piiToken,
          accountNumber: recipient.accountNumber ?? '',
          bankCode: recipient.bankCode ?? '058',
          // The institution's record of the name, which is what a name enquiry
          // returns. Kept in step with the simulator so the demo is coherent.
          accountName: resolvedName,
        },
      });
    } else {
      await prisma.recipientProfileGh.upsert({
        where: { piiToken },
        update: {},
        create: {
          piiToken,
          msisdn: recipient.msisdn ?? '',
          network: recipient.network ?? 'MTN',
          accountName: resolvedName,
        },
      });
    }

    await prisma.recipient.upsert({
      where: { piiToken },
      update: { resolvedName, nickname: recipient.nickname, archivedAt: null },
      create: {
        userId: owner.id,
        method: recipient.country === 'NG' ? 'BANK_ACCOUNT' : 'MOBILE_MONEY',
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
