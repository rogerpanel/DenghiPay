-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "partition_gh";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "partition_ng";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "partition_ru";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CustomerRole" AS ENUM ('SENDER', 'RECIPIENT');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPPORT', 'COMPLIANCE_OFFICER', 'TREASURY_OPERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('CLEAR', 'HIT', 'ERROR');

-- CreateEnum
CREATE TYPE "ScreeningSubject" AS ENUM ('SENDER', 'RECIPIENT', 'COUNTERPARTY');

-- CreateEnum
CREATE TYPE "ComplianceCaseType" AS ENUM ('SCREENING_HIT', 'VELOCITY', 'STRUCTURING', 'ENHANCED_DUE_DILIGENCE', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ComplianceCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CLEARED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PrefundingStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "roles" "CustomerRole"[],
    "kyc_tier" INTEGER NOT NULL DEFAULT 0,
    "pii_partition" TEXT NOT NULL DEFAULT 'RU',
    "pii_token" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_token" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "replaced_by_id" TEXT,
    "user_agent_hash" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "roles" "StaffRole"[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_session" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "sequence" BIGSERIAL NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "reason" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("sequence")
);

-- CreateTable
CREATE TABLE "kyc_case" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_tier" INTEGER NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "document_types" TEXT[],
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "rejection_reason" TEXT,

    CONSTRAINT "kyc_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screening_record" (
    "id" TEXT NOT NULL,
    "subject_type" "ScreeningSubject" NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "transfer_id" TEXT,
    "provider" TEXT NOT NULL,
    "status" "ScreeningStatus" NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "matches" JSONB NOT NULL DEFAULT '[]',
    "list_version" TEXT NOT NULL,
    "screened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_case" (
    "id" TEXT NOT NULL,
    "type" "ComplianceCaseType" NOT NULL,
    "status" "ComplianceCaseStatus" NOT NULL DEFAULT 'OPEN',
    "user_id" TEXT,
    "transfer_id" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "assigned_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "decision_reason" TEXT,

    CONSTRAINT "compliance_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_case_note" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_case_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corridor" (
    "id" TEXT NOT NULL,
    "source_country" TEXT NOT NULL,
    "source_currency" TEXT NOT NULL,
    "destination_country" TEXT NOT NULL,
    "destination_currency" TEXT NOT NULL,
    "payin_methods" TEXT[],
    "payout_methods" TEXT[],
    "min_send_minor_units" BIGINT NOT NULL,
    "max_send_minor_units" BIGINT NOT NULL,
    "fixed_fee_minor_units" BIGINT NOT NULL,
    "fx_margin_bps" INTEGER NOT NULL,
    "open_utc_hour" INTEGER NOT NULL DEFAULT 0,
    "close_utc_hour" INTEGER NOT NULL DEFAULT 24,
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corridor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_observation" (
    "id" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "numerator" BIGINT NOT NULL,
    "scale" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "corridor_id" TEXT NOT NULL,
    "send_minor_units" BIGINT NOT NULL,
    "send_currency" TEXT NOT NULL,
    "fixed_fee_minor_units" BIGINT NOT NULL,
    "fx_margin_minor_units" BIGINT NOT NULL,
    "total_to_pay_minor_units" BIGINT NOT NULL,
    "recipient_minor_units" BIGINT NOT NULL,
    "recipient_currency" TEXT NOT NULL,
    "mid_rate_numerator" BIGINT NOT NULL,
    "mid_rate_scale" INTEGER NOT NULL,
    "effective_rate_numerator" BIGINT NOT NULL,
    "effective_rate_scale" INTEGER NOT NULL,
    "fx_margin_bps" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipient" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "pii_token" TEXT NOT NULL,
    "pii_partition" TEXT NOT NULL,
    "masked_account" TEXT NOT NULL,
    "resolved_name" TEXT,
    "nickname" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "corridor_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "send_minor_units" BIGINT NOT NULL,
    "send_currency" TEXT NOT NULL,
    "total_to_pay_minor_units" BIGINT NOT NULL,
    "fee_minor_units" BIGINT NOT NULL,
    "recipient_minor_units" BIGINT NOT NULL,
    "recipient_currency" TEXT NOT NULL,
    "payin_method" TEXT NOT NULL,
    "payin_provider_id" TEXT,
    "payin_provider_ref" TEXT,
    "payin_instructions" JSONB,
    "payout_provider_id" TEXT,
    "payout_provider_ref" TEXT,
    "payout_institution_ref" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "poll_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_poll_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_event" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "from_state" TEXT NOT NULL,
    "to_state" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_position" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "sell_currency" TEXT NOT NULL,
    "sell_minor_units" BIGINT NOT NULL,
    "buy_currency" TEXT NOT NULL,
    "buy_minor_units" BIGINT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "fx_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "response_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "partition" TEXT NOT NULL,
    "owner_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transaction" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ledger_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "memo" TEXT,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_balance_snapshot" (
    "account_id" TEXT NOT NULL,
    "minor_units" BIGINT NOT NULL,
    "through_sequence" BIGINT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_balance_snapshot_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "prefunding_request" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "float_account_code" TEXT NOT NULL,
    "treasury_account_code" TEXT NOT NULL,
    "status" "PrefundingStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "executed_at" TIMESTAMP(3),
    "ledger_transaction_id" TEXT,

    CONSTRAINT "prefunding_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "float_threshold" (
    "currency" TEXT NOT NULL,
    "low_watermark_minor_units" BIGINT NOT NULL,
    "target_minor_units" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "float_threshold_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "partner_statement" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_line" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "value_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "statement_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_run" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_count" INTEGER NOT NULL,
    "break_count" INTEGER NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suspense_item" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_minor_units" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    "ledger_transaction_id" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "suspense_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_message" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partition_ru"."sender_profile" (
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
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_ng"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateTable
CREATE TABLE "partition_gh"."recipient_profile" (
    "pii_token" TEXT NOT NULL,
    "msisdn" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_profile_pkey" PRIMARY KEY ("pii_token")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_pii_token_key" ON "app_user"("pii_token");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_token_token_hash_key" ON "email_verification_token"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_token_user_id_idx" ON "email_verification_token"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_family_id_idx" ON "session"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_email_key" ON "staff_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_session_token_hash_key" ON "staff_session"("token_hash");

-- CreateIndex
CREATE INDEX "staff_session_staff_id_idx" ON "staff_session"("staff_id");

-- CreateIndex
CREATE INDEX "staff_session_family_id_idx" ON "staff_session"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_hash_key" ON "audit_event"("hash");

-- CreateIndex
CREATE INDEX "audit_event_subject_type_subject_id_idx" ON "audit_event"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_idx" ON "audit_event"("actor_id");

-- CreateIndex
CREATE INDEX "kyc_case_user_id_idx" ON "kyc_case"("user_id");

-- CreateIndex
CREATE INDEX "kyc_case_status_idx" ON "kyc_case"("status");

-- CreateIndex
CREATE INDEX "screening_record_transfer_id_idx" ON "screening_record"("transfer_id");

-- CreateIndex
CREATE INDEX "screening_record_subject_ref_idx" ON "screening_record"("subject_ref");

-- CreateIndex
CREATE INDEX "compliance_case_status_idx" ON "compliance_case"("status");

-- CreateIndex
CREATE INDEX "compliance_case_transfer_id_idx" ON "compliance_case"("transfer_id");

-- CreateIndex
CREATE INDEX "compliance_case_note_case_id_idx" ON "compliance_case_note"("case_id");

-- CreateIndex
CREATE INDEX "rate_observation_base_currency_quote_currency_observed_at_idx" ON "rate_observation"("base_currency", "quote_currency", "observed_at");

-- CreateIndex
CREATE INDEX "quote_user_id_idx" ON "quote"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipient_pii_token_key" ON "recipient"("pii_token");

-- CreateIndex
CREATE INDEX "recipient_user_id_idx" ON "recipient"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_reference_key" ON "transfer"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_quote_id_key" ON "transfer"("quote_id");

-- CreateIndex
CREATE INDEX "transfer_user_id_idx" ON "transfer"("user_id");

-- CreateIndex
CREATE INDEX "transfer_state_idx" ON "transfer"("state");

-- CreateIndex
CREATE INDEX "transfer_next_poll_at_idx" ON "transfer"("next_poll_at");

-- CreateIndex
CREATE INDEX "transfer_event_transfer_id_idx" ON "transfer_event"("transfer_id");

-- CreateIndex
CREATE INDEX "fx_position_closed_at_idx" ON "fx_position"("closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_scope_key_key" ON "idempotency_record"("scope", "key");

-- CreateIndex
CREATE INDEX "webhook_event_expires_at_idx" ON "webhook_event"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_provider_id_event_id_key" ON "webhook_event"("provider_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_code_key" ON "ledger_account"("code");

-- CreateIndex
CREATE INDEX "ledger_account_type_currency_idx" ON "ledger_account"("type", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transaction_idempotency_key_key" ON "ledger_transaction"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transaction_reference_idx" ON "ledger_transaction"("reference");

-- CreateIndex
CREATE INDEX "ledger_transaction_reason_idx" ON "ledger_transaction"("reason");

-- CreateIndex
CREATE INDEX "ledger_entry_account_id_sequence_idx" ON "ledger_entry"("account_id", "sequence");

-- CreateIndex
CREATE INDEX "ledger_entry_transaction_id_idx" ON "ledger_entry"("transaction_id");

-- CreateIndex
CREATE INDEX "prefunding_request_status_idx" ON "prefunding_request"("status");

-- CreateIndex
CREATE INDEX "statement_line_statement_id_idx" ON "statement_line"("statement_id");

-- CreateIndex
CREATE INDEX "statement_line_provider_ref_idx" ON "statement_line"("provider_ref");

-- CreateIndex
CREATE INDEX "suspense_item_resolved_at_idx" ON "suspense_item"("resolved_at");

-- CreateIndex
CREATE INDEX "outbox_message_sent_at_idx" ON "outbox_message"("sent_at");

-- AddForeignKey
ALTER TABLE "email_verification_token" ADD CONSTRAINT "email_verification_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_case" ADD CONSTRAINT "kyc_case_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screening_record" ADD CONSTRAINT "screening_record_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_case" ADD CONSTRAINT "compliance_case_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_case_note" ADD CONSTRAINT "compliance_case_note_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "compliance_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_corridor_id_fkey" FOREIGN KEY ("corridor_id") REFERENCES "corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient" ADD CONSTRAINT "recipient_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_corridor_id_fkey" FOREIGN KEY ("corridor_id") REFERENCES "corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_event" ADD CONSTRAINT "transfer_event_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_position" ADD CONSTRAINT "fx_position_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_balance_snapshot" ADD CONSTRAINT "ledger_balance_snapshot_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "partner_statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_run" ADD CONSTRAINT "reconciliation_run_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "partner_statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
