import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { asCorridorId } from '@morapay/domain';
import { LedgerService } from '@morapay/ledger';
import {
  MockKycProvider,
  MockScreeningProvider,
  ProviderRegistry,
  SimulatedRateSource,
  createBeninPayinSimulator,
  createBeninPayoutSimulator,
  createCameroonPayinSimulator,
  createCameroonPayoutSimulator,
  createGhanaPayinSimulator,
  createGhanaPayoutSimulator,
  createNigeriaPayinSimulator,
  createNigeriaPayoutSimulator,
  createRussiaPayinSimulator,
  createSouthAfricaPayoutSimulator,
} from '@morapay/adapters';

import { AppConfig, loadConfig } from './config/config';
import { APP_CONFIG, KYC_PROVIDER, RATE_SOURCE, SCREENING_PROVIDER } from './config/tokens';
import { PrismaService } from './common/prisma.service';
import { MetricsService } from './common/metrics.service';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './notifications/outbox.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import {
  JwtAuthGuard,
  RolesGuard,
  StaffAuthGuard,
  StaffRolesGuard,
  VerifiedUserGuard,
} from './auth/guards';
import { StaffAuthService } from './staff/staff-auth.service';
import { PrismaLedgerStore } from './ledger/prisma-ledger-store';
import { PartitionsModule } from './partitions/partitions.module';
import { CorridorsService } from './quoting/corridors.service';
import { RatesService } from './quoting/rates.service';
import { QuotesService } from './quoting/quotes.service';
import { QuotingController } from './quoting/quoting.controller';
import { RecipientsService } from './recipients/recipients.service';
import { InstitutionsController, RecipientsController } from './recipients/recipients.controller';
import { ScreeningService } from './compliance/screening.service';
import { LimitsService } from './compliance/limits.service';
import { ComplianceService } from './compliance/compliance.service';
import { KycService } from './kyc/kyc.service';
import { KycController } from './kyc/kyc.controller';
import { TransfersService } from './transfers/transfers.service';
import { TransfersController } from './transfers/transfers.controller';
import { TransferSagaService } from './transfers/transfer-saga.service';
import { ProviderCallbackController } from './webhooks/provider-callback.controller';
import { SimulatorController } from './simulator/simulator.controller';
import { TreasuryService } from './treasury/treasury.service';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { AdminAuthController, AdminController } from './admin/admin.controller';
import { HealthController } from './health/health.controller';
import { DocsController } from './openapi/docs.controller';

const config = loadConfig();

/**
 * Provider wiring.
 *
 * Every rail is a simulator today. The contracted adapters — Paycrest and
 * Fincra for payout, a Russian licensed partner for pay-in — register here
 * behind their feature flags when they exist. Guardrail G1 keeps them disabled
 * until there is a signed agreement and a written legal opinion, and
 * `enabled: false` keeps a registered-but-unproven rail out of routing entirely.
 *
 * The Russian pay-in partner is the open commercial item
 * (TECHNICAL_ARCHITECTURE §1.1). Until it is closed, `PayinSimulator` is the
 * only implementation, and that is enough to build and test everything above it.
 */
/**
 * Every corridor the rails must serve.
 *
 * The intra-African mesh is generated from the same origin/destination lists
 * the seed uses, so a corridor row cannot exist without a rail behind it — the
 * failure that produces is a transfer stuck in AWAITING_PAYIN with a log line
 * nobody is watching.
 */
const AFRICAN_ORIGINS = ['NG', 'GH', 'CM', 'BJ'] as const;
const AFRICAN_DESTINATIONS = ['NG', 'GH', 'ZA', 'CM', 'BJ'] as const;

function corridorIds(): string[] {
  const inbound = ['RU-NG', 'RU-GH', 'BY-NG', 'BY-GH'];
  const intraAfrican = AFRICAN_ORIGINS.flatMap((from) =>
    AFRICAN_DESTINATIONS.filter((to) => to !== from).map((to) => `${from}-${to}`),
  );
  return [...inbound, ...intraAfrican];
}

