# Runbook — stuck transfer

**Alert:** `StuckTransfers`
**Severity:** page
**Meaning:** a transfer exhausted its poll schedule without reaching a terminal
state. Someone else has the customer's money and we do not know what happened
to it.

## First, establish where the money is

Every transfer is in exactly one of three positions, and the state tells you
which:

| State                         | Where the money is                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `AWAITING_PAYIN`              | With the sender. We hold nothing. Low urgency.                                               |
| `PAYIN_CONFIRMED`, `SETTLING` | With us, in float. We owe the sender.                                                        |
| `PAYOUT_INITIATED`            | With the payout partner. **Highest urgency** — it may or may not have reached the recipient. |

```bash
# In the back office: Operations → search the reference.
# Or directly:
curl -s "$API/admin/transfers?reference=MP-XXXX-XXXX" -H "authorization: Bearer $STAFF_TOKEN"
```

## Then ask the provider, do not guess

```bash
curl -s "$API/admin/transfers/$ID" -H "authorization: Bearer $STAFF_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['payoutProviderRef'], d['state'])"
```

The saga polls automatically. If it has stopped, the usual causes, in order of
how often they actually happen:

1. **The provider reference is null.** The submission never got through. Safe to
   re-drive: the idempotency key is derived from the transfer id, so a retry
   cannot create a second payout.
2. **The provider returns `PENDING` indefinitely.** Contact them with the
   provider reference. Do not refund yet — a refund plus a late settlement is
   a double payment.
3. **The provider returns an error we do not map.** Look at
   `morapay_provider_call_duration_seconds{outcome="error"}` and the API logs
   for the correlation id.

## Only then decide

- **Confirmed not delivered** → Operations → _Refund this transfer_, with a
  reason code. The refund posts mirrored entries and returns the fee.
- **Confirmed delivered but our state is behind** → the next status poll will
  correct it. Force one by re-driving the saga. Never edit the state by hand;
  `applyEvent` is the only writer, and the audit log would show a gap.
- **Genuinely unknown** → leave it. An unknown transfer that is left alone can
  still be corrected by the T+1 statement. A guessed refund cannot be undone.

## Afterwards

- Check `/health/ledger` still reports `balanced: true`.
- If the T+1 statement later disagrees with what you did, **the statement
  wins** — open a suspense item and investigate.
- If the cause was a provider behaviour we do not model, add it to the
  simulator (`packages/adapters/src/simulators/scenarios.ts`) so the next
  person meets it in a test rather than at 3am.
