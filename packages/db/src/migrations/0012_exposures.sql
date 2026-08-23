CREATE TYPE "public"."exposure_kind" AS ENUM('payment_failure', 'checkout_abandonment', 'overdue_receivable');--> statement-breakpoint
CREATE TABLE "exposures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "exposure_kind" NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"source_ref" text NOT NULL,
	"payment_id" uuid,
	"due_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "exposure_id" uuid;--> statement-breakpoint
ALTER TABLE "exposures" ADD CONSTRAINT "exposures_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposures" ADD CONSTRAINT "exposures_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposures" ADD CONSTRAINT "exposures_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposures" ADD CONSTRAINT "exposures_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exposures_source_uidx" ON "exposures" USING btree ("tenant_id","kind","source_ref");--> statement-breakpoint
CREATE INDEX "exposures_due_idx" ON "exposures" USING btree ("kind","due_at");--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_exposure_id_exposures_id_fk" FOREIGN KEY ("exposure_id") REFERENCES "public"."exposures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exposures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "exposures" USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));--> statement-breakpoint
-- Every existing case was opened by a failed payment. Lift each one into the
-- exposure it always was, so history reads the same through the new join.
INSERT INTO "exposures" ("tenant_id", "connection_id", "customer_id", "kind", "amount_minor", "currency", "source_ref", "payment_id", "occurred_at")
SELECT p."tenant_id", p."connection_id", p."customer_id", 'payment_failure', p."amount_minor", p."currency", p."provider_payment_id", p."id", p."occurred_at"
FROM "payments" p
WHERE EXISTS (SELECT 1 FROM "cases" c WHERE c."payment_id" = p."id")
ON CONFLICT ("tenant_id", "kind", "source_ref") DO NOTHING;--> statement-breakpoint
UPDATE "cases" c SET "exposure_id" = e."id" FROM "exposures" e WHERE e."payment_id" = c."payment_id" AND c."exposure_id" IS NULL;
