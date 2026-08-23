# Riko

An agent that recovers revenue at risk — failed payments, abandoned
checkouts, overdue invoices — and proves it with numbers, not vibes.

Riko never decides on its own how hard to push. A deterministic policy engine
sets the bounds; the model only writes inside them.

## What it does

- Classifies why a payment failed and routes it: retry, wait, email, or escalate
- Drafts and validates a recovery email — the validator rejects anything off-policy
- Tracks a held-out control group, so "recovered" means something
- Detects a promise to pay, holds off, and follows up only if it's broken
- Stops on its own: unsubscribe, dispute, fraud signal, or three tries with no reply
- Logs every decision to a tamper-evident, hash-chained audit trail

## Stack

TypeScript monorepo, pnpm workspaces.

| | |
|---|---|
| `apps/api` | Express API, webhooks, auth |
| `apps/worker` | The recovery loop — drafts, sends, sweeps, judges promises |
| `apps/web` | Dashboard, React + Vite |
| `apps/email-worker` | Cloudflare Worker for inbound email |
| `packages/core` | Policy engine, providers, gates, state machine |
| `packages/agent` | Drafting + validation |
| `packages/db` | Drizzle schema, migrations |

Postgres (Neon), Razorpay + Stripe, an NVIDIA NIM model for drafting.

## Run it

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, APP_ENCRYPTION_KEY, etc.
pnpm db:migrate
pnpm dev
```

Dashboard on `:5173`, API on `:4000`.

## Deploy

One free Render service runs the API, dashboard, and worker loop together.
One Cloudflare Worker handles inbound email. See [`DEPLOY.md`](./DEPLOY.md).

## Test

```bash
pnpm test
pnpm typecheck
```
