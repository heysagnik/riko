# How Riko Works

Riko is an autonomous revenue recovery engine. It detects payment failures, abandoned checkouts, and overdue receivables, decides whether and when to act, and runs bounded email outreach to recover funds.

---

## 1. System Topology & Lifecycle Overview

Riko separates recovery policy from message generation. A deterministic policy engine evaluates limits and safety bounds, while an LLM reasoning engine drafts messages within structured templates. Every draft is evaluated by a post-generation validation pass before dispatch.

```mermaid
flowchart TB
    %% Class Styles
    classDef ext fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef proc fill:#f1f5f9,stroke:#0284c7,stroke-width:1.5px,color:#0f172a
    classDef gate fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef agent fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef success fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef term fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    EVENT(["1. External Trigger\n(Payment Failure · Cart Abandoned · Overdue Invoice)"]):::ext
    
    subgraph IngestStage["Ingestion & Normalization (apps/api)"]
        direction TB
        SIG["HMAC-SHA256 Signature Verification\n(Matches candidate connection secrets)"]:::proc
        NORM["Payload Normalizer ➔ NormalizedEvent\n(Maps gateway error to FailureCategory)"]:::proc
        PII["AES-256-GCM Cryptographic Vault\n(Encrypts customer email & phone at rest)"]:::proc
        ARM{"Assign Experimental Arm\n(e.g., 95% Treatment / 5% Holdout)"}:::gate
    end

    subgraph GateStage["Deterministic Gate Evaluator (packages/core)"]
        direction TB
        GATES{"10 Hard Send Gates Check\n• Deliverable Email · Not Suppressed/Bounced\n• Sender Verified · Attempt Count < 3\n• Cooldown >= 48h · Contact Window (7–23h)\n• Max Exposure Age · Tenant Daily Cap"}:::gate
    end

    subgraph PolicyStage["Intervention Policy Router (packages/core)"]
        direction TB
        ROUTER{"Evaluate Intervention Policy"}:::gate
        STOP_F["Fraud Signal Detected?\n(lost_card, stolen_card, security_violation)"]:::gate
        ESC_T["High Value / Business Fault?\n(amount >= humanReviewMinor OR merchant setup error)"]:::gate
        WAIT_R["Provider Retrying or Soft Decline?\n(network_error or within retry window)"]:::gate
        OUT_R["Actionable Recovery Outreach\n(Selects tone rung: instrument_fix, reminder, etc.)"]:::gate
    end

    subgraph AgentStage["AI Reasoning & Validation Barrier (packages/agent)"]
        direction TB
        REASON["LLM Reasoner (NVIDIA NIM · Llama 3.1 8B)\nEvaluates case context & customer history"]:::agent
        DRAFT["Structured Email Drafter\nGenerates { subject, bodyText, bodyHtml }"]:::agent
        VALID{"Deterministic AST/Regex Validator\n• Exact formatted amount & customer name\n• Zero blocklisted terms (discount, refund, waive)\n• Permitted URLs ONLY (pay & unsub links)\n• Word count [40, 160] & subject < 78 chars"}:::gate
        RETRY{"Retry Count < 3?"}:::gate
        SCORE["Quality Scorer (0–100 Rating)\nRewards clarity & tone; penalizes pressure & filler"]:::agent
    end

    subgraph DispatchStage["Dispatch & Ledger Commitment (apps/worker)"]
        direction TB
        DISPATCH["SMTP Dispatch (Nodemailer)\n• Custom Message-ID · List-Unsubscribe One-Click\n• Branded HTML & plain-text multipart"]:::proc
        LEDGER["SHA-256 Audit Ledger Append\nComputes chained event hash and commits transition"]:::proc
    end

    subgraph TwoWayStage["Two-Way Inbound & Promise Engine"]
        direction TB
        INB_RECV["Inbound Mail Webhook (Cloudflare)\n• Strip quoted reply thread · Classify message type"]:::proc
        PROMISE_TEST{"Customer Intent Classification"}:::gate
        PROM_STATE["PROMISED State\nFreeze outreach until promised date + 24h grace"]:::proc
        CONV_REP["Contextual Agent Reply\nMulti-turn grounded Q&A (max 5 replies)"]:::agent
    end

    subgraph Outcomes["Resolution States"]
        REC(["RECOVERED\n(Payment captured & incremental lift recorded)"]):::success
        SKIP(["SKIPPED\n(Holdout control / Fraud stop / Unsubscribed)"]):::term
        ESC(["ESCALATED\n(Human operator review queue)"]):::term
        LOST(["LOST\n(Attempts exhausted without payment)"]):::term
    end

    %% Pipeline flow
    EVENT --> SIG --> NORM --> PII --> ARM
    ARM -- "Holdout Control Arm" --> SKIP
    ARM -- "Treatment Arm" --> GATES

    GATES -- "Failed (Quiet hours, Cooldown, Daily cap)" --> SKIP
    GATES -- "Passed" --> ROUTER

    ROUTER --> STOP_F
    STOP_F -- "Yes (Fraud)" --> SKIP
    STOP_F -- "No" --> ESC_T
    ESC_T -- "Yes" --> ESC
    ESC_T -- "No" --> WAIT_R
    WAIT_R -- "Yes" --> WAIT_STATE["WAITING State\n(Defer until retry timestamp)"]:::proc
    WAIT_R -- "No" --> OUT_R

    OUT_R --> REASON --> DRAFT --> VALID
    VALID -- "Failed" --> RETRY
    RETRY -- "Yes (< 3x)" -->|Structured Error Feedback| DRAFT
    RETRY -- "No (3x Failed)" --> ESC
    VALID -- "Passed" --> SCORE --> DISPATCH --> LEDGER

    LEDGER --> INB_RECV --> PROMISE_TEST
    PROMISE_TEST -- "Promise to Pay Extracted" --> PROM_STATE
    PROMISE_TEST -- "Customer Question" --> CONV_REP --> DISPATCH
    PROMISE_TEST -- "No Reply (48h elapsed)" --> GATES

    %% Resolutions
    PROM_STATE -- "Paid on/before Due Date" --> REC
    PROM_STATE -- "Promise Broken" --> GATES
    DISPATCH -.->|Webhook: payment.captured| REC
    GATES -- "Attempts >= 3" --> LOST
```

