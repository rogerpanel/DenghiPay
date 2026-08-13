-- Data-residency partitions (BUILD_PLAN 12.1).
--
-- In production these are separate database instances in separate
-- jurisdictions. Locally they are separate schemas in one instance, so that
-- application code is forced to address them separately from day one and the
-- move to real separation is a connection-string change rather than a refactor.

CREATE SCHEMA IF NOT EXISTS partition_ru;
CREATE SCHEMA IF NOT EXISTS partition_ng;
CREATE SCHEMA IF NOT EXISTS partition_gh;

COMMENT ON SCHEMA partition_ru IS
  'Russian-resident sender PII and KYC documents. 152-FZ. Production: in-country provider.';
COMMENT ON SCHEMA partition_ng IS
  'Nigerian payment transaction data and recipient PII. CBN localisation, 1 Jan 2027.';
COMMENT ON SCHEMA partition_gh IS
  'Ghanaian recipient PII. Production: Ghana or a compliant regional host.';

-- The neutral tier lives in the default `public` schema: ledger, transfers,
-- tokenised references, audit log. It holds no sender PII and no Nigerian
-- payment data.
COMMENT ON SCHEMA public IS
  'Neutral tier (Hetzner). Ledger, transfers, tokenised references only.';
