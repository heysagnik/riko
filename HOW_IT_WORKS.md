# How Riko Works

Riko is an autonomous revenue recovery engine. It detects payment failures, abandoned checkouts, and overdue receivables, decides whether and when to act, and runs bounded email outreach to recover funds. The merchant sets the bounds — the agent works inside them, and code makes sure it stays that way.

---

## 1. System Architecture & Topology

Riko separates recovery policy from message generation. A deterministic policy engine evaluates limits and safety bounds, while an LLM reasoning engine drafts messages within structured templates. Every draft is evaluated by a post-generation validation pass before dispatch.

![Riko Architecture](./assets/architecture.svg)

---

## 2. End-to-End Recovery Event Lifecycle

Every payment failure, cart abandonment, or invoice due event moves through an end-to-end processing pipeline:

![Recovery Lifecycle](./assets/recovery-lifecycle.svg)

---

## 3. Core Monorepo Architecture

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
        WEB["apps/web\n• React 19 + Vite + Tailwind\n• Case Inspector & Action Log\n• Agent Settings & Connectors\n• Guided Onboarding Modal\n• Holdout Lift Visualizer"]:::appNode
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
    EMAIL_W --> API
```

---

## 4. Case State Machine

Cases move through a finite state machine enforced by [`packages/core/src/cases/state-machine.ts`](./packages/core/src/cases/state-machine.ts).

![State Machine](./assets/state-machine.svg)

### State Definitions & Transitions

| From State | Trigger | To State | Reason |
|---|---|---|---|
| `NEW` | `gates_passed` | `DRAFTING` | Eligible for outreach |
| `NEW` | `gates_failed` | `SKIPPED` | Holdout, fraud code, or quiet hours |
| `NEW` | `payment_succeeded` | `RECOVERED` | Paid immediately |
| `DRAFTING` | `draft_valid` | `SENDING` | Draft passed all AST validation rules |
| `DRAFTING` | `draft_invalid_exhausted` | `ESCALATED` | Failed validation 3x |
| `SENDING` | `sent` | `WAITING` | Dispatched via SMTP; 48h cooldown begins |
| `WAITING` | `promise_captured` | `PROMISED` | Customer committed to future date |
| `WAITING` | `cooldown_elapsed_retry` | `DRAFTING` | 48h elapsed and attempt count < 3 |
| `WAITING` | `cooldown_elapsed_exhausted`| `LOST` | 3 outreach attempts exhausted |
| `WAITING` | `customer_replied` | `ESCALATED` | Dispute or unhandled customer intent |
| `WAITING` | `customer_unsubscribed` | `SKIPPED` | Opted out via one-click link |
| `PROMISED` | `payment_succeeded` | `RECOVERED` | Promise kept by customer |
| `PROMISED` | `promise_broken` | `WAITING` | Grace period elapsed without settlement |
| `ANY` | `payment_succeeded` | `RECOVERED` | Payment captured in gateway |

---

## 5. Send Gates & Policy Engine

Before any draft is generated, [`packages/core/src/gates/evaluate.ts`](./packages/core/src/gates/evaluate.ts) executes hard safety checks. The numbers below are per-tenant defaults — attempt caps, cooldowns, contact window, age limits, and a minimum-amount floor are all editable under Settings → Agent, and the gate code enforces whatever the merchant set with the same rigidity:

```mermaid
flowchart TD
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

    PASS(["Gate Passed -> Move to Policy Routing"]):::pass
    FAIL(["Gate Failed -> Stop / Defer Execution"]):::stop

    START --> G1
    G1 -->|No| FAIL
    G1 -->|Yes| G2
    G2 -->|Yes| FAIL
    G2 -->|No| G3
    G3 -->|Yes| FAIL
    G3 -->|No| G4
    G4 -->|No| FAIL
    G4 -->|Yes| G5
    G5 -->|Yes| FAIL
    G5 -->|No| G6
    G6 -->|Yes| FAIL
    G6 -->|No| G7
    G7 -->|No| FAIL
    G7 -->|Yes| G8
    G8 -->|Yes| FAIL
    G8 -->|No| G9
    G9 -->|No| FAIL
    G9 -->|Yes| G10
    G10 -->|Yes| FAIL
    G10 -->|No| PASS
```

---

## 6. AI Reasoning, Drafting & AST Validation

The merchant shapes the voice; the validator keeps the promises. Tone and persistence preferences, high-value flags, and standing written guidance are injected into the prompt as advisory context — sanitized of markup and explicitly subordinate to the rules — while the validation barrier below stays identical no matter what a merchant writes.

```mermaid
flowchart TD
    classDef input fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef model fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef test fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef pass fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef fail fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    FACTS["Case Facts & Context\n• Customer Name\n• Exact Amount (e.g. INR 2400.00)\n• Payment / Unsubscribe URLs\n• Failure Reason & Selected Tone Rung"]:::input
    
    PROMPT["Mistral Drafter (mistral-small-latest)\nGenerates Structured JSON: { subject, bodyText, bodyHtml }"]:::model
    
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
    
    R1 -->|Violation| ERR["Record Validation Failure\n(Extract specific error message)"]:::fail
    R2 -->|Violation| ERR
    R3 -->|Violation| ERR
    R4 -->|Violation| ERR
    R5 -->|Violation| ERR
    R6 -->|Violation| ERR
    
    ERR --> RETRY_CHECK{"Attempt Count < 3?"}:::test
    RETRY_CHECK -->|Yes| FEEDBACK["Feed Specific Failure Feedback into Prompt"]:::model --> PROMPT
    RETRY_CHECK -->|No: 3x Failed| ESC_OUT["Escalate to Merchant Dashboard"]:::fail

    R6 -->|All Checks Passed| SCORE["Quality Scoring Engine (0–100)\n• +10 Specific failure reason words\n• +12 Ideal body length (55–110 words)\n• +8 Reassuring tone ('nothing has been cancelled')\n• -8 Corporate filler phrases\n• -6 Pressure tactics ('immediately', 'urgent')"]:::pass
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

