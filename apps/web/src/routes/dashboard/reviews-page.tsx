import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useReviews, type ReviewRow } from "../../hooks/use-reviews.js";
import { formatAmount } from "../../hooks/use-cases.js";

function ReviewCard({ row }: { row: ReviewRow }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">sampled for review</Badge>
        <span className="text-caption text-ink-faint">
          {row.sentAt ? new Date(row.sentAt).toLocaleString() : "unsent"} ·{" "}
          {formatAmount(row.amountMinor, row.currency)}
        </span>
        {row.openedAt ? <Badge variant="waiting">opened</Badge> : null}
        {row.clickedAt ? <Badge variant="recovered">clicked</Badge> : null}
      </div>
      <p className="mt-2 text-sm font-medium text-ink">{row.subject}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{row.body}</p>
    </div>
  );
}

export function ReviewsPage() {
  const { data, isLoading, error, refetch, isRefetching } = useReviews();
  const reviews = data?.reviews ?? [];

  return (
    <div>
      <h1 className="text-title text-ink">Sent-mail review</h1>
      <p className="mt-1 text-sm text-ink-muted">
        A sample of what Riko actually sent. Skim it weekly — tone drift shows up here before it shows up in
        unsubscribes.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error ? (
        <div className="mt-6 flex items-center gap-3">
          <p className="text-sm text-lost">Could not load reviews.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : reviews.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">Nothing sampled yet. Sampled sends appear here automatically.</p>
      ) : (
        <div className="mt-6 space-y-3">
          {reviews.map((row) => (
            <ReviewCard key={row.outreachId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
