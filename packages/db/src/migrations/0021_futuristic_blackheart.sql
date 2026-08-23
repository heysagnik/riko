DELETE FROM "connections" WHERE "status" = 'revoked' OR "provider_id" = 'stripe';--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'active'::text;--> statement-breakpoint
DROP TYPE "public"."connection_status";--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'expired', 'error');--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."connection_status";--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "status" SET DATA TYPE "public"."connection_status" USING "status"::"public"."connection_status";--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "provider_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "provider_id" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."provider_id";--> statement-breakpoint
CREATE TYPE "public"."provider_id" AS ENUM('razorpay');--> statement-breakpoint
ALTER TABLE "connections" ALTER COLUMN "provider_id" SET DATA TYPE "public"."provider_id" USING "provider_id"::"public"."provider_id";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "provider_id" SET DATA TYPE "public"."provider_id" USING "provider_id"::"public"."provider_id";