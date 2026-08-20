import { z } from 'zod';
import { Authorisation, parseAuthorisations } from '@morapay/domain';

/**
 * Environment configuration, validated at boot.
 *
 * The application refuses to start on a malformed environment rather than
 * discovering it at the first request. Secrets have no defaults: a missing
 * signing key must be a startup failure, never a silently weak one.
 */

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const secret = (minLength = 16) =>
  z.string().min(minLength, `must be at least ${minLength} characters`);

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Guardrail G1. No default of `true` exists anywhere in this codebase, and
   * a CI check (infra/scripts/check-live-funds-default.sh) fails the build if
   * one appears.
   */
  LIVE_FUNDS_ENABLED: booleanFromEnv,

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.string().default('http://localhost:3000'),
  ADMIN_PUBLIC_URL: z.string().default('http://localhost:3001'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: secret(24),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  ADMIN_JWT_ACCESS_SECRET: secret(24),
  QUOTE_SIGNING_SECRET: secret(24),
  FIELD_ENCRYPTION_KEY: secret(24),
  TOKENISATION_SALT: secret(8),

  CALLBACK_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  PROVIDER_SIGNING_SECRET_PAYIN_RU_SIM: z.string().default('sim-payin-ru-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYIN_NG_SIM: z.string().default('sim-payin-ng-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYIN_GH_SIM: z.string().default('sim-payin-gh-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYIN_CM_SIM: z.string().default('sim-payin-cm-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYIN_BJ_SIM: z.string().default('sim-payin-bj-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYOUT_NG_SIM: z.string().default('sim-payout-ng-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYOUT_GH_SIM: z.string().default('sim-payout-gh-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYOUT_ZA_SIM: z.string().default('sim-payout-za-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYOUT_CM_SIM: z.string().default('sim-payout-cm-signing-secret'),
  PROVIDER_SIGNING_SECRET_PAYOUT_BJ_SIM: z.string().default('sim-payout-bj-signing-secret'),

  /**
   * Which corridor authorisations we actually hold, as a comma-separated list
   * of names from `AUTHORISATIONS` in @morapay/domain.
   *
   * Empty by default and irrelevant while live funds are off. Once they are on,
   * a corridor may only move money if every authorisation it rests on is named
   * here — so bringing up NG→GH for real means writing
   * `NG_DOMESTIC_COLLECTION,GH_PAYOUT_RAIL`, which is a sentence a reviewer can
   * ask for evidence of. There is deliberately no wildcard.
   */
  LIVE_CORRIDOR_AUTHORISATIONS: z.string().default(''),

  // Contracted rails. All disabled until G1 is satisfied.
  PAYCREST_ENABLED: booleanFromEnv,
  FINCRA_ENABLED: booleanFromEnv,
  PAYIN_RU_PARTNER_ENABLED: booleanFromEnv,

  KYC_PROVIDER: z.enum(['mock', 'smileid', 'sumsub']).default('mock'),
  SCREENING_PROVIDER: z.enum(['mock', 'complyadvantage', 'worldcheck']).default('mock'),
  SCREENING_BLOCK_THRESHOLD: z.coerce.number().int().min(0).max(100).default(85),

  RATE_SOURCE: z.enum(['simulated', 'ecb', 'partner']).default('simulated'),
  RATE_MAX_AGE_MS: z.coerce.number().int().positive().default(120_000),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(90),

  MAIL_TRANSPORT: z.enum(['outbox', 'smtp']).default('outbox'),
  MAIL_FROM: z.string().default('no-reply@example.invalid'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  METRICS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),

  /** Seconds before an unpaid simulated pay-in confirms itself, for demos. */
  SIMULATOR_AUTOCONFIRM_SECONDS: z.coerce.number().int().min(0).default(12),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const config = parsed.data;

  // Guardrail G1, restated at runtime. Enabling live funds is a deliberate
  // production act with a human behind it, so it may not be switched on
  // anywhere else.
  if (config.LIVE_FUNDS_ENABLED && config.NODE_ENV !== 'production') {
    throw new Error(
      'LIVE_FUNDS_ENABLED is true outside production. Guardrail G1: live funds are ' +
        'enabled once, by a human, in production, behind the manual approval gate.',
    );
  }

  // Reject an unknown authorisation name at boot rather than at the first
  // transfer. A typo here would otherwise read as "not held" and block a
  // corridor someone believes they have licensed.
  parseAuthorisations(config.LIVE_CORRIDOR_AUTHORISATIONS);

  return config;
}

/** The authorisations this deployment claims to hold. */
export function heldAuthorisations(config: AppConfig): readonly Authorisation[] {
  return parseAuthorisations(config.LIVE_CORRIDOR_AUTHORISATIONS);
}

export function corsOrigins(config: AppConfig): string[] {
  return config.API_CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
