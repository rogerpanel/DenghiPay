-- Data-residency partitions (BUILD_PLAN 12.1).
--
-- In production these are separate database instances in separate
-- jurisdictions. Locally they are separate schemas in one instance, so that
-- application code is forced to address them separately from day one and the
-- move to real separation is a connection-string change rather than a refactor.
--
-- Sixteen of them. Note partition_cd and partition_cg are two countries: the
-- Democratic Republic of the Congo (Congolese franc, BCC) and the Republic of
-- the Congo (Central African CFA franc, BEAC). They are not a duplicate.

CREATE SCHEMA IF NOT EXISTS partition_ru;
CREATE SCHEMA IF NOT EXISTS partition_ng;
CREATE SCHEMA IF NOT EXISTS partition_gh;
CREATE SCHEMA IF NOT EXISTS partition_za;
CREATE SCHEMA IF NOT EXISTS partition_cm;
CREATE SCHEMA IF NOT EXISTS partition_bj;
CREATE SCHEMA IF NOT EXISTS partition_cd;
CREATE SCHEMA IF NOT EXISTS partition_cg;
CREATE SCHEMA IF NOT EXISTS partition_ug;
CREATE SCHEMA IF NOT EXISTS partition_ke;
CREATE SCHEMA IF NOT EXISTS partition_tz;
CREATE SCHEMA IF NOT EXISTS partition_zm;
CREATE SCHEMA IF NOT EXISTS partition_gm;
CREATE SCHEMA IF NOT EXISTS partition_ne;
CREATE SCHEMA IF NOT EXISTS partition_ml;
CREATE SCHEMA IF NOT EXISTS partition_sn;

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
COMMENT ON SCHEMA partition_cd IS
  'Congolese (DRC) sender and recipient PII. Banque Centrale du Congo.';
COMMENT ON SCHEMA partition_cg IS
  'Congolese (Republic) sender and recipient PII. CEMAC/BEAC.';
COMMENT ON SCHEMA partition_ug IS
  'Ugandan sender and recipient PII. Bank of Uganda, DPPA 2019.';
COMMENT ON SCHEMA partition_ke IS
  'Kenyan sender and recipient PII. Central Bank of Kenya, DPA 2019.';
COMMENT ON SCHEMA partition_tz IS
  'Tanzanian sender and recipient PII. Bank of Tanzania, PDPA 2022.';
COMMENT ON SCHEMA partition_zm IS
  'Zambian sender and recipient PII. Bank of Zambia, DPA 2021.';
COMMENT ON SCHEMA partition_gm IS
  'Gambian sender and recipient PII. Central Bank of The Gambia.';
COMMENT ON SCHEMA partition_ne IS
  'Nigerien sender and recipient PII. UEMOA/BCEAO.';
COMMENT ON SCHEMA partition_ml IS
  'Malian sender and recipient PII. UEMOA/BCEAO.';
COMMENT ON SCHEMA partition_sn IS
  'Senegalese sender and recipient PII. UEMOA/BCEAO, CDP.';

-- The neutral tier lives in the default `public` schema: ledger, transfers,
-- tokenised references, audit log. It holds no sender PII and no Nigerian
-- payment data.
COMMENT ON SCHEMA public IS
  'Neutral tier (Hetzner). Ledger, transfers, tokenised references only.';
