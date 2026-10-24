import { describe, expect, it } from 'vitest';
import {
  SENDER_FACING_STATUS,
  TRANSFER_EVENTS,
  TRANSFER_STATES,
  TransferEvent,
  TransferState,
  allowedEvents,
  canTransition,
  isTerminal,
  transition,
} from './state-machine';
import { IllegalTransitionError } from '../errors';

/** The transition table from TECHNICAL_ARCHITECTURE §2.3, written out independently. */
const EXPECTED: ReadonlyArray<readonly [TransferState, TransferEvent, TransferState]> = [
  ['DRAFT', 'QUOTE_ISSUED', 'QUOTED'],
  ['QUOTED', 'CONFIRM', 'COMPLIANCE_PENDING'],
  ['QUOTED', 'QUOTE_EXPIRED', 'FAILED'],
  ['COMPLIANCE_PENDING', 'SCREEN_CLEAR', 'AWAITING_PAYIN'],
  ['COMPLIANCE_PENDING', 'SCREEN_HIT', 'ON_HOLD'],
  ['ON_HOLD', 'OFFICER_CLEARED', 'AWAITING_PAYIN'],
  ['ON_HOLD', 'OFFICER_REJECTED', 'FAILED'],
  ['AWAITING_PAYIN', 'PAYIN_RECEIVED', 'PAYIN_CONFIRMED'],
  ['AWAITING_PAYIN', 'PAYIN_TIMEOUT', 'FAILED'],
  ['PAYIN_CONFIRMED', 'SETTLEMENT_STARTED', 'SETTLING'],
  ['SETTLING', 'PAYOUT_SUBMITTED', 'PAYOUT_INITIATED'],
  ['SETTLING', 'NO_LIQUIDITY', 'REFUNDING'],
  ['PAYOUT_INITIATED', 'PAYOUT_SETTLED', 'PAYOUT_CONFIRMED'],
  ['PAYOUT_INITIATED', 'PAYOUT_FAILED', 'REFUNDING'],
  ['PAYOUT_CONFIRMED', 'COMPLETE', 'COMPLETED'],
  ['REFUNDING', 'REFUND_EXECUTED', 'REFUNDED'],
];

describe('transfer state machine', () => {
  it('implements exactly the documented transitions', () => {
    for (const [from, event, to] of EXPECTED) {
      expect(transition(from, event)).toBe(to);
    }
  });

  it('is exhaustive: every state × event pair not documented is illegal', () => {
    const legal = new Set(EXPECTED.map(([from, event]) => `${from}|${event}`));
    for (const from of TRANSFER_STATES) {
      for (const event of TRANSFER_EVENTS) {
        const isLegal = legal.has(`${from}|${event}`);
        expect(canTransition(from, event)).toBe(isLegal);
        if (!isLegal) {
          expect(() => transition(from, event)).toThrow(IllegalTransitionError);
        }
      }
    }
  });

  it('has no outbound transition from a terminal state', () => {
    for (const state of TRANSFER_STATES) {
      if (isTerminal(state)) {
        expect(allowedEvents(state)).toHaveLength(0);
      } else {
        expect(allowedEvents(state).length).toBeGreaterThan(0);
      }
    }
  });

  it('reaches a terminal state from every non-terminal state', () => {
    for (const start of TRANSFER_STATES) {
      const seen = new Set<TransferState>();
      const queue: TransferState[] = [start];
      let reachedTerminal = false;
      while (queue.length > 0) {
        const current = queue.shift() as TransferState;
        if (seen.has(current)) continue;
        seen.add(current);
        if (isTerminal(current)) {
          reachedTerminal = true;
          break;
        }
        for (const event of allowedEvents(current)) {
          queue.push(transition(current, event));
        }
      }
      expect(reachedTerminal).toBe(true);
    }
  });

  it('cannot reach settlement without passing through the compliance gate', () => {
    // Guardrail G3 at the level of graph reachability: every path from DRAFT to
    // SETTLING passes through COMPLIANCE_PENDING.
    const paths: TransferState[][] = [['DRAFT']];
    const complete: TransferState[][] = [];
    while (paths.length > 0) {
      const path = paths.pop() as TransferState[];
      const head = path[path.length - 1] as TransferState;
      if (head === 'SETTLING') {
        complete.push(path);
        continue;
      }
      for (const event of allowedEvents(head)) {
        const to = transition(head, event);
        if (path.includes(to)) continue;
        paths.push([...path, to]);
      }
    }
    expect(complete.length).toBeGreaterThan(0);
    for (const path of complete) {
      expect(path).toContain('COMPLIANCE_PENDING');
    }
  });

  it('gives every state a sender-facing label', () => {
    for (const state of TRANSFER_STATES) {
      expect(SENDER_FACING_STATUS[state]).toBeTruthy();
    }
  });
});
