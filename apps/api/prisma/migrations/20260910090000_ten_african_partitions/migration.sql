-- Residency partitions for the ten Paycrest coverage markets.
--
-- Congo-Kinshasa (CD), Congo-Brazzaville (CG), Uganda, Kenya, Tanzania,
-- Zambia, Gambia, Niger, Mali and Senegal. Unlike the earlier partition
-- migrations these ten ARE symmetrical: every one both sends and receives over
-- mobile money, and every one anchors identity on a single national identity
-- number. That is what lets them share one repository in the application
-- (src/partitions/standard) — but not one schema.
--
-- CD and CG are two countries, not one. The Democratic Republic of the Congo
-- uses the Congolese franc under the BCC; the Republic of the Congo uses the
-- Central African CFA franc under the BEAC, alongside Cameroon. They get two
-- schemas for the same reason they get two corridors.
--
-- Each table keeps the same name inside its own schema as its counterparts
-- elsewhere, so promoting a partition to a separate database instance in its
-- own jurisdiction stays a connection-string change.

CREATE SCHEMA IF NOT EXISTS "partition_cd";
CREATE SCHEMA IF NOT EXISTS "partition_cg";
CREATE SCHEMA IF NOT EXISTS "partition_ug";
CREATE SCHEMA IF NOT EXISTS "partition_ke";
CREATE SCHEMA IF NOT EXISTS "partition_tz";
CREATE SCHEMA IF NOT EXISTS "partition_zm";
CREATE SCHEMA IF NOT EXISTS "partition_gm";
CREATE SCHEMA IF NOT EXISTS "partition_ne";
CREATE SCHEMA IF NOT EXISTS "partition_ml";
CREATE SCHEMA IF NOT EXISTS "partition_sn";

COMMENT ON SCHEMA "partition_cd" IS
  'Congolese (DRC) sender and recipient PII. Banque Centrale du Congo.';
COMMENT ON SCHEMA "partition_cg" IS
  'Congolese (Republic) sender and recipient PII. CEMAC/BEAC.';
COMMENT ON SCHEMA "partition_ug" IS
  'Ugandan sender and recipient PII. Bank of Uganda, DPPA 2019.';
COMMENT ON SCHEMA "partition_ke" IS
  'Kenyan sender and recipient PII. Central Bank of Kenya, DPA 2019.';
COMMENT ON SCHEMA "partition_tz" IS
  'Tanzanian sender and recipient PII. Bank of Tanzania, PDPA 2022.';
COMMENT ON SCHEMA "partition_zm" IS
  'Zambian sender and recipient PII. Bank of Zambia, DPA 2021.';
COMMENT ON SCHEMA "partition_gm" IS
  'Gambian sender and recipient PII. Central Bank of The Gambia.';
COMMENT ON SCHEMA "partition_ne" IS
  'Nigerien sender and recipient PII. UEMOA/BCEAO.';
COMMENT ON SCHEMA "partition_ml" IS
  'Malian sender and recipient PII. UEMOA/BCEAO.';
COMMENT ON SCHEMA "partition_sn" IS
  'Senegalese sender and recipient PII. UEMOA/BCEAO, CDP.';

-- CreateTable
CREATE TABLE "partition_cd"."sender_profile" (
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
CREATE TABLE "partition_cd"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_cg"."sender_profile" (
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
CREATE TABLE "partition_cg"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_ug"."sender_profile" (
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
CREATE TABLE "partition_ug"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_ke"."sender_profile" (
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
CREATE TABLE "partition_ke"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_tz"."sender_profile" (
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
CREATE TABLE "partition_tz"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_zm"."sender_profile" (
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
CREATE TABLE "partition_zm"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_gm"."sender_profile" (
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
CREATE TABLE "partition_gm"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_ne"."sender_profile" (
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
CREATE TABLE "partition_ne"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_ml"."sender_profile" (
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
CREATE TABLE "partition_ml"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_sn"."sender_profile" (
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
CREATE TABLE "partition_sn"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);
