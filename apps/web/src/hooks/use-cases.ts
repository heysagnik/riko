import { useQuery } from "@tanstack/react-query";
import type { CaseUiState } from "../components/case-row.js";
import { ACTIVE_STATES, ACTIVE_POLL_MS, WAITING_POLL_MS } from "../lib/case-states.js";

interface CaseRowResponse {
  id: string;
  state: CaseUiState;
  attemptCount: number;
  openedAt: string;
  closedReason: string | null;
  recoveredAmountMinor: number | null;
  customerName: string | null;
  amountMinor: number | null;
  currency: string | null;
  intervention: string | null;
  interventionReason: string | null;
  failureCategory: string | null;
  failureSource: string | null;
  arm: string | null;
}

export interface CaseListResponse {
  cases: CaseRowResponse[];
  total: number;
  counts: Record<string, number>;
  offset: number;
  limit: number;
}

const PAGE_SIZE = 50;

async function fetchCases(state: string, offset: number, from?: string, to?: string): Promise<CaseListResponse> {
  const params = new URLSearchParams({ state, offset: String(offset), limit: String(PAGE_SIZE) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const response = await fetch(`/api/cases?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to load cases: ${response.status}`);
  }
  return response.json();
}

export function useCases(state = "ALL", offset = 0, from?: string, to?: string) {
  return useQuery({
    queryKey: ["cases", state, offset, from, to],
    queryFn: () => fetchCases(state, offset, from, to),
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const rows = query.state.data?.cases;
      if (!rows) return ACTIVE_POLL_MS;
      return rows.some((row) => ACTIVE_STATES.has(row.state)) ? ACTIVE_POLL_MS : WAITING_POLL_MS;
    },
  });
}

export { PAGE_SIZE };

export function ageLabelFromDate(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "now";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

export function formatAmount(amountMinor: number | null | undefined, currency: string | null = "inr"): string {
  if (amountMinor === null || amountMinor === undefined) {
    return "—";
  }
  const code = (currency ?? "inr").toLowerCase();
  const locale = code === "inr" ? "en-IN" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}
