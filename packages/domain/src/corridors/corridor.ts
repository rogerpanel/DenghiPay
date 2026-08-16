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

/**
 * How we collect from the sender.
 *
 * `SBP`, `QR` and `CARD` are Russian rails. `VIRTUAL_ACCOUNT` is deliberately
 * shared: a dedicated account the sender pushes to, which is a Russian virtual
 * account on RU→ corridors and a Nigerian NUBAN on NG→ ones. The mechanics and
 * the reconciliation are identical, so splitting them would buy a name and cost
 * a branch.
 *
 * `MOBILE_MONEY` is the Ghanaian collection rail and works the other way round:
 * we ask the network to debit a wallet, and the sender approves the prompt on
 * their handset. It is a request we make, not an account we publish — which is
 * why it needs its own member and its own instruction shape.
 */
export const PAYIN_METHODS = ['SBP', 'QR', 'CARD', 'VIRTUAL_ACCOUNT', 'MOBILE_MONEY'] as const;
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

/**
 * The currency a resident of this country sends in.
 *
 * Used wherever something has to be stated in the sender's own money before a
 * corridor is chosen — KYC limits, the tier upgrade prompt. It was implicitly
 * RUB everywhere until Nigeria and Ghana became origins, and an implicit RUB
 * shown to a sender in Accra is a wrong number, not a placeholder.
 */
const SEND_CURRENCY: Readonly<Record<CountryCode, CurrencyCode>> = {
  RU: 'RUB',
  BY: 'BYN',
  NG: 'NGN',
  GH: 'GHS',
};

export function sendCurrencyFor(country: string): CurrencyCode {
  return SEND_CURRENCY[country as CountryCode] ?? 'RUB';
}

/**
 * May someone whose personal data lives in `partition` send on a corridor that
 * starts in `sourceCountry`?
 *
 * The rule is that a sender must be where the collection happens. Somebody in
 * Lagos cannot hand over rubles, so offering them RU→NG produces a quote they
 * can never pay and a pay-in nobody can initiate.
 *
 * Belarus is the one place where the partition and the country differ: BY
 * senders are held in the RU store under the same regime, so the RU partition
 * admits both RU and BY origins. Everywhere else the partition is the country.
 */
export function residencyPermitsOrigin(partition: string, sourceCountry: CountryCode): boolean {
  if (partition === 'RU') return sourceCountry === 'RU' || sourceCountry === 'BY';
  return partition === sourceCountry;
}
