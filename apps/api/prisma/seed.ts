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

/**
 * The intra-African mesh: every country that can collect, into every country
 * that can receive.
 *
 * Generated rather than listed. Sixteen rows written by hand would be sixteen
 * chances to transpose a currency, and the next country turns them into
 * twenty-five. What varies between them is only the pricing, which is a
 * function of the pair, so that is the only thing stated per corridor.
 *
 * South Africa is an origin as of BUILD_PLAN 4.3c. Its outward payments are
 * subject to SARB exchange control, which is enforced above this layer: a
 * declaration category and an annual allowance check, neither of which any
 * other origin needs. The corridor rows themselves are ordinary.
 *
 * These are enabled because with LIVE_FUNDS_ENABLED=false nothing moves and
 * every direction needs to be demonstrable end to end. The licence gate is
 * what stops them the moment live funds are switched on without the paperwork
 * — see docs/CORRIDORS.md and OPEN_ITEMS B6.
 */
const ORIGINS = ['NG', 'GH', 'ZA', 'CM', 'BJ'] as const;
const DESTINATIONS = ['NG', 'GH', 'ZA', 'CM', 'BJ'] as const;

type AfricanCountry = (typeof DESTINATIONS)[number];

/** Currency, collection rail and payout rail, per country. */
const COUNTRY_RAILS: Readonly<
  Record<
    AfricanCountry,
    {
      currency: string;
      payin: string[];
      payout: string[];
      /** Smallest and largest send, and the flat fee, in minor units. */
      minSend: bigint;
      maxSend: bigint;
      fee: bigint;
    }
  >
> = {
  // Naira and cedi have two decimals; the CFA francs have none, so their
  // figures are whole francs and look a hundredfold smaller for the same value.
  NG: {
    currency: 'NGN',
    payin: ['VIRTUAL_ACCOUNT'],
    payout: ['BANK_ACCOUNT'],
    minSend: 100_000n, //      ₦1 000,00
    maxSend: 500_000_000n, //  ₦5 000 000,00
    fee: 50_000n, //           ₦500,00
  },
  GH: {
    currency: 'GHS',
    payin: ['MOBILE_MONEY'],
    payout: ['MOBILE_MONEY'],
    minSend: 1_000n, //        GH₵10,00
    maxSend: 1_000_000n, //    GH₵10 000,00
    fee: 350n, //              GH₵3,50
  },
  ZA: {
    currency: 'ZAR',
    payin: ['VIRTUAL_ACCOUNT'],
    payout: ['BANK_ACCOUNT'],
    minSend: 10_000n, //       R100,00
    maxSend: 10_000_000n, //   R100 000,00 — well inside the annual allowance,
    //                         which is enforced per sender rather than per corridor.
    fee: 5_000n, //            R50,00
  },
  CM: {
    currency: 'XAF',
    payin: ['MOBILE_MONEY'],
    payout: ['MOBILE_MONEY'],
    minSend: 500n, //          500 FCFA
    maxSend: 5_000_000n, //    5 000 000 FCFA
    fee: 200n, //              200 FCFA
  },
  BJ: {
    currency: 'XOF',
    payin: ['MOBILE_MONEY'],
    payout: ['MOBILE_MONEY'],
    minSend: 500n,
    maxSend: 5_000_000n,
    fee: 200n,
  },
};

/**
 * Margin in basis points.
 *
 * Wider than RU→NG because none of these pairs has a deep direct market — every
 * one of them crosses the dollar in practice. The CFA pair is the exception:
 * XAF and XOF share the euro peg, so there is no currency risk to price and the
 * margin covers the rail alone.
 */
function marginFor(from: AfricanCountry, to: AfricanCountry): number {
  const cfa = (c: AfricanCountry) => c === 'CM' || c === 'BJ';
  if (cfa(from) && cfa(to)) return 90;
  return 225;
}

function intraAfricanCorridors() {
  return ORIGINS.flatMap((sourceCountry) =>
    DESTINATIONS.filter((destinationCountry) => destinationCountry !== sourceCountry).map(
      (destinationCountry) => {
        const origin = COUNTRY_RAILS[sourceCountry];
        const destination = COUNTRY_RAILS[destinationCountry];
        return {
          id: `${sourceCountry}-${destinationCountry}`,
          sourceCountry,
          sourceCurrency: origin.currency,
          destinationCountry,
          destinationCurrency: destination.currency,
          payinMethods: origin.payin,
          payoutMethods: destination.payout,
          minSendMinorUnits: origin.minSend,
          maxSendMinorUnits: origin.maxSend,
          fixedFeeMinorUnits: origin.fee,
          fxMarginBps: marginFor(sourceCountry, destinationCountry),
        };
      },
    ),
  );
}

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
  ...intraAfricanCorridors(),
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

/**
 * When to top a float up, per currency, in minor units.
 *
 * Roughly a week of expected volume as the low watermark and a month as the
 * target. The CFA rows look small beside the naira ones for the same real
 * value, because those currencies have no decimals.
 */
const FLOAT_THRESHOLDS = [
  { currency: 'RUB', lowWatermarkMinorUnits: 50_000_000n, targetMinorUnits: 200_000_000n },
  { currency: 'NGN', lowWatermarkMinorUnits: 500_000_000n, targetMinorUnits: 2_000_000_000n },
  { currency: 'GHS', lowWatermarkMinorUnits: 5_000_000n, targetMinorUnits: 20_000_000n },
  { currency: 'ZAR', lowWatermarkMinorUnits: 10_000_000n, targetMinorUnits: 40_000_000n },
  { currency: 'XAF', lowWatermarkMinorUnits: 30_000_000n, targetMinorUnits: 120_000_000n },
  { currency: 'XOF', lowWatermarkMinorUnits: 30_000_000n, targetMinorUnits: 120_000_000n },
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
