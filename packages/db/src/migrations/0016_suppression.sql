ALTER TABLE "customers" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "suppression_reason" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "timezone" text;