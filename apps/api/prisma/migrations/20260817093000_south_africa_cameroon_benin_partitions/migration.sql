-- Residency partitions for South Africa, Cameroon and Benin.
--
-- Three new jurisdictions, and they are not symmetrical:
--
--   partition_za  recipients only. South Africa receives and does not send
--                 until SARB exchange-control reporting exists, so there is
--                 deliberately no sender_profile table here. The absence is
--                 the enforcement — a ZA sender has nowhere to be stored.
--   partition_cm  senders and recipients. CEMAC/BEAC.
--   partition_bj  senders and recipients. UEMOA/BCEAO.
--
-- Each table keeps the same name inside its own schema as its counterparts
-- elsewhere, so promoting a partition to a separate database instance in its
-- own jurisdiction stays a connection-string change.

CREATE SCHEMA IF NOT EXISTS "partition_za";
CREATE SCHEMA IF NOT EXISTS "partition_cm";
CREATE SCHEMA IF NOT EXISTS "partition_bj";

COMMENT ON SCHEMA "partition_za" IS
  'South African recipient PII. POPIA. Receive-only: no sender store exists.';
COMMENT ON SCHEMA "partition_cm" IS
  'Cameroonian sender and recipient PII. CEMAC/BEAC.';
COMMENT ON SCHEMA "partition_bj" IS
  'Beninese sender and recipient PII. UEMOA/BCEAO, APDP.';

-- CreateTable
CREATE TABLE "partition_za"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_cm"."sender_profile" (
    "pii_token" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT NOT NULL,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "national_id_no" TEXT,
    "wallet_msisdn" TEXT,
    "wallet_network" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_cm"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_bj"."sender_profile" (
    "pii_token" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT NOT NULL,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "national_id_no" TEXT,
    "wallet_msisdn" TEXT,
    "wallet_network" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_bj"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);
