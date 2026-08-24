import { useState } from "react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useReport, reportCsvUrl } from "../../hooks/use-report.js";
import { formatAmount } from "../../hooks/use-cases.js";

const WINDOWS = [7, 30, 90];

function pct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

export function ReportPage() {
  const [windowDays, setWindowDays] = useState(30);
  const { data, isLoading, error, refetch, isRefetching } = useReport(windowDays);

  const totals = data?.totals;
  const lift = data?.lift;
  const currency = data?.cases[0]?.currency ?? "inr";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title text-ink">Recovery report</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Money recovered across the batch — attributed to outreach and self-healed, shown side by side.
          </p>
        </div>
        <a href={reportCsvUrl(windowDays)} download>
          <Button variant="outline" size="sm">
            Download CSV
          </Button>
        </a>
      </div>

      <div className="mt-4 flex items-center gap-1">
        {WINDOWS.map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => setWindowDays(days)}
            className={
              windowDays === days
                ? "rounded-sm bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent"
                : "rounded-sm px-3 py-1.5 text-sm text-ink-muted transition-colors duration-150 hover:bg-surface-sunk hover:text-ink"
            }
          >
            {days} days
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-6 flex items-center gap-3">
          <p className="text-sm text-lost">Could not load the report.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? "Retrying…" : "Try again"}
          </Button>
        </div>
      ) : totals && lift ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-md border border-line bg-surface p-4">
              <span className="text-label uppercase text-ink-muted">Recovered</span>
              <p className="mt-1 text-figure-lg tabular-nums text-recovered">
                {formatAmount(totals.recoveredAmountMinor, currency)}
              </p>
              <p className="text-caption text-ink-faint">{totals.recoveredCount} of {totals.cases} cases</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <span className="text-label uppercase text-ink-muted">Attributed</span>
              <p className="mt-1 text-figure-lg tabular-nums text-ink">
                {formatAmount(totals.attributedAmountMinor, currency)}
              </p>
              <p className="text-caption text-ink-faint">after contact ({totals.attributedCount})</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <span className="text-label uppercase text-ink-muted">Self-healed</span>
              <p className="mt-1 text-figure-lg tabular-nums text-ink-muted">
                {formatAmount(
                  totals.recoveredAmountMinor - totals.attributedAmountMinor,
                  currency,
                )}
              </p>
              <p className="text-caption text-ink-faint">no contact needed ({totals.selfHealedCount})</p>
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <span className="text-label uppercase text-ink-muted">At risk</span>
              <p className="mt-1 text-figure-lg tabular-nums text-ink">
                {formatAmount(totals.atRiskMinor, currency)}
              </p>
              <p className="text-caption text-ink-faint">{totals.emailsSent} emails sent</p>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-subtitle text-ink">Treatment vs holdout lift</h2>
              <Badge variant={lift.significant ? "recovered" : "default"}>
                {lift.significant ? "Significant" : `Needs ≥30 per arm (${Math.min(lift.treatmentCount, lift.holdoutCount)})`}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <span className="text-label uppercase text-ink-muted">Treatment rate</span>
                <p className="text-lg tabular-nums text-ink">{pct(lift.treatmentRate)}</p>
                <p className="text-caption text-ink-faint">{lift.treatmentCount} cases</p>
              </div>
              <div>
                <span className="text-label uppercase text-ink-muted">Holdout rate</span>
                <p className="text-lg tabular-nums text-ink">{pct(lift.holdoutRate)}</p>
                <p className="text-caption text-ink-faint">{lift.holdoutCount} cases</p>
              </div>
              <div>
                <span className="text-label uppercase text-ink-muted">Incremental</span>
                <p className="text-lg tabular-nums text-ink">
                  {lift.incrementalPoints === null ? "—" : `+${lift.incrementalPoints.toFixed(1)} pts`}
                </p>
                <p className="text-caption text-ink-faint">recovery caused by outreach</p>
              </div>
            </div>
          </div>

          <p className="mt-4 text-caption text-ink-faint">
            {data.exceptions.length} exceptions in this window.{" "}
            {data.generatedAt.slice(0, 10)} · raw and attributed recovery are always shown together on purpose.
          </p>
        </>
      ) : null}
    </div>
  );
}
