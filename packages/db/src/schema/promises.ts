import { pgTable, text, timestamp, uuid, integer, real, pgEnum, index } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { cases } from "./cases.js";

export const promiseStateEnum = pgEnum("promise_state", ["open", "kept", "broken", "cancelled"]);

// Holding a commitment as state is what stops the ladder climbing over someone
// who already answered.
export const promises = pgTable(
  "promises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    state: promiseStateEnum("state").notNull().default("open"),
    amountMinor: integer("amount_minor"),
    promisedFor: timestamp("promised_for", { withTimezone: true }).notNull(),
    confidence: real("confidence").notNull(),
    sourceText: text("source_text").notNull(),
    model: text("model"),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("promises_open_due_idx").on(table.state, table.promisedFor)],
);
