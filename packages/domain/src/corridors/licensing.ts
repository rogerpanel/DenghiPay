import { CountryCode, Corridor } from './corridor';

/**
 * Which authorisation each leg of a corridor rests on.
 *
 * This file exists because NG↔GH is not the same kind of corridor as RU→NG,
 * and the difference is regulatory rather than technical. The transfer code is
 * identical either way — that is the point of corridors being data — so if the
 * distinction is not written down somewhere the machine can check, it survives
 * only as a sentence in a document that nobody reads at the moment it matters.
 *
 * **RU→NG and RU→GH are inbound remittances.** We collect in Russia through a
 * licensed Russian partner, and the funds arrive in Nigeria or Ghana as an
 * inbound cross-border remittance, which the destination partner's own IMTO
 * authorisation covers. Our regulatory exposure sits mostly at the origin.
 *
 * **NG→GH and GH→NG are domestic collection at both ends.** We take naira from
 * a person inside Nigeria and pay cedis to a person inside Ghana. Collecting
 * money from the public inside Nigeria is a CBN-licensed activity in its own
 * right; so is collecting from a mobile-money wallet inside Ghana under the
 * Bank of Ghana's payment-systems regime. Neither is implied by holding an
 * inbound-remittance arrangement, and neither is implied by the other
 * direction: NG→GH does not authorise GH→NG.
 *
 * So the two directions are two authorisations, not one corridor with an arrow
 * at both ends, and the enabled flag alone is not a strong enough statement.
 */
export const AUTHORISATIONS = [
  /** A licensed Russian partner collects RUB on our behalf. OPEN_ITEMS B1. */
  'RU_COLLECTION_PARTNER',
  'BY_COLLECTION_PARTNER',
  /** CBN authorisation to collect naira from the public inside Nigeria. */
  'NG_DOMESTIC_COLLECTION',
  /** Bank of Ghana authorisation to debit cedi wallets inside Ghana. */
  'GH_DOMESTIC_COLLECTION',
  /** BEAC/COBAC authorisation to debit XAF wallets inside Cameroon. */
  'CM_DOMESTIC_COLLECTION',
  /** BCEAO authorisation to debit XOF wallets inside Benin. */
  'BJ_DOMESTIC_COLLECTION',
  /** A licensed rail that credits Nigerian bank accounts. Paycrest or Fincra. */
  'NG_PAYOUT_RAIL',
  /** A licensed rail that credits Ghanaian mobile-money wallets. OPEN_ITEMS B4. */
  'GH_PAYOUT_RAIL',
  /** A licensed rail that credits South African bank accounts. */
  'ZA_PAYOUT_RAIL',
  /** A licensed rail that credits Cameroonian mobile-money wallets. */
  'CM_PAYOUT_RAIL',
  /** A licensed rail that credits Beninese mobile-money wallets. */
  'BJ_PAYOUT_RAIL',
] as const;

export type Authorisation = (typeof AUTHORISATIONS)[number];

/**
 * Where we are authorised — or intend to become authorised — to collect.
 *
 * Deliberately **partial**. South Africa is absent, and its absence is the
 * design: outward transfers from South Africa sit under SARB exchange control,
 * which is not merely another licence to obtain but a different product —
 * every outward payment is reported under a balance-of-payments category code
 * and measured against the sender's annual allowance, neither of which this
 * codebase models. Until that is built, South Africa receives and does not
 * send, and `authorisationsFor` refuses to describe a ZA-origin corridor at
 * all rather than quietly inventing a licence name for one.
 */
const COLLECTION_AUTHORISATION: Readonly<Partial<Record<CountryCode, Authorisation>>> = {
  RU: 'RU_COLLECTION_PARTNER',
  BY: 'BY_COLLECTION_PARTNER',
  NG: 'NG_DOMESTIC_COLLECTION',
  GH: 'GH_DOMESTIC_COLLECTION',
  CM: 'CM_DOMESTIC_COLLECTION',
  BJ: 'BJ_DOMESTIC_COLLECTION',
};

