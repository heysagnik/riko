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

## System Architecture & Data Flow

```mermaid
flowchart TB
    %% Class Styles
    classDef ext fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef api fill:#f0f9ff,stroke:#0284c7,stroke-width:1.5px,color:#0369a1
    classDef worker fill:#faf5ff,stroke:#9333ea,stroke-width:1.5px,color:#581c87
    classDef agent fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef db fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef ui fill:#eff6ff,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a
    classDef gate fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f

    %% 1. Ingestion
    subgraph S1["1. Event Ingestion & Webhook Gateway"]
        direction TB
        GATEWAYS["Payment Gateways\n• Razorpay (payment.failed, invoice.paid)\n• Stripe (charge.failed, invoice.payment_failed)"]:::ext
        CF_INBOUND["Cloudflare Inbound Email\n• PostalMime RFC 5322 parser\n• billing+<caseId>@reply.domain.com"]:::ext
        WH_EP["apps/api · Webhook Ingestion\n• HMAC-SHA256 signature verification\n• Raw body candidate matching\n• Idempotent webhook event ledger"]:::api
        INB_EP["apps/api · /inbound/mail Endpoint\n• x-riko-inbound-secret authorization\n• Quote stripping & address tag extraction\n• Inbound classifier (bounce/unsub/reply)"]:::api
    end

    %% 2. Database & State
    subgraph S2["2. Relational Schema & Cryptographic Ledger (packages/db)"]
        direction TB
        DB_TENANT["Multi-Tenant PostgreSQL (Neon)\n• withTenant(db, tenantId, query) scoping"]:::db
        ENCRYPT_PII["AES-256-GCM Encryption\n• emailEncrypted & phoneEncrypted at rest"]:::db
        TABLES["Core Tables\n• exposures · cases · caseMessages\n• outreach · promises · agentActions"]:::db
        HASH_LEDGER["Tamper-Evident SHA-256 Ledger\nhash = SHA-256(prevHash, caseId, seq, states, reason, actor, ts)"]:::db
    end

    %% 3. Recovery Daemon
    subgraph S3["3. Autonomous Recovery Daemon Loop (apps/worker)"]
        direction TB
        POLL_LOCK["PostgreSQL Advisory Lock\nSELECT pg_try_advisory_lock('riko-worker-tick')\nRuns 10 background jobs every 15s"]:::worker
        
        subgraph WorkerJobs["Sequenced Worker Pipeline"]
            direction TB
            J1["processCircuitBreaker ➔ Auto-pause if bounce/unsub spike"]:::gate
            J2["processPromises ➔ NLP promise due date tracking"]:::gate
            J3["processWaitingCases ➔ 48h cooldown & retry evaluation"]:::gate
            J4["processNewCases ➔ 10-Gate Evaluator & Policy Router"]:::gate
            
            subgraph AgentLoop["AI Drafting & AST Validation Loop (packages/agent)"]
                LLM_REASON["1. LLM Reasoner (NVIDIA NIM · Llama 3.1 8B)\n• Evaluates failure code & merchant fault\n• Selects Tone Rung (instrument_fix, reminder, firm, etc.)"]:::agent
                LLM_DRAFT["2. Structured Email Drafter\n• Generates subject, bodyText, bodyHtml JSON"]:::agent
                VALID_PASS{"3. AST / Regex Validation Barrier\n• Exact amount & customer name match\n• Blocklist check: no discounts/waivers\n• URL allowlist: only pay & unsub URLs\n• Length: 40-160 words, subject < 78 chars"}:::gate
                SCORE_EVAL["4. Quality Scorer (0-100 Rating)\n• Rewards clarity, penalizes corporate filler"]:::agent
            end
            
            J5["processDraftingCases ➔ Runs Agent loop with 3x error retry"]:::worker
            J6["processSendingCases ➔ Nodemailer SMTP dispatch with List-Unsubscribe"]:::worker
            J7["processAgentReplies ➔ Conversational thread multi-turn replies"]:::worker
        end
    end

    %% 4. Dashboard & Operations
    subgraph S4["4. Operations Dashboard (apps/web)"]
        direction TB
        DASH_UI["React 18 + Vite + Tailwind CSS"]:::ui
        CASE_EXP["Live Case Inspector\n• Real-time state timeline\n• Full action & message thread"]:::ui
        ESC_INBOX["Human Escalations Inbox\n• Approve send / close / return"]:::ui
        METRICS_VIEW["Holdout ROI Analytics\n• Treatment Rate vs Holdout Rate\n• Incremental Lift calculation"]:::ui
        AUDIT_VERIFY["Cryptographic Audit Verifier\n• Traverses and verifies SHA-256 chain"]:::ui
    end

    %% Ingestion Links
    GATEWAYS -->|Raw Webhook Payload| WH_EP
    CF_INBOUND -->|JSON Stream| INB_EP
    WH_EP -->|Upsert Normalized Event| S2
    INB_EP -->|Append Inbound Turn| S2

    %% Worker Execution Links
    POLL_LOCK --> WorkerJobs
    S2 <-->|Poll Pending Cases| J4
    J4 --> LLM_REASON --> LLM_DRAFT --> VALID_PASS
    VALID_PASS -- "Pass" --> SCORE_EVAL --> J5 --> J6
    VALID_PASS -- "Fail (<3x)" -->|Structured Error Feedback| LLM_DRAFT
    VALID_PASS -- "Fail (>=3x)" -->|Escalate to Human| S2
    J6 -->|Dispatch Email via Verified SMTP| GATEWAYS
    J6 -->|Record Outreach & Hash Event| S2
    J7 <-->|Thread Context & Reply| S2

    %% UI Links
    S2 <-->|REST API + Better Auth| S4
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
