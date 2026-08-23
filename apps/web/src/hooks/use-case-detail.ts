import { useQuery } from "@tanstack/react-query";
import type { CaseUiState } from "../components/case-row.js";
import { ACTIVE_STATES, CLOSED_STATES, ACTIVE_POLL_MS, WAITING_POLL_MS } from "../lib/case-states.js";

interface CaseEventRow {
  id: string;
  fromState: CaseUiState | null;
  toState: CaseUiState;
  reason: string | null;
  actor: string;
  createdAt: string;
}

interface AgentActionRow {
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  model: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface CaseMessageRow {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  subject: string | null;
  intent: string | null;
  confidence: number | null;
  rationale: string | null;
  seq: number;
  createdAt: string;
}

interface ScheduledDraft {
  id: string;
  subject: string;
  body: string;
  scheduledFor: string | null;
  createdAt: string;
}

interface CustomerFacts {
  id: string;
  name: string | null;
  emailEncrypted: string;
  locale: string | null;
}

interface PaymentFacts {
  id: string;
  amountMinor: number;
  currency: string;
  failureCategory: string;
  failureCode: string | null;
  failureSource: string | null;
  providerRetryAt: string | null;
  occurredAt: string;
}

interface CaseDetail {
  case: {
    id: string;
    state: CaseUiState;
    closedReason: string | null;
    closedAt: string | null;
    openedAt: string;
    attemptCount: number;
    intervention: string | null;
    interventionReason: string | null;
    arm: string | null;
    nextActionAt: string | null;
  };
  events: CaseEventRow[];
  actions: AgentActionRow[];
  messages: CaseMessageRow[];
  scheduledDraft: ScheduledDraft | null;
  customer: CustomerFacts | null;
  payment: PaymentFacts | null;
  chain: {
    valid: boolean;
    eventCount: number;
    unhashedCount: number;
    brokenAtSeq: number | null;
  };
}

async function fetchCaseDetail(caseId: string): Promise<CaseDetail> {
  const response = await fetch(`/api/cases/${caseId}`);
  if (!response.ok) {
    throw new Error(`Failed to load case: ${response.status}`);
  }
  return response.json();
}

export function useCaseDetail(caseId: string) {
  return useQuery({
    queryKey: ["cases", caseId],
    queryFn: () => fetchCaseDetail(caseId),
    enabled: Boolean(caseId),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const state = query.state.data?.case.state;
      if (!state) return ACTIVE_POLL_MS;
      if (CLOSED_STATES.has(state)) return false;
      return ACTIVE_STATES.has(state) ? ACTIVE_POLL_MS : WAITING_POLL_MS;
    },
  });
}

export type { CaseDetail, CaseEventRow, AgentActionRow, CaseMessageRow, ScheduledDraft };
