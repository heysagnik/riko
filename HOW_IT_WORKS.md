# How Riko Works

Riko is an autonomous revenue recovery engine. It detects payment failures, abandoned checkouts, and overdue receivables, decides whether and when to act, and runs bounded email outreach to recover funds.

---

## 1. System Overview

Riko separates recovery policy from email drafting. A deterministic policy engine evaluates limits and safety bounds, while an LLM reasoning engine drafts messages within structured templates. Every draft is evaluated by a post-generation validation pass before dispatch.

```mermaid
flowchart TD
    EV["Webhook / Payment Event Ingestion"] --> INGEST["Ingestion Layer\n(Decrypt PII · Record Exposure · Assign Control Arm)"]
    INGEST --> GATES{"Gate Evaluator\n(Quiet hours · Max attempts · Cooldown · Sender status)"}
    
    GATES -- Failed --> SKIPPED["SKIPPED\n(Permanent stop / Holdout / Outside window)"]
    GATES -- Passed --> ROUTE{"Policy Router\n(isFraud · Human Threshold · Tone Rung)"}
    
    ROUTE -- Fraud --> SKIPPED
    ROUTE -- Above Threshold --> ESCALATE["ESCALATED\n(Merchant Review)"]
    ROUTE -- Actionable --> DRAFT["AI Draft Loop\n(LLM Generation inside Tone Rung)"]
    
    DRAFT --> VALID{"Post-Draft Validator\n(Exact Amount · Name · No Discounts · Allowlisted URLs)"}
    VALID -- Invalid (< 3x) --> DRAFT
    VALID -- Invalid (3x exhausted) --> ESCALATE
    VALID -- Valid --> DISPATCH["SMTP Dispatch\n(Signed Header · List-Unsubscribe · SHA-256 Event Logged)"]
    
    DISPATCH --> TWO_WAY["Two-Way Email & Tracking\n(Inbound Routing · Promise Extraction · Conversational Replies)"]
    
    TWO_WAY --> RES{"Resolution Event"}
    RES -- Payment Captured --> RECOVERED["RECOVERED\n(Incremental ROI Counted)"]
    RES -- Max Tries Exhausted --> LOST["LOST"]
```

---

## 2. Core Monorepo Architecture

```mermaid
flowchart LR
    subgraph Apps["apps/"]
        direction TB
        API["api\n(Express REST, Auth, Webhooks)"]
        WORKER["worker\n(Polling Recovery Loop)"]
        WEB["web\n(React 18 + Vite Dashboard)"]
        EMAIL_W["email-worker\n(Cloudflare MIME Parser)"]
    end

    subgraph Packages["packages/"]
        direction TB
        CORE["core\n(State Machine, Gates, Policy, Providers)"]
        AGENT["agent\n(Reasoning, Drafting, Rule Validators)"]
        DB["db\n(Drizzle Schema, withTenant, Audit Ledger)"]
        SHARED["shared\n(Types, Zod Schemas, Contracts)"]
    end

    API --> DB
    API --> CORE
    API --> SHARED

    WORKER --> DB
    WORKER --> CORE
    WORKER --> AGENT
    WORKER --> SHARED

    WEB --> SHARED

    AGENT --> CORE
    AGENT --> SHARED

    DB --> SHARED
```

---

## 3. Case State Machine

Cases move through a finite state machine enforced by [`packages/core/src/cases/state-machine.ts`](./packages/core/src/cases/state-machine.ts).

