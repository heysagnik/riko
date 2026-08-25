import { cn } from "../lib/utils.js";

export interface MetricValueProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "positive" | "negative" | "neutral";
  className?: string;
  hint?: boolean;
}

const DELTA_TONE_CLASS: Record<NonNullable<MetricValueProps["deltaTone"]>, string> = {
  positive: "text-recovered",
  negative: "text-lost",
  neutral: "text-ink-muted",
};

export function MetricValue({ label, value, delta, deltaTone = "neutral", className, hint = false }: MetricValueProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span
        className={cn(
          "text-label uppercase text-ink-muted",
          hint && "w-fit cursor-help underline decoration-ink-faint decoration-dotted underline-offset-4",
        )}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-2">
        <span className="text-figure-lg tabular-nums text-ink">{value}</span>
        {delta ? (
          <span className={cn("text-caption tabular-nums", DELTA_TONE_CLASS[deltaTone])}>{delta}</span>
        ) : null}
      </span>
    </div>
  );
}
