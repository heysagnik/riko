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
};

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