```mermaid
stateDiagram-v2
    [*] --> NEW: Webhook Ingested

    NEW --> SKIPPED: gates_failed / fraud_signal / holdout
    NEW --> RECOVERED: payment_succeeded
    NEW --> DRAFTING: gates_passed
    NEW --> ESCALATED: above_threshold / business_fault

    DRAFTING --> SENDING: draft_valid
    DRAFTING --> ESCALATED: draft_invalid_exhausted (3x)
    DRAFTING --> RECOVERED: payment_succeeded

    SENDING --> WAITING: sent
    SENDING --> RECOVERED: payment_succeeded

    WAITING --> PROMISED: promise_captured
    WAITING --> WAITING: agent_answered (customer inquiry)
    WAITING --> ESCALATED: customer_replied (dispute/unhandled)
    WAITING --> SKIPPED: customer_unsubscribed / hard_bounced
    WAITING --> DRAFTING: cooldown_elapsed_retry (attempt < 3)
    WAITING --> LOST: cooldown_elapsed_exhausted (attempt = 3)
    WAITING --> RECOVERED: payment_succeeded

    PROMISED --> RECOVERED: payment_succeeded (promise_kept)
    PROMISED --> WAITING: promise_broken (grace period elapsed)
    PROMISED --> PROMISED: agent_answered
    PROMISED --> ESCALATED: reply_after_promise / dispute
    PROMISED --> SKIPPED: customer_unsubscribed / hard_bounced
    PROMISED --> LOST: cooldown_elapsed_exhausted

    ESCALATED --> DRAFTING: merchant_approved
    ESCALATED --> LOST: merchant_closed
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

| Gate | Rule | Behavior on Failure |
|---|---|---|
| **Deliverability** | Customer must possess a valid, non-empty email address | SKIPPED (`no_deliverable_email`) |
| **Suppression** | Customer must not be unsubscribed, bounced, or suppressed | SKIPPED (`unsubscribed_or_bounced`) |
| **Verified Sender** | Merchant must configure an active, verified SMTP identity | Defer until sender is verified |
| **Max Attempts** | Hard cap of 3 outreach emails per case | LOST (`attempts_exhausted`) |
| **Cooldown** | Minimum 48-hour gap between successive emails | Defer until cooldown elapses |
| **Contact Window** | Follow-up emails only send between 07:00–23:00 local time | Defer until contact window opens |
| **Exposure Age** | Max age: 21d (payments), 7d (carts), 30d (invoices) | SKIPPED (`payment_too_old`) |
| **Daily Send Cap** | Tenant-level send volume throttle | Defer until cap window resets |
| **Fraud Check** | Compromised/stolen card signals (`lost_card`, `fraudulent`) | SKIPPED (`fraud_signal`) |

---

## 5. Reasoning, Drafting & Validation

```mermaid
flowchart TD
    FACTS["Case Facts & Context\n(Amount, Currency, Failure Code, Customer Name, URLs)"] --> PROMPT["LLM Draft Engine\n(NVIDIA NIM · Llama 3.1)"]
    PROMPT --> DRAFT["Candidate Email Draft\n(subject, bodyText, bodyHtml)"]
    
    DRAFT --> VAL{"Deterministic Validator Pass"}
    
    VAL -- "Rule 1: Exact Amount Present" --> FAIL1["Reject & Feed Error Back"]
    VAL -- "Rule 2: Customer Name Present" --> FAIL1
    VAL -- "Rule 3: Zero Blocklisted Words\n(discount, refund, waive, credit)" --> FAIL1
    VAL -- "Rule 4: Valid Tone Rung Rules" --> FAIL1
    VAL -- "Rule 5: Allowlisted URLs Only\n(updatePaymentUrl, unsubUrl)" --> FAIL1
    VAL -- "Rule 6: Length: 40–160 words, Subject < 78 chars" --> FAIL1
    
    FAIL1 -- "Retry < 3" --> PROMPT
    FAIL1 -- "Retry >= 3" --> ESC["Escalate to Merchant"]
    
    VAL -- "All Rules Pass" --> SCORE["Quality Scoring (0–100)\n(Reward clarity, penalize filler & pressure)"]
    SCORE --> SEND["Ready for Dispatch\n(State: SENDING)"]
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
    participant Agent as apps/worker (processAgentReplies)
    participant SMTP as Merchant SMTP

    Customer->>CF: Sends email reply
    CF->>Worker: Delivers RFC MIME stream
    Worker->>API: POST /inbound/mail (JSON parsed payload)
    API->>API: Verify INBOUND_MAIL_SECRET & strip quotes
    API->>API: Classify inbound (auto_reply, bounce, unsub, reply)
    API->>DB: Append turn to caseMessages & trigger awaitingAgentReply
    
    loop Worker Daemon Cycle
        Agent->>DB: Poll cases with awaitingAgentReply = true
        Agent->>Agent: Check reply limit (< 5) & sentiment/disputes
        Agent->>Agent: LLM drafts answer quoting thread history
        Agent->>Agent: Validate response (no discounts, safe links)
        Agent->>SMTP: Send response with In-Reply-To headers
        SMTP-->>Customer: Deliver reply into existing email thread
    end