function buildRegistry(cfg: AppConfig): ProviderRegistry {
  const allCorridors = corridorIds().map(asCorridorId);
  // Collection is chosen by where the money comes from; payout by where it
  // goes. Both are derived from the corridor id rather than listed, so adding
  // a corridor above is the whole change.
  const from = (country: string) =>
    allCorridors.filter((id) => String(id).startsWith(`${country}-`));
  const to = (country: string) => allCorridors.filter((id) => String(id).endsWith(`-${country}`));

  const payinOptions = {
    autoConfirmAfterSeconds:
      cfg.SIMULATOR_AUTOCONFIRM_SECONDS === 0 ? null : cfg.SIMULATOR_AUTOCONFIRM_SECONDS,
  };

  return (
    new ProviderRegistry()
      .registerPayin({
        provider: createRussiaPayinSimulator([...from('RU'), ...from('BY')], payinOptions),
        priority: 100,
        enabled: !cfg.PAYIN_RU_PARTNER_ENABLED,
      })
      // Domestic collection inside the four African origins. Simulators for the
      // same reason as the Russian leg, but a different unfilled prerequisite:
      // these need a local collection licence, not a partner bank. The corridor
      // licence gate is what enforces that; registering them here only makes the
      // rails exist.
      //
      // South Africa is absent, and stays absent: it is a destination only until
      // SARB exchange-control reporting exists.
      .registerPayin({
        provider: createNigeriaPayinSimulator(from('NG'), payinOptions),
        priority: 100,
        enabled: true,
      })
      .registerPayin({
        provider: createGhanaPayinSimulator(from('GH'), payinOptions),
        priority: 100,
        enabled: true,
      })
      .registerPayin({
        provider: createCameroonPayinSimulator(from('CM'), payinOptions),
        priority: 100,
        enabled: true,
      })
      .registerPayin({
        provider: createBeninPayinSimulator(from('BJ'), payinOptions),
        priority: 100,
        enabled: true,
      })
      .registerPayout({
        provider: createNigeriaPayoutSimulator(to('NG')),
        priority: 100,
        enabled: !cfg.PAYCREST_ENABLED && !cfg.FINCRA_ENABLED,
      })
      .registerPayout({
        provider: createGhanaPayoutSimulator(to('GH')),
        priority: 100,
        enabled: !cfg.FINCRA_ENABLED,
      })
      .registerPayout({
        provider: createSouthAfricaPayoutSimulator(to('ZA')),
        priority: 100,
        enabled: true,
      })
      .registerPayout({
        provider: createCameroonPayoutSimulator(to('CM')),
        priority: 100,
        enabled: true,
      })
      .registerPayout({
        provider: createBeninPayoutSimulator(to('BJ')),
        priority: 100,
        enabled: true,
      })
  );
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({
      secret: config.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: config.JWT_ACCESS_TTL_SECONDS },
    }),
    // BUILD_PLAN 11.3 — per-IP rate limiting, applied globally.
    ThrottlerModule.forRoot([
      { ttl: config.RATE_LIMIT_WINDOW_SECONDS * 1000, limit: config.RATE_LIMIT_MAX_REQUESTS },
    ]),
    // Residency partitions. This module exports the gateway and nothing else,
    // so no other module can reach a partition repository (guardrail G8).
    PartitionsModule,
  ],
  controllers: [
    AuthController,
    QuotingController,
    RecipientsController,
    InstitutionsController,
    KycController,
    TransfersController,
    ProviderCallbackController,
    SimulatorController,
    AdminAuthController,
    AdminController,
    HealthController,
    DocsController,
  ],
  providers: [
    { provide: APP_CONFIG, useValue: config },
    PrismaService,
    MetricsService,
    AuditService,
    OutboxService,

    // Ledger: the Postgres implementation of the port, and the only writer of
    // financial state (guardrail G5).
    PrismaLedgerStore,
    {
      provide: LedgerService,
      useFactory: (store: PrismaLedgerStore) => new LedgerService(store),
      inject: [PrismaLedgerStore],
    },

    // Adapter ports.
    { provide: ProviderRegistry, useFactory: () => buildRegistry(config) },
    { provide: SCREENING_PROVIDER, useFactory: () => new MockScreeningProvider() },
    { provide: KYC_PROVIDER, useFactory: () => new MockKycProvider() },
    { provide: RATE_SOURCE, useFactory: () => new SimulatedRateSource() },

    // Application services.
    AuthService,
    StaffAuthService,
    CorridorsService,
    RatesService,
    QuotesService,
    RecipientsService,
    ScreeningService,
    LimitsService,
    ComplianceService,
    KycService,
    TransfersService,
    TransferSagaService,
    TreasuryService,
    ReconciliationService,

    // Guards. The customer and staff guards read different signing keys from
    // the configuration, so a customer token presented to an admin endpoint
    // fails signature verification rather than merely an authorisation check.
    JwtAuthGuard,
    StaffAuthGuard,
    RolesGuard,
    StaffRolesGuard,
    VerifiedUserGuard,
    Reflector,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
