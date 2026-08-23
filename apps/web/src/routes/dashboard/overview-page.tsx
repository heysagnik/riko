import { Link } from "react-router-dom";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { STATE_BADGE_VARIANT, STATE_LABEL, STATE_MARKER_CLASS } from "../../components/case-row.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js";
import { useMetrics } from "../../hooks/use-metrics.js";
import { useCases, ageLabelFromDate, formatAmount } from "../../hooks/use-cases.js";
import { useConnections } from "../../hooks/use-connections.js";
import { failureLabel } from "../../lib/labels.js";
import { cn } from "../../lib/utils.js";

const DECISION_TONE: Record<string, string> = {
  outreach_email: "bg-accent",
  wait_until: "bg-waiting",
  no_action_provider_retrying: "bg-ink-faint",
  escalate_human: "bg-lost",
  stop_never_contact: "bg-lost/50",
  unspecified: "bg-line-strong",
};

export function OverviewPage() {
  const { data: metrics, isLoading: metricsLoading } = useMetrics();
  const { data: casesData, isLoading: casesLoading } = useCases();
  const { data: connectionsData, isLoading: connectionsLoading } = useConnections();

  const recentCases = (casesData?.cases ?? []).slice(0, 5);
  const hasConnection = (connectionsData?.connections ?? []).some((c) => c.status === "active");
  const currency = metrics?.currency ?? "inr";
  const lift = metrics?.lift;
  const liftReliable = lift?.significant ?? false;
  const economics = metrics?.economics;
  const harm = metrics?.harm;
  const needsAttention = metrics?.exceptions.filter((e) => e.state === "ESCALATED").length ?? 0;
  const decisions = metrics?.interventions ?? [];
  const decisionTotal = Math.max(1, metrics?.totalCases ?? 1);

  return (
    <div>
      <h1 className="text-title text-ink">Overview</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {metrics ? `Last ${metrics.windowDays} days` : "Recovery at a glance"}
      </p>

      {metricsLoading ? (
        <Skeleton className="mt-10 h-28 w-full" />
      ) : (
        <section className="mt-10">
          <span className="text-label uppercase text-ink-muted">Recovered</span>
          <p className="mt-2 text-figure-lg tabular-nums text-ink">
            {formatAmount(metrics?.recoveredAmountMinor ?? 0, currency)}
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            {metrics?.recoveredCount ?? 0} of {metrics?.totalCases ?? 0} cases, out of{" "}
            <span className="tabular-nums">{formatAmount(metrics?.atRiskMinor ?? 0, currency)}</span> at risk.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-5 text-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-ink-muted underline decoration-ink-faint decoration-dotted underline-offset-4">
                    Riko caused
                  </span>{" "}
                  <span className="tabular-nums text-ink">
                    {formatAmount(metrics?.attributedAmountMinor ?? 0, currency)}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Recovered after Riko contacted the customer. The remaining{" "}
                {formatAmount(metrics?.selfHealedAmountMinor ?? 0, currency)} came back without us, and we don't
                claim it.
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-ink-muted underline decoration-ink-faint decoration-dotted underline-offset-4">
                    Lift vs control
                  </span>{" "}
                  <span className={cn("tabular-nums", liftReliable ? "text-ink" : "text-ink-faint")}>
                    {lift?.incrementalPoints === null || lift?.incrementalPoints === undefined
                      ? "—"
                      : `${lift.incrementalPoints > 0 ? "+" : ""}${lift.incrementalPoints.toFixed(1)} pp`}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {liftReliable
                  ? `Contacted customers recover ${lift?.incrementalPoints?.toFixed(1)} points more often than the untouched holdout group (treatment n=${lift?.treatmentCount}, holdout n=${lift?.holdoutCount}).`
                  : `Treatment n=${lift?.treatmentCount ?? 0}, holdout n=${lift?.holdoutCount ?? 0}. Both arms need about ${lift?.minArmSize ?? 30} before this difference means anything.`}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <span className="text-ink-muted underline decoration-ink-faint decoration-dotted underline-offset-4">
                    Net
                  </span>{" "}
                  <span className="tabular-nums text-ink">
                    {formatAmount(economics?.netRecoveredMinor ?? 0, currency)}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Recovered minus what it cost to recover it: {economics?.sendCount ?? 0} emails,{" "}
                {formatAmount(economics?.incentiveSpendMinor ?? 0, currency)} in discounts. Riko never offers money
                off, so recovery costs almost nothing.
              </TooltipContent>
            </Tooltip>
          </div>

          {harm ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-muted">
              <span>
                <span className="tabular-nums text-ink">{harm.unsubscribedCount}</span> opted out
                <span className="text-ink-faint"> ({(harm.unsubscribeRate * 100).toFixed(1)}%)</span>
              </span>
              <span>
                <span className="tabular-nums text-ink">{harm.bouncedCount}</span> bounced
                <span className="text-ink-faint"> ({(harm.bounceRate * 100).toFixed(1)}%)</span>
              </span>
              <span className="text-ink-faint">across {harm.customerCount} customers</span>
            </div>
          ) : null}
        </section>
      )}

      {needsAttention > 0 ? (
        <Link
          to="/dashboard/needs-you"
          className="mt-8 flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3.5 transition-colors duration-150 hover:bg-surface-sunk"
        >
          <span className="text-sm text-ink">
            <span className="tabular-nums font-medium">{needsAttention}</span>{" "}
            {needsAttention === 1 ? "case needs" : "cases need"} a person to look
          </span>
          <ArrowRightIcon size={16} weight="regular" className="shrink-0 text-ink-faint" />
        </Link>
      ) : null}

      {!metricsLoading && decisions.length > 0 ? (
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="text-subtitle text-ink">What Riko decided</h2>
            <Link
              to="/dashboard/cases"
              className="text-sm text-accent transition-colors duration-150 hover:text-accent-hover"
            >
              Break it down
            </Link>
          </div>
          <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-sunk">
            {decisions.map((item) => (
              <div
                key={item.key}
                className={cn("h-full", DECISION_TONE[item.key] ?? "bg-line-strong")}
                style={{ width: `${(item.count / decisionTotal) * 100}%` }}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            <span className="tabular-nums text-ink">{metrics?.contactedCount ?? 0}</span> contacted,{" "}
            <span className="tabular-nums text-ink">{metrics?.suppressedCount ?? 0}</span> deliberately left alone.
          </p>
        </section>
      ) : null}

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="text-subtitle text-ink">Recent activity</h2>
          <Link
            to="/dashboard/cases"
            className="text-sm text-accent transition-colors duration-150 hover:text-accent-hover"
          >
            All cases
          </Link>
        </div>

        {casesLoading || connectionsLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : recentCases.length === 0 && !hasConnection ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink-muted">Connect a payment provider to start recovering payments.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/connections">Connect a provider</Link>
            </Button>
          </div>
        ) : recentCases.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            No failed payments yet. Cases appear here the moment one arrives.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {recentCases.map((c) => (
              <li key={c.id} className="relative">
                <span className={cn("absolute inset-y-0 left-0 w-0.5", STATE_MARKER_CLASS[c.state])} />
                <Link
                  to={`/dashboard/cases/${c.id}`}
                  className="flex items-center gap-4 py-3 pl-4 pr-1 text-sm transition-colors duration-150 hover:bg-surface-sunk"
                >
                  <Badge variant={STATE_BADGE_VARIANT[c.state]}>{STATE_LABEL[c.state]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink">{c.customerName ?? "Unknown customer"}</span>
                  <span className="hidden shrink-0 text-ink-muted sm:block">{failureLabel(c.failureCategory)}</span>
                  <span className="shrink-0 text-figure tabular-nums text-ink">
                    {formatAmount(c.amountMinor, c.currency)}
                  </span>
                  <span className="w-8 shrink-0 text-right text-caption tabular-nums text-ink-faint">
                    {ageLabelFromDate(c.openedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