---

## 2. Core Monorepo Architecture

```mermaid
flowchart LR
    %% Class Styles
    classDef appNode fill:#f0f9ff,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef pkgNode fill:#f8fafc,stroke:#475569,stroke-width:1.5px,color:#0f172a
    classDef sharedNode fill:#fdf4ff,stroke:#a855f7,stroke-width:1.5px,color:#581c87

    subgraph Apps["apps/ (Runtime Deployables)"]
        direction TB
        API["apps/api\n• Express REST API & Webhooks\n• HMAC Signature Verification\n• Inbound Mail Receiver\n• Better Auth Sessions"]:::appNode
        WORKER["apps/worker\n• Recovery Daemon Loop\n• Postgres Advisory Lock\n• 10 Sequenced Job Pipelines\n• Nodemailer SMTP Dispatch"]:::appNode
        WEB["apps/web\n• React 18 + Vite + Tailwind\n• Case Inspector & Action Log\n• Escalations Management\n• Holdout Lift Visualizer"]:::appNode
        EMAIL_W["apps/email-worker\n• Cloudflare Worker\n• Streamed PostalMime Parser\n• Inbound Webhook Dispatcher"]:::appNode
    end

    subgraph Packages["packages/ (Core Internal Libraries)"]
        direction TB
        CORE["packages/core\n• Case State Machine Engine\n• 10-Gate Safety Evaluator\n• Policy Intervention Router\n• NLP Promise Date Parser\n• Provider Adapters (Razorpay/Stripe)"]:::pkgNode
        AGENT["packages/agent\n• LLM Reasoning & Prompts\n• AST / Regex Draft Validator\n• Quality Scoring Engine\n• Escalation Signal Detector"]:::pkgNode
        DB["packages/db\n• Drizzle ORM Schema\n• withTenant Row Scoping\n• SHA-256 Audit Ledger Chaining\n• Postgres Migrations"]:::pkgNode
        SHARED["packages/shared\n• TypeScript Types & Enums\n• Zod API Validation Schemas\n• Shared Request/Response Types"]:::sharedNode
    end

    %% Dependency Links
    API --> DB & CORE & SHARED
    WORKER --> DB & CORE & AGENT & SHARED
    WEB --> SHARED
    AGENT --> CORE & SHARED
    CORE --> SHARED
    DB --> SHARED
    EMAIL_W -.->|HTTP POST /inbound/mail| API
```

---

## 3. Case State Machine

Cases move through a finite state machine enforced by [`packages/core/src/cases/state-machine.ts`](./packages/core/src/cases/state-machine.ts).

