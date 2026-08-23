# Deploying Riko

This is a full walkthrough, not a reference card. Follow it top to bottom on a
fresh checkout and you end with a public URL, a working Razorpay webhook, and
real two-way email.

## Architecture

Two deployable things, nothing else:

```
┌─────────────────────────────────────────────┐      ┌──────────────────────┐
│  Render — one free web service               │      │  Cloudflare Worker   │
│                                               │      │  (email only)        │
│  Express serves:                             │      │                      │
│    /              → dashboard (apps/web/dist)│◄─────┤  parses inbound mail │
│    /api/*         → API routes               │ POST │  posts to /inbound/  │
│    /webhooks/*    → Razorpay, Stripe          │      │       mail           │
│    /inbound/mail  → replies from Cloudflare  │      └──────────────────────┘
│                                               │
│  In the same process, an async loop:         │
│    processCircuitBreaker → processExposure-  │
│    Sweep → processPromises → processNewCases │
│    → processDraftingCases → processSending-  │
│    Cases, every WORKER_POLL_MS (default 15s) │
└───────────────┬───────────────────────────────┘
                │
                ▼
        ┌───────────────┐
        │  Neon Postgres │
        └───────────────┘
```

**Why one process.** Render's free tier is web-services-only — a background
worker is a paid product there. Running the poll loop inside the same Node
process as the API means the whole system, including the agent pipeline, costs
nothing. `RUN_WORKER=1` is what turns this on; see `apps/api/src/server.ts`.

**Why Cloudflare only handles email.** Cloudflare Workers can't run this stack
without a rewrite: no persistent process (the poll loop needs one), and the
Postgres client here uses TCP transactions for row-level-security scoping,
which Workers can't open. Its Email Routing product, though, is the only free
way to receive mail on a custom domain and hand it to code — so that's the one
piece that lives there.

## Prerequisites

