# PLAN.md

Revenue Recovery — multi-tenant agent that detects failed payments, decides whether to act, and runs bounded, audited email outreach to recover the money.

---

## 1. Product scope

### v1 does exactly this

A merchant signs up, connects their payment provider, and the system ingests payment-failure events. Each failure opens a **case**. A deterministic state machine decides whether the case is eligible for outreach and when. When it is, an agent drafts a merchant-branded email, a check validates the draft, and the system sends it. Every decision and action is logged. The dashboard shows open cases, the full action trail per case, and a recovery-rate summary.

### v1 scope boundaries

**In:**
- Merchant auth and multi-tenant isolation
- Stripe Connect (read-only OAuth) as the first provider
- Subscription and invoice payment failures only
- Deterministic case state machine with hard send gates
- LLM email drafting inside a fixed template family, with a validation pass
- Email delivery with open/click/bounce tracking
- Landing page + dashboard (cases, case detail, recovery metrics, connections)

**Out (deferred, with the version that picks them up):**
- Razorpay adapter — v1.5, additive only (see §4)
- WhatsApp / SMS channels — v2, blocked on WhatsApp BSP approval and DLT registration
- One-off checkout abandonment — v2
- B2B overdue receivables and promise-to-pay — v2
- Agent-generated discounts, offers, or payment-term changes — not planned; deliberately excluded

### Why subscription failures first

Recurring failures have a bounded, observable lifecycle: the provider signals the failure, retries within a known window, then terminates the subscription. That gives a natural start, a natural deadline, and an unambiguous success signal (the invoice gets paid). One-off failures have none of these, so they need invented timing logic and produce weaker attribution.

---

## 2. Architecture

```
apps/web (React)          apps/api (Express)
  landing                   /auth/*            better-auth handler
  dashboard                 /connections/*     OAuth connect + status
     |                      /webhooks/stripe   signed ingestion
     |  REST + cookie       /webhooks/razorpay signed ingestion (v1.5)
     +--------------------> /cases/*           list, detail, action trail
                            /metrics/*         recovery rate, exceptions
                                 |
                            packages/core
                              provider adapters
                              normalizer
                              case state machine
                              gates
                                 |
                            packages/agent
                              draft loop, validation, tools
                                 |
                            packages/db (Drizzle + Neon)
                                 |
                            worker (same repo, separate process)
                              scheduled transitions, send jobs
```

Three runtime processes: the web app (static), the API (webhooks + REST), and the worker (timed case transitions and outreach jobs). One database. No message broker in v1 — the worker polls due cases on an interval, which is sufficient at this volume and removes an entire piece of infrastructure.

---

## 3. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Workspace protocol for internal packages; Turborepo only for task orchestration and caching |
| Language | TypeScript, strict mode | One language across web, api, worker, and shared packages |
| Frontend | React + Vite + React Router | SPA behind the API; no SSR requirement in v1 |
| UI | shadcn/ui + Tailwind CSS | Component contracts stay in the repo; see `design.md` |
| Data fetching | TanStack Query | Server-state caching, refetch on focus for live case lists |
| Forms | react-hook-form + zod | Same zod schemas shared with the API via `packages/shared` |
| Backend | Express | Direct control over raw-body webhook handling and middleware ordering |
| Auth | better-auth | Session cookies, organization support for tenancy |
| Database | Neon Postgres | Serverless Postgres, branching for preview environments |
| ORM | Drizzle | SQL-first, typed, migrations checked into the repo |
| Validation | zod | Boundary validation on every request and webhook payload |
| LLM | Anthropic Messages API | Email drafting with tool use |
| Email | Resend | Domain verification per merchant, delivery webhooks |
| Hosting | API + worker on Railway, web on Vercel | Worker needs a long-lived process; the SPA does not |

### Rejected, deliberately

- **Next.js** — the app is an authenticated dashboard plus one marketing page; SSR adds a rendering model to reason about for no user-visible gain, and it complicates raw-body webhook handling.
- **Redis + BullMQ** — a polled `next_action_at` column covers v1's scheduling needs. Introduce a queue when send volume or retry semantics actually demand it.
- **Prisma** — Drizzle's generated SQL stays legible, which matters when two providers write into one normalized table.
- **Microservices** — one API, one worker, one database.

