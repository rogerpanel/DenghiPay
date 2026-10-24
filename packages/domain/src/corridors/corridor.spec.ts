import { describe, expect, it } from 'vitest';
import {
  AFRICAN_COUNTRIES,
  ALWAYS_OPEN,
  Corridor,
  corridorIdFor,
  isCorridorOpen,
} from './corridor';
import {
  Authorisation,
  CorridorNotAuthorisedError,
  assertCorridorMayMoveLiveFunds,
  authorisationsFor,
  canCollectFrom,
  corridorClass,
  parseAuthorisations,
} from './licensing';

function corridor(overrides: Partial<Corridor> = {}): Corridor {
  return {
    id: 'NG-GH',
    sourceCountry: 'NG',
    sourceCurrency: 'NGN',
    destinationCountry: 'GH',
    destinationCurrency: 'GHS',
    payinMethods: ['VIRTUAL_ACCOUNT'],
    payoutMethods: ['MOBILE_MONEY'],
    limits: { minSendMinorUnits: 100n, maxSendMinorUnits: 1_000_000n },
    fees: { fixedFeeMinorUnits: 10n, fxMarginBps: 200 },
    operatingHours: ALWAYS_OPEN,
    enabled: true,
    ...overrides,
  };
}

describe('corridor identity and hours', () => {
  it('builds an id from the country pair, in send-to-receive order', () => {
    expect(corridorIdFor('NG', 'GH')).toBe('NG-GH');
    expect(corridorIdFor('GH', 'NG')).toBe('GH-NG');
  });

  it('is closed when disabled, whatever the hour', () => {
    const at = new Date('2026-08-17T12:00:00Z'); // A Monday, mid-day.
    expect(isCorridorOpen(corridor(), at)).toBe(true);
    expect(isCorridorOpen(corridor({ enabled: false }), at)).toBe(false);
  });

  it('respects the weekday and hour window', () => {
    const weekdaysOnly = corridor({
      operatingHours: { openUtcHour: 8, closeUtcHour: 18, weekdays: [1, 2, 3, 4, 5] },
    });
    expect(isCorridorOpen(weekdaysOnly, new Date('2026-08-17T09:00:00Z'))).toBe(true);
    expect(isCorridorOpen(weekdaysOnly, new Date('2026-08-17T18:00:00Z'))).toBe(false);
    // Sunday is ISO weekday 7, which getUTCDay() reports as 0.
    expect(isCorridorOpen(weekdaysOnly, new Date('2026-08-16T09:00:00Z'))).toBe(false);
  });
});

