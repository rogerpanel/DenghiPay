import { CurrencyCode } from '../money/currency';

/**
 * Corridors are data, not code (BUILD_PLAN 4.3).
 *
 * Adding RU→GH alongside RU→NG is a configuration row plus a migration; no
 * branch in the transfer logic knows the name of a country.
 */

export type CountryCode =
  // Inbound-remittance origins.
  | 'RU'
  | 'BY'
  // The African mesh. Every one of these both sends and receives.
  | 'NG'
  | 'GH'
  | 'ZA'
  | 'CM'
  | 'BJ'
  // Added with the Paycrest coverage markets. Note CD and CG are two different
  // countries with two different central banks: the Democratic Republic of the
  // Congo uses the Congolese franc, the Republic of the Congo uses the Central
  // African CFA franc and sits in the BEAC zone beside Cameroon. Treating
  // "Congo" as one country is the mistake this pair exists to prevent.
  | 'CD'
  | 'CG'
  | 'UG'
  | 'KE'
  | 'TZ'
  | 'ZM'
  | 'GM'
  | 'NE'
  | 'ML'
  | 'SN';

/**
 * The African countries that form the mesh, in one place.
 *
 * Everything that needs "all the African origins" or "all the African
 * destinations" reads this rather than repeating the list, so adding the next
 * country is one line here instead of a search for every array that happened to
 * enumerate them.
 */
export const AFRICAN_COUNTRIES = [
  'NG',
  'GH',
  'ZA',
  'CM',
  'BJ',
  'CD',
  'CG',
  'UG',
  'KE',
  'TZ',
  'ZM',
  'GM',
  'NE',
  'ML',
  'SN',
] as const satisfies readonly CountryCode[];

export type AfricanCountry = (typeof AFRICAN_COUNTRIES)[number];

export function isAfricanCountry(country: string): country is AfricanCountry {
  return (AFRICAN_COUNTRIES as readonly string[]).includes(country);
}

export const PAYOUT_METHODS = ['BANK_ACCOUNT', 'MOBILE_MONEY'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/**
 * Mobile-money networks, by the country that licenses them.
 *
 * The same brand is a different operator under a different regulator in each
 * country — MTN Ghana and MTN Cameroon are separate licensees on separate
 * switches — so a network is only ever meaningful alongside its country. This
 * map is what makes "MTN" in Benin resolvable and "TELECEL" in Benin an error
 * rather than a silent acceptance.
 */
export const MOBILE_MONEY_NETWORKS = {
  GH: ['MTN', 'TELECEL', 'AIRTELTIGO'],
  CM: ['MTN', 'ORANGE'],
  BJ: ['MTN', 'MOOV', 'CELTIIS'],
  // East Africa. M-Pesa is the case that proves the rule about brands: it is
  // Safaricom in Kenya and Vodacom in Tanzania and the DRC — three licensees,
  // three switches, one name.
  KE: ['MPESA', 'AIRTEL'],
  UG: ['MTN', 'AIRTEL'],
  TZ: ['MPESA', 'AIRTEL', 'TIGO', 'HALOPESA'],
  ZM: ['MTN', 'AIRTEL', 'ZAMTEL'],
  // Central Africa.
  CD: ['MPESA', 'ORANGE', 'AIRTEL', 'AFRICELL'],
  CG: ['MTN', 'AIRTEL'],
  // West Africa. Wave is a payments licensee rather than a mobile operator,
  // which is why it appears beside the networks and not inside one.
  SN: ['ORANGE', 'WAVE', 'FREE'],
  ML: ['ORANGE', 'MOOV', 'WAVE'],
  NE: ['AIRTEL', 'MOOV', 'ORANGE'],
  GM: ['AFRICELL', 'QMONEY', 'WAVE'],
} as const satisfies Partial<Record<CountryCode, readonly string[]>>;

export const MOBILE_MONEY_NETWORK_CODES = [
  'MTN',
  'TELECEL',
  'AIRTELTIGO',
  'ORANGE',
  'MOOV',
  'CELTIIS',
  'MPESA',
  'AIRTEL',
  'TIGO',
  'HALOPESA',
  'ZAMTEL',
  'AFRICELL',
  'WAVE',
  'FREE',
  'QMONEY',
] as const;
export type MobileMoneyNetwork = (typeof MOBILE_MONEY_NETWORK_CODES)[number];

export function networksFor(country: CountryCode): readonly MobileMoneyNetwork[] {
  return (
    (MOBILE_MONEY_NETWORKS as Partial<Record<CountryCode, readonly MobileMoneyNetwork[]>>)[
      country
    ] ?? []
  );
}

/** Does this country license this network? Wrong pairings fail closed. */
export function networkServesCountry(country: CountryCode, network: string): boolean {
  return (networksFor(country) as readonly string[]).includes(network);
}

/**
 * The international dialling prefix a mobile-money number must carry, per
 * country. A Ghanaian wallet number handed to the Beninese rail is a mistake
 * worth catching before it becomes a failed payout.
 */
export const MSISDN_PREFIX: Readonly<Partial<Record<CountryCode, string>>> = {
  GH: '233',
  CM: '237',
  BJ: '229',
  KE: '254',
  UG: '256',
  TZ: '255',
  ZM: '260',
  CD: '243',
  CG: '242',
  SN: '221',
  ML: '223',
  NE: '227',
  GM: '220',
};

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
  ZA: 'ZAR',
  CM: 'XAF',
  BJ: 'XOF',
  CD: 'CDF',
  // Republic of the Congo is in the BEAC zone with Cameroon, so it shares XAF.
  CG: 'XAF',
  UG: 'UGX',
  KE: 'KES',
  TZ: 'TZS',
  ZM: 'ZMW',
  GM: 'GMD',
  // Niger, Mali and Senegal are all BCEAO members and share XOF with Benin.
  // Four countries, one currency, four separate collection authorisations.
  NE: 'XOF',
  ML: 'XOF',
  SN: 'XOF',
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