---

## 4. Provider abstraction

Business logic never sees a provider name. Everything above the adapter layer operates on normalized types.

```
packages/core/src/providers/
  types.ts
  stripe.ts
  razorpay.ts
  registry.ts
```

Every adapter satisfies one interface:

```ts
export interface PaymentProvider {
  readonly id: ProviderId;
  buildAuthorizeUrl(input: AuthorizeInput): string;
  exchangeCode(code: string): Promise<ProviderTokens>;
  refreshTokens(refreshToken: string): Promise<ProviderTokens>;
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders, secret: string): ProviderEvent;
  normalize(event: ProviderEvent): NormalizedEvent | null;
}
```

```ts
export interface NormalizedEvent {
  providerId: ProviderId;
  providerAccountId: string;
  kind: "payment_failed" | "payment_succeeded" | "subscription_ended";
  providerPaymentId: string;
  providerCustomerId: string;
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  failureCategory: FailureCategory;
  occurredAt: Date;
  raw: unknown;
}
```

```ts
export type FailureCategory =
  | "insufficient_funds"
  | "expired_card"
  | "authentication_required"
  | "bank_decline"
  | "network_error"
  | "invalid_instrument"
  | "unknown";
```

`normalize` returning `null` means the event is not relevant and is acknowledged without processing.

### Failure code mapping

The only place provider differences are allowed to live. A `failure_code_map` table maps `(provider_id, provider_code)` to a `FailureCategory` and a `recoverable` flag. Adding Razorpay's codes is a data migration, not a code change. Unmapped codes resolve to `unknown` and surface in an admin view so the map can be extended from real traffic.

### Adding Razorpay in v1.5

1. Implement `RazorpayAdapter` against the same interface.
2. Register it in `registry.ts`.
3. Add `POST /webhooks/razorpay` calling the shared handler.
4. Insert Razorpay rows into `failure_code_map`.
5. Add the provider to the connections UI.

No changes to the state machine, agent, worker, dashboard, or metrics. That constraint is the acceptance criterion for the abstraction — if adding Razorpay requires touching anything else, the abstraction leaked.

Razorpay needs Technology Partner approval and OAuth application review before production use, which is why it follows rather than leads. Stripe Connect is self-serve and unblocks a real merchant immediately.

---

## 5. Data model

Neon Postgres. Every tenant-scoped table carries `tenant_id` and is protected by row-level security. Timestamps are `timestamptz`. Money is stored as integer minor units with an explicit currency.

```
tenants                id, name, slug, created_at
users                  better-auth managed
members                id, tenant_id, user_id, role
connections            id, tenant_id, provider_id, provider_account_id,
                       access_token_encrypted, refresh_token_encrypted,
                       token_expires_at, scopes, status, webhook_secret_encrypted,
                       connected_at
sender_identities      id, tenant_id, from_email, from_name, reply_to,
                       domain_verified, provider_domain_id
customers              id, tenant_id, provider_id, provider_customer_id,
                       email_encrypted, name, locale, unsubscribed_at
payments               id, tenant_id, connection_id, provider_payment_id,
                       customer_id, amount_minor, currency, status,
                       failure_code, failure_category, is_recurring,
                       occurred_at, raw
cases                  id, tenant_id, payment_id, customer_id, state,
                       attempt_count, next_action_at, opened_at, closed_at,
                       closed_reason, recovered_amount_minor
case_events            id, tenant_id, case_id, from_state, to_state, reason,
                       actor, created_at
agent_actions          id, tenant_id, case_id, tool, input, output,
                       model, latency_ms, created_at
outreach               id, tenant_id, case_id, channel, subject, body,
                       draft_id, provider_message_id, sent_at,
                       opened_at, clicked_at, bounced_at, replied_at
failure_code_map       provider_id, provider_code, failure_category,
                       recoverable
webhook_events         id, provider_id, provider_event_id, received_at,
                       processed_at, status
```

**Idempotency:** `webhook_events` has a unique index on `(provider_id, provider_event_id)`. Redelivered events are acknowledged and dropped.

**Encryption:** customer email, OAuth tokens, and webhook secrets are encrypted at the application layer before insert. Keys come from environment configuration, never the database.

