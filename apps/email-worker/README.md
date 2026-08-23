# Inbound mail worker

Receives replies to Riko's recovery emails and posts them to `/inbound/mail`,
where they are classified (reply / bounce / auto-reply / unsubscribe) and, if
they contain a commitment to pay, turned into a promise.

## How a reply finds its case

Every outgoing email carries a plus-tagged `Reply-To`:

```
billing+6b7f2848-6da8-4e6d-99f8-71a726f56686@yourdomain.com
```

The API routes on that tag first and falls back to `In-Reply-To` threading.
The tag is the reliable path: clients rewrite threading headers and forwards
drop them, but the envelope recipient survives.

**This is why Email Routing must be set to catch-all.** Cloudflare matches
custom addresses exactly, so a rule for `billing@yourdomain.com` will *not*
catch `billing+<case-id>@yourdomain.com`.

## Setup

**1. Add the domain to Cloudflare** and enable Email Routing
(Dashboard → your domain → Email → Email Routing). Accept the MX and TXT
records it offers.

**2. Point the API at a public URL.** Cloudflare cannot reach `localhost`, so
edit `RIKO_INBOUND_URL` in `wrangler.toml` to either a deployed API or a
tunnel:

```
cloudflared tunnel --url http://localhost:4000
```

**3. Set the shared secret** — it must equal `INBOUND_MAIL_SECRET` in the API's
`.env`, or every message is rejected with 401:

```
pnpm --filter @riko/email-worker exec wrangler secret put RIKO_INBOUND_SECRET
```

**4. Deploy:**

```
pnpm --filter @riko/email-worker deploy
```

**5. Route catch-all to the worker.** Email Routing → Routing rules →
Catch-all address → action **Send to a Worker** → `riko-inbound-mail`.

**6. Set the Reply-To** in Riko under Settings to the untagged base address
(`billing@yourdomain.com`). Riko adds the per-case tag when it sends.

## Checking it works

Send a reply to any recovery email. The worker logs each message:

```
pnpm --filter @riko/email-worker exec wrangler tail
```

A routed reply returns `{"status":"applied", ...}`. `{"status":"ignored"}`
means no case matched — set `FORWARD_UNMATCHED_TO` in `wrangler.toml` so those
land in a human mailbox instead of disappearing.

To exercise the same path without real mail:

```
pnpm --filter @riko/api exec tsx --env-file=../../.env scripts/send-tagged-reply.ts
```

## Behaviour worth knowing

- Messages over 1 MB are rejected at the edge rather than parsed.
- A 5xx from the API throws, so Cloudflare tells the sending server to retry.
  A reply is never bounced because Riko happened to be down.
- Auto-replies and soft bounces are recorded but never escalate, so an
  out-of-office does not stop a live recovery.
