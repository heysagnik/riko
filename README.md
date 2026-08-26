# Riko

> **An autonomous revenue-recovery engine for failed payments, abandoned checkouts, and overdue invoices — with guardrails the merchant controls.**

Riko separates judgment from obedience. A reasoning model decides what to say and when; a deterministic policy engine decides what is *allowed*. Every draft passes an AST and regex validation barrier before a single email leaves, and every bound the agent runs within is merchant-configurable — enforced in code, not in prompt hope.

---

## Highlights

- **Merchant-tunable agent**: Cadence, contact windows, money rules (minimum chase amounts, high-value thresholds), tone, persistence, language, and standing instructions — all editable in Settings → Agent, all enforced by deterministic code *after* the model decides.
- **Guided onboarding**: One modal connects Razorpay, sets up your mail service, and introduces the agent. No forms archaeology.
- **Deterministic safety gates**: Contact windows in the customer's local time, attempt caps, cooldowns, verified senders, daily send caps, and a minimum-amount floor — eleven hard gates before any draft is generated.
- **AST/regex draft validation**: Every draft is validated against exact amounts, customer names, and zero-tolerance blocklists (no unauthorized discounts, waivers, or invented deadlines). Three strikes and the case goes to a human.
- **Conversational two-way email**: Autonomous inbound reply classification, quote stripping, context-aware answers, and sentiment escalation.
- **Promise-to-pay intelligence**: Extracts payment commitments (*"I'll clear this Friday noon"*), pauses outreach until due, tracks settlement, and resumes the ladder when a promise breaks.
- **Scientific holdout control groups**: A randomized holdout (merchant-configurable, default 5%) proves incremental recovery lift over natural self-healing — so the recovery number is honest.
- **Tamper-evident audit ledger**: SHA-256 hash-chains log every state transition and LLM interaction. Manual database edits break the chain, visibly.
- **Multi-tenant security**: Row-level isolation with AES-256-GCM encryption for all customer PII.

---

## System Architecture

![Riko Architecture](./assets/architecture.svg)

---

## Monorepo Structure

| Package / App | Purpose |
|---|---|
| [`apps/api`](./apps/api) | Express API, signed webhook ingestion, session auth, and escalations |
| [`apps/worker`](./apps/worker) | 10-stage background recovery loop running on PostgreSQL advisory locks |
| [`apps/web`](./apps/web) | React + Vite merchant dashboard and real-time case inspector |
| [`apps/email-worker`](./apps/email-worker) | Cloudflare Worker parsing inbound MIME email streams |
| [`apps/keepalive-worker`](./apps/keepalive-worker) | Cloudflare Cron Worker pinging `/health` to keep free-tier hosts warm |
| [`packages/core`](./packages/core) | Finite state machine, send gates, policy routing, and provider adapters |
| [`packages/agent`](./packages/agent) | Reasoning engine, drafting loop, rule validators, and scoring |
| [`packages/db`](./packages/db) | Drizzle schema, tenant isolation helpers, and cryptographic audit ledger |
| [`packages/shared`](./packages/shared) | Shared TypeScript schemas, types, and API contracts |

---

## Getting Started

### Prerequisites

- Node.js `>= 22.0.0 < 25.0.0`
- pnpm `^9.15.1`
- PostgreSQL (Neon recommended)
- NVIDIA NIM API Key (`meta/llama-3.1-8b-instruct`)

### 1. Install dependencies

```bash
git clone https://github.com/heysagnik/riko.git
cd riko
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Generate 32-byte hex keys:

```bash
openssl rand -hex 32 # APP_ENCRYPTION_KEY
openssl rand -hex 32 # BETTER_AUTH_SECRET
openssl rand -hex 24 # INBOUND_MAIL_SECRET
```

Populate the required keys in `.env`:

```env
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
APP_ENCRYPTION_KEY=...
BETTER_AUTH_SECRET=...
NVIDIA_API_KEY=...
INBOUND_MAIL_SECRET=...
```

### 3. Migrate and run

```bash
pnpm db:migrate
pnpm dev
```

- Dashboard: `http://localhost:5173`
- API Server: `http://localhost:4000`

Sign up and the dashboard walks you through the rest: connect Razorpay, point it at your mail server, and meet your agent.

---

## Verification

```bash
pnpm test        # Run workspace test suites
pnpm typecheck   # Typecheck all packages
pnpm lint        # Run linter
```

---

## Documentation

- **[HOW_IT_WORKS.md](./HOW_IT_WORKS.md)** — Detailed engine architecture, lifecycle state transitions, drafting rules, and attribution.
- **[DEPLOY.md](./DEPLOY.md)** — Production deployment guide for Render and Cloudflare Email Routing.
