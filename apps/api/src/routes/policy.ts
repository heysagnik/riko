import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, withTenant, senderIdentities } from "@riko/db";
import { describePolicyLimits } from "@riko/core";
import { requireTenant } from "../middleware/require-tenant.js";

export const policyRouter = Router();

const STOPPING_RULES = [
  { id: "payment_succeeded", label: "The money arrives", detail: "Any successful payment closes the case immediately, from any state." },
  { id: "customer_unsubscribed", label: "The customer opts out", detail: "One click in the email footer. Every open case for them closes." },
  { id: "hard_bounce", label: "The address is dead", detail: "A hard bounce suppresses the address rather than retrying it." },
  { id: "customer_suppressed", label: "A person flags them", detail: "DND, an open dispute, or signs of distress stop contact outright." },
  { id: "fraud_signal", label: "The decline looks like fraud", detail: "Never contacted. Chasing a stolen card helps nobody." },
  { id: "attempts_exhausted", label: "Three emails, no reply", detail: "The case is marked lost rather than escalated further." },
  { id: "customer_reply", label: "The customer writes back", detail: "Unless it contains a clear promise to pay, a person reads it next." },
  { id: "promise_to_pay", label: "The customer commits to a date", detail: "The ladder pauses until that date rather than climbing." },
  { id: "tenant_paused", label: "Opt-outs spike", detail: "Outreach pauses automatically across the whole tenant." },
];

const ESCALATION_LADDER = [
  { rung: "L0", channel: "Nothing", entry: "Transient gateway or network fault", detail: "The provider is already retrying. Contact would only confuse." },
  { rung: "L1", channel: "Timed wait", entry: "Insufficient funds, or a soft decline", detail: "Held to the salary window, or 24h for a decline that may clear itself." },
  { rung: "L2", channel: "Email", entry: "Only the customer can fix it", detail: "One email, written to the tone the policy engine authorised." },
  { rung: "L3", channel: "Email, firmer", entry: "An invoice 7 days past its terms", detail: "Direct and businesslike. Threats are rejected by the validator." },
  { rung: "L4", channel: "Email, formal", entry: "An invoice 21 days past its terms", detail: "A matter of record. Still no threat of legal action or collections." },
  { rung: "L5", channel: "A person", entry: "High value, a dispute, or 30 days overdue", detail: "The agent stops and hands over. It never escalates past this." },
];

policyRouter.get("/policy", requireTenant, async (req, res) => {
  const tenantId = req.tenant!.tenantId;

  const [sender] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ paused: senderIdentities.outreachPaused, dailySendCap: senderIdentities.dailySendCap })
      .from(senderIdentities)
      .where(eq(senderIdentities.tenantId, tenantId))
      .limit(1),
  );

  res.json({
    limits: [
      ...describePolicyLimits(),
      { id: "daily_cap", label: "Emails per day", value: String(sender?.dailySendCap ?? 500), group: "budget" },
    ],
    stoppingRules: STOPPING_RULES,
    ladder: ESCALATION_LADDER,
    outreachPaused: sender?.paused ?? false,
  });
});
