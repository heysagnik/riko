ALTER TABLE "sender_identities" ADD COLUMN "outreach_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sender_identities" ADD COLUMN "daily_send_cap" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "bounced_at" timestamp with time zone;