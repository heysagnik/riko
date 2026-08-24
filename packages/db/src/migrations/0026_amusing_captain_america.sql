ALTER TABLE "sender_identities" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "exposures" ADD COLUMN "provider_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exposures" ADD COLUMN "failure_category" "failure_category";