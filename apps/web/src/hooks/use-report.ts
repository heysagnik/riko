import { useQuery } from "@tanstack/react-query";

export interface ReportCaseRow {
  caseId: string;
  state: string;
  arm: string;
  intervention: string | null;
  interventionReason: string | null;
  closedReason: string | null;
  amountMinor: number;
  currency: string;
  recoveredAmountMinor: number | null;
  failureCategory: string | null;
  attemptCount: number;
  customerName: string | null;
  openedAt: string;
  closedAt: string | null;
  sentCount: number;
  clicked: boolean;
}

export interface ReportResponse {
  windowDays: number;
  generatedAt: string;
  totals: {
    cases: number;
    atRiskMinor: number;
    recoveredCount: number;
    recoveredAmountMinor: number;
    attributedCount: number;
    attributedAmountMinor: number;
    selfHealedCount: number;
    emailsSent: number;
  };
  lift: {
    treatmentRate: number | null;
    holdoutRate: number | null;
    treatmentCount: number;
    holdoutCount: number;
    incrementalPoints: number | null;
    significant: boolean;
  };
  exceptions: { caseId: string; state: string; reason: string | null; amountMinor: number }[];
  cases: ReportCaseRow[];
}

async function fetchReport(windowDays: number): Promise<ReportResponse> {
  const response = await fetch(`/api/report?windowDays=${windowDays}`);
  if (!response.ok) {
    throw new Error(`Failed to load report: ${response.status}`);
  }
  return response.json();
}

export function useReport(windowDays = 30) {
  return useQuery({
    queryKey: ["report", windowDays],
    queryFn: () => fetchReport(windowDays),
  });
}

export function reportCsvUrl(windowDays: number): string {
  return `/api/report?windowDays=${windowDays}&format=csv`;
}
