import { ProviderId } from '@morapay/domain';

/**
 * Sanctions and PEP screening port (BUILD_PLAN 3.4, guardrail G3).
 *
 * There is no `skip` parameter, no dev mode, and no override. A caller that
 * wants to move a transfer forward must hold a `CLEAR` result, and the only way
 * to get one is to screen.
 */

export const SCREENING_LISTS = [
  'OFAC_SDN',
  'EU_CONSOLIDATED',
  'UN_CONSOLIDATED',
  'UK_HMT',
  'PEP',
] as const;
export type ScreeningList = (typeof SCREENING_LISTS)[number];

export interface ScreeningSubjectInput {
  readonly kind: 'SENDER' | 'RECIPIENT' | 'COUNTERPARTY';
  /** Tokenised reference we record against the result. */
  readonly subjectRef: string;
  readonly fullName: string;
  readonly dateOfBirth?: string;
  readonly nationality?: string;
  readonly country?: string;
  /** For treasury counterparties: the account or on-chain address (G4). */
  readonly accountIdentifier?: string;
}

export interface ScreeningMatch {
  readonly list: ScreeningList;
  readonly matchedName: string;
  /** 0-100. */
  readonly score: number;
  readonly programme: string;
  readonly entityId: string;
}

export type ScreeningResult =
  | {
      readonly _tag: 'CLEAR';
      readonly subjectRef: string;
      readonly listVersion: string;
      readonly screenedAt: Date;
    }
  | {
      readonly _tag: 'HIT';
      readonly subjectRef: string;
      readonly listVersion: string;
      readonly screenedAt: Date;
      readonly matches: readonly ScreeningMatch[];
      readonly topScore: number;
    };

export interface ScreeningProvider {
  readonly id: ProviderId;
  /** Which list snapshot this provider is serving. Recorded on every result. */
  listVersion(): Promise<string>;
  screen(subject: ScreeningSubjectInput): Promise<ScreeningResult>;
}

export function isClear(
  result: ScreeningResult,
): result is Extract<ScreeningResult, { _tag: 'CLEAR' }> {
  return result._tag === 'CLEAR';
}