**Isolation:** every query runs through a tenant-scoped context that sets the RLS session variable. There is no code path that reads a tenant-scoped table without it.

---

## 6. Case state machine

Deterministic. Transitions come from code, never from the model. This is the primary safety boundary: the agent writes copy, the state machine decides whether anything gets sent.

```
                    payment_failed
                          |
                          v
                    +-----------+
                    |    NEW    |
                    +-----------+
                          |
                    evaluate gates
                    /            \
              blocked            passes
                 |                  |
                 v                  v
           +-----------+      +-----------+
           |  SKIPPED  |      | DRAFTING  |
           +-----------+      +-----------+
                                    |
                          draft + validation
                          /                \
                    invalid x3            valid
                        |                    |
                        v                    v
                  +-----------+        +-----------+
                  | ESCALATED |        |  SENDING  |
                  +-----------+        +-----------+
                                             |
                                          sent
                                             |
                                             v
                                       +-----------+
                                       |  WAITING  |
                                       +-----------+
                                        /    |     \
                          payment_succeeded  |      cooldown elapsed
                                 |           |            |
                                 v      reply / unsub     v
                          +-----------+     |       attempts left?
                          | RECOVERED |     |       /          \
                          +-----------+     v     yes          no
                                      +-----------+  |          |
                                      | ESCALATED |  |          v
                                      +-----------+  |    +-----------+
                                                     |    |   LOST    |
                                          back to DRAFTING+-----------+
```

### Gates

Evaluated before the agent is invoked. If any fails, the case moves to `SKIPPED` with a recorded reason.

- Customer has a deliverable email address
- Customer is not unsubscribed and has not bounced previously
- Tenant has a verified sender identity
- `attempt_count < 3`
- At least 48 hours since the last outreach on this case
- Failure category is marked `recoverable` in `failure_code_map`
- Payment occurred within the last 21 days
- Tenant is not paused and is within its daily send cap

Gates are pure functions over case and tenant state, unit tested independently of the agent. They are not exposed as agent tools — the agent cannot check, skip, or negotiate them.

### Terminal states and the exception list

`SKIPPED`, `LOST`, and `ESCALATED` each carry a `closed_reason`. The exception report is a query over these three states grouped by reason. It is a first-class product surface, not a debugging artifact.

---

## 7. Agent harness

### Responsibility

The agent writes one email. It does not decide whether to send, when to send, how many times to send, or what to offer. Those are state machine concerns.

### Loop

1. Worker picks up a case in `DRAFTING`.
2. Load the fact set: amount, currency, failure category, customer name, attempt number, prior subjects sent on this case, merchant name, update-payment-method link.
3. Call the model with the fact set and the template family for that failure category and attempt number.
4. Validate the returned draft.
5. On pass, persist the draft and transition to `SENDING`. On fail, retry with the validation errors appended, up to three attempts total, then `ESCALATED`.

### Tools

```
get_case_facts(case_id)      -> structured fact set, no free text
draft_email(case_id, facts)  -> { subject, body }
log_action(case_id, tool, input, output)
```

`send_email` is not an agent tool. Sending is performed by the worker after the state machine reaches `SENDING`. The agent has no capability to deliver a message.

### Draft validation

Runs before anything is persisted as sendable:

- Every monetary amount, date, and customer name in the draft appears in the fact set
- No discount, refund, credit, extension, or deadline language — matched against a blocklist
- No URLs other than the provided update-payment-method link and the unsubscribe link
- Subject under 78 characters; body between 40 and 160 words
- Required unsubscribe token present
- Plain text and HTML variants both render

Validation is deterministic. It is not a second model call, because a rule that can be talked out of is not a rule.

### Prompt construction

- System prompt is versioned in the repo and stamped onto every `agent_actions` row
- Fact sets are passed as structured JSON, never as prose the model could read as instruction
- Merchant-supplied strings (business name, product name) are inserted as data and escaped; they are never concatenated into the instruction section
- Temperature is low; the task is constrained copywriting, not ideation

---

## 8. Outreach

- Resend, with a per-tenant verified sending domain. Emails come from the merchant, not from the platform.
- Delivery webhooks update `outreach` with opens, clicks, bounces, and complaints.
- A hard bounce marks the customer undeliverable and closes the case as `SKIPPED`.
- Every email carries a one-click unsubscribe header and a visible unsubscribe link. Unsubscribing writes `customers.unsubscribed_at` and closes all open cases for that customer.
- Sends respect the merchant's timezone and a configured send window.

