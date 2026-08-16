import { describe, expect, it } from 'vitest';
import { ALWAYS_OPEN, Corridor, corridorIdFor, isCorridorOpen } from './corridor';
import {
  Authorisation,
  CorridorNotAuthorisedError,
  assertCorridorMayMoveLiveFunds,
  authorisationsFor,
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

  it('parses a configured held set and rejects an unknown name', () => {
    expect(parseAuthorisations(' NG_DOMESTIC_COLLECTION , GH_PAYOUT_RAIL ')).toEqual([
      'NG_DOMESTIC_COLLECTION',
      'GH_PAYOUT_RAIL',
    ]);
    expect(parseAuthorisations('')).toEqual([]);
    expect(() => parseAuthorisations('ALL')).toThrow(/Unknown corridor authorisation/);
  });
});
