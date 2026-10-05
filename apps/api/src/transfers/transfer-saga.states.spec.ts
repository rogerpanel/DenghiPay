import { TERMINAL_STATES, TRANSFER_STATES, TransferState } from '@morapay/domain';
import { SWEPT_STATES, UNSWEPT_STATES } from './transfer-saga.service';

/**
 * Every transfer state must be classified.
 *
 * The sweeper is the only thing that ever comes back for a transfer nobody is
 * watching, so a state it does not select is a transfer that stops there
 * permanently. `PAYOUT_CONFIRMED` was exactly that: the list read as "states
 * awaiting a provider answer", and PAYOUT_CONFIRMED awaits no provider — the
 * money has arrived — it only awaits the final COMPLETE. A transfer interrupted
 * between those two events sat delivered-but-not-completed with nothing
 * scheduled to finish it, and the state machine's own `default` branch returned
 * it unchanged.
 *
 * This test is the reason that cannot recur. A new state has to be put in one
 * of the three lists, which forces the question "what will move this on?" —
 * which is the question that went unasked.
 */
describe('every transfer state is swept, terminal, or waiting on somebody', () => {
  it('classifies all of them, exactly once', () => {
    const classified = [...SWEPT_STATES, ...UNSWEPT_STATES, ...TERMINAL_STATES];

    const unclassified = TRANSFER_STATES.filter(
      (state) => !classified.includes(state as TransferState),
    );
    expect(unclassified).toEqual([]);

    // Exactly once, so a state cannot be both swept and terminal — which would
    // mean the sweeper picking up finished transfers forever.
    expect(new Set(classified).size).toBe(classified.length);
    expect(classified).toHaveLength(TRANSFER_STATES.length);
  });

  it('sweeps the state a delivered transfer waits in', () => {
    // The specific regression. PAYOUT_CONFIRMED means the recipient has the
    // money and the ledger has recorded it; only COMPLETE is outstanding.
    expect(SWEPT_STATES).toContain('PAYOUT_CONFIRMED');
    expect(TERMINAL_STATES).not.toContain('PAYOUT_CONFIRMED');
  });

  it('does not sweep states no amount of polling would move', () => {
    // A quote waits on the sender and a hold waits on a compliance officer.
    // Sweeping them would spin every ten seconds and crowd out transfers the
    // saga can actually move — the sweeper takes 25 rows at a time.
    for (const state of ['DRAFT', 'QUOTED', 'COMPLIANCE_PENDING', 'ON_HOLD'] as const) {
      expect(SWEPT_STATES).not.toContain(state);
      expect(UNSWEPT_STATES).toContain(state);
    }
  });

  it('never sweeps a terminal state', () => {
    for (const state of TERMINAL_STATES) {
      expect(SWEPT_STATES).not.toContain(state);
    }
  });
});
