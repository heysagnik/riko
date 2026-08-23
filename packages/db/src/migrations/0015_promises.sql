CREATE TYPE "public"."promise_state" AS ENUM('open', 'kept', 'broken', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."case_state" ADD VALUE 'PROMISED' BEFORE 'RECOVERED';--> statement-breakpoint
CREATE TABLE "promises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"case_id" uuid NOT NULL,
	"state" "promise_state" DEFAULT 'open' NOT NULL,
	"amount_minor" integer,
	"promised_for" timestamp with time zone NOT NULL,
	"confidence" real NOT NULL,
	"source_text" text NOT NULL,
	"model" text,
	"reminded_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promises" ADD CONSTRAINT "promises_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promises_open_due_idx" ON "promises" USING btree ("state","promised_for");--> statement-breakpoint
ALTER TABLE "promises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "promises" USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
