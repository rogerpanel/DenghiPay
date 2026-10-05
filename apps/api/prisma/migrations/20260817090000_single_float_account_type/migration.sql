-- Collapse the per-currency float account types into one.
--
-- `FLOAT_RUB`, `FLOAT_NGN` and `FLOAT_GHS` carried the currency in the type
-- name while the currency column sat right beside them holding the same fact.
-- That cost a new enum member and a new branch in two `floatTypeFor` helpers
-- for every country opened; at six currencies it was a chore that would
-- eventually be got wrong. The type becomes `FLOAT` and the currency column is
-- the single place the denomination lives.
--
-- This rewrites existing rows in place rather than creating new accounts,
-- because the balances hanging off them are real. Ledger entries reference
-- accounts by id, which does not change, so no entry is touched and no balance
-- moves. The `code` is the human-readable key and is rebuilt to match.
--
-- Idempotent: re-running finds nothing to update.

UPDATE ledger_account
   SET code = 'FLOAT:' || currency,
       type = 'FLOAT'
 WHERE type IN ('FLOAT_RUB', 'FLOAT_NGN', 'FLOAT_GHS');

-- Prefunding requests store the float account code as text, so they carry the
-- old name too. Treasury history must keep pointing at the account it actually
-- moved, and a dangling code would break the four-eyes audit trail.
UPDATE prefunding_request
   SET float_account_code = 'FLOAT:' || currency
 WHERE float_account_code LIKE 'FLOAT\_%';

-- Refuse to leave the table half-migrated. If any float row still carries a
-- per-currency type, something above did not match and the ledger would then
-- have two spellings for one concept — worse than either spelling alone.
DO $$
DECLARE stragglers integer;
BEGIN
  SELECT count(*) INTO stragglers
    FROM ledger_account
   WHERE type LIKE 'FLOAT\_%';
  IF stragglers > 0 THEN
    RAISE EXCEPTION 'account type migration incomplete: % float accounts still carry a per-currency type', stragglers;
  END IF;
END $$;
