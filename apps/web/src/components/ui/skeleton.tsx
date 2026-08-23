import { cn } from "../../lib/utils.js";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-sm bg-surface-sunk", className)} {...props} />;
}
