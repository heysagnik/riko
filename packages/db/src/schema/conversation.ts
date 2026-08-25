import { pgTable, text, timestamp, uuid, integer, index, pgEnum, real } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { cases } from "./cases.js";

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

export const caseMessages = pgTable(
  "case_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    direction: messageDirectionEnum("direction").notNull(),
    body: text("body").notNull(),
    subject: text("subject"),
    intent: text("intent"),
    confidence: real("confidence"),
    rationale: text("rationale"),
    providerMessageId: text("provider_message_id"),
    seq: integer("seq").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("case_messages_case_seq_idx").on(table.caseId, table.seq)],
);