```mermaid
stateDiagram-v2
    [*] --> NEW: Ingested via Webhook / Cart / Invoice

    NEW --> SKIPPED: gates_failed / fraud_signal / holdout_arm
    NEW --> RECOVERED: payment_succeeded
    NEW --> DRAFTING: gates_passed
    NEW --> ESCALATED: above_human_threshold / business_fault

    DRAFTING --> SENDING: draft_valid
    DRAFTING --> ESCALATED: draft_invalid_exhausted (3x retries)
    DRAFTING --> RECOVERED: payment_succeeded

    SENDING --> WAITING: sent via SMTP
    SENDING --> RECOVERED: payment_succeeded

    WAITING --> PROMISED: promise_captured ("will pay Friday noon")
    WAITING --> WAITING: agent_answered (customer inquiry resolved)
    WAITING --> ESCALATED: customer_replied (dispute / complex request)
    WAITING --> SKIPPED: customer_unsubscribed / hard_bounced
    WAITING --> DRAFTING: cooldown_elapsed_retry (gap >= 48h, attempt < 3)
    WAITING --> LOST: cooldown_elapsed_exhausted (attempt = 3)
    WAITING --> RECOVERED: payment_succeeded

    PROMISED --> RECOVERED: payment_succeeded (promise_kept)
    PROMISED --> WAITING: promise_broken (grace period expired)
    PROMISED --> PROMISED: agent_answered (answered during promise)
    PROMISED --> ESCALATED: reply_after_promise / dispute
    PROMISED --> SKIPPED: customer_unsubscribed / hard_bounced
    PROMISED --> LOST: cooldown_elapsed_exhausted

    ESCALATED --> DRAFTING: merchant_approved (approved by operator)
    ESCALATED --> LOST: merchant_closed (closed unrecoverable)
    ESCALATED --> RECOVERED: payment_succeeded

    RECOVERED --> [*]
    SKIPPED --> [*]
    LOST --> [*]
```

### Terminal States
- `RECOVERED`: The payment was captured and verified.
- `SKIPPED`: Case halted due to hard bounce, unsubscribe, fraud signal, or control group assignment.
- `ESCALATED`: Routed to merchant review due to high value, dispute, or validation failure.
- `LOST`: Maximum outreach attempts exhausted without recovery.

---

## 4. Send Gates & Policy Engine

Before any draft is generated, [`packages/core/src/gates/evaluate.ts`](./packages/core/src/gates/evaluate.ts) executes hard safety checks:

```mermaid
flowchart TD
    %% Class Styles
    classDef check fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef pass fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef stop fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    START(["Case Ready for Gate Check"]):::check
    
    G1{"1. Deliverable Email?\n(customerHasDeliverableEmail)"}:::check
    G2{"2. Unsubscribed or Bounced?\n(customerUnsubscribed || customerHasBounced)"}:::check
    G3{"3. Customer Suppressed?\n(customerSuppressed in tenant list)"}:::check
    G4{"4. Verified Sender Configured?\n(tenantHasVerifiedSender SMTP active)"}:::check
    G5{"5. Max Attempts Reached?\n(attemptCount >= 3)"}:::check
    G6{"6. Cooldown Elapsed?\n(hoursSinceLastOutreach < 48h)"}:::check
    G7{"7. Failure Recoverable?\n(!failureRecoverable)"}:::check
    G8{"8. Exposure Too Old?\n(Age > 21d payment, 7d cart, 30d invoice)"}:::check
    G9{"9. Contact Window Open?\n(Local Hour 07:00–23:00 customer local time)"}:::check
    G10{"10. Tenant Throttled?\n(tenantPaused || !tenantWithinDailySendCap)"}:::check

    PASS(["Gate Passed ➔ Move to Policy Routing"]):::pass
    FAIL(["Gate Failed ➔ Stop / Defer Execution"]):::stop

    START --> G1
    G1 -- "No" --> FAIL
    G1 -- "Yes" --> G2
    G2 -- "Yes" --> FAIL
    G2 -- "No" --> G3
    G3 -- "Yes" --> FAIL
    G3 -- "No" --> G4
    G4 -- "No" --> FAIL
    G4 -- "Yes" --> G5
    G5 -- "Yes" --> FAIL
    G5 -- "No" --> G6
    G6 -- "Yes" --> FAIL
    G6 -- "No" --> G7
    G7 -- "No" --> FAIL
    G7 -- "Yes" --> G8
    G8 -- "Yes" --> FAIL
    G8 -- "No" --> G9
    G9 -- "No" --> FAIL
    G9 -- "Yes" --> G10
    G10 -- "Yes" --> FAIL
    G10 -- "No" --> PASS
```

---

