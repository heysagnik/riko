import { useQuery } from "@tanstack/react-query";

export interface Tally {
  key: string;
  count: number;
  amountMinor: number;
}

export interface Exception {
  caseId: string;
  state: string;
  reason: string | null;
  amountMinor: number;
  failureCategory: string;
}

export interface Metrics {
  windowDays: number;
  currency: string;

  totalCases: number;
  atRiskMinor: number;

  recoveredCount: number;
  recoveredAmountMinor: number;
  recoveryRate: number;

  attributedCount: number;
  attributedAmountMinor: number;
  selfHealedCount: number;
  selfHealedAmountMinor: number;

  contactedCount: number;
  suppressedCount: number;
  suppressedAmountMinor: number;

  lift: {
    treatmentRate: number | null;
    holdoutRate: number | null;
    treatmentCount: number;
    holdoutCount: number;
    incrementalPoints: number | null;
    minArmSize: number;
    significant: boolean;
  };

  economics: {
    sendCount: number;
    costPerSendMinor: number;
    costMinor: number;
    netRecoveredMinor: number;
    netAttributedMinor: number;
    costPerRecoveredMinor: number;
    incentiveSpendMinor: number;
  };

  harm: {
    customerCount: number;
    unsubscribedCount: number;
    bouncedCount: number;
    unsubscribeRate: number;
    bounceRate: number;
  };

  interventions: Tally[];
  suppressionReasons: Tally[];
  failureCategories: Tally[];
  exceptions: Exception[];
}

async function fetchMetrics(): Promise<Metrics> {
  const response = await fetch("/api/metrics");
  if (!response.ok) {
    throw new Error(`Failed to load metrics: ${response.status}`);
  }
  return response.json();
}

export function useMetrics() {
  return useQuery({ queryKey: ["metrics"], queryFn: fetchMetrics });
}
