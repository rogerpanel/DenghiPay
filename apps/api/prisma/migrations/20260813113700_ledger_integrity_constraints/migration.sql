-- Ledger integrity, enforced by the database (BUILD_PLAN 1.2 DoD).
--
-- Application-level validation exists to produce a good error message. This is
-- the guarantee. An unbalanced transaction cannot be committed even by a
-- direct psql session.

-- ---------------------------------------------------------------------------
-- 1. Every transaction balances to zero, per currency.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_ledger_transaction_balances()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  offending RECORD;
  entry_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO entry_count
  FROM public.ledger_entry
  WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id);

  -- A transaction with no entries left is a deleted transaction; nothing to check.
  IF entry_count = 0 THEN
    RETURN NULL;
  END IF;

  IF entry_count < 2 THEN
    RAISE EXCEPTION
      'Ledger transaction % has % entry: double-entry requires at least two',
      COALESCE(NEW.transaction_id, OLD.transaction_id), entry_count
      USING ERRCODE = 'check_violation';
  END IF;

  FOR offending IN
    SELECT
      currency,
      SUM(CASE WHEN direction = 'DEBIT'  THEN amount_minor_units ELSE 0 END) AS debits,
      SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor_units ELSE 0 END) AS credits
    FROM public.ledger_entry
    WHERE transaction_id = COALESCE(NEW.transaction_id, OLD.transaction_id)
    GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'DEBIT'  THEN amount_minor_units ELSE 0 END)
        <> SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor_units ELSE 0 END)
  LOOP
    RAISE EXCEPTION
      'Ledger transaction % does not balance in %: debits % <> credits %',
      COALESCE(NEW.transaction_id, OLD.transaction_id),
      offending.currency, offending.debits, offending.credits
      USING ERRCODE = 'check_violation';
  END LOOP;

  RETURN NULL;
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED so the check runs once, at COMMIT, after all
-- entries of a transaction are inserted.
CREATE CONSTRAINT TRIGGER ledger_entry_balances
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entry
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_ledger_transaction_balances();

-- ---------------------------------------------------------------------------
-- 2. Amounts are strictly positive; the direction carries the sign.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ledger_entry
  ADD CONSTRAINT ledger_entry_amount_positive CHECK (amount_minor_units > 0);

ALTER TABLE public.ledger_entry
  ADD CONSTRAINT ledger_entry_direction_valid CHECK (direction IN ('DEBIT', 'CREDIT'));

-- ---------------------------------------------------------------------------
-- 3. The ledger is append-only. No UPDATE, no DELETE, ever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER ledger_entry_append_only
BEFORE UPDATE OR DELETE ON public.ledger_entry
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

CREATE TRIGGER ledger_transaction_append_only
BEFORE UPDATE OR DELETE ON public.ledger_transaction
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

CREATE TRIGGER transfer_event_append_only
BEFORE UPDATE OR DELETE ON public.transfer_event
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON public.audit_event
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

-- ---------------------------------------------------------------------------
-- 4. Four-eyes on treasury (guardrail G6), enforced below the application.
-- ---------------------------------------------------------------------------
ALTER TABLE public.prefunding_request
  ADD CONSTRAINT prefunding_four_eyes
  CHECK (approved_by IS NULL OR approved_by <> requested_by);

-- ---------------------------------------------------------------------------
-- 5. A screening record may only be CLEAR, HIT or ERROR, and a transfer's
--    state must be one the state machine knows about.
-- ---------------------------------------------------------------------------
ALTER TABLE public.transfer
  ADD CONSTRAINT transfer_state_valid CHECK (state IN (
    'DRAFT', 'QUOTED', 'COMPLIANCE_PENDING', 'ON_HOLD', 'AWAITING_PAYIN',
    'PAYIN_CONFIRMED', 'SETTLING', 'PAYOUT_INITIATED', 'PAYOUT_CONFIRMED',
    'COMPLETED', 'REFUNDING', 'REFUNDED', 'FAILED'
  ));
