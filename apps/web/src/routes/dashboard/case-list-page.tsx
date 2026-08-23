import { useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CaseRow, CaseRowMobile } from "../../components/case-row.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { ageLabelFromDate, formatAmount, useCases, PAGE_SIZE } from "../../hooks/use-cases.js";
import { useConnections } from "../../hooks/use-connections.js";
import { useEscalations, useResolveEscalation, type Escalation, type ResolveAction } from "../../hooks/use-escalations.js";
import { failureLabel, reasonLabel } from "../../lib/labels.js";
import { cn } from "../../lib/utils.js";

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "NEEDS_YOU", label: "Needs you" },
  { value: "RECOVERED", label: "Recovered" },
  { value: "CLOSED", label: "Closed" },
  { value: "ALL", label: "All" },
];

const DATE_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

function dateBounds(range: string): { from?: string; to?: string } {
  if (range === "all") return {};
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - Number.parseInt(range, 10));
  return { from: from.toISOString(), to: now.toISOString() };
}

const ATTEMPT_CAP = 3;

const OUTCOME_TEXT: Record<string, string> = {
  SENDING: "Approved. Riko is sending the draft now.",
  NEW: "Back with Riko. It will pick this up on the next run.",
  LOST: "Written off. Riko will not contact them again.",
};