- A GitHub account (Render deploys from a repo)
- A [Neon](https://neon.tech) Postgres database (free tier)
- A [Render](https://render.com) account (free tier)
- A domain added to Cloudflare, with Email Routing available (only needed for
  two-way email — skip section 7 without it)
- An NVIDIA NIM API key (free tier) for the drafting model
- A Razorpay account in test mode

## 1. Generate the secrets you'll need

Two values must be generated once and then never change, because existing
encrypted data depends on them:

```bash
# APP_ENCRYPTION_KEY — AES-256-GCM key for connection secrets and PII.
# Rotating this after cases exist makes existing customer emails undecryptable.
openssl rand -hex 32

# BETTER_AUTH_SECRET — signs session tokens. Rotating logs everyone out.
openssl rand -hex 32
```

Save both somewhere durable (a password manager, not just this terminal) —
you'll paste them into Render once and reuse them for every future redeploy.

Generate one more for inbound mail authentication:

```bash
# INBOUND_MAIL_SECRET — shared secret between the Cloudflare Worker and this API.
openssl rand -hex 24
```

## 2. Create the Neon database

1. [neon.tech](https://neon.tech) → New Project → any region close to you
2. Copy the connection string from the dashboard. It looks like:
   ```
   postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require
   ```
3. Keep this tab open — you'll paste it into Render in step 4.

Nothing needs to be run against it yet. The Render build step applies every
migration in `packages/db/src/migrations` on each deploy.

## 3. Push the repo to GitHub

Render deploys from a branch. Check whether this repo has any commits first —
if `git log` is empty, this is the first one:

```bash
git status
git add -A
git commit -m "Riko"
gh repo create riko --private --source=. --push
```

If you already have commits and a remote, just push:

```bash
git push origin master
```

## 4. Create the Render service

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the GitHub repo. Render reads `render.yaml` at the root and
   proposes one service named `riko` — a free web service in Singapore.
3. Before clicking **Apply**, Render will prompt for every environment
   variable marked `sync: false` in `render.yaml`. Fill in what you have so
   far and leave `BETTER_AUTH_URL` / `APP_BASE_URL` blank for now:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | The Neon connection string from step 2 |
| `APP_ENCRYPTION_KEY` | Generated in step 1 |
| `BETTER_AUTH_SECRET` | Generated in step 1 |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) → API key |
| `INBOUND_MAIL_SECRET` | Generated in step 1 |
| `BETTER_AUTH_URL` | Leave blank, fill in step 5 |
| `APP_BASE_URL` | Leave blank, fill in step 5 |

4. Click **Apply**. Render clones the repo and runs the build command:
   ```
   corepack enable && pnpm install --frozen-lockfile && pnpm --filter @riko/web build && pnpm --filter @riko/db exec tsx src/migrate.ts
   ```
   This installs the whole workspace, builds the dashboard's static assets,
   then applies every pending migration against `DATABASE_URL`. Expect this
   first build to take 3–5 minutes.
5. Once live, Render assigns a URL like `https://riko-a1b2.onrender.com`.
   **The first deploy will not work yet** — continue to step 5 before testing.

## 5. Close the URL loop

`BETTER_AUTH_URL` and `APP_BASE_URL` both need the service's own URL, which
only exists after the first deploy. This is expected, not a bug:

1. Copy the URL Render assigned (Dashboard → your service → the URL at the top)
2. Service → **Environment** → set:
   - `BETTER_AUTH_URL` = `https://riko-a1b2.onrender.com` (no trailing slash)
   - `APP_BASE_URL` = the same value
3. Save. Render redeploys automatically — this run is fast, since it reuses
   the build cache and only restarts the process.

Sign-in will 500 with a cryptic better-auth error until this step is done,
because `auth.ts` calls `requireEnv("BETTER_AUTH_URL")` at startup.

## 6. Verify the deploy

```bash
curl https://riko-a1b2.onrender.com/health
# {"ok":true,"at":"..."}
```

Open the service **Logs** tab and confirm all three lines appear on boot:

```
serving web from /opt/render/project/src/apps/web/dist
api listening on 10000
worker polling every 15000ms
```

If the third line is missing, `RUN_WORKER` isn't set to `1` in the
environment — check the Environment tab. Without it, cases will sit in `NEW`
forever; nothing is actually broken, the loop that moves them just never
starts.

Then open `https://riko-a1b2.onrender.com` in a browser, sign up, and create
an organization. This is the tenant everything else attaches to.

## 7. Keep the free service awake

A free Render web service sleeps after 15 minutes of no HTTP traffic and takes
roughly 50 seconds to wake on the next request. Two consequences:

- A Razorpay webhook that arrives while asleep may time out before the service
  wakes, and Razorpay's retry window is short. **This will silently lose a
  demo** if you don't account for it.
- The dashboard itself will feel broken on first load after idle.

Fix it with any free scheduler hitting `/health` every 10 minutes:

- [cron-job.org](https://cron-job.org) — free account, one job, no code
- Or a second, tiny Cloudflare Worker on a Cron Trigger:
  ```js
  export default {
    async scheduled(_event, env) {
      await fetch("https://riko-a1b2.onrender.com/health");
    },
  };
  ```

Do this **before** connecting Razorpay, or your first test webhook is the one
that gets lost to a cold start.

## 8. Connect Razorpay

Two separate things need doing: telling Riko about your Razorpay account, and
telling Razorpay about Riko's webhook URL. The order matters — Riko needs to
exist first, because the webhook secret it generates has to match what you
type into Razorpay.

**8a. Add the connection in Riko.** Dashboard → Connections → Connect Razorpay.
This calls `POST /api/connections/razorpay`, which encrypts and stores your
key ID, key secret, and a webhook secret you choose — nothing round-trips to
Razorpay for verification the way the Stripe connection does.

**8b. Register the webhook in Razorpay.** Dashboard → Settings → Webhooks →
Add New Webhook:

| Field | Value |
|---|---|
| Webhook URL | `https://riko-a1b2.onrender.com/webhooks/razorpay` |
| Secret | **Byte-identical** to what you entered in step 8a |
| Active events | `payment.failed`, `payment.captured`, `order.created`, `invoice.issued`, `invoice.paid` |

The secret mismatch is the single most common failure here: `verifyWebhook` in
`packages/core/src/providers/razorpay.ts` does an HMAC-SHA256 comparison, and
any difference — including trailing whitespace pasted from a password manager
— fails closed with a 400 and no case is created. If webhooks return 400,
recheck the secret character-for-character before anything else.

**8c. Test it.** From your machine, with `.env` pointed at production:

```bash
cd apps/api
API_BASE_URL=https://riko-a1b2.onrender.com \
  pnpm exec tsx --env-file=../../.env scripts/send-real-razorpay-webhook.ts
```

Expect `HTTP 200 {"status":"processed","caseId":"..."}`. Watch the case move
through the dashboard: `NEW → DRAFTING → SENDING → WAITING`, roughly 15–30
seconds end to end at the default poll interval.

## 9. Set up sender identity (SMTP)

Recovery emails send through whatever SMTP credentials you configure in
Settings → Sender Identity — Resend, Gmail with an app password, or any SMTP
provider works, since `apps/worker/src/lib/mailer.ts` is a plain nodemailer
transport. Without this configured, `evaluateGates` rejects every case with
`no_verified_sender` and nothing sends, by design — Riko will not draft mail
it cannot deliver.

Set a real **Reply-To** here too; this is the address `taggedReplyTo` appends
`+<case-id>` to before every send, which is how section 10 routes replies back
to the right case.

## 10. Inbound email (Cloudflare Worker)

Optional, but required for the promise-to-pay and reply-classification loop to
work with real customers instead of the simulation scripts. This section is
self-contained — it assumes only that step 4–6 already gave you a live Render
URL (`https://riko-a1b2.onrender.com` in every example below; substitute your
own throughout).

Reference: `apps/email-worker/README.md` covers the same ground more tersely,
plus the behavioural notes (message size limits, retry semantics) that don't
belong in a deploy doc.

### 10a. Install Wrangler and log in

Wrangler is already a devDependency of `apps/email-worker`, so no global
install is needed — `pnpm exec` resolves it from the workspace.

```bash
pnpm --filter @riko/email-worker exec wrangler login
```

This opens a browser tab to authorize the CLI against your Cloudflare
account. If you're in a headless environment, use `wrangler login` with the
`--browser=false` flag and follow the printed URL manually.

### 10b. Add the domain to Cloudflare and enable Email Routing

Skip this if the domain is already on Cloudflare with Email Routing enabled.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a domain** →
   enter the domain you want replies to arrive at (e.g. `yourdomain.com`)
2. Update the domain's nameservers at your registrar to the two Cloudflare
   assigns — this step is outside Cloudflare and can take anywhere from a few
   minutes to a few hours to propagate
3. Once Cloudflare shows the domain as **Active**: domain → **Email** →
   **Email Routing** → **Get started**. Cloudflare proposes MX and TXT
   records and, on a Cloudflare-managed domain, adds them automatically —
   confirm and continue.

### 10c. Point the worker at your Render deployment

Edit `apps/email-worker/wrangler.toml`:

```toml
name = "riko-inbound-mail"
main = "src/index.ts"
compatibility_date = "2026-08-01"
compatibility_flags = ["nodejs_compat"]

[vars]
RIKO_INBOUND_URL = "https://riko-a1b2.onrender.com/inbound/mail"
```

This is the only line that changes. `RIKO_INBOUND_URL` must be the full path
including `/inbound/mail` — not just the host — since the worker POSTs to it
directly with no path rewriting.

### 10d. Set the shared secret

The worker and the Render service authenticate to each other with one shared
value. It must be **exactly** the `INBOUND_MAIL_SECRET` you set on the Render
service in step 4 — any difference and every message is rejected with 401
before it's even classified.

```bash
pnpm --filter @riko/email-worker exec wrangler secret put RIKO_INBOUND_SECRET
# paste the same value as Render's INBOUND_MAIL_SECRET when prompted
```

Secrets set this way are encrypted at rest by Cloudflare and never appear in
`wrangler.toml` or any log — this is deliberate, and different from `[vars]`,
which is plaintext and fine for a non-secret like the inbound URL.

### 10e. Deploy the worker

```bash
pnpm --filter @riko/email-worker cf:deploy
```

Expect output ending in something like:

```
Uploaded riko-inbound-mail (2.1 sec)
Deployed riko-inbound-mail triggers (0.4 sec)
  https://riko-inbound-mail.<your-subdomain>.workers.dev
```

That URL is irrelevant for email — it's the worker's HTTP entry point, which
this worker doesn't use (it's triggered by the `email()` handler, not by
requests to that URL). What matters is that the deploy succeeded and the
worker is now registered as `riko-inbound-mail` in your account, which is the
name the next step needs.

### 10f. Route catch-all mail to the worker

Cloudflare dashboard → your domain → **Email** → **Email Routing** →
**Routing rules** → **Catch-all address** → set action to **Send to a
Worker** → select `riko-inbound-mail` → **Save**.

This must be the **catch-all** rule, not a custom rule for a specific
address like `billing@yourdomain.com`. Every outgoing recovery email carries
a plus-tagged Reply-To —

```
billing+6b7f2848-6da8-4e6d-99f8-71a726f56686@yourdomain.com
```

— and Cloudflare's custom-address rules match the local part **exactly**, so
a rule scoped to `billing@yourdomain.com` alone will never see anything with
a `+` in it. Catch-all is what makes every tagged address reach the worker
regardless of what precedes the `+`.

### 10g. Point the sender identity's Reply-To at the domain

In the Riko dashboard: Settings → Sender Identity → Reply-To, set it to the
**untagged** base address on the domain you just configured, e.g.
`billing@yourdomain.com`. Riko appends `+<case-id>` itself before every send
(`taggedReplyTo` in `packages/core/src/inbound/address-tag.ts`) — do not
include a tag here.

### 10h. Verify the wiring end to end

Without waiting on real mail, replay what the worker would send:

```bash
cd apps/api
API_BASE_URL=https://riko-a1b2.onrender.com \
  INBOUND_MAIL_SECRET=<same value as Render's INBOUND_MAIL_SECRET> \
  pnpm exec tsx --env-file=../../.env scripts/send-tagged-reply.ts
```

A successful run prints `{"status":"applied", ...}` and the matching case in
the dashboard moves state (typically to `PROMISED` or `ESCALATED`, depending
on the reply text in the script).

Then confirm the real path. In one terminal:

```bash
pnpm --filter @riko/email-worker exec wrangler tail
```

From any mail client, reply to a genuine recovery email Riko sent. The tail
should show the worker invoked within a few seconds, followed by the same
`{"status": ...}` shape logged from the fetch to Render. If nothing appears
in the tail at all, the catch-all rule isn't wired to this worker — recheck
10f. If the tail shows the invocation but Render logs a 401, the secrets in
10d don't match.

### Multi-tenant note

Each tenant's inbound mail rides on **their own domain's** Email Routing,
because the plus-tagged address is built from that tenant's own Reply-To
(step 10g). The worker itself, `RIKO_INBOUND_URL`, and `INBOUND_MAIL_SECRET`
are shared infrastructure — one deployment serves every tenant — but nothing
about routing is tenant-specific inside the worker. `/inbound/mail` resolves
the tenant purely from the case the tagged address points to
(`caseIdFromRecipient` → `case.tenantId`), so a second tenant onboarding
later just needs their own domain added to Cloudflare and routed to this same
`riko-inbound-mail` worker — no code change, no second deployment.

## Redeploying

Render redeploys automatically on every push to the deploy branch. Migrations
run again on every build — they're idempotent, so this is safe even when
nothing changed. To redeploy without a code change (e.g. after editing an env
var by hand), use **Manual Deploy → Deploy latest commit** in the dashboard.

## Rolling back

Render keeps prior deploys. Dashboard → your service → **Events** → find the
last good deploy → **Rollback to this deploy**. This does not revert the
database — if a bad deploy included a migration, rolling back the app code
alone will not undo the schema change.

## Cost

Everything above is free at hackathon scale:

| Piece | Plan | Cost |
|---|---|---|
| Render web service | Free | $0 |
| Neon Postgres | Free (0.5 GB) | $0 |
| Cloudflare Workers | Free (100k req/day) | $0 |
| Cloudflare Email Routing | Free | $0 |
| NVIDIA NIM | Free tier | $0 |
| cron-job.org keepalive | Free | $0 |

The only paid dependency is Razorpay itself in live mode, and test mode (used
throughout this guide) is free.

## Troubleshooting

**`ERR_PNPM_NO_SCRIPT_OR_SERVER: Missing script start`.** The service was
created as a plain **Web Service** rather than a **Blueprint**, so Render
ignored `render.yaml` and fell back to its own defaults — `pnpm run build`
then `pnpm run start` against the repo root, and the root `package.json` used
to have neither a matching `build` nor a `start` script.

Both now exist at the root and do the right thing (`build` builds the
dashboard and runs migrations; `start` launches the API), so this is fixed
going forward whichever way the service was created. If you already have a
service stuck on the old commands, either:

- **Delete it and recreate via Blueprint** (Dashboard → New → Blueprint →
  same repo) so `render.yaml`'s explicit commands apply, or
- **Fix the existing service in place**: Settings → Build & Deploy → set
  Build Command to `pnpm install --frozen-lockfile && pnpm run build` and
  Start Command to `pnpm run start`, then Manual Deploy → Deploy latest commit.

**Sign-in 500s immediately after first deploy.** `BETTER_AUTH_URL` isn't set
yet — see step 5.

**Webhooks return 400.** Signature mismatch. Recheck the secret is
byte-identical between Riko's connection and Razorpay's webhook config — see
step 8b.

**Cases sit in `NEW` forever.** `RUN_WORKER` isn't `1`, or the worker log line
is missing on boot — see step 6.

**Every case gets stuck before sending, closed with `no_verified_sender`.**
Sender identity isn't configured — see step 9.

**A demo webhook silently never arrived.** The service was asleep and
Razorpay's delivery timed out before the 50-second cold start finished — see
step 7, and confirm the keepalive cron is actually running before a live demo.

**Inbound replies return `{"status":"ignored"}`.** Either the Email Routing
rule isn't catch-all (see step 10f), or the case the reply threads to has
already closed — `/inbound/mail` only matches cases in `NEW`, `DRAFTING`,
`SENDING`, `WAITING`, or `PROMISED`.

**`wrangler tail` shows nothing when you send a real reply.** The catch-all
rule isn't pointed at `riko-inbound-mail` — recheck step 10f. A quick way to
confirm the rule itself is live: send *any* mail to a nonsense address on the
domain (e.g. `asdf123@yourdomain.com`); if the worker never fires for that
either, the routing rule is the problem, not the reply's tag.

**`wrangler tail` shows the invocation, but Render logs a 401 on
`/inbound/mail`.** `RIKO_INBOUND_SECRET` (set via `wrangler secret put`, step
10d) doesn't match `INBOUND_MAIL_SECRET` on the Render service. Re-run
`wrangler secret put` with the exact value from Render's Environment tab —
there's no way to read back a Cloudflare secret once set, only overwrite it.

**`ERR_PNPM_INVALID_DEPLOY_TARGET: This command requires one parameter`.**
`deploy` is a reserved pnpm subcommand (for deploying a package to a
directory), so `pnpm --filter @riko/email-worker deploy` gets intercepted by
pnpm itself rather than running the worker's script — that's why the script
is named `cf:deploy`, not `deploy`. Use `pnpm --filter @riko/email-worker
cf:deploy` exactly as written above.

**Worker deploy succeeds but no domain shows up to route from.** Deploying
the worker (step 10e) and adding a domain to Cloudflare (step 10b) are
independent — deploying doesn't require a domain, and a domain doesn't
require a worker. If Email Routing → Routing rules shows no worker option,
the domain's Email Routing (10b) hasn't finished activating; it can take a
few minutes after accepting the MX/TXT records.

**`useActiveOrganization` or similar type errors in the editor after a
`pnpm install`.** Almost always a stale TypeScript server, not a real error —
run `pnpm -r typecheck` from a terminal to check the ground truth, then
restart the TS server in your editor.

## Environment variable reference

Everything Riko reads from the environment, beyond what's already covered
above. All optional ones have safe defaults for a demo.

| Variable | Required | Default | Effect |
|---|---|---|---|
| `INBOUND_REPLY_BASE` | For replies | none | Shared base reply address, e.g. `billing@reply.example.com`. Riko appends the per-case tag. Without it, mail carries no `Reply-To` and replies are unroutable. A tenant's own `reply_to` overrides it. |
| `HOLDOUT_PERCENT` | No | `5` | % of cases held back as the uncontacted control group |
| `CONTACT_WINDOW_START_HOUR` | No | `8` | Local hour outreach may start |
| `CONTACT_WINDOW_END_HOUR` | No | `19` | Local hour outreach must stop by |
| `DEFAULT_CUSTOMER_TIMEZONE` | No | `Asia/Kolkata` | Fallback when a customer has no stored timezone |
| `UNSUBSCRIBE_RATE_LIMIT` | No | `0.1` | Opt-out rate per send that trips the circuit breaker |
| `COST_PER_SEND_MINOR` | No | `0` | Assumed cost per email, for the net-recovered metric |
| `WORKER_POLL_MS` | No | `15000` | How often the in-process worker loop ticks |
| `NVIDIA_NIM_MODEL` | No | `meta/llama-3.1-8b-instruct` | Drafting model |
| `NVIDIA_NIM_BASE_URL` | No | NVIDIA's public endpoint | Override for a self-hosted NIM |