---

## 9. Metrics

Computed from `cases` and `payments`, per tenant, over a selectable window:

- **Recovery rate** — recovered cases over eligible cases
- **Recovered amount** — sum of `recovered_amount_minor`
- **Attributed recovery** — recovered cases where a payment succeeded within 72 hours of an outreach click, reported separately from raw recovery so the number is honest about what the system actually caused
- **Skip rate** with reason breakdown
- **Time to recovery** — median hours from case open to recovery
- **Exception list** — every `SKIPPED`, `LOST`, `ESCALATED` case with reason

Raw recovery and attributed recovery are always shown together. A merchant who sees only raw recovery is being told that every payment that eventually succeeded was the system's doing, which is not true.

---

## 10. Repository layout

```
revenue-recovery/
  apps/
    web/
      src/
        routes/
          landing/
          dashboard/
        components/
          ui/
        lib/
        hooks/
    api/
      src/
        routes/
        middleware/
        webhooks/
        server.ts
    worker/
      src/
        jobs/
        index.ts
  packages/
    core/
      src/
        providers/
        cases/
        gates/
        normalize/
    agent/
      src/
        tools/
        prompts/
        validate/
    db/
      src/
        schema/
        migrations/
        client.ts
    shared/
      src/
        types/
        schemas/
  turbo.json
  pnpm-workspace.yaml
```

Internal packages are referenced with `workspace:*`. `packages/shared` holds zod schemas and types used by both `apps/web` and `apps/api`, so a change to a request shape breaks the build on both sides.

---

## 11. Code standards

- No comments. Names carry intent; if a block needs explanation, it needs extraction.
- TypeScript strict. No `any`. No non-null assertions outside test fixtures.
- Every external boundary — request bodies, webhook payloads, environment variables, provider responses — is parsed with zod before use.
- Functions return typed results rather than throwing for expected failures; exceptions are for genuine faults.
- Business logic lives in `packages/core` and is pure and testable without a database or network.
- Express routes are thin: parse, delegate, respond.
- React components are presentational by default; data fetching lives in hooks.
- No `console.log` in application code; structured logging with tenant and case identifiers.
- Migrations are forward-only and checked in.

---

## 12. Milestones

| # | Deliverable | Done when |
|---|---|---|
| M1 | Monorepo, Neon schema, better-auth, tenant RLS | Two tenants exist and neither can read the other's rows |
| M2 | Stripe Connect OAuth + signed webhook ingestion | A real test-mode failure creates a normalized payment and a `NEW` case |
| M3 | State machine, gates, worker scheduling | Cases traverse every transition under test; no LLM involved |
| M4 | Agent harness, validation, Resend delivery | One real email sent, full action trail persisted |
| M5 | Dashboard — connections, case list, case detail, metrics | A non-technical viewer can follow one case end to end |
| M6 | Batch run over 50+ real test-mode failures | Recovery rate, attributed recovery, and exception list produced |
| M7 | Razorpay adapter | Razorpay cases flow through with zero changes outside `providers/` and `failure_code_map` |

M3 completing before M4 is deliberate. The system must be correct with no model in the loop before a model is added.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Merchants hesitate to connect a payment account to an unknown tool | Request read-only scopes, list them next to the connect button, state what is not requested and what is retained; offer a sample-data preview before connecting |
| Outreach reads as spam and damages merchant reputation | Per-tenant verified domains, merchant branding, 48-hour spacing, three-attempt cap, one-click unsubscribe, immediate stop on reply |
| Recovery credit is overstated | Attributed recovery reported separately from raw recovery |
| Model produces an off-brand or invented claim | Fixed fact set, deterministic validation, no send capability in the agent's tool surface |
| Webhook redelivery causes duplicate sends | Unique constraint on provider event id; sends gated on state transition, not on event arrival |
| Razorpay partner approval delays the India path | Stripe-first, adapter interface fixed in advance so Razorpay is additive |
| Customer PII sprawl | Encrypt at rest, request minimum scopes, define a retention window and enforce it in a scheduled job |