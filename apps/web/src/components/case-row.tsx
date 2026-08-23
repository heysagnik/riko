import { cn } from "../lib/utils.js";
import { failureLabel, interventionLabel, INTERVENTION_TONE, reasonLabel } from "../lib/labels.js";
import { Badge } from "./ui/badge.js";
import { TableCell, TableRow } from "./ui/table.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";

export type CaseUiState =
  | "NEW"
  | "SKIPPED"
  | "DRAFTING"
  | "SENDING"
  | "WAITING"
  | "PROMISED"
  | "RECOVERED"
  | "ESCALATED"
  | "LOST";

export const STATE_MARKER_CLASS: Record<CaseUiState, string> = {
  NEW: "bg-ink-faint",
  DRAFTING: "bg-ink-faint",
  SENDING: "bg-ink-faint",
  WAITING: "bg-waiting",
  PROMISED: "bg-accent",
  RECOVERED: "bg-recovered",
  LOST: "bg-lost",
  SKIPPED: "bg-skipped",
  ESCALATED: "bg-lost",
};

export const STATE_BADGE_VARIANT: Record<CaseUiState, "default" | "recovered" | "waiting" | "lost" | "skipped"> = {
  NEW: "default",
  DRAFTING: "default",
  SENDING: "default",
  WAITING: "waiting",
  PROMISED: "waiting",
  RECOVERED: "recovered",
  LOST: "lost",
  SKIPPED: "skipped",
  ESCALATED: "lost",
};

export const STATE_LABEL: Record<CaseUiState, string> = {
  NEW: "New",
  DRAFTING: "Drafting",
  SENDING: "Sending",
  WAITING: "Waiting",
  PROMISED: "Promised",
  RECOVERED: "Recovered",
  LOST: "Lost",
  SKIPPED: "Skipped",
  ESCALATED: "Escalated",
};

export interface CaseRowData {
  id: string;
  state: CaseUiState;
  failureCategory: string | null;
  intervention: string | null;
  interventionReason: string | null;
  customerName: string;
  amountLabel: string;
  attemptCount: number;
  attemptCap: number;
  ageLabel: string;
}

export interface CaseRowProps {
  data: CaseRowData;
  onClick?: () => void;
}

const COLUMN_COUNT = 7;

function InterventionBadge({ kind }: { kind: string | null }) {
  if (!kind) return <span className="text-ink-faint">—</span>;
  return <Badge variant={INTERVENTION_TONE[kind] ?? "default"}>{interventionLabel(kind)}</Badge>;
}

export function CaseRow({ data, onClick }: CaseRowProps) {
  const trackFill = Math.min(100, (data.attemptCount / data.attemptCap) * 100);
  const showTrack = data.attemptCount > 0 && !["RECOVERED", "SKIPPED"].includes(data.state);

  return (
    <>
      <TableRow
        onClick={onClick}
        className={cn("relative", showTrack ? "border-b-0" : "", onClick && "cursor-pointer hover:bg-surface-sunk")}
      >
        <TableCell className="relative w-0 p-0">
          <span className={cn("absolute inset-y-0 left-0 w-0.5", STATE_MARKER_CLASS[data.state])} />
        </TableCell>
        <TableCell className="pl-4">
          <Badge variant={STATE_BADGE_VARIANT[data.state]}>{STATE_LABEL[data.state]}</Badge>
        </TableCell>
        <TableCell className="text-ink">{failureLabel(data.failureCategory)}</TableCell>
        <TableCell>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-fit cursor-help">
                <InterventionBadge kind={data.intervention} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{reasonLabel(data.interventionReason)}</TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell className="text-ink">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunk text-caption font-medium text-ink-muted">
              {data.customerName.charAt(0).toUpperCase() || "?"}
            </span>
            <span className="truncate">{data.customerName}</span>
          </span>
        </TableCell>
        <TableCell className="text-right text-figure tabular-nums text-ink">{data.amountLabel}</TableCell>
        <TableCell className="text-right text-caption tabular-nums text-ink-faint">{data.ageLabel}</TableCell>
      </TableRow>
      {showTrack ? (
        <TableRow className="border-b border-line hover:bg-transparent">
          <TableCell colSpan={COLUMN_COUNT} className="h-px p-0">
            <div className="h-px w-full bg-line">
              <div
                className="h-px bg-ink-faint transition-all duration-150 ease-out"
                style={{ width: `${trackFill}%` }}
              />
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function CaseRowMobile({ data, onClick }: CaseRowProps) {
  const trackFill = Math.min(100, (data.attemptCount / data.attemptCap) * 100);
  const showTrack = data.attemptCount > 0 && !["RECOVERED", "SKIPPED"].includes(data.state);

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative border-b border-line py-3 pl-4 pr-3",
        onClick && "cursor-pointer transition-colors duration-150 hover:bg-surface-sunk",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", STATE_MARKER_CLASS[data.state])} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunk text-caption font-medium text-ink-muted">
            {data.customerName.charAt(0).toUpperCase() || "?"}
          </span>
          <span className="truncate text-sm text-ink">{data.customerName}</span>
        </div>
        <span className="shrink-0 text-figure tabular-nums text-ink">{data.amountLabel}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={STATE_BADGE_VARIANT[data.state]}>{STATE_LABEL[data.state]}</Badge>
          <span className="truncate text-caption text-ink-muted">{failureLabel(data.failureCategory)}</span>
        </div>
        <span className="shrink-0 text-caption tabular-nums text-ink-faint">{data.ageLabel}</span>
      </div>
      <p className="mt-1.5 truncate text-caption text-ink-faint">{reasonLabel(data.interventionReason)}</p>
      {showTrack ? (
        <div className="mt-2 h-px w-full bg-line">
          <div
            className="h-px bg-ink-faint transition-all duration-150 ease-out"
            style={{ width: `${trackFill}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
