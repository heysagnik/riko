import { useQuery } from "@tanstack/react-query";

export interface ReviewRow {
  outreachId: string;
  caseId: string;
  subject: string;
  body: string;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  customerName: string | null;
  amountMinor: number;
  currency: string;
}

async function fetchReviews(): Promise<{ reviews: ReviewRow[] }> {
  const response = await fetch("/api/reviews");
  if (!response.ok) {
    throw new Error(`Failed to load reviews: ${response.status}`);
  }
  return response.json();
}

export function useReviews() {
  return useQuery({
    queryKey: ["reviews"],
    queryFn: fetchReviews,
  });
}