## 5. Reasoning, Drafting & Validation

```mermaid
flowchart TD
    classDef input fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef model fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef test fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef pass fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef fail fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    FACTS["Case Facts & Context\n• Customer Name\n• Exact Amount (e.g. INR 2400.00)\n• Payment / Unsubscribe URLs\n• Failure Reason & Selected Tone Rung"]:::input
    
    PROMPT["NVIDIA NIM Drafter (Llama 3.1 8B)\nGenerates Structured JSON: { subject, bodyText, bodyHtml }"]:::model
    
    FACTS --> PROMPT
    PROMPT --> DRAFT["Candidate Draft Output"]:::model
    
    subgraph ValidatorSuite["Deterministic Validation Barrier (packages/agent)"]
        direction TB
        R1{"Rule 1: Exact Amount Match\nIs exact formatted amount string present in both bodyText & bodyHtml?"}:::test
        R2{"Rule 2: Customer Name Present\nIs customer name present in both bodyText & bodyHtml?"}:::test
        R3{"Rule 3: Blocklist Check\nAre terms like 'discount', 'refund', 'credit', 'waive' absent?"}:::test
        R4{"Rule 4: Rung Tone Compliance\nAre forbidden terms for this rung absent?"}:::test
        R5{"Rule 5: URL Allowlist\nAre ONLY the updatePaymentMethodUrl and unsubscribeUrl present?"}:::test
        R6{"Rule 6: Word Count & Subject Bounds\nIs body 40–160 words and subject < 78 chars?"}:::test
    end

    DRAFT --> R1 --> R2 --> R3 --> R4 --> R5 --> R6
    
    R1 & R2 & R3 & R4 & R5 & R6 -- "Violation Detected" --> ERR["Record Validation Failure\n(Extract specific error message)"]:::fail
    
    ERR --> RETRY_CHECK{"Attempt Count < 3?"}:::test
    RETRY_CHECK -- "Yes" --> FEEDBACK["Feed Specific Failure Feedback into Prompt"]:::model --> PROMPT
    RETRY_CHECK -- "No (3x Failed)" --> ESC_OUT["Escalate to Merchant Dashboard"]:::fail

    R6 -- "All Checks Passed" --> SCORE["Quality Scoring Engine (0–100)\n• +10 Specific failure reason words\n• +12 Ideal body length (55–110 words)\n• +8 Reassuring tone ('nothing has been cancelled')\n• -8 Corporate filler phrases\n• -6 Pressure tactics ('immediately', 'urgent')"]:::pass
    SCORE --> READY["Ready for SMTP Dispatch (State: SENDING)"]:::pass
```

### Communication Tone Rungs
- `instrument_fix`: Friendly notification for soft declines, expired cards, or authentication issues.
- `resume_checkout`: Cart abandonment nudge with a saved checkout link (no debt framing).
- `reminder`: First gentle reminder for overdue invoices.
- `firm`: Professional follow-up on persistent unpaid invoices.
- `formal`: Late-stage invoice notice stating outstanding amounts plainly.
- `merchant_fault`: Transparent notice for merchant gateway configuration issues.

---

## 6. Two-Way Email & Conversation Threading

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant CF as Cloudflare Email Routing
    participant Worker as apps/email-worker
    participant API as apps/api (/inbound/mail)
    participant DB as packages/db
    participant Daemon as apps/worker (processAgentReplies)
    participant SMTP as Merchant SMTP Server

    Customer->>CF: Replies to recovery email ("Can I pay via UPI?")
    CF->>Worker: Streams RFC 5322 MIME payload
    Worker->>API: POST /inbound/mail (Headers, Parsed Body)
    API->>API: Validate x-riko-inbound-secret
    API->>API: stripQuotedContent (Extract clean customer reply)
    API->>API: classifyInbound (Filter auto-replies, bounces, unsubs)
    API->>DB: Append message turn to caseMessages & set awaitingAgentReply = true
    
    loop Worker Polling Interval (15s)
        Daemon->>DB: Poll active cases with awaitingAgentReply = true
        Daemon->>Daemon: Verify reply limit (< 5) & check dispute signals
        Daemon->>Daemon: LLM drafts answer quoting thread history & providing payment URL
        Daemon->>Daemon: Validate reply against rules (no discounts/promises)
        Daemon->>SMTP: Send email with References & In-Reply-To headers
        SMTP-->>Customer: Deliver reply into customer's existing email thread
        Daemon->>DB: Record outbound message & reset awaitingAgentReply
    end
