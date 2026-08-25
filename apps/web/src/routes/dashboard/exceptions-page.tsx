import { Badge } from "../../components/ui/badge.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useUnmappedCodes } from "../../hooks/use-unmapped-codes.js";
import { formatAmount } from "../../hooks/use-cases.js";
import { failureLabel } from "../../lib/labels.js";

export function ExceptionsPage() {
  const { data, isLoading, error, refetch, isRefetching } = useUnmappedCodes();
  const rows = data?.unmapped ?? [];
  const unmappedCount = rows.filter((row) => !row.mapped).length;

  return (
    <div>
      <h1 className="text-title text-ink">Exceptions</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every payment error code seen so far, with the category Riko assigned and whether the failure is
        recoverable. {unmappedCount > 0 ? `${unmappedCount} unmapped ` : "Unmapped "}
        {unmappedCount === 1 ? "code has" : "codes have"} no entry in the failure_code_map seed — those cases
        escalate to a human by default; extend the seed to route them automatically next time.
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <div className="mt-6 flex items-center gap-3">
          <p className="text-sm text-lost">Could not load failure codes.</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="rounded-sm border border-line px-3 py-1.5 text-sm text-ink transition-colors duration-150 hover:bg-surface-sunk"
          >
            {isRefetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">No failure codes recorded yet.</p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 pr-4 font-medium text-ink-muted">Code</th>
              <th className="py-2 pr-4 font-medium text-ink-muted">Provider</th>
              <th className="py-2 pr-4 font-medium text-ink-muted">Category</th>
              <th className="py-2 pr-4 font-medium text-ink-muted">Recoverable</th>
              <th className="py-2 pr-4 font-medium text-ink-muted">Mapping</th>
              <th className="py-2 pr-4 text-right font-medium text-ink-muted">Cases</th>
              <th className="py-2 pr-4 text-right font-medium text-ink-muted">Amount at risk</th>
              <th className="py-2 text-right font-medium text-ink-muted">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.providerId}:${row.failureCode}`} className="border-b border-line/60">
                <td className="py-2.5 pr-4 font-mono text-caption text-ink">{row.failureCode}</td>
                <td className="py-2.5 pr-4 text-ink-muted">{row.providerId}</td>
                <td className="py-2.5 pr-4 text-ink">{failureLabel(row.failureCategory)}</td>
                <td className="py-2.5 pr-4 text-ink-muted">{row.failureRecoverable ? "Yes" : "No"}</td>
                <td className="py-2.5 pr-4">
                  {row.mapped ? (
                    <Badge variant="default">Mapped</Badge>
                  ) : (
                    <Badge variant="waiting">Unmapped</Badge>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-ink">{row.occurrences}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-ink">
                  {formatAmount(row.amountMinor, "inr")}
                </td>
                <td className="py-2.5 text-right text-ink-muted">{new Date(row.lastSeen).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
