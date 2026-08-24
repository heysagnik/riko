import { pgTable, text, timestamp, uuid, integer, bigserial, boolean, index, pgEnum } from "drizzle-orm/pg-core";
import { organization } from "./auth.js";
import { exposures } from "./exposures.js";
import { customers } from "./customers.js";

export const caseStateEnum = pgEnum("case_state", [
  "NEW",
  "SKIPPED",
  "DRAFTING",
  "SENDING",
  "WAITING",
  "PROMISED",
  "RECOVERED",
  "ESCALATED",
  "LOST",
]);

export const caseActorEnum = pgEnum("case_actor", ["system", "agent", "merchant"]);

export const cases = pgTable(
  "cases",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  exposureId: uuid("exposure_id").notNull().references(() => exposures.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  state: caseStateEnum("state").notNull().default("NEW"),
  attemptCount: integer("attempt_count").notNull().default(0),
  // Separate from attemptCount so a chatty customer cannot loop forever.
  agentReplyCount: integer("agent_reply_count").notNull().default(0),
  awaitingAgentReply: boolean("awaiting_agent_reply").notNull().default(false),
  nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  intervention: text("intervention"),
  interventionReason: text("intervention_reason"),
  // Tone the policy engine authorised for this attempt; the validator enforces it.
  rung: text("rung"),
  arm: text("arm").notNull().default("treatment"),
  humanReviewedAt: timestamp("human_reviewed_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedReason: text("closed_reason"),
  recoveredAmountMinor: integer("recovered_amount_minor"),
  },
  (table) => [
    index("cases_tenant_opened_idx").on(table.tenantId, table.openedAt),
    index("cases_tenant_state_idx").on(table.tenantId, table.state),
  ],
);

export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // createdAt ties on fast transitions; a chain needs one unambiguous predecessor.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    tenantId: text("tenant_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    fromState: caseStateEnum("from_state"),
    toState: caseStateEnum("to_state").notNull(),
    reason: text("reason"),
    actor: caseActorEnum("actor").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    prevHash: text("prev_hash"),
    hash: text("hash"),
  },
  (table) => [index("case_events_case_seq_idx").on(table.caseId, table.seq)],
);