```

---

## 7. Promise-to-Pay Intelligence

Customers often reply with scheduled commitments (*"I'll pay on Monday"* or *"Will clear this tomorrow by 5pm"*).

```mermaid
flowchart LR
    classDef in fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef proc fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef test fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef succ fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef err fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    INB["Customer Inbound Email"]:::in --> NLP["NLP Date & Intent Extractor\n(packages/core/src/promises/extract.ts)"]:::proc
    
    NLP -- "Intent: 'will pay' / 'transferring'\nTarget Date: e.g. Friday 12:00 UTC\nConfidence >= 0.60" --> PROMISED["State: PROMISED\n• Freeze outreach emails\n• Set deadline + 24h grace period"]:::proc
    
    PROMISED --> CHECK{"Check Settlement at Deadline"}:::test
    CHECK -- "Payment Captured" --> REC["RECOVERED\n(Reason: promise_kept)"]:::succ
    CHECK -- "No Payment After Grace Period" --> BROKE["WAITING\n(Reason: promise_broken · Resume Cadence)"]:::err
```

---

## 8. Incremental Lift & Attribution

To distinguish true agent impact from natural self-healing, Riko uses randomized holdout control groups:

```mermaid
flowchart TB
    classDef in fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef split fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef group fill:#f1f5f9,stroke:#0284c7,stroke-width:1.5px,color:#0f172a
    classDef math fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b

    FAIL["Total Ingested Exposure Cohort\n(Failed Payments / Invoices)"]:::in --> SPLIT{"Randomized Arm Split\n(e.g., 95% Treatment / 5% Holdout)"}:::split
    
    SPLIT -- "Treatment Arm (95%)" --> TREAT["Active Recovery Engine\n(Intelligent multi-rung outreach)"]:::group
    SPLIT -- "Holdout Arm (5%)" --> HOLD["Silent Control Group\n(Zero outreach sent)"]:::group
    
    TREAT --> TR_RATE["Treatment Recovery Rate\n(e.g., 48.2%)"]:::group
    HOLD --> HO_RATE["Holdout Recovery Rate (Natural Self-Healing)\n(e.g., 22.1%)"]:::group
    
    TR_RATE & HO_RATE --> LIFT["Incremental Lift Calculation\nLift = Treatment Rate (48.2%) - Holdout Rate (22.1%) = +26.1%"]:::math
    
    LIFT --> ROI["Proven Net Value Generated\n(Lift × Total Treatment Volume) - Outreach Cost"]:::math
```

---

## 9. Cryptographic Audit Ledger

Every case state transition and LLM interaction appends to a SHA-256 hash chain:

$$\text{hash}_n = \text{SHA-256}\Big(\big[\text{prevHash}, \text{caseId}, \text{fromState}, \text{toState}, \text{reason}, \text{actor}, \text{createdAt}\big]\Big)$$

```mermaid
flowchart LR
    classDef genesis fill:#f8fafc,stroke:#475569,stroke-width:1.5px,color:#0f172a
    classDef event fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95

    G["Genesis Block\nHash: 0000...0000"]:::genesis --> E1["Event 1: NEW ➔ DRAFTING\n• prevHash: 0000...0000\n• actor: 'system'\n• Hash: e3b0c442..."]:::event
    
    E1 --> E2["Event 2: DRAFTING ➔ SENDING\n• prevHash: e3b0c442...\n• actor: 'agent'\n• Hash: 8f4c21b9..."]:::event
    
    E2 --> E3["Event 3: SENDING ➔ WAITING\n• prevHash: 8f4c21b9...\n• actor: 'system'\n• Hash: 1a7d903e..."]:::event
    
    E3 --> E4["Event 4: WAITING ➔ RECOVERED\n• prevHash: 1a7d903e...\n• reason: 'payment_succeeded'\n• Hash: 49b28a1c..."]:::event
```

- **Genesis Hash**: Initial event starts with $64\text{ zeros}$.
- **Verification**: Integrity can be validated programmatically via `/api/cases/:caseId/audit` or exported to CSV. Any manual database tampering breaks the hash chain.

---

## 10. Security & Multi-Tenancy

- **Row-Level Tenant Isolation**: All queries execute within `withTenant(db, tenantId, ...)` scoping.
- **PII Encryption**: Customer emails and phone numbers are encrypted at rest with `AES-256-GCM`.
- **Constant-Time Comparisons**: Security tokens and inbound webhook secrets use `crypto.timingSafeEqual`.
- **Session Authentication**: Handled by Better Auth with secure HTTP-only cookies.