```

---

## 7. Promise-to-Pay Intelligence

Customers often reply with scheduled commitments (*"I'll pay on Monday"* or *"Will clear this tomorrow by 5pm"*).

```mermaid
flowchart LR
    INB["Customer Inbound Email"] --> NLP["NLP Date & Intent Extractor\n(packages/core/src/promises/extract.ts)"]
    NLP -- Promise Detected --> PROMISED["State: PROMISED\nOutreach Halted until Due Date + 24h Grace"]
    
    PROMISED --> CHECK{"Payment Status at Due Date"}
    CHECK -- Paid --> REC["RECOVERED\n(Reason: promise_kept)"]
    CHECK -- Unpaid --> BROKE["WAITING\n(Reason: promise_broken · Resume Cadence)"]
```

---

## 8. Incremental Lift & Attribution

To distinguish true agent impact from natural self-healing, Riko uses randomized holdout control groups:

```mermaid
flowchart TD
    FAIL["All Failed Payments Ingested"] --> SPLIT{"Randomized Arm Assignment"}
    
    SPLIT -- "Treatment Arm (95%)" --> TREAT["Active Outreach Engine\n(Multi-rung email cadence)"]
    SPLIT -- "Holdout Arm (5%)" --> HOLD["Silent Control Group\n(Zero outreach sent)"]
    
    TREAT --> TR_RATE["Treatment Recovery Rate\n(e.g., 48.2%)"]
    HOLD --> HO_RATE["Holdout Recovery Rate\n(e.g., 22.1%)"]
    
    TR_RATE & HO_RATE --> LIFT["Incremental Lift Calculation\nLift = Treatment Rate (48.2%) - Holdout Rate (22.1%) = +26.1%"]
    LIFT --> ROI["Net Incremental Revenue =\n(Lift × Total Treatment Volume) - Send Costs"]
```

---

## 9. Cryptographic Audit Ledger

Every case state transition and LLM interaction appends to a SHA-256 hash chain:

$$\text{hash}_n = \text{SHA-256}\Big(\big[\text{prevHash}, \text{caseId}, \text{fromState}, \text{toState}, \text{reason}, \text{actor}, \text{createdAt}\big]\Big)$$

```mermaid
flowchart LR
    G["Genesis\n0000...0000"] --> E1["Event 1 (NEW -> DRAFTING)\nSHA-256(prevHash, E1)"]
    E1 --> E2["Event 2 (DRAFTING -> SENDING)\nSHA-256(Hash1, E2)"]
    E2 --> E3["Event 3 (SENDING -> WAITING)\nSHA-256(Hash2, E3)"]
    E3 --> E4["Event 4 (WAITING -> RECOVERED)\nSHA-256(Hash3, E4)"]
```

- **Genesis Hash**: Initial event starts with $64\text{ zeros}$.
- **Verification**: Integrity can be validated programmatically via `/api/cases/:caseId/audit` or exported to CSV. Any manual database tampering breaks the hash chain.

---

## 10. Security & Multi-Tenancy

- **Row-Level Tenant Isolation**: All queries execute within `withTenant(db, tenantId, ...)` scoping.
- **PII Encryption**: Customer emails and phone numbers are encrypted at rest with `AES-256-GCM`.
- **Constant-Time Comparisons**: Security tokens and inbound webhook secrets use `crypto.timingSafeEqual`.
- **Session Authentication**: Handled by Better Auth with secure HTTP-only cookies.
