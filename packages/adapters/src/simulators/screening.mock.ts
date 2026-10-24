import { ProviderId, asProviderId } from '@morapay/domain';
import {
  ScreeningMatch,
  ScreeningProvider,
  ScreeningResult,
  ScreeningSubjectInput,
} from '../ports/screening-provider';

/**
 * Mock sanctions and PEP screening (BUILD_PLAN 3.4).
 *
 * Shaped like ComplyAdvantage / World-Check: a name-similarity score against a
 * versioned list snapshot, with the programme and entity id a compliance
 * officer needs to adjudicate.
 *
 * The list below is fictional. It exists so that a seeded test identity cannot
 * transact under any code path, and so that the compliance queue has something
 * real to review in a demo.
 */

interface ListEntry {
  readonly name: string;
  readonly list: ScreeningMatch['list'];
  readonly programme: string;
  readonly entityId: string;
  readonly dateOfBirth?: string;
}

export const MOCK_LIST_VERSION = '2026-08-01-mock';

export const MOCK_LIST: readonly ListEntry[] = [
  {
    name: 'VIKTOR ALEKSEYEVICH SOKOLOV',
    list: 'OFAC_SDN',
    programme: 'RUSSIA-EO14024',
    entityId: 'SDN-MOCK-1001',
    dateOfBirth: '1971-03-14',
  },
  {
    name: 'EMEKA CHUKWUEMEKA BALOGUN',
    list: 'OFAC_SDN',
    programme: 'SDGT',
    entityId: 'SDN-MOCK-1002',
  },
  {
    name: 'KOFI ANTWI DARKO',
    list: 'UN_CONSOLIDATED',
    programme: 'UNSC-1267',
    entityId: 'UN-MOCK-2001',
  },
  {
    name: 'NATALIA IVANOVNA MOROZOVA',
    list: 'EU_CONSOLIDATED',
    programme: 'EU-269/2014',
    entityId: 'EU-MOCK-3001',
  },
  {
    name: 'OLUWASEUN ADEBANJO',
    list: 'PEP',
    programme: 'PEP-TIER-2',
    entityId: 'PEP-MOCK-4001',
  },
  {
    // On-chain counterparty screening (guardrail G4).
    name: '0X000000000000000000000000000000000000DEAD',
    list: 'OFAC_SDN',
    programme: 'CYBER2',
    entityId: 'SDN-MOCK-5001',
  },
];

export class MockScreeningProvider implements ScreeningProvider {
  readonly id: ProviderId = asProviderId('screening-mock');

  constructor(private readonly entries: readonly ListEntry[] = MOCK_LIST) {}

  async listVersion(): Promise<string> {
    return MOCK_LIST_VERSION;
  }

  async screen(subject: ScreeningSubjectInput): Promise<ScreeningResult> {
    const candidates = [subject.fullName, subject.accountIdentifier].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );

    const matches: ScreeningMatch[] = [];
    for (const entry of this.entries) {
      for (const candidate of candidates) {
        const score = similarity(normalise(candidate), normalise(entry.name));
        if (score < 70) continue;
        // A date of birth that disagrees is exculpatory: it drops the score
        // below the blocking threshold rather than clearing the name outright,
        // because a compliance officer, not an algorithm, closes a case.
        const adjusted =
          entry.dateOfBirth !== undefined &&
          subject.dateOfBirth !== undefined &&
          entry.dateOfBirth !== subject.dateOfBirth
            ? Math.min(score, 74)
            : score;
        matches.push({
          list: entry.list,
          matchedName: entry.name,
          score: adjusted,
          programme: entry.programme,
          entityId: entry.entityId,
        });
      }
    }

    if (matches.length === 0) {
      return {
        _tag: 'CLEAR',
        subjectRef: subject.subjectRef,
        listVersion: MOCK_LIST_VERSION,
        screenedAt: new Date(),
      };
    }

    matches.sort((a, b) => b.score - a.score);
    return {
      _tag: 'HIT',
      subjectRef: subject.subjectRef,
      listVersion: MOCK_LIST_VERSION,
      screenedAt: new Date(),
      matches,
      topScore: matches[0]?.score ?? 0,
    };
  }
}

function normalise(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-set similarity: the share of the shorter name's tokens that appear in
 * the longer one. Crude by design — a real vendor does phonetics, transliteration
 * and aliasing, and that is precisely why we abstract behind a port rather than
 * pretending this is good enough for production.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 100;
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  const shared = tokensA.filter((t) => setB.has(t)).length;
  const shorter = Math.min(tokensA.length, tokensB.length);
  const base = (shared / shorter) * 100;

  // Two shared surnames out of three tokens is a real-world hit worth reviewing;
  // one shared common forename is not.
  if (shared === 0) return 0;
  if (shared === 1 && shorter > 1) return Math.min(base, 60);
  return Math.round(base);
}
