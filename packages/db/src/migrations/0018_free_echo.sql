ALTER TABLE "outreach" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "scheduled_for" timestamp with time zone;