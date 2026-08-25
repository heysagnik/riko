# Riko

> **An autonomous, deterministic revenue recovery engine for failed payments, abandoned checkouts, and overdue invoices.**

Riko decouples recovery policy from message generation: a deterministic policy engine establishes the safety bounds, while a reasoning model drafts within them, enforced by post-generation AST and regex validators.

---

## Highlights

- **Deterministic bounds**: Hard gates for contact windows (07:00–23:00 local customer time), max 3 attempts per case, strict 48h cooldowns, verified senders, and daily send caps.
- **AST/regex draft validation**: Every draft is validated against exact amounts, customer names, and zero-tolerance blocklists (no unauthorized discounts, waivers, or fake deadlines).
- **Conversational two-way email**: Autonomous inbound reply classification, quote stripping, context-aware answers, and sentiment escalation.
- **Promise-to-pay intelligence**: Extracts payment commitments (e.g. *"I'll clear this Friday noon"*), pauses outreach until due, and tracks settlement.
- **Scientific holdout control groups**: Randomized holdout groups (default 5–25%) prove incremental recovery lift over natural self-healing.
- **Tamper-evident audit ledger**: SHA-256 cryptographic hash-chains log every state transition and LLM interaction.
- **Multi-tenant security**: Row-level isolation with AES-256-GCM encryption for all customer PII.

---

## Architecture

```mermaid
flowchart TD
    subgraph Ingest["1. Ingestion Layer"]
        RP["Razorpay / Stripe Webhooks"]
        CF["Cloudflare Inbound Email"]
    end

    subgraph API["apps/api (Express REST API)"]
        AUTH["Better Auth & Sessions"]
        WH["Webhook Ingestion & HMAC Verify"]
        INB["/inbound/mail Parser"]
        ESC["Escalations & Manual Actions"]
        PUB["Public Payment & Unsub URLs"]
    end

    subgraph Storage["Data & Multi-Tenancy (packages/db)"]
        DB[("Neon PostgreSQL")]
        RLS["withTenant Scoping"]
        PII["AES-256-GCM Encrypted PII"]
        LEDGER["SHA-256 Hash Chain Ledger"]
    end

    subgraph Daemon["apps/worker (Recovery Loop)"]
        LOCK["Postgres Advisory Lock"]
        GATES["Send Gates Evaluator"]
        ROUTER["Deterministic Policy Router"]
        DRAFT["LLM Drafter (NVIDIA NIM)"]
        VALID["Post-Draft AST Validator"]
        DISPATCH["SMTP Dispatch (Nodemailer)"]
    end

    subgraph UI["apps/web (Dashboard)"]
        DASH["React 18 + Vite + Tailwind"]
        INSPECT["Real-Time Case Inspector"]
        AUDIT["Audit Chain Verifier"]
    end

    RP --> WH
    CF --> INB
    WH --> DB
    INB --> DB

    LOCK --> GATES
    GATES --> ROUTER
    ROUTER --> DRAFT
    DRAFT --> VALID
    VALID --> DISPATCH
    DISPATCH --> DB

    DB --- RLS
    DB --- PII
    DB --- LEDGER

    DB <--> API
    API <--> UI
```

### Monorepo Structure

| Package / App | Purpose |
|---|---|
| [`apps/api`](./apps/api) | Express API, signed webhook ingestion, session auth, and escalations |
| [`apps/worker`](./apps/worker) | 10-stage background recovery loop running on PostgreSQL advisory locks |
| [`apps/web`](./apps/web) | React + Vite merchant dashboard and real-time case inspector |
| [`apps/email-worker`](./apps/email-worker) | Cloudflare Worker parsing inbound MIME email streams |
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
