import { cn } from "../lib/utils.js";

export interface LogoProps {
  className?: string;
  compact?: boolean;
}

export function Logo({ className, compact = false }: LogoProps) {
  return (
    <span className={cn("font-serif text-lg tracking-wide text-ink", className)}>{compact ? "R" : "Riko"}</span>
  );
}
