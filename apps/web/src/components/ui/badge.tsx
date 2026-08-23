import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded border px-2 py-0.5 text-caption font-medium transition-colors duration-150",
  {
    variants: {
      variant: {
        default: "border-line-strong bg-surface-sunk text-ink-muted",
        recovered: "border-transparent bg-recovered/10 text-recovered",
        waiting: "border-transparent bg-waiting/10 text-waiting",
        lost: "border-transparent bg-lost/10 text-lost",
        skipped: "border-transparent bg-skipped/10 text-skipped",
        accent: "border-transparent bg-accent-soft text-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
