import { useQuery } from "@tanstack/react-query";

export interface PolicyLimit {
  id: string;
  label: string;
  value: string;
  group: "budget" | "temporal" | "compliance";
}

export interface StoppingRule {
  id: string;
  label: string;
  detail: string;
}

export interface LadderRung {
  rung: string;
  channel: string;
  entry: string;
  detail: string;
}

export interface Policy {
  limits: PolicyLimit[];
  stoppingRules: StoppingRule[];
  ladder: LadderRung[];
  outreachPaused: boolean;
}

async function fetchPolicy(): Promise<Policy> {
  const response = await fetch("/api/policy");
  if (!response.ok) {
    throw new Error(`Failed to load policy: ${response.status}`);
  }
  return response.json();
}

export function usePolicy() {
  return useQuery({ queryKey: ["policy"], queryFn: fetchPolicy });
}
