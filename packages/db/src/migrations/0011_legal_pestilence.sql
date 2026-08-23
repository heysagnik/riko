ALTER TABLE "case_events" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "case_events" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "case_events" ADD COLUMN "hash" text;--> statement-breakpoint
CREATE INDEX "case_events_case_seq_idx" ON "case_events" USING btree ("case_id","seq");--> statement-breakpoint
-- ADD COLUMN numbers existing rows in physical order. Renumber by created_at so
-- the chain backfill walks each case's history in the order it actually happened.
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "case_events"
)
UPDATE "case_events" SET "seq" = ordered.rn FROM ordered WHERE "case_events"."id" = ordered."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('case_events', 'seq'), COALESCE((SELECT MAX("seq") FROM "case_events"), 1));