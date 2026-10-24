-- Delivery attempts on the mail outbox.
--
-- Two jobs in one column: it bounds retries, and it is the optimistic lock the
-- delivery worker claims a message with — a conditional update on the value it
-- read means two API instances cannot both send the same message.
ALTER TABLE "public"."outbox_message" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- The worker's query is "undelivered, not exhausted, oldest first".
CREATE INDEX "outbox_message_pending_idx"
  ON "public"."outbox_message" ("sent_at", "attempts", "created_at");
