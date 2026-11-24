import { CurrencyCode } from '../money/currency';

/**
 * Corridors are data, not code (BUILD_PLAN 4.3).
 *
 * Adding RU→GH alongside RU→NG is a configuration row plus a migration; no
 * branch in the transfer logic knows the name of a country.
 */

/** Origins that only send: inbound remittance, no African leg. */
export const REMITTANCE_ORIGINS = ['RU', 'BY'] as const;

export type RemittanceOrigin = (typeof REMITTANCE_ORIGINS)[number];

/**
 * The African countries that form the mesh, in one place.
 *
 * Everything that needs "all the African origins" or "all the African
 * destinations" reads this rather than repeating the list, so adding the next
 * country is one line here instead of a search for every array that happened to
 * enumerate them. The licence gate, the provider registry, the corridor seed
 * and the exchange-control map all read it; when this list and a copy of it
 * disagreed, corridors out of the new countries were silently classified as
 * inbound remittances.
 *
 * Note CD and CG are two different countries with two different central banks:
 * the Democratic Republic of the Congo uses the Congolese franc, the Republic
 * of the Congo uses the Central African CFA franc and sits in the BEAC zone
 * beside Cameroon. Treating "Congo" as one country is the mistake this pair
 * exists to prevent.
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
] as const;

export type AfricanCountry = (typeof AFRICAN_COUNTRIES)[number];

export function isAfricanCountry(country: string): country is AfricanCountry {
  return (AFRICAN_COUNTRIES as readonly string[]).includes(country);
}

/**
 * Every country the platform knows, as a value rather than only a type.
 *
 * `CountryCode` is derived from it rather than declared beside it, so the two
 * cannot disagree — and the zod enum in `@morapay/contracts` is built from this
 * array for the same reason. A country added here reaches the API schema, the
 * registration form and the corridor mesh without a second edit.
 */
export const COUNTRY_CODES = [...REMITTANCE_ORIGINS, ...AFRICAN_COUNTRIES] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && (COUNTRY_CODES as readonly string[]).includes(value);
}

/**
 * How a country is named to a person choosing one.
 *
 * Here rather than in a component because three surfaces need the same names —
 * registration, the recipient form and the back office — and a country named
 * differently in two of them is a support call.
 *
 * Local name first where it differs, then English, matching how the two
 * Russian-language options have always been written.
 *
 * **The two Congos are named by their capitals**, which is the only reliable
 * way to tell them apart in a dropdown. "Congo" and "Congo" adjacent in a list
 * is not a cosmetic problem: picking the wrong one files the sender in the
 * wrong jurisdiction's database and quotes them the wrong currency, and both
 * screens after it look entirely normal.
 */
export const COUNTRY_NAMES: Readonly<Record<CountryCode, string>> = {
  RU: 'Россия / Russia',
  BY: 'Беларусь / Belarus',
  NG: 'Nigeria',
  GH: 'Ghana',
  ZA: 'South Africa',
  CM: 'Cameroun / Cameroon',
  BJ: 'Bénin / Benin',
  CD: 'RD Congo / DR Congo (Kinshasa)',
  CG: 'Congo / Republic of the Congo (Brazzaville)',
  UG: 'Uganda',
  KE: 'Kenya',
  TZ: 'Tanzania',
  ZM: 'Zambia',
  GM: 'The Gambia',
  NE: 'Niger',
  ML: 'Mali',
  SN: 'Sénégal / Senegal',
};

export function countryName(country: CountryCode): string {
  return COUNTRY_NAMES[country];
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
 * The shape of a mobile-money number, per country: the international dialling
 * prefix it must carry and how many national digits follow.
 *
 * A Ghanaian wallet number handed to the Beninese rail is a mistake worth
 * catching before it becomes a failed payout, so this is checked in three
 * places — the API schema, the send form and the rail itself. All three read
 * this table. They used to hold three copies of it, which is three chances for
 * one country's number length to be right in two of them.
 *
 * Numbers are stored and validated in E.164 **without** the leading plus.
 */
export const MSISDN_FORMAT: Readonly<
  Partial<Record<CountryCode, { prefix: string; minDigits: number; maxDigits: number }>>
> = {
  GH: { prefix: '233', minDigits: 9, maxDigits: 9 },
  CM: { prefix: '237', minDigits: 9, maxDigits: 9 },
  // Benin lengthened its national numbers from eight digits to ten, so both are
  // in circulation and both must be accepted.
  BJ: { prefix: '229', minDigits: 8, maxDigits: 10 },
  KE: { prefix: '254', minDigits: 9, maxDigits: 9 },
  UG: { prefix: '256', minDigits: 9, maxDigits: 9 },
  TZ: { prefix: '255', minDigits: 9, maxDigits: 9 },
  ZM: { prefix: '260', minDigits: 9, maxDigits: 9 },
  CD: { prefix: '243', minDigits: 9, maxDigits: 9 },
  CG: { prefix: '242', minDigits: 9, maxDigits: 9 },
  SN: { prefix: '221', minDigits: 9, maxDigits: 9 },
  ML: { prefix: '223', minDigits: 8, maxDigits: 8 },
  NE: { prefix: '227', minDigits: 8, maxDigits: 8 },
  // The shortest in the mesh at seven. A validator that assumed nine would
  // reject every Gambian number there is.
  GM: { prefix: '220', minDigits: 7, maxDigits: 7 },
};

/**
 * The countries whose recipients are credited to a wallet rather than a bank
 * account — every African country in the mesh except Nigeria and South Africa,
 * which settle to bank accounts.
 *
 * Derived from `MSISDN_FORMAT` rather than listed: a country has wallets
 * exactly when it has a wallet number format, and inventing a second list would
 * let the two disagree about a country that has just been added.
 */
export const WALLET_COUNTRIES = Object.keys(MSISDN_FORMAT) as readonly WalletCountry[];

export type WalletCountry = Exclude<AfricanCountry, 'NG' | 'ZA'>;

/** The dialling prefix alone, for callers that only need to compose a number. */
export const MSISDN_PREFIX: Readonly<Partial<Record<CountryCode, string>>> = Object.fromEntries(
  Object.entries(MSISDN_FORMAT).map(([country, format]) => [country, format.prefix]),
);

/** The pattern a wallet number for this country must match, or null if it has no wallets. */
export function msisdnPattern(country: CountryCode): RegExp | null {
  const format = MSISDN_FORMAT[country];
  if (format === undefined) return null;
  const digits =
    format.minDigits === format.maxDigits
      ? `{${format.minDigits}}`
      : `{${format.minDigits},${format.maxDigits}}`;
  return new RegExp(`^${format.prefix}\\d${digits}$`);
}

/** What to tell somebody who typed the number wrong. */
export function msisdnHint(country: CountryCode): string | null {
  const format = MSISDN_FORMAT[country];
  if (format === undefined) return null;
  const digits =
    format.minDigits === format.maxDigits
      ? `${format.minDigits} digits`
      : `${format.minDigits} to ${format.maxDigits} digits`;
  return `a ${COUNTRY_NAMES[country]} mobile number is ${format.prefix} followed by ${digits}`;
}

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
