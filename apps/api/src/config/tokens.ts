/**
 * Injection tokens for things that are interfaces at compile time.
 *
 * `ScreeningProvider`, `KycProvider` and `RateSource` are ports — TypeScript
 * interfaces with no runtime representation — so Nest cannot use the type as a
 * token. Naming them here keeps the indirection in one place, and keeps the
 * services depending on the port rather than on whichever implementation is
 * wired in today (BUILD_PLAN 3.1: swapping providers touches nothing outside
 * `packages/adapters`).
 */
export const APP_CONFIG = Symbol('APP_CONFIG');
export const SCREENING_PROVIDER = Symbol('SCREENING_PROVIDER');
export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
export const RATE_SOURCE = Symbol('RATE_SOURCE');
