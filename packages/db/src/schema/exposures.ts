import { pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { connections } from "./connections.js";
import { customers } from "./customers.js";
import { payments, failureCategoryEnum } from "./payments.js";

export const exposureKindEnum = pgEnum("exposure_kind", [
  "payment_failure",
  "checkout_abandonment",
  "overdue_receivable",
]);

export const exposures = pgTable(
  "exposures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    kind: exposureKindEnum("kind").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    sourceRef: text("source_ref").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    providerRetryAt: timestamp("provider_retry_at", { withTimezone: true }),
    failureCategory: failureCategoryEnum("failure_category"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    raw: jsonb("raw"),
  },
  (table) => [
    uniqueIndex("exposures_source_uidx").on(table.tenantId, table.kind, table.sourceRef),
    index("exposures_due_idx").on(table.kind, table.dueAt),
  ],
);
