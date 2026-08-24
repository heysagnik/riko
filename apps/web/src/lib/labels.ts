export const FAILURE_LABEL: Record<string, string> = {
  insufficient_funds: "Not enough balance",
  expired_card: "Card expired",
  authentication_required: "Bank needs approval",
  bank_decline: "Bank declined",
  network_error: "Gateway fault",
  invalid_instrument: "Card unusable",
  unknown: "Unclassified",
};

export const INTERVENTION_LABEL: Record<string, string> = {
  outreach_email: "Emailed customer",
  wait_until: "Waiting",
  no_action_provider_retrying: "Left to provider",
  escalate_human: "Sent to a human",
  stop_never_contact: "Never contact",
};

export const INTERVENTION_TONE: Record<string, "accent" | "waiting" | "skipped" | "lost" | "default"> = {
  outreach_email: "accent",
  wait_until: "waiting",
  no_action_provider_retrying: "skipped",
  escalate_human: "lost",
  stop_never_contact: "lost",
};

export const REASON_LABEL: Record<string, string> = {
  transient_fault_card_is_healthy: "Card is fine, gateway blipped",
  hold_until_shortly_before_provider_retry: "Holding until just before the provider retries",
  await_salary_window: "Waiting for the salary window",
  soft_decline_may_clear: "Soft decline may clear on its own",
  fraud_signal: "Fraud flag on the card",
  above_human_review_threshold: "Above the review threshold",
  unmapped_failure_code: "Failure code not recognised",
  merchant_configuration_fault: "Your account configuration",
  holdout_control_group: "Held back as control",
  no_deliverable_email: "No usable email address",
  unsubscribed_or_bounced: "Unsubscribed or bounced",
  no_verified_sender: "No verified sender configured",
  attempts_exhausted: "Attempt limit reached",
  cooldown_not_elapsed: "Still inside the cooldown window",
  not_recoverable: "Not recoverable",
  payment_too_old: "Payment too old to chase",
  tenant_paused_or_capped: "Sending paused or capped",
  validation_failed_3x: "Draft failed checks three times",
  payment_succeeded: "Customer paid",
  recovered_without_contact: "Paid without us contacting them",
  customer_reply: "Customer replied",
  hard_bounce: "Email hard-bounced",
  customer_unsubscribed: "Customer unsubscribed",
  batch_reset: "Cleared by a batch run",
  agent_answered: "Riko answered the customer",
  agent_reply_limit_reached: "Handed over after too many replies",
  promise_to_pay: "Customer promised to pay",
  reply_after_promise: "Customer wrote again after promising",
  promise_broken: "Promise date passed unpaid",
};

export const INTENT_LABEL: Record<string, string> = {
  promise_to_pay: "Promised to pay",
  already_paid: "Says already paid",
  question: "Asked a question",
  needs_more_time: "Needs more time",
  payment_problem: "Payment did not work",
  dispute: "Disputes the charge",
  unsubscribe: "Asked to stop",
  hostile: "Hostile",
  other: "Other",
};

export function intentLabel(intent: string | null | undefined): string {
  if (!intent) return "—";
  return INTENT_LABEL[intent] ?? humanise(intent);
}

function humanise(slug: string): string {
  const words = slug.replace(/[_:]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function failureLabel(category: string | null | undefined): string {
  if (!category) return "—";
  return FAILURE_LABEL[category] ?? humanise(category);
}

export function interventionLabel(kind: string | null | undefined): string {
  if (!kind) return "Not yet decided";
  return INTERVENTION_LABEL[kind] ?? humanise(kind);
}

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  const base = reason.includes(":") ? reason.slice(reason.indexOf(":") + 1) : reason;
  return REASON_LABEL[base] ?? REASON_LABEL[reason] ?? humanise(base);
}

export const REASON_DESCRIPTION: Record<string, string> = {
  merchant_configuration_fault:
    "The payment provider reported an account or gateway setup issue. Automated outreach was paused to avoid incorrectly blaming the customer.",
  above_human_review_threshold:
    "The payment amount at stake exceeds your automated outreach threshold and requires human review.",
  unmapped_failure_code:
    "The payment failed with an unrecognised provider error code. Paused for human review.",
  soft_decline_may_clear:
    "Temporary bank decline. Outreach is held to give the card time to clear on its own.",
  transient_fault_card_is_healthy:
    "Gateway or network blip with a healthy card. Left for provider automatic retry.",
  hold_until_shortly_before_provider_retry:
    "Holding outreach until right before the gateway's scheduled retry attempt.",
  await_salary_window:
    "Holding outreach until the customer's typical salary window.",
  fraud_signal:
    "High risk or fraud signal detected on the card instrument. Customer will not be contacted.",
  holdout_control_group:
    "Randomly assigned to the control group to measure automated recovery lift.",
  no_deliverable_email:
    "Customer has no usable email address on file.",
  unsubscribed_or_bounced:
    "Customer previously unsubscribed or email address bounced.",
  no_verified_sender:
    "No verified sender identity or SMTP configured in Settings.",
  attempts_exhausted:
    "Maximum outreach attempt limit reached for this case.",
  validation_failed_3x:
    "Drafted emails did not satisfy quality and safety checks after 3 attempts.",
  agent_reply_limit_reached:
    "Reached the maximum automated reply threshold for this thread. Handed over to you.",
  payment_succeeded:
    "Customer paid and the transaction was confirmed by the payment gateway.",
  recovered_without_contact:
    "Customer resolved the payment without requiring automated contact.",
  hard_bounce:
    "Outreach email hard-bounced and could not be delivered.",
  customer_unsubscribed:
    "Customer opted out of further recovery emails.",
  returned_by_merchant:
    "Merchant released the case back to Riko for automated outreach.",
};

export function reasonDescription(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const base = reason.includes(":") ? reason.slice(reason.indexOf(":") + 1) : reason;
  return REASON_DESCRIPTION[base] ?? REASON_DESCRIPTION[reason] ?? null;
}

