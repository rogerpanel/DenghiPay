-- Sender stores for the Nigerian and Ghanaian partitions.
--
-- Until now only Russia held senders, because every corridor started there.
-- The intra-African corridors (NG-GH, GH-NG) put a sender inside Nigeria and a
-- sender inside Ghana, and their personal data may not leave those countries —
-- so each gets a store in its own partition rather than a residency column on
-- a shared table.
--
-- Each table is named `sender_profile` inside its own schema, matching
-- `partition_ru.sender_profile`. In production these schemas are separate
-- database instances in separate jurisdictions; the identical table name is
-- what lets that substitution be a connection string rather than a rewrite.

-- CreateTable
CREATE TABLE "partition_ng"."sender_profile" (
    "pii_token" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT NOT NULL,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "bvn" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_gh"."sender_profile" (
    "pii_token" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT NOT NULL,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "ghana_card_no" TEXT,
    "wallet_msisdn" TEXT,
    "wallet_network" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_profile_pkey" PRIMARY KEY ("pii_token")
);