const PAYOUT_AUTHORISATION: Readonly<Partial<Record<CountryCode, Authorisation>>> = {
  NG: 'NG_PAYOUT_RAIL',
  GH: 'GH_PAYOUT_RAIL',
  ZA: 'ZA_PAYOUT_RAIL',
  CM: 'CM_PAYOUT_RAIL',
  BJ: 'BJ_PAYOUT_RAIL',
};

/** Countries we can collect from at all. A corridor cannot start anywhere else. */
export function canCollectFrom(country: CountryCode): boolean {
  return COLLECTION_AUTHORISATION[country] !== undefined;
}

/**
 * Corridors divide into two regulatory shapes, and a reader should be able to
 * tell which one they are looking at without tracing country codes.
 */
export type CorridorClass = 'INBOUND_REMITTANCE' | 'INTRA_AFRICAN';

/** Origins whose collection leg is domestic rather than a border crossing. */
const AFRICAN_ORIGINS: readonly CountryCode[] = ['NG', 'GH', 'ZA', 'CM', 'BJ'];

export function corridorClass(corridor: {
  readonly sourceCountry: CountryCode;
  readonly destinationCountry: CountryCode;
}): CorridorClass {
  return AFRICAN_ORIGINS.includes(corridor.sourceCountry) ? 'INTRA_AFRICAN' : 'INBOUND_REMITTANCE';
}

/**
 * Every authorisation this corridor rests on, collection leg first.
 *
 * Throws for an origin we have no collection authorisation defined for. That
 * is not defensive noise: a corridor starting somewhere we cannot lawfully
 * collect is a mistake in the seed, and returning an empty list would let the
 * licence gate wave it through as "nothing missing".
 */
export function authorisationsFor(corridor: {
  readonly sourceCountry: CountryCode;
  readonly destinationCountry: CountryCode;
}): readonly Authorisation[] {
  const collection = COLLECTION_AUTHORISATION[corridor.sourceCountry];
  if (collection === undefined) {
    throw new Error(
      `No collection authorisation is defined for ${corridor.sourceCountry}, so no corridor ` +
        'may start there. If that country should become an origin, add its authorisation ' +
        'and whatever the local regime actually requires — for South Africa that means ' +
        'balance-of-payments reporting and allowance tracking, not just a name in a list.',
    );
  }
  const payout = PAYOUT_AUTHORISATION[corridor.destinationCountry];
  return payout === undefined ? [collection] : [collection, payout];
}

export class CorridorNotAuthorisedError extends Error {
  constructor(
    readonly corridorId: string,
    readonly missing: readonly Authorisation[],
  ) {
    super(
      `Corridor ${corridorId} cannot move live funds: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not declared as held. ` +
        'Declare it in LIVE_CORRIDOR_AUTHORISATIONS once the licence and the written ' +
        'legal opinion exist — never to make a demonstration work.',
    );
    this.name = 'CorridorNotAuthorisedError';
  }
}

/**
 * The gate.
 *
 * With live funds off this is a no-op: a simulated corridor moves no money and
 * needs no licence, which is what lets both intra-African directions be built
 * and demonstrated now. With live funds on, every authorisation the corridor
 * rests on must be named in the held set, and the check is per corridor rather
 * than per country pair — enabling NG→GH says nothing about GH→NG.
 *
 * This deliberately cannot be satisfied by a flag that means "skip the check".
 * The only way through is to name the specific authorisation, which is a
 * sentence someone has to write and a reviewer can question.
 */
export function assertCorridorMayMoveLiveFunds(
  corridor: Pick<Corridor, 'id' | 'sourceCountry' | 'destinationCountry'>,
  options: { readonly liveFundsEnabled: boolean; readonly held: readonly Authorisation[] },
): void {
  if (!options.liveFundsEnabled) return;
  const missing = authorisationsFor(corridor).filter((a) => !options.held.includes(a));
  if (missing.length > 0) {
    throw new CorridorNotAuthorisedError(corridor.id, missing);
  }
}

/** Parse the configured held set, rejecting anything that is not a known name. */
export function parseAuthorisations(raw: string): readonly Authorisation[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      if (!(AUTHORISATIONS as readonly string[]).includes(part)) {
        throw new Error(
          `Unknown corridor authorisation ${JSON.stringify(part)}. ` +
            `Known: ${AUTHORISATIONS.join(', ')}`,
        );
      }
      return part as Authorisation;
    });
}
