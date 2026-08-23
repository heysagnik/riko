export const ACTIVE_STATES: ReadonlySet<string> = new Set(["NEW", "DRAFTING", "SENDING"]);
export const CLOSED_STATES: ReadonlySet<string> = new Set([
  "RECOVERED",
  "LOST",
  "SKIPPED",
  "ESCALATED",
]);

export const ACTIVE_POLL_MS = 2_000;
export const WAITING_POLL_MS = 15_000;
