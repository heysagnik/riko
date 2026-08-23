import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CaseRow, CaseRowMobile } from "../../components/case-row.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs.js";
import { ageLabelFromDate, formatAmount, useCases, PAGE_SIZE } from "../../hooks/use-cases.js";
import { useConnections } from "../../hooks/use-connections.js";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "NEEDS_YOU", label: "Needs you" },
  { value: "RECOVERED", label: "Recovered" },
  { value: "CLOSED", label: "Closed" },
];

const ATTEMPT_CAP = 3;

export function CaseListPage() {
  const [filter, setFilter] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error, refetch, isRefetching } = useCases(filter, offset);
  const { data: connectionsData, isLoading: connectionsLoading } = useConnections();
  const navigate = useNavigate();

  const cases = data?.cases ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const hasConnection = (connectionsData?.connections ?? []).some((c) => c.status === "active");

  function selectFilter(next: string) {
    setFilter(next);
    setOffset(0);
  }

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <h1 className="text-title text-ink">Cases</h1>
      <p className="mt-1 text-sm text-ink-muted">Every case opened from a failed payment, filterable by status.</p>

      <Tabs value={filter} onValueChange={selectFilter} className="mt-4">
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
              {counts[f.value] !== undefined && (
                <span className="ml-1.5 tabular-nums text-ink-muted">{counts[f.value]}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {isLoading || connectionsLoading ? (
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
                    <TableHead className="w-0" />
                    <TableHead>State</TableHead>
                    <TableHead>Why it failed</TableHead>
                    <TableHead>What Riko did</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Age</TableHead>
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
                    onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rangeEnd >= total}
                    onClick={() => setOffset((o) => o + PAGE_SIZE)}
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
