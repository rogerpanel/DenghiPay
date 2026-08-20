-- Data-residency partitions (BUILD_PLAN 12.1).
--
-- In production these are separate database instances in separate
-- jurisdictions. Locally they are separate schemas in one instance, so that
-- application code is forced to address them separately from day one and the
-- move to real separation is a connection-string change rather than a refactor.

CREATE SCHEMA IF NOT EXISTS partition_ru;
CREATE SCHEMA IF NOT EXISTS partition_ng;
CREATE SCHEMA IF NOT EXISTS partition_gh;
CREATE SCHEMA IF NOT EXISTS partition_za;
CREATE SCHEMA IF NOT EXISTS partition_cm;
CREATE SCHEMA IF NOT EXISTS partition_bj;

COMMENT ON SCHEMA partition_ru IS
  'Russian-resident sender PII and KYC documents. 152-FZ. Production: in-country provider.';
COMMENT ON SCHEMA partition_ng IS
  'Nigerian payment transaction data and recipient PII. CBN localisation, 1 Jan 2027.';
COMMENT ON SCHEMA partition_gh IS
  'Ghanaian sender and recipient PII. Production: Ghana or a compliant regional host.';
COMMENT ON SCHEMA partition_za IS
  'South African recipient PII. POPIA. Receive-only: no sender store exists.';
COMMENT ON SCHEMA partition_cm IS
  'Cameroonian sender and recipient PII. CEMAC/BEAC.';
COMMENT ON SCHEMA partition_bj IS
  'Beninese sender and recipient PII. UEMOA/BCEAO, APDP.';

-- The neutral tier lives in the default `public` schema: ledger, transfers,
-- tokenised references, audit log. It holds no sender PII and no Nigerian
-- payment data.
COMMENT ON SCHEMA public IS
  'Neutral tier (Hetzner). Ledger, transfers, tokenised references only.';
