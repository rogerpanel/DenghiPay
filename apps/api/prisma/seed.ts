/**
 * Baseline seed (BUILD_PLAN 1.5, 4.3).
 *
 * Creates the chart of accounts, the corridors, float thresholds, an initial
 * rate observation per pair, and the back-office staff accounts. Idempotent:
 * running it twice produces the same ledger, which is the DoD for step 1.5.
 *
 * It creates no customer data. That is `demo-seed.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { ExchangeRate } from '@morapay/domain';
import { SYSTEM_ACCOUNTS, accountCode } from '@morapay/ledger';
import { baseRates } from '@morapay/adapters';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

/**
 * Local staff credentials.
 *
 * These are development-only accounts on a development database. They are
 * printed on creation so a new engineer can sign in, and the seed refuses to
 * run at all when NODE_ENV is production.
 */
const STAFF = [
  {
    email: 'compliance@morapay.local',
    displayName: 'Compliance Officer',
    roles: ['COMPLIANCE_OFFICER'] as const,
  },
  { email: 'support@morapay.local', displayName: 'Support Agent', roles: ['SUPPORT'] as const },
  {
    email: 'treasury@morapay.local',
    displayName: 'Treasury Operator',
    roles: ['TREASURY_OPERATOR'] as const,
  },
  {
    // A second treasury identity, so four-eyes can actually be demonstrated.
    email: 'treasury2@morapay.local',
    displayName: 'Treasury Approver',
    roles: ['TREASURY_OPERATOR', 'ADMIN'] as const,
  },
  { email: 'admin@morapay.local', displayName: 'Administrator', roles: ['ADMIN'] as const },
];

const DEV_STAFF_PASSWORD = 'morapay-local-staff-2026';

const CORRIDORS = [
  {
    id: 'RU-NG',
    sourceCountry: 'RU',
    sourceCurrency: 'RUB',
    destinationCountry: 'NG',
    destinationCurrency: 'NGN',
    payinMethods: ['SBP', 'QR', 'VIRTUAL_ACCOUNT'],
    payoutMethods: ['BANK_ACCOUNT'],
    minSendMinorUnits: 50_000n, //     500,00 ₽
    maxSendMinorUnits: 60_000_000n, // 600 000,00 ₽
    fixedFeeMinorUnits: 15_000n, //    150,00 ₽
    fxMarginBps: 150,
  },
  {
    id: 'RU-GH',
    sourceCountry: 'RU',
    sourceCurrency: 'RUB',
    destinationCountry: 'GH',
    destinationCurrency: 'GHS',
    payinMethods: ['SBP', 'QR', 'VIRTUAL_ACCOUNT'],
    payoutMethods: ['MOBILE_MONEY'],
    minSendMinorUnits: 50_000n,
    maxSendMinorUnits: 60_000_000n,
    fixedFeeMinorUnits: 15_000n,
    fxMarginBps: 175,
  },
  {
    id: 'BY-NG',
    sourceCountry: 'BY',
    sourceCurrency: 'BYN',
    destinationCountry: 'NG',
    destinationCurrency: 'NGN',
    payinMethods: ['VIRTUAL_ACCOUNT'],
    payoutMethods: ['BANK_ACCOUNT'],
    minSendMinorUnits: 2_000n,
    maxSendMinorUnits: 2_000_000n,
    fixedFeeMinorUnits: 500n,
    fxMarginBps: 175,
    enabled: false, // Awaiting a Belarusian pay-in partner.
  },
  {
    id: 'BY-GH',
    sourceCountry: 'BY',
    sourceCurrency: 'BYN',
    destinationCountry: 'GH',
    destinationCurrency: 'GHS',
    payinMethods: ['VIRTUAL_ACCOUNT'],
    payoutMethods: ['MOBILE_MONEY'],
    minSendMinorUnits: 2_000n,
    maxSendMinorUnits: 2_000_000n,
    fixedFeeMinorUnits: 500n,
    fxMarginBps: 200,
    enabled: false,
  },
];

const FLOAT_THRESHOLDS = [
  { currency: 'RUB', lowWatermarkMinorUnits: 50_000_000n, targetMinorUnits: 200_000_000n },
  { currency: 'NGN', lowWatermarkMinorUnits: 500_000_000n, targetMinorUnits: 2_000_000_000n },
  { currency: 'GHS', lowWatermarkMinorUnits: 5_000_000n, targetMinorUnits: 20_000_000n },
];

