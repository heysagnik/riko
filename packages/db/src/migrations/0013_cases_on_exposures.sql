ALTER TABLE "cases" DROP CONSTRAINT "cases_payment_id_payments_id_fk";
--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "exposure_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "payment_id";