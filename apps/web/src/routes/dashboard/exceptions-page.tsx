import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useMetrics } from "../../hooks/use-metrics.js";
import { formatAmount } from "../../hooks/use-cases.js";
import { failureLabel, reasonLabel } from "../../lib/labels.js";

const STATE_BADGE: Record<string, "waiting" | "lost" | "skipped" | "default"> = {
  SKIPPED: "skipped",
  LOST: "lost",
  ESCALATED: "lost",
};

const DELIBERATE = new Set([
  "fraud_signal",
  "holdout_control_group",
  "unsubscribed_or_bounced",
  "customer_unsubscribed",
  "hard_bounce",
  "not_recoverable",
  "payment_too_old",
  "no_deliverable_email",
  "transient_fault_card_is_healthy",
]);

export function ExceptionsPage() {
  const { data, isLoading, error, refetch, isRefetching } = useMetrics();

  const exceptions = data?.exceptions ?? [];
  const currency = data?.currency ?? "inr";

  const grouped = exceptions.reduce<Record<string, typeof exceptions>>((acc, exception) => {
    const key = exception.reason ?? "unspecified";
    acc[key] = acc[key] ?? [];
    acc[key]!.push(exception);
    return acc;
  }, {});

  const groups = Object.entries(grouped)
    .map(([reason, rows]) => ({
      reason,
      rows,
      amountMinor: rows.reduce((s, r) => s + r.amountMinor, 0),
      deliberate: DELIBERATE.has(reason),
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const deliberateTotal = groups.filter((g) => g.deliberate).reduce((s, g) => s + g.amountMinor, 0);
  const unresolvedTotal = groups.filter((g) => !g.deliberate).reduce((s, g) => s + g.amountMinor, 0);

  return (
    <div>
      <h1 className="text-title text-ink">Exceptions</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every case that did not recover, and why. Some of these are Riko deciding correctly not to act.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <div className="mt-6 flex items-center gap-3">
          <p className="text-sm text-lost">Could not load exceptions.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : exceptions.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">Nothing unresolved in this window.</p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-x-6 border-b border-line pb-6">
            <div className="flex flex-col gap-1">
              <span className="text-label uppercase text-ink-muted">Deliberately left alone</span>
              <span className="text-figure-lg tabular-nums text-ink">{formatAmount(deliberateTotal, currency)}</span>
              <span className="text-caption text-ink-faint">Contacting these would have been wrong</span>
            </div>
            <div className="flex flex-col gap-1 border-l border-line pl-6">
              <span className="text-label uppercase text-ink-muted">Unresolved</span>
              <span className="text-figure-lg tabular-nums text-lost">{formatAmount(unresolvedTotal, currency)}</span>
              <span className="text-caption text-ink-faint">Worth a look</span>
            </div>
          </div>

          <div className="mt-8 space-y-8">
            {groups.map((group) => (
              <section key={group.reason}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                    {reasonLabel(group.reason)}
                    {group.deliberate ? <Badge variant="skipped">By design</Badge> : null}
                  </h2>
                  <span className="flex items-center gap-4 text-caption tabular-nums text-ink-faint">
                    <span>{formatAmount(group.amountMinor, currency)}</span>
                    <span>{group.rows.length} cases</span>
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {group.rows.slice(0, 8).map((row) => (
                    <li key={row.caseId}>
                      <Link
                        to={`/dashboard/cases/${row.caseId}`}
                        className="flex items-center gap-4 py-3 text-sm transition-colors duration-150 hover:bg-surface-sunk"
                      >
                        <Badge variant={STATE_BADGE[row.state] ?? "default"}>{row.state}</Badge>
                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                          {failureLabel(row.failureCategory)}
                        </span>
                        <span className="shrink-0 text-figure tabular-nums text-ink">
                          {formatAmount(row.amountMinor, currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {group.rows.length > 8 ? (
                  <p className="pt-2 text-caption text-ink-faint">
                    and {group.rows.length - 8} more
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
