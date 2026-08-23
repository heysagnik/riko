ALTER TABLE "payments" ADD COLUMN "failure_source" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "intervention" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "intervention_reason" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "arm" text DEFAULT 'treatment' NOT NULL;