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

export interface CaseRowRowProps {
  data: CaseRowData;
  onClick?: () => void;
}

function AttemptPips({ count, cap }: { count: number; cap: number }) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-1" aria-label={`${count} of ${cap} attempts used`}>
      {Array.from({ length: cap }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("h-1 w-3 rounded-full", i < count ? "bg-ink-faint" : "bg-line")}
        />
      ))}
    </span>
  );
}

function AvatarDot({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunk text-caption font-medium text-ink-muted">
      {name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function InterventionBadge({ kind }: { kind: string | null }) {
  if (!kind) return <span className="text-ink-faint">—</span>;
  return <Badge variant={INTERVENTION_TONE[kind] ?? "default"}>{interventionLabel(kind)}</Badge>;
}

export function CaseRow({ data, onClick }: CaseRowRowProps) {
  return (
    <TableRow
      onClick={onClick}
      className={cn("group border-b border-line", onClick && "cursor-pointer hover:bg-surface-sunk")}
    >
      <TableCell className="pl-4 pr-3 py-2.5">
        <span className="flex items-center gap-2.5">
          <Badge variant={STATE_BADGE_VARIANT[data.state]}>{STATE_LABEL[data.state]}</Badge>
          <AttemptPips count={data.attemptCount} cap={data.attemptCap} />
        </span>
      </TableCell>
      <TableCell className="py-2.5 pr-4 text-ink">{failureLabel(data.failureCategory)}</TableCell>
      <TableCell className="py-2.5 pr-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="w-fit cursor-help">
              <InterventionBadge kind={data.intervention} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{reasonLabel(data.interventionReason)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="py-2.5 pr-4 text-ink">
        <span className="flex min-w-0 items-center gap-2.5">
          <AvatarDot name={data.customerName} />
          <span className="truncate font-medium">{data.customerName}</span>
        </span>
      </TableCell>
      <TableCell className="py-2.5 pr-4 text-right text-figure tabular-nums text-ink">{data.amountLabel}</TableCell>
      <TableCell className="py-2.5 pr-4 text-right text-caption tabular-nums text-ink-faint">{data.ageLabel}</TableCell>
    </TableRow>
  );
}

export function CaseRowMobile({ data, onClick }: CaseRowRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative block w-full border-b border-line py-3 pl-4 pr-3 text-left transition-colors duration-150 active:bg-surface-sunk"
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", STATE_MARKER_CLASS[data.state])} aria-hidden />
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <AvatarDot name={data.customerName} />
          <span className="truncate text-sm font-medium text-ink">{data.customerName}</span>
        </span>
        <span className="shrink-0 text-figure tabular-nums text-ink">{data.amountLabel}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant={STATE_BADGE_VARIANT[data.state]}>{STATE_LABEL[data.state]}</Badge>
          <span className="truncate text-caption text-ink-muted">{failureLabel(data.failureCategory)}</span>
        </span>
        <span className="shrink-0 text-caption tabular-nums text-ink-faint">{data.ageLabel}</span>
      </div>
      <p className="mt-1 truncate text-caption text-ink-faint">{reasonLabel(data.interventionReason)}</p>
      <div className="mt-1.5">
        <AttemptPips count={data.attemptCount} cap={data.attemptCap} />
      </div>
    </button>
  );
}
