import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { formatAmount } from "../../hooks/use-cases.js";
import { useEscalations, useResolveEscalation, type Escalation, type ResolveAction } from "../../hooks/use-escalations.js";
import { failureLabel, reasonLabel } from "../../lib/labels.js";

function Row({ item, currency }: { item: Escalation; currency: string }) {
  const resolve = useResolveEscalation();
  const [error, setError] = useState<string | null>(null);

  const act = (action: ResolveAction) => {
    setError(null);
    resolve.mutate({ caseId: item.id, action }, { onError: (e) => setError(e.message) });
  };

  const busy = resolve.isPending;

  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          to={`/dashboard/cases/${item.id}`}
          className="text-sm font-medium text-ink transition-colors duration-150 hover:text-accent"
        >
          {item.customerName ?? "Unknown customer"}
        </Link>
        <span className="text-figure tabular-nums text-ink">{formatAmount(item.amountMinor, item.currency ?? currency)}</span>
      </div>

      <p className="mt-1 text-sm text-ink-muted">
        {failureLabel(item.failureCategory)} · {reasonLabel(item.closedReason ?? item.interventionReason)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => act("approve_send")} disabled={busy}>
          Approve and send
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("return_to_queue")} disabled={busy}>
          Let Riko retry
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act("close_unrecoverable")} disabled={busy}>
          Write off
        </Button>
      </div>

      {error ? (
        <p className="mt-2 text-caption text-lost" role="alert">
          {error === "no_draft_to_send"
            ? "There is no draft to approve. Let Riko retry instead."
            : error === "not_escalated"
              ? "Someone already resolved this one."
              : error}
        </p>
      ) : null}
    </li>
  );
}

export function EscalationsPage() {
  const { data, isLoading, error, refetch, isRefetching } = useEscalations();

  const escalations = data?.escalations ?? [];
  const currency = data?.currency ?? "inr";

  return (
    <div>
      <h1 className="text-title text-ink">Needs you</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Riko stopped short on these and wants a person to decide.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="mt-6 flex items-center gap-3">
          <p className="text-sm text-lost">Could not load the queue.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : escalations.length === 0 ? (
        <div className="mt-10 border-t border-line pt-10">
          <p className="text-sm text-ink">Nothing waiting on you.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Cases land here when Riko will not act on its own — an unrecognised failure, a high-value payment, or a
            draft that failed its checks three times.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex items-baseline gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1">
              <span className="text-label uppercase text-ink-muted">Waiting on you</span>
              <span className="text-figure-lg tabular-nums text-ink">{escalations.length}</span>
            </div>
            <div className="flex flex-col gap-1 border-l border-line pl-6">
              <span className="text-label uppercase text-ink-muted">Value held up</span>
              <span className="text-figure-lg tabular-nums text-ink">
                {formatAmount(data?.totalMinor ?? 0, currency)}
              </span>
            </div>
          </div>

          <ul className="mt-2">
            {escalations.map((item) => (
              <Row key={item.id} item={item} currency={currency} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