function NeedsYouRow({
  item,
  currency,
  onResolved,
}: {
  item: Escalation;
  currency: string;
  onResolved: (item: Escalation, state: string) => void;
}) {
  const resolve = useResolveEscalation();
  const [error, setError] = useState<string | null>(null);

  const act = (action: ResolveAction) => {
    setError(null);
    resolve.mutate(
      { caseId: item.id, action },
      { onSuccess: (result) => onResolved(item, result.state), onError: (e) => setError(e.message) },
    );
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

function NeedsYouResolvedRow({ item, state, currency }: { item: Escalation; state: string; currency: string }) {
  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          to={`/dashboard/cases/${item.id}`}
          className="text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-accent"
        >
          {item.customerName ?? "Unknown customer"}
        </Link>
        <span className="text-figure tabular-nums text-ink-muted">
          {formatAmount(item.amountMinor, item.currency ?? currency)}
        </span>
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-ink">
        <Badge variant="default">{state}</Badge>
        {OUTCOME_TEXT[state] ?? "Resolved."}
      </p>

      <Link
        to={`/dashboard/cases/${item.id}`}
        className="mt-1.5 inline-block text-caption text-accent transition-colors duration-150 hover:text-accent-hover"
      >
        View case
      </Link>
    </li>
  );
}

function NeedsYouView() {
  const { data, isLoading, error, refetch, isRefetching } = useEscalations();
  const [resolved, setResolved] = useState<{ item: Escalation; state: string }[]>([]);

  const resolvedIds = new Set(resolved.map((r) => r.item.id));
  const escalations = (data?.escalations ?? []).filter((e) => !resolvedIds.has(e.id));
  const currency = data?.currency ?? "inr";

  const onResolved = (item: Escalation, state: string) =>
    setResolved((prev) => (prev.some((r) => r.item.id === item.id) ? prev : [{ item, state }, ...prev]));

  if (isLoading) {
    return (
      <div className="mt-6 space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 flex items-center gap-3">
        <p className="text-sm text-lost">Could not load the queue.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          {isRefetching ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  }

  if (escalations.length === 0 && resolved.length === 0) {
    return (
      <div className="mt-6 border-t border-line pt-10">
        <p className="text-sm text-ink">Nothing waiting on you.</p>
        <p className="mt-1 text-sm text-ink-muted">
          Cases land here when Riko will not act on its own — an unrecognised failure, a high-value payment, or a
          draft that failed its checks three times.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 flex items-baseline gap-6 border-b border-line pb-5">
        <div className="flex flex-col gap-1">
          <span className="text-label uppercase text-ink-muted">Waiting on you</span>
          <span className="text-figure-lg tabular-nums text-ink">{escalations.length}</span>
        </div>
        <div className="flex flex-col gap-1 border-l border-line pl-6">
          <span className="text-label uppercase text-ink-muted">Value held up</span>
          <span className="text-figure-lg tabular-nums text-ink">{formatAmount(data?.totalMinor ?? 0, currency)}</span>
        </div>
      </div>

      <ul className="mt-2">
        {resolved.map((r) => (
          <NeedsYouResolvedRow key={r.item.id} item={r.item} state={r.state} currency={currency} />
        ))}
        {escalations.map((item) => (
          <NeedsYouRow key={item.id} item={item} currency={currency} onResolved={onResolved} />
        ))}
      </ul>
    </>
  );
}

export function CaseListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("state") ?? "OPEN";
  const range = searchParams.get("range") ?? "all";
  const offset = Number(searchParams.get("offset") ?? "0") || 0;
  const bounds = dateBounds(range);
  const { data, isLoading, error, refetch, isRefetching } = useCases(filter, offset, bounds.from, bounds.to);
  const { data: connectionsData, isLoading: connectionsLoading } = useConnections();
  const navigate = useNavigate();

  const cases = data?.cases ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const hasConnection = (connectionsData?.connections ?? []).some((c) => c.status === "active");

  function updateFilters(next: { state?: string; range?: string }) {
    const nextParams = new URLSearchParams(searchParams);
    if (next.state) nextParams.set("state", next.state);
    if (next.range) nextParams.set("range", next.range);
    nextParams.delete("offset");
    setSearchParams(nextParams);
  }

  function setPage(nextOffset: number) {
    const nextParams = new URLSearchParams(searchParams);
    if (nextOffset === 0) nextParams.delete("offset");
    else nextParams.set("offset", String(nextOffset));
    setSearchParams(nextParams);
  }

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <h1 className="text-title text-ink">Cases</h1>
          <p className="mt-1 text-sm text-ink-muted">Every case opened from a failed payment.</p>
        </div>
        <p className="text-caption tabular-nums text-ink-faint">{total} {total === 1 ? "case" : "cases"}</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <Tabs value={filter} onValueChange={(value) => updateFilters({ state: value })}>
          <TabsList className="border-b-0">
            {STATUS_OPTIONS.map((option) => (
              <TabsTrigger key={option.value} value={option.value} className="inline-flex items-center gap-1.5">
                {option.label}
                {counts[option.value] !== undefined ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums leading-none",
                      filter === option.value
                        ? "bg-accent text-accent-foreground"
                        : "border border-line-strong text-ink-faint",
                    )}
                  >
                    {counts[option.value]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mb-2 flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink-muted outline-none transition-colors hover:border-accent hover:text-ink focus-visible:border-accent"
            >
              {DATE_OPTIONS.find((option) => option.value === range)?.label ?? "Any time"}
              <CaretDownIcon size={12} weight="bold" className="text-ink-faint" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuRadioGroup value={range} onValueChange={(value) => updateFilters({ range: value })}>
              {DATE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-4">
        {filter === "NEEDS_YOU" && range === "all" ? (
          <NeedsYouView />
        ) : isLoading || connectionsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-lost">Could not load cases. Try reconnecting your provider.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching ? "Retrying…" : "Try again"}
            </Button>
          </div>
        ) : cases.length === 0 && !hasConnection ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-ink-muted">Connect a payment provider to start seeing cases here.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/connections">Connect a provider</Link>
            </Button>
          </div>
        ) : cases.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No cases in this view yet. Cases appear here as soon as a failed payment arrives.
          </p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">State</TableHead>
                    <TableHead>Why it failed</TableHead>
                    <TableHead>What Riko did</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="pr-4 text-right">Amount</TableHead>
                    <TableHead className="pr-4 text-right">Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((c) => (
                    <CaseRow
                      key={c.id}
                      onClick={() => navigate(`/dashboard/cases/${c.id}`)}
                      data={{
                        id: c.id,
                        state: c.state,
                        failureCategory: c.failureCategory,
                        intervention: c.intervention,
                        interventionReason: c.interventionReason,
                        customerName: c.customerName ?? "Unknown customer",
                        amountLabel: formatAmount(c.amountMinor ?? c.recoveredAmountMinor, c.currency),
                        attemptCount: c.attemptCount,
                        attemptCap: ATTEMPT_CAP,
                        ageLabel: ageLabelFromDate(c.openedAt),
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-line md:hidden">
              {cases.map((c) => (
                <CaseRowMobile
                  key={c.id}
                  onClick={() => navigate(`/dashboard/cases/${c.id}`)}
                  data={{
                    id: c.id,
                    state: c.state,
                    failureCategory: c.failureCategory,
                    intervention: c.intervention,
                    interventionReason: c.interventionReason,
                    customerName: c.customerName ?? "Unknown customer",
                    amountLabel: formatAmount(c.amountMinor ?? c.recoveredAmountMinor, c.currency),
                    attemptCount: c.attemptCount,
                    attemptCap: ATTEMPT_CAP,
                    ageLabel: ageLabelFromDate(c.openedAt),
                  }}
                />
              ))}
            </div>

            {total > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <p className="text-sm tabular-nums text-ink-muted">
                  {rangeStart}–{rangeEnd} of {total}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setPage(Math.max(0, offset - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rangeEnd >= total}
                    onClick={() => setPage(offset + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
