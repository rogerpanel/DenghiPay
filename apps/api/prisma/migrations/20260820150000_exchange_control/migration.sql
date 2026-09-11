-- Exchange control: a South African sender store, and declarations.
--
-- South Africa becomes an origin. Outward payments from it are permitted only
-- when declared under a published category and counted against the sender's
-- personal annual allowance, so two things are added:
--
--   partition_za.sender_profile        personal data, including the identity
--                                      number an Authorised Dealer reports
--                                      against and the tax reference the larger
--                                      allowance requires. Stays in ZA.
--
--   public.exchange_control_declaration  one row per outward transfer: the
--                                      category, the allowance year, and what
--                                      the allowance was believed to be at the
--                                      moment of the decision. Neutral tier,
--                                      because it is transaction data joined to
--                                      a token rather than personal data.
--
-- `used_through_us_minor_units` and `declared_elsewhere_minor_units` are kept
-- apart rather than summed. An allowance is personal and spans every provider
-- the sender uses; when a discrepancy is investigated the question is always
-- which of the two figures was wrong, and a single total cannot answer it.

-- CreateTable
CREATE TABLE "partition_za"."sender_profile" (
    "pii_token" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT NOT NULL,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "national_id_no" TEXT,
    "tax_reference" TEXT,
    "exchange_control_status" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "exchange_control_declaration" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "regime_country" TEXT NOT NULL,
    "category_code" TEXT NOT NULL,
    "category_label" TEXT NOT NULL,
    "allowance_kind" TEXT NOT NULL,
    "allowance_year" INTEGER NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "used_through_us_minor_units" BIGINT NOT NULL,
    "declared_elsewhere_minor_units" BIGINT NOT NULL,
    "tax_clearance_ref" TEXT,
    "reported_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_control_declaration_pkey" PRIMARY KEY ("id")
);

-- One declaration per transfer. A second would mean the same payment counted
-- twice against an allowance, or reported twice to the regulator.
CREATE UNIQUE INDEX "exchange_control_declaration_transfer_id_key"
    ON "exchange_control_declaration"("transfer_id");

-- The allowance query is "this sender, this calendar year", and the reporting
-- query is "everything not yet handed to the Authorised Dealer".
CREATE INDEX "exchange_control_declaration_user_id_allowance_year_idx"
    ON "exchange_control_declaration"("user_id", "allowance_year");
CREATE INDEX "exchange_control_declaration_reported_at_idx"
    ON "exchange_control_declaration"("reported_at");

-- AddForeignKey
ALTER TABLE "exchange_control_declaration"
    ADD CONSTRAINT "exchange_control_declaration_transfer_id_fkey"
    FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
