/**
 * Simulator scenarios.
 *
 * The failure catalogue from TECHNICAL_ARCHITECTURE §1.2 is not a footnote —
 * §7 requires the payout simulator to reproduce it. Each scenario below is one
 * of those defects, made reachable on demand so the transfer saga is tested
 * against it rather than against the happy path only.
 *
 * A scenario is selected by the last four digits of the recipient identifier
 * (account number or MSISDN). That keeps the demo deterministic: the same test
 * account always fails the same way, and nobody has to configure anything.
 */
export const SCENARIOS = {
  /** Settles on the first status poll. The ordinary case. */
  HAPPY: 'HAPPY',
  /** Name enquiry finds nothing. The transfer must stop before the sender commits. */
  NAME_NOT_FOUND: 'NAME_NOT_FOUND',
  /** The institution is not reachable through this rail. */
  UNSUPPORTED_INSTITUTION: 'UNSUPPORTED_INSTITUTION',
  /**
   * Acknowledged, then failed. This is the FreshPay `Status: "Success"` /
   * `Trans_Status: "Failed"` pair — the reason an acknowledgement and an
   * outcome are different types.
   */
  ACK_THEN_FAIL: 'ACK_THEN_FAIL',
  /** Pending for several polls before settling. Exercises the backoff schedule. */
  SLOW_SETTLE: 'SLOW_SETTLE',
  /** Delivers the same callback several times, out of order. */
  DUPLICATE_CALLBACK: 'DUPLICATE_CALLBACK',
  /** Never sends a callback at all. The poll schedule must still finish the job. */
  NO_CALLBACK: 'NO_CALLBACK',
  /** Reports the amount as a JSON float, as FreshPay does. Must be refused at the edge. */
  FLOAT_AMOUNT: 'FLOAT_AMOUNT',
  /** Fails permanently: account closed. Not retryable. */
  TERMINAL_FAILURE: 'TERMINAL_FAILURE',
  /** Omits its own reference at submit time, as FreshPay does (§1.2 issue 10). */
  NO_REF_AT_SUBMIT: 'NO_REF_AT_SUBMIT',
} as const;

export type Scenario = (typeof SCENARIOS)[keyof typeof SCENARIOS];

const BY_SUFFIX: Readonly<Record<string, Scenario>> = {
  '0000': SCENARIOS.NAME_NOT_FOUND,
  '1111': SCENARIOS.ACK_THEN_FAIL,
  '2222': SCENARIOS.SLOW_SETTLE,
  '3333': SCENARIOS.DUPLICATE_CALLBACK,
  '4444': SCENARIOS.NO_CALLBACK,
  '5555': SCENARIOS.FLOAT_AMOUNT,
  '6666': SCENARIOS.TERMINAL_FAILURE,
  '7777': SCENARIOS.UNSUPPORTED_INSTITUTION,
  '8888': SCENARIOS.NO_REF_AT_SUBMIT,
};

export function scenarioFor(identifier: string): Scenario {
  const suffix = identifier.slice(-4);
  return BY_SUFFIX[suffix] ?? SCENARIOS.HAPPY;
}

/** Documented so the demo script and the admin simulator panel stay in sync. */
export const SCENARIO_GUIDE: ReadonlyArray<{
  readonly suffix: string;
  readonly scenario: Scenario;
  readonly describes: string;
}> = [
  {
    suffix: '0000',
    scenario: SCENARIOS.NAME_NOT_FOUND,
    describes: 'Name enquiry finds no account',
  },
  {
    suffix: '1111',
    scenario: SCENARIOS.ACK_THEN_FAIL,
    describes: 'Acknowledged, then failed (the FreshPay bug)',
  },
  {
    suffix: '2222',
    scenario: SCENARIOS.SLOW_SETTLE,
    describes: 'Pending for three polls, then settles',
  },
  {
    suffix: '3333',
    scenario: SCENARIOS.DUPLICATE_CALLBACK,
    describes: 'Duplicate, out-of-order callbacks',
  },
  {
    suffix: '4444',
    scenario: SCENARIOS.NO_CALLBACK,
    describes: 'No callback ever arrives; polling completes it',
  },
  {
    suffix: '5555',
    scenario: SCENARIOS.FLOAT_AMOUNT,
    describes: 'Amount reported as a JSON float',
  },
  {
    suffix: '6666',
    scenario: SCENARIOS.TERMINAL_FAILURE,
    describes: 'Account closed — permanent failure',
  },
  {
    suffix: '7777',
    scenario: SCENARIOS.UNSUPPORTED_INSTITUTION,
    describes: 'Institution not on this rail',
  },
  {
    suffix: '8888',
    scenario: SCENARIOS.NO_REF_AT_SUBMIT,
    describes: 'Provider reference absent at submit',
  },
  { suffix: 'any other', scenario: SCENARIOS.HAPPY, describes: 'Settles on the first status poll' },
];
