-- Sender-facing product surface (BUILD_PLAN 14).
--
-- Notifications, standing instructions, rate alerts and support correspondence.
-- None of these tables holds financial state: no balances, no postings, and
-- nothing here is a writer to the ledger. A schedule prepares a transfer and a
-- transfer still goes through every control it would have gone through by hand.

CREATE TABLE "public"."user_notification" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "title"      TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "link"       TEXT,
  "read_at"    TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "user_notification_user_id_read_at_idx" ON "public"."user_notification" ("user_id", "read_at");
CREATE INDEX "user_notification_user_id_created_at_idx" ON "public"."user_notification" ("user_id", "created_at");
ALTER TABLE "public"."user_notification"
  ADD CONSTRAINT "user_notification_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."transfer_schedule" (
  "id"               TEXT NOT NULL,
  "user_id"          TEXT NOT NULL,
  "corridor_id"      TEXT NOT NULL,
  "recipient_id"     TEXT NOT NULL,
  "send_minor_units" BIGINT NOT NULL,
  "send_currency"    TEXT NOT NULL,
  "payin_method"     TEXT NOT NULL,
  "purpose"          TEXT NOT NULL,
  "frequency"        TEXT NOT NULL,
  "day_of_period"    INTEGER NOT NULL,
  "next_run_at"      TIMESTAMP(3) NOT NULL,
  "last_run_at"      TIMESTAMP(3),
  "last_failure"     TEXT,
  "occurrences"      INTEGER NOT NULL DEFAULT 0,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transfer_schedule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "transfer_schedule_active_next_run_at_idx" ON "public"."transfer_schedule" ("active", "next_run_at");
CREATE INDEX "transfer_schedule_user_id_idx" ON "public"."transfer_schedule" ("user_id");
ALTER TABLE "public"."transfer_schedule"
  ADD CONSTRAINT "transfer_schedule_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."transfer_schedule"
  ADD CONSTRAINT "transfer_schedule_corridor_id_fkey"
  FOREIGN KEY ("corridor_id") REFERENCES "public"."corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."transfer_schedule"
  ADD CONSTRAINT "transfer_schedule_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "public"."recipient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "public"."rate_alert" (
  "id"             TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "corridor_id"    TEXT NOT NULL,
  "direction"      TEXT NOT NULL,
  -- A decimal string, never a float. Rates are compared, not summed, but the
  -- rule is the rule: no floating point anywhere near money.
  "threshold_rate" TEXT NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "triggered_at"   TIMESTAMP(3),
  "triggered_rate" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rate_alert_active_corridor_id_idx" ON "public"."rate_alert" ("active", "corridor_id");
CREATE INDEX "rate_alert_user_id_idx" ON "public"."rate_alert" ("user_id");
ALTER TABLE "public"."rate_alert"
  ADD CONSTRAINT "rate_alert_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."rate_alert"
  ADD CONSTRAINT "rate_alert_corridor_id_fkey"
  FOREIGN KEY ("corridor_id") REFERENCES "public"."corridor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "public"."support_thread" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'OPEN',
  "transfer_id" TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "support_thread_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_thread_user_id_idx" ON "public"."support_thread" ("user_id");
CREATE INDEX "support_thread_status_updated_at_idx" ON "public"."support_thread" ("status", "updated_at");
ALTER TABLE "public"."support_thread"
  ADD CONSTRAINT "support_thread_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "public"."support_message" (
  "id"          TEXT NOT NULL,
  "thread_id"   TEXT NOT NULL,
  "author_type" TEXT NOT NULL,
  "author_id"   TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_message_thread_id_created_at_idx" ON "public"."support_message" ("thread_id", "created_at");
ALTER TABLE "public"."support_message"
  ADD CONSTRAINT "support_message_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "public"."support_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