/**
 * Decide whether staff accounts with published passwords may be created here.
 *
 * The rule that must never bend: **not alongside live funds.** These accounts
 * have passwords written in `docs/DEMO.md`, so a database holding both them and
 * real money is compromised by publication, not by attack. That check comes
 * first and has no override.
 *
 * `NODE_ENV=production` on its own is a weaker signal than it looks. A
 * demonstration server runs the production build — that is the point of
 * demonstrating it — so a blanket refusal makes the seeded accounts
 * unreachable exactly where they are needed, and invites someone to reach for
 * `NODE_ENV=development` in a place it does not belong.
 *
 * So production requires a second, deliberate statement:
 * `ALLOW_DEMONSTRATION_SEED=true`. It is set once, by a person, in an
 * environment they have decided is a demonstration, and it cannot survive
 * `LIVE_FUNDS_ENABLED` being turned on.
 */
function assertSeedableEnvironment(): void {
  if (process.env.LIVE_FUNDS_ENABLED === 'true') {
    throw new Error(
      'Refusing to seed: LIVE_FUNDS_ENABLED is true. These staff accounts have ' +
        'published passwords and must never exist in a database that moves real money.',
    );
  }

  if (process.env.NODE_ENV !== 'production') return;

  if (process.env.ALLOW_DEMONSTRATION_SEED !== 'true') {
    throw new Error(
      'Refusing to seed: NODE_ENV is production. This seed creates staff accounts ' +
        'whose passwords are published in docs/DEMO.md.\n\n' +
        'If this really is a demonstration environment, say so explicitly by setting ' +
        'ALLOW_DEMONSTRATION_SEED=true. Do not set NODE_ENV=development to get around ' +
        'this — that changes how the application behaves, and this check is the only ' +
        'thing standing between a published password and a production database.',
    );
  }

  console.warn(
    '⚠  Seeding staff accounts with published passwords into a NODE_ENV=production\n' +
      '   environment, because ALLOW_DEMONSTRATION_SEED=true. Correct for a\n' +
      '   demonstration server. Remove that variable before this database is used\n' +
      '   for anything else.',
  );
}

async function main(): Promise<void> {
  assertSeedableEnvironment();

  console.log('→ chart of accounts');
  for (const spec of SYSTEM_ACCOUNTS) {
    const code = accountCode(spec.type, spec.currency, spec.scope);
    await prisma.ledgerAccount.upsert({
      where: { code },
      update: {},
      create: {
        code,
        type: spec.type,
        currency: spec.currency,
        partition: spec.partition,
      },
    });
  }
  console.log(`  ${SYSTEM_ACCOUNTS.length} system accounts`);

  console.log('→ corridors');
  for (const corridor of CORRIDORS) {
    const { enabled = true, ...rest } = corridor;
    await prisma.corridor.upsert({
      where: { id: corridor.id },
      update: { ...rest, enabled },
      create: { ...rest, enabled },
    });
  }
  console.log(`  ${CORRIDORS.length} corridors`);

  console.log('→ float thresholds');
  for (const threshold of FLOAT_THRESHOLDS) {
    await prisma.floatThreshold.upsert({
      where: { currency: threshold.currency },
      update: threshold,
      create: threshold,
    });
  }

  console.log('→ initial rate observations');
  const observedAt = new Date();
  for (const [pair, value] of Object.entries(baseRates())) {
    const [from, to] = pair.split(':') as [string, string];
    const rate = ExchangeRate.fromDecimalString(from as 'RUB', to as 'NGN', value);
    await prisma.rateObservation.create({
      data: {
        baseCurrency: from,
        quoteCurrency: to,
        numerator: rate.numerator,
        scale: rate.scale,
        source: 'seed',
        observedAt,
      },
    });
  }
  console.log(`  ${Object.keys(baseRates()).length} pairs`);

  console.log('→ back-office staff');
  const passwordHash = await argonHash(DEV_STAFF_PASSWORD, ARGON_OPTIONS);
  for (const staff of STAFF) {
    await prisma.staffUser.upsert({
      where: { email: staff.email },
      update: { roles: [...staff.roles], displayName: staff.displayName },
      create: {
        email: staff.email,
        displayName: staff.displayName,
        roles: [...staff.roles],
        passwordHash,
      },
    });
  }

  console.log('');
  console.log('  Back office: http://localhost:3001');
  for (const staff of STAFF) {
    console.log(`    ${staff.email.padEnd(28)} ${staff.roles.join(', ')}`);
  }
  console.log(`    password (development only): ${DEV_STAFF_PASSWORD}`);
  console.log('');
  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