## 7. Two-Way Email & Conversation Threading

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

## 8. Promise-to-Pay Intelligence

Customers often reply with scheduled commitments (*"I'll pay on Monday"* or *"Will clear this tomorrow by 5pm"*).

```mermaid
flowchart LR
    classDef in fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef proc fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef test fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef succ fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef err fill:#fef2f2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    INB["Customer Inbound Email"]:::in --> NLP["NLP Date & Intent Extractor\n(packages/core/src/promises/extract.ts)"]:::proc
    
    NLP -->|Intent: 'will pay' / 'transferring'<br/>Confidence >= 0.60| PROMISED["State: PROMISED\n• Freeze outreach emails\n• Set deadline + 24h grace period"]:::proc
    
    PROMISED --> CHECK{"Check Settlement at Deadline"}:::test
    CHECK -->|Payment Captured| REC["RECOVERED\n(Reason: promise_kept)"]:::succ
    CHECK -->|No Payment After Grace Period| BROKE["WAITING\n(Reason: promise_broken · Resume Cadence)"]:::err
```

---

## 9. Incremental Lift & Attribution

To distinguish true agent impact from natural self-healing, Riko uses randomized holdout control groups:

```mermaid
flowchart TB
    classDef in fill:#f8fafc,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    classDef split fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef group fill:#f1f5f9,stroke:#0284c7,stroke-width:1.5px,color:#0f172a
    classDef math fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b

    FAIL["Total Ingested Exposure Cohort\n(Failed Payments / Invoices)"]:::in --> SPLIT{"Randomized Arm Split\n(e.g., 95% Treatment / 5% Holdout)"}:::split
    
    SPLIT -->|Treatment Arm: 95%| TREAT["Active Recovery Engine\n(Intelligent multi-rung outreach)"]:::group
    SPLIT -->|Holdout Arm: 5%| HOLD["Silent Control Group\n(Zero outreach sent)"]:::group
    
    TREAT --> TR_RATE["Treatment Recovery Rate\n(e.g., 48.2%)"]:::group
    HOLD --> HO_RATE["Holdout Recovery Rate (Natural Self-Healing)\n(e.g., 22.1%)"]:::group
    
    TR_RATE & HO_RATE --> LIFT["Incremental Lift Calculation\nLift = Treatment Rate (48.2%) - Holdout Rate (22.1%) = +26.1%"]:::math
    
    LIFT --> ROI["Proven Net Value Generated\n(Lift × Total Treatment Volume) - Outreach Cost"]:::math
```

---

## 10. Cryptographic Audit Ledger

Every case state transition and LLM interaction appends to a SHA-256 hash chain:

$$\text{hash}_n = \text{SHA-256}\Big(\big[\text{prevHash}, \text{caseId}, \text{fromState}, \text{toState}, \text{reason}, \text{actor}, \text{createdAt}\big]\Big)$$

```mermaid
flowchart LR
    classDef genesis fill:#f8fafc,stroke:#475569,stroke-width:1.5px,color:#0f172a
    classDef event fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95

    G["Genesis Block\nHash: 0000...0000"]:::genesis --> E1["Event 1: NEW -> DRAFTING\n• prevHash: 0000...0000\n• actor: 'system'\n• Hash: e3b0c442..."]:::event
    
    E1 --> E2["Event 2: DRAFTING -> SENDING\n• prevHash: e3b0c442...\n• actor: 'agent'\n• Hash: 8f4c21b9..."]:::event
    
    E2 --> E3["Event 3: SENDING -> WAITING\n• prevHash: 8f4c21b9...\n• actor: 'system'\n• Hash: 1a7d903e..."]:::event
    
    E3 --> E4["Event 4: WAITING -> RECOVERED\n• prevHash: 1a7d903e...\n• reason: 'payment_succeeded'\n• Hash: 49b28a1c..."]:::event
```

- **Genesis Hash**: Initial event starts with $64\text{ zeros}$.
- **Verification**: Integrity can be validated programmatically via `/api/cases/:caseId/audit` or exported to CSV. Any manual database tampering breaks the hash chain.

---

## 11. Security & Multi-Tenancy

- **Row-Level Tenant Isolation**: All queries execute within `withTenant(db, tenantId, ...)` scoping.
- **PII Encryption**: Customer emails and phone numbers are encrypted at rest with `AES-256-GCM`.
- **Constant-Time Comparisons**: Security tokens and inbound webhook secrets use `crypto.timingSafeEqual`.
- **Session Authentication**: Handled by Better Auth with secure HTTP-only cookies.
