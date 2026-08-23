# Use the `figure-lg` token for the Overview "Recovered" headline figure

Written against: unavailable (working tree has no commits)

## Evidence chain

- Surface: `/dashboard` (Overview page), the "Recovered" headline metric
- Problem: The headline figure is set with a one-off arbitrary Tailwind size (`text-[44px] font-semibold leading-none tracking-[-0.02em] tabular-nums`) instead of the documented `figure-lg` type token, and does not reuse the `MetricValue` component
- Design evidence: `DESIGN.md` §3 "Type" scale defines `figure-lg 32/1.1 600, tabular — headline metrics`; §5 states `MetricValue` — "a label-over-figure pair with tabular numerals and an optional delta... applied in a dozen places and hardcoding it each time guarantees drift"
- Owner: `apps/web/src/components/metric-value.tsx` (renders `text-figure-lg tabular-nums text-ink` for its value slot); other headline metrics already consume it correctly via the same token, e.g. `apps/web/src/routes/dashboard/exceptions-page.tsx:78,83` and `apps/web/src/routes/dashboard/escalations-page.tsx:100,104`
- Scope and affected surfaces: `apps/web/src/routes/dashboard/overview-page.tsx` only
- Uncertainty: None — this is a direct token substitution with an existing, already-used class

## Design decision

Replace the hardcoded `text-[44px]` figure on the Overview page with the documented `text-figure-lg` token, matching the size/weight/tracking used by every other headline metric in the dashboard (Exceptions, Needs you). This removes the one instance of drift from the type scale on the product's single most important number.

## Reuse

- `text-figure-lg` (Tailwind token backing DESIGN.md's `figure-lg` scale entry)
- Exemplar: `apps/web/src/routes/dashboard/exceptions-page.tsx:78` — `<span className="text-figure-lg tabular-nums text-ink">{formatAmount(deliberateTotal, currency)}</span>`

No new primitive is required.

## Changes

1. `apps/web/src/routes/dashboard/overview-page.tsx`
   - Change: In the `<section className="mt-10">` block rendering the "Recovered" metric, replace `<p className="mt-2 text-[44px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">` with `<p className="mt-2 text-figure-lg tabular-nums text-ink">` (drop the now-redundant `font-semibold`, `leading-none`, and `tracking-[-0.02em]` utilities, since `text-figure-lg` already carries weight 600 and line-height 1.1 per the token definition — verify against the compiled Tailwind config that `text-figure-lg` indeed sets these before dropping them; if it only sets font-size, keep `font-semibold` and drop only the arbitrary size/leading/tracking values that duplicate the token).
   - Preserve: The surrounding label (`text-label uppercase text-ink-muted`, "Recovered"), the `mt-2` spacing, and the amount value/formatting logic (`formatAmount(...)`) — only the type-scale class changes.
   - Verify: Rendered figure visually matches the size/weight of the "Waiting on you" and "Deliberately left alone" headline figures elsewhere in the dashboard when viewed side by side.

## Scope

- Inherit: Overview page only (`overview-page.tsx`)
- Verify: No other page references the same `text-[44px]` pattern (confirmed via repo-wide grep at audit time — only this one instance exists)
- Exclude: Any change to `MetricValue` itself, to other pages' figures, or to the landing page's `figure-lg` usages (already correct)

## Validation

- Product: Load `/dashboard` (Overview) with an active connection and confirm the "Recovered" amount renders and remains legible and prominent.
- Interface: Check Overview at 375px, 768px, and desktop widths; confirm no layout shift versus the current arbitrary size (figure-lg is smaller — 32px vs 44px — so surrounding vertical spacing should be checked for awkward gaps at `mt-2`/`mt-3`).
- System: Confirm the change reuses `text-figure-lg` exactly as used in `exceptions-page.tsx` / `escalations-page.tsx`, with no new arbitrary-value class introduced.
- Repository: `grep -rn "text-\[44px\]" apps/web/src` → no matches after the change.

## Stop conditions

- Stop if `text-figure-lg` does not compile to 32px/600/1.1 as documented (e.g. Tailwind config defines it differently from DESIGN.md) — reconcile against the actual token definition before applying, rather than assuming DESIGN.md's numbers are current.

## Design documentation

- After acceptance and validation: none — this change conforms to already-documented decisions and does not alter DESIGN.md.
