import { useQuery } from "@tanstack/react-query";

export interface UnmappedCodeRow {
  providerId: string;
  failureCode: string | null;
  failureCategory: string;
  failureRecoverable: boolean;
  mapped: boolean;
  occurrences: number;
  amountMinor: number;
  lastSeen: string;
}

async function fetchUnmappedCodes(): Promise<{ unmapped: UnmappedCodeRow[] }> {
  const response = await fetch("/api/failure-codes/unmapped");
  if (!response.ok) {
    throw new Error(`Failed to load unmapped codes: ${response.status}`);
  }
  return response.json();
}

export function useUnmappedCodes() {
  return useQuery({
    queryKey: ["failure-codes", "unmapped"],
    queryFn: fetchUnmappedCodes,
  });
}
