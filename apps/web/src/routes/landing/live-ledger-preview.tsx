import { useEffect, useState } from "react";
import { cn } from "../../lib/utils.js";

interface LedgerSample {
  id: string;
  reason: string;
  customer: string;
  amount: string;
  status: string;
  marker: string;
}

const SAMPLES: LedgerSample[] = [
  { id: "1", reason: "Expired card", customer: "Priya S.", amount: "₹2,400", status: "sent 1/3", marker: "bg-waiting" },
  { id: "2", reason: "Insufficient funds", customer: "Rahul M.", amount: "₹8,900", status: "recovered", marker: "bg-recovered" },
  { id: "3", reason: "Bank decline", customer: "Anjali K.", amount: "₹1,200", status: "escalated", marker: "bg-lost" },
];

export function LiveLedgerPreview() {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setVisibleCount(SAMPLES.length);
      return;
    }

    const timers = SAMPLES.map((_, index) =>
      setTimeout(() => setVisibleCount((count) => Math.max(count, index + 1)), index * 220),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="bg-surface">
      {SAMPLES.map((sample, index) => (
        <div
          key={sample.id}
          className={cn(
            "flex items-center gap-4 border-b border-line px-4 py-3 text-sm transition-all duration-300 ease-out last:border-b-0",
            index < visibleCount ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          )}
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-full", sample.marker)} />
          <span className="w-36 text-ink-muted">{sample.reason}</span>
          <span className="w-24 text-ink">{sample.customer}</span>
          <span className="ml-auto text-figure tabular-nums text-ink">{sample.amount}</span>
          <span className="w-24 text-right text-caption text-ink-faint">{sample.status}</span>
        </div>
      ))}
    </div>
  );
}
