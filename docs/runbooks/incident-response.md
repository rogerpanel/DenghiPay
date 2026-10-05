# Runbook — incident response

## Severity

| Level    | Definition                                                                                         | Response                                                                   |
| -------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **SEV1** | Money is wrong, or customer data is exposed. Ledger imbalance, double payout, suspected breach.    | Page immediately. Stop money movement first, diagnose second.              |
| **SEV2** | Money is stuck or the service is down. Transfers not completing, API unavailable, provider outage. | Page during working hours, ticket overnight unless customers are affected. |
| **SEV3** | Degraded but correct. Slow polls, elevated errors, one stuck transfer.                             | Ticket.                                                                    |

## The first five minutes of a SEV1

1. **Stop the bleeding.** For anything involving money:

   ```bash
   # Take the API out of rotation. Transfers stop; nothing in flight is lost,
   # because the saga resumes from persisted state.
   docker compose -f infra/compose/production.yml stop api
   ```

   A stopped system loses no money. A running system with a defect loses money
   continuously.

2. **Establish the invariant.**

   ```bash
   curl -s $API/health/ledger
   ```

   `balanced: true` means the books are intact and this is a process problem.
   `balanced: false` means stop everything and page the engineering lead — the
   database enforces this with a constraint trigger, so a `false` here means
   something is very wrong.

3. **Start a timeline.** One document, timestamps in UTC, what you saw and what
   you did. Write it as you go; nobody reconstructs it accurately afterwards.

4. **Do not edit the database.** The ledger, transfer events and the audit log
   reject `UPDATE` and `DELETE`. That is not an obstacle to work around — it is
   the property that lets you trust the record while you are diagnosing.

## Suspected data breach

1. Rotate every secret: `JWT_ACCESS_SECRET`, `ADMIN_JWT_ACCESS_SECRET`,
   `QUOTE_SIGNING_SECRET`, `FIELD_ENCRYPTION_KEY`, `TOKENISATION_SALT`, and
   every provider signing secret. Rotating the JWT secrets signs everyone out,
   which is the intended effect.
2. Revoke all sessions:
   ```sql
   UPDATE session SET revoked_at = now(), revoked_reason = 'INCIDENT' WHERE revoked_at IS NULL;
   UPDATE staff_session SET revoked_at = now(), revoked_reason = 'INCIDENT' WHERE revoked_at IS NULL;
   ```
3. Verify the audit chain — if it is intact, the log can be trusted as evidence:
   `GET /admin/audit/verify`.
4. Determine which partition is affected. The partitions are separate stores
   precisely so this question has an answer: a breach of the neutral tier does
   not expose sender PII.
5. Notification obligations differ by jurisdiction (152-FZ, NDPA, Ghana's Data
   Protection Act). Counsel decides; engineering supplies the facts.

## Provider outage

1. Mark the provider unhealthy so routing skips it. With a second rail
   registered, transfers continue on the other one.
2. With no second rail, transfers queue in `SETTLING`. That is correct — we hold
   the money and the sender's liability is recorded.
3. Tell senders before they ask. `OutboxService.notifyTransferUpdate` is how.

## After any SEV1 or SEV2

Within five working days, a written review covering: what happened, the
customer impact in numbers, why the existing controls did not prevent it, and
what changes. If a control failed, the change is to the control, not to the
person. If the failure mode was one a simulator could reproduce, add it to
`packages/adapters/src/simulators/scenarios.ts` as part of the fix.
