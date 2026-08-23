import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { connections } from "./connections.js";
import { customers } from "./customers.js";

export const paymentStatusEnum = pgEnum("payment_status", [
  "failed",
  "succeeded",
  "subscription_ended",
]);

export const failureCategoryEnum = pgEnum("failure_category", [
  "insufficient_funds",
  "expired_card",
  "authentication_required",
  "bank_decline",
  "network_error",
  "invalid_instrument",
  "unknown",
]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  providerPaymentId: text("provider_payment_id").notNull(),
  providerCorrelationId: text("provider_correlation_id"),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: paymentStatusEnum("status").notNull(),
  failureCode: text("failure_code"),
  failureCategory: failureCategoryEnum("failure_category").notNull().default("unknown"),
  failureSource: text("failure_source"),
  failureRecoverable: boolean("failure_recoverable").notNull().default(false),
  providerRetryAt: timestamp("provider_retry_at", { withTimezone: true }),
  isRecurring: boolean("is_recurring").notNull().default(true),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  raw: jsonb("raw"),
});

export const failureCodeMap = pgTable(
  "failure_code_map",
  {
    providerId: text("provider_id").notNull(),
    providerCode: text("provider_code").notNull(),
    failureCategory: failureCategoryEnum("failure_category").notNull(),
    recoverable: boolean("recoverable").notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.providerId, table.providerCode] })],
);
