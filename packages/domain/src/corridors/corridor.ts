import { CurrencyCode } from '../money/currency';

/**
 * Corridors are data, not code (BUILD_PLAN 4.3).
 *
 * Adding RU→GH alongside RU→NG is a configuration row plus a migration; no
 * branch in the transfer logic knows the name of a country.
 */

export type CountryCode = 'RU' | 'BY' | 'NG' | 'GH';

export const PAYOUT_METHODS = ['BANK_ACCOUNT', 'MOBILE_MONEY'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const PAYIN_METHODS = ['SBP', 'QR', 'CARD', 'VIRTUAL_ACCOUNT'] as const;
export type PayinMethod = (typeof PAYIN_METHODS)[number];

export interface CorridorLimits {
  /** Smallest transfer we will quote, in minor units of the send currency. */
  readonly minSendMinorUnits: bigint;
  /** Largest single transfer, in minor units of the send currency. */
  readonly maxSendMinorUnits: bigint;
}

export interface CorridorFees {
  /** Flat fee charged in the send currency, in minor units. */
  readonly fixedFeeMinorUnits: bigint;
  /** Our margin on the mid-market rate, in basis points. */
  readonly fxMarginBps: number;
}

export interface OperatingHours {
  /** UTC hour at which the corridor opens (inclusive). */
  readonly openUtcHour: number;
  /** UTC hour at which the corridor closes (exclusive). 24 means always open. */
  readonly closeUtcHour: number;
  /** ISO weekday numbers (1 = Monday) on which the corridor operates. */
  readonly weekdays: readonly number[];
}

export interface Corridor {
  readonly id: string;
  readonly sourceCountry: CountryCode;
  readonly sourceCurrency: CurrencyCode;
  readonly destinationCountry: CountryCode;
  readonly destinationCurrency: CurrencyCode;
  readonly payinMethods: readonly PayinMethod[];
  readonly payoutMethods: readonly PayoutMethod[];
  readonly limits: CorridorLimits;
  readonly fees: CorridorFees;
  readonly operatingHours: OperatingHours;
  readonly enabled: boolean;
}

export const ALWAYS_OPEN: OperatingHours = {
  openUtcHour: 0,
  closeUtcHour: 24,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};

export function isCorridorOpen(corridor: Corridor, at: Date): boolean {
  if (!corridor.enabled) return false;
  const { openUtcHour, closeUtcHour, weekdays } = corridor.operatingHours;
  // getUTCDay(): 0 = Sunday. ISO weekday: 7 = Sunday.
  const isoWeekday = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
  if (!weekdays.includes(isoWeekday)) return false;
  const hour = at.getUTCHours();
  return hour >= openUtcHour && hour < closeUtcHour;
}

export function corridorIdFor(source: CountryCode, destination: CountryCode): string {
  return `${source}-${destination}`;
}