describe('corridor authorisations', () => {
  it('classifies a Russian origin as an inbound remittance', () => {
    expect(corridorClass({ sourceCountry: 'RU', destinationCountry: 'NG' })).toBe(
      'INBOUND_REMITTANCE',
    );
  });

  it('classifies an African origin as intra-African, in both directions', () => {
    expect(corridorClass({ sourceCountry: 'NG', destinationCountry: 'GH' })).toBe('INTRA_AFRICAN');
    expect(corridorClass({ sourceCountry: 'GH', destinationCountry: 'NG' })).toBe('INTRA_AFRICAN');
  });

  it('names a collection authorisation and a payout authorisation per corridor', () => {
    expect(authorisationsFor({ sourceCountry: 'RU', destinationCountry: 'NG' })).toEqual([
      'RU_COLLECTION_PARTNER',
      'NG_PAYOUT_RAIL',
    ]);
    expect(authorisationsFor({ sourceCountry: 'GH', destinationCountry: 'NG' })).toEqual([
      'GH_DOMESTIC_COLLECTION',
      'NG_PAYOUT_RAIL',
    ]);
  });

  it('does nothing while live funds are off — a simulated corridor needs no licence', () => {
    expect(() =>
      assertCorridorMayMoveLiveFunds(corridor(), { liveFundsEnabled: false, held: [] }),
    ).not.toThrow();
  });

  it('refuses a live corridor whose authorisations are not declared held', () => {
    expect(() =>
      assertCorridorMayMoveLiveFunds(corridor(), { liveFundsEnabled: true, held: [] }),
    ).toThrow(CorridorNotAuthorisedError);
  });

  it('names exactly what is missing, so the message is actionable', () => {
    try {
      assertCorridorMayMoveLiveFunds(corridor(), {
        liveFundsEnabled: true,
        held: ['NG_DOMESTIC_COLLECTION'],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CorridorNotAuthorisedError);
      expect((error as CorridorNotAuthorisedError).missing).toEqual(['GH_PAYOUT_RAIL']);
    }
  });

  /**
   * The point of the whole file. Authorising collection in Nigeria says nothing
   * about authorising collection in Ghana, so a held set that satisfies NG→GH
   * must still stop GH→NG.
   */
  it('does not let one direction authorise the other', () => {
    const held: Authorisation[] = ['NG_DOMESTIC_COLLECTION', 'GH_PAYOUT_RAIL'];
    expect(() =>
      assertCorridorMayMoveLiveFunds(corridor(), { liveFundsEnabled: true, held }),
    ).not.toThrow();

    const reverse = corridor({ id: 'GH-NG', sourceCountry: 'GH', destinationCountry: 'NG' });
    expect(() => assertCorridorMayMoveLiveFunds(reverse, { liveFundsEnabled: true, held })).toThrow(
      /GH_DOMESTIC_COLLECTION, NG_PAYOUT_RAIL/,
    );
  });

  /**
   * A country absent from the collection map cannot be an origin at all, and
   * the refusal is a throw rather than an empty list — an empty list would read
   * to the licence gate as "nothing missing" and wave the corridor through.
   *
   * Two countries have now been promoted out of being examples of it. South
   * Africa gained a collection authorisation when exchange control was built in
   * 4.3c, and Kenya gained one when the Paycrest coverage markets landed — the
   * stand-in has to be replaced each time, which is the rule working rather
   * than the test rotting. Every country in `CountryCode` can collect today, so
   * this reaches for one that is not in the type at all.
   */
  it('refuses to describe a corridor starting where we cannot collect', () => {
    for (const country of [...AFRICAN_COUNTRIES, 'RU', 'BY'] as const) {
      expect(canCollectFrom(country)).toBe(true);
    }

    // A country the map has never heard of. Cast because CountryCode does not
    // admit it — which is the first line of defence; this is the second.
    const unknown = 'ET' as never;
    expect(() => authorisationsFor({ sourceCountry: unknown, destinationCountry: 'NG' })).toThrow(
      /No collection authorisation is defined for ET/,
    );
    expect(() =>
      assertCorridorMayMoveLiveFunds(
        corridor({ id: 'ET-NG', sourceCountry: unknown, destinationCountry: 'NG' }),
        { liveFundsEnabled: true, held: [] },
      ),
    ).toThrow(/No collection authorisation is defined for ET/);
  });

  /**
   * South Africa collects under an Authorised Dealer arrangement rather than a
   * plain collection permit, and it is still a separate authorisation from the
   * payout rail into South Africa. Holding one says nothing about the other.
   */
  it('separates collecting in South Africa from paying into it', () => {
    expect(authorisationsFor({ sourceCountry: 'ZA', destinationCountry: 'NG' })).toEqual([
      'ZA_DOMESTIC_COLLECTION',
      'NG_PAYOUT_RAIL',
    ]);
    expect(authorisationsFor({ sourceCountry: 'NG', destinationCountry: 'ZA' })).toEqual([
      'NG_DOMESTIC_COLLECTION',
      'ZA_PAYOUT_RAIL',
    ]);
    expect(() =>
      assertCorridorMayMoveLiveFunds(
        corridor({ id: 'ZA-NG', sourceCountry: 'ZA', destinationCountry: 'NG' }),
        { liveFundsEnabled: true, held: ['ZA_PAYOUT_RAIL', 'NG_PAYOUT_RAIL'] },
      ),
    ).toThrow(/ZA_DOMESTIC_COLLECTION/);
  });

  it('names the francophone authorisations, and keeps the two CFA zones apart', () => {
    expect(authorisationsFor({ sourceCountry: 'BJ', destinationCountry: 'CM' })).toEqual([
      'BJ_DOMESTIC_COLLECTION',
      'CM_PAYOUT_RAIL',
    ]);
    expect(authorisationsFor({ sourceCountry: 'CM', destinationCountry: 'BJ' })).toEqual([
      'CM_DOMESTIC_COLLECTION',
      'BJ_PAYOUT_RAIL',
    ]);
    // BCEAO and BEAC are separate regulators; holding one says nothing about
    // the other, even though XAF and XOF are at par.
    expect(() =>
      assertCorridorMayMoveLiveFunds(
        corridor({ id: 'CM-BJ', sourceCountry: 'CM', destinationCountry: 'BJ' }),
        { liveFundsEnabled: true, held: ['BJ_DOMESTIC_COLLECTION', 'CM_PAYOUT_RAIL'] },
      ),
    ).toThrow(/CM_DOMESTIC_COLLECTION, BJ_PAYOUT_RAIL/);
  });

  it('treats every African origin as intra-African', () => {
    for (const sourceCountry of ['NG', 'GH', 'CM', 'BJ'] as const) {
      expect(corridorClass({ sourceCountry, destinationCountry: 'ZA' })).toBe('INTRA_AFRICAN');
    }
  });

  /**
   * The Paycrest coverage markets. Two facts this pins down, both of which the
   * shared currencies invite getting wrong.
   *
   * A currency union is not a licensing union: Benin, Niger, Mali and Senegal
   * all use XOF under the BCEAO, and each still needs its own approval. Holding
   * Senegal's says nothing about Mali's.
   *
   * And "Congo" is two countries. The DRC is its own central bank and its own
   * currency; the Republic of the Congo is BEAC and XAF, beside Cameroon.
   */
  it('keeps the BCEAO countries licensed separately despite sharing XOF', () => {
    for (const country of ['BJ', 'NE', 'ML', 'SN'] as const) {
      expect(canCollectFrom(country)).toBe(true);
    }

    expect(authorisationsFor({ sourceCountry: 'SN', destinationCountry: 'ML' })).toEqual([
      'SN_DOMESTIC_COLLECTION',
      'ML_PAYOUT_RAIL',
    ]);

    // Holding Senegal's pair does not open Mali→Senegal, even though both legs
    // are XOF and the conversion is 1:1.
    expect(() =>
      assertCorridorMayMoveLiveFunds(
        corridor({ id: 'ML-SN', sourceCountry: 'ML', destinationCountry: 'SN' }),
        { liveFundsEnabled: true, held: ['SN_DOMESTIC_COLLECTION', 'ML_PAYOUT_RAIL'] },
      ),
    ).toThrow(/ML_DOMESTIC_COLLECTION, SN_PAYOUT_RAIL/);
  });

  it('treats the two Congos as two countries', () => {
    expect(authorisationsFor({ sourceCountry: 'CD', destinationCountry: 'CG' })).toEqual([
      'CD_DOMESTIC_COLLECTION',
      'CG_PAYOUT_RAIL',
    ]);
    expect(authorisationsFor({ sourceCountry: 'CG', destinationCountry: 'CD' })).toEqual([
      'CG_DOMESTIC_COLLECTION',
      'CD_PAYOUT_RAIL',
    ]);
  });

  it('classifies every country in the mesh as intra-African', () => {
    for (const sourceCountry of AFRICAN_COUNTRIES) {
      if (sourceCountry === 'KE') continue;
      expect(corridorClass({ sourceCountry, destinationCountry: 'KE' })).toBe('INTRA_AFRICAN');
    }
  });

  /** Every country in the mesh can both collect and be paid into. */
  it('gives every mesh country both authorisations', () => {
    for (const country of AFRICAN_COUNTRIES) {
      expect(canCollectFrom(country)).toBe(true);
      const other = country === 'NG' ? 'GH' : 'NG';
      expect(authorisationsFor({ sourceCountry: country, destinationCountry: other })).toHaveLength(
        2,
      );
    }
  });

  it('parses a configured held set and rejects an unknown name', () => {
    expect(parseAuthorisations(' NG_DOMESTIC_COLLECTION , GH_PAYOUT_RAIL ')).toEqual([
      'NG_DOMESTIC_COLLECTION',
      'GH_PAYOUT_RAIL',
    ]);
    expect(parseAuthorisations('')).toEqual([]);
    expect(() => parseAuthorisations('ALL')).toThrow(/Unknown corridor authorisation/);
  });
});
