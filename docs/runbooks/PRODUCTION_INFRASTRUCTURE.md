# Production Infrastructure — connecting providers

Everything below is **configuration only**: the adapters, validation and health reporting are in the code. Each step that needs an account, a credential, a DNS record or a dashboard change is marked **OWNER ACTION**. No secret value is ever written here, into the repository, into CI logs or into chat. Values go directly into the Vercel project's **Production** environment (never Preview).

**Status model.** `/admin/ops` → "صحة المزودين" shows each provider's status:

| Status | Meaning |
|---|---|
| `NOT_CONFIGURED` | The provider is not set up. |
| `CONFIGURED_UNVERIFIED` | Set up, but no real success recorded yet. |
| `HEALTHY` | A real success has been recorded. |
| `DEGRADED` | Recent failures. |
| `FAILED` | 3 or more failures in a row. |

`HEALTHY` never comes from configuration alone. "الجاهزية حسب المرحلة" shows the infrastructure part of PUBLIC WEBSITE / CONTROLLED PILOT / REAL MONEY.

## 0. Before anything (OWNER ACTION)
- Credential rotation S7–S10 (`SECRET_ROTATION.md`).
- New Vercel project `edmn-production` (team on Pro). Production branch `main`. Preview deployments get **no** production variables.
- New Neon project, separate from staging, in the same region as the Vercel functions.
- Production boot refuses a known staging encryption key, the staging database endpoint and local/test databases. It also refuses `DATA_ENCRYPTION_KEY_ID=default` and shared secrets (`src/server/core/known-nonprod.ts`, `productionIsolationErrors`).
- Before the first production deploy, add the staging `SESSION_SECRET` / `CRON_SECRET` check values to `NONPROD_SECRET_KCVS`. Staging records them in `secret_fingerprints` since this release, so a read-only query gives them; they are one-way values.

## 1. Region (OWNER ACTION, Vercel dashboard)
- `vercel.json` no longer pins a region. Each project uses its own dashboard setting, so staging stays on `iad1` (its project setting).
- `edmn-production` → Settings → Functions → **Function Region = Frankfurt (fra1)**, matching the Neon production region (`aws-eu-central-1`).
- Verify after the first deploy: the deployment's region is `fra1` and `/api/ready` returns `ready`.

## 2. Scheduler / cron
The endpoint is `/api/cron/tick`.
- It accepts GET or POST with `Authorization: Bearer <CRON_SECRET>`, and returns 404 without the secret.
- It is **due-based**: each job runs only when its own interval has elapsed, with 10 % jitter tolerance, under a database lease.
- Duplicate or overlapping calls never run a job twice. A missed call is recovered by the next one.
- Jobs never move money.

`vercel.json` keeps the **daily** cron, valid on Hobby (staging) and on Pro, as a safety net for both projects. For production every-minute ticks, pick one:
- **A — Vercel Cron (preferred once the whole team is on Pro).**
  1. **OWNER ACTION:** upgrade the team to Pro. Both projects then share Pro, so a per-minute schedule no longer breaks staging.
  2. Then, as a reviewed one-line change, set `"schedule": "* * * * *"` in `vercel.json`. Staging will tick every minute too; this is harmless, but it costs some extra Neon compute on staging.
- **B — External scheduler for production only (no repository change).**
  1. **OWNER ACTION:** create a 1-minute job, for example Upstash QStash schedule or cron-job.org, calling `https://www.edmneg.com/api/cron/tick`.
  2. Set the header `Authorization: Bearer <CRON_SECRET>` (QStash: `Upstash-Forward-Authorization`). The secret is stored only in the scheduler and Vercel.

In both cases keep `INLINE_WORKER=true`. Verify: Ops → jobs `ledger.health`, `outbound.flush` and `alerts.sweep` are `OK`, and `SCHEDULER` is `HEALTHY`.

## 3. Transactional email + delivery webhook
**SMTP (unchanged code).** The existing mailbox `info@edmneg.com` keeps its hosting and MX. **Do not change MX or the mailbox.** The provider only sends.
- **OWNER ACTION:** create the provider account and verify the domain `edmneg.com` for sending:
  - Add the provider's DKIM record.
  - **Merge** its SPF `include:` into the **existing** SPF record (only one SPF record may exist).
  - Add the bounce/return-path record if the provider requires one.
  - Add `_dmarc` with `p=none` first.
- Production variables:

  | Variable | Value |
  |---|---|
  | `MAIL_DRIVER` | `smtp` |
  | `SMTP_HOST` / `SMTP_PORT` | provider values |
  | `SMTP_USER` / `SMTP_PASSWORD` | provider credential |
  | `MAIL_FROM` | `اضمن إي جي <info@edmneg.com>` |

  Production refuses a sender outside the site's domain and placeholder addresses.

**Delivery webhook** (`/api/webhooks/email/<adapter>`). It is the only way a message becomes `DELIVERED` or `BOUNCED`; `DEFERRED` and `COMPLAINED` are recorded as evidence, and a complaint is audited.
- **Adapters:**
  - `resend` — the concrete provider: Svix-signed `svix-id`, `svix-timestamp` and `svix-signature`, secret `whsec_…`.
  - `generic` — EDMN HMAC `x-edmn-timestamp` / `x-edmn-signature` over `${timestamp}.${rawBody}`, for any provider bridged through a relay.
- **Guarantees:** ±5-minute replay window, unique event id (duplicates acknowledged, never re-applied), unknown messages recorded and acknowledged, raw bodies never stored, and no money effect.
- **OWNER ACTION (Resend):**
  1. Webhooks → add endpoint `https://www.edmneg.com/api/webhooks/email/resend`.
  2. Select the events delivered, bounced, delivery_delayed and complained.
  3. Copy the signing secret directly into Vercel as `EMAIL_WEBHOOK_SECRET`.
- **Verification (OWNER ACTION):**
  1. Send one real test email, for example a password reset to an owner address.
  2. Check that the Ops row turns `DELIVERED` and `EMAIL_WEBHOOK` is `HEALTHY`.
  3. Correlation uses the provider message id, or our `Message-ID <outbox-id@domain>` when the provider echoes it. If the first test shows `UNKNOWN_MESSAGE`, the provider's id differs from what SMTP returned. Do **not** enable real money; fix the mapping in a reviewed change.
- Staging: without `EMAIL_WEBHOOK_SECRET` the endpoint answers 503 and SMTP and the log driver work as before.

## 4. Error tracking
- **Internal:** `error_events` is always kept and authoritative.
- **External forward**, only when `ERROR_TRACKING_DSN` is set:
  - **Sentry:** DSN `https://<key>@<host>/<project>` → envelope API with `X-Sentry-Auth`. No SDK.
  - **Generic webhook:** any other https URL, plus `ERROR_TRACKING_TOKEN` as Bearer.
- **Guarantees:** 3 s timeout, one retry on network/429/5xx, at most one forward per error group per 10 minutes, and failures never affect the request.
- **Never sent:** passwords, OTP/TOTP, cookies, authorization headers, DB URLs, API tokens, emails, phone / national-ID / IBAN numbers, file or message ids in paths, query strings, request bodies, users, IPs.
- **Tags:** `environment`, plus `release` from `EDMN_RELEASE` or the Vercel git SHA.
- **OWNER ACTION:**
  1. Create a Sentry project (platform: Node).
  2. In the project settings, keep "Send default PII" **off** and enable data scrubbing.
  3. Copy the DSN into Vercel as `ERROR_TRACKING_DSN` (Production only).
- **Verification:** trigger a test error in a maintenance window and check that it appears once in Sentry and `ERROR_TRACKING` is `HEALTHY`.

## 5. Private malware scanner (ClamAV)
In production every private file stays **QUARANTINED** until the scanner says CLEAN. This covers ID scans, payment and payout proofs, and all evidence. Without a scanner nobody can open them, including reviewers.

**Fail closed:**

| Scanner outcome | File status | Openable? |
|---|---|---|
| CLEAN | `CLEAN` | yes, for authorized users |
| INFECTED | `INFECTED` | never |
| REJECTED | `REJECTED` | never |
| Unreachable / timeout / malformed response / non-200 | `SCAN_FAILED` | never; retried after 15 minutes |

Never use VirusTotal or any public multi-engine service.

**Deploy (OWNER ACTION):**
1. **Host:** a small private host or container with ≥ 2–4 GB RAM.
2. **Containers:** `clamav/clamav` (clamd on 3310, signatures auto-updated by freshclam), plus `node:22-alpine` running `ops/scanner/clamd-http.mjs`.
   - Wrapper env: `SCANNER_TOKEN` (≥ 32 random chars), `CLAMD_HOST`, `CLAMD_PORT`, `PORT`, `MAX_BYTES`.
   - The wrapper stores and logs nothing.
3. **Exposure:** clamd must never be public. Either:
   - the wrapper behind **HTTPS** (separate host), or
   - **self-hosted**: the compose profile `scanner` on the internal network, with `MALWARE_SCANNER_URL=http://scanner:8080/scan` plus `MALWARE_SCANNER_PRIVATE_NETWORK=true` (see `SELF_HOSTED_DEPLOYMENT.md` §9).
4. **App settings:** `MALWARE_SCANNER_URL` and `MALWARE_SCANNER_TOKEN` (same value as `SCANNER_TOKEN`). Production refuses a missing token, credentials in the URL, and plain http, except a private destination (single-label service name, loopback or RFC 1918) with the explicit flag.
5. **Verification:** upload the EICAR test file as a payment proof on production, before launch, from an owner account. It must become `INFECTED` and stay unopenable, while a normal PDF becomes `CLEAN`, and `MALWARE_SCANNER` shows `HEALTHY`. Then remove the `MALWARE_SCANNING` blocker in a reviewed change citing this evidence.

## 6. Web Push
- **OWNER ACTION:** generate a **new** VAPID key pair for production with `npx web-push generate-vapid-keys` on a trusted machine, and put it directly into Vercel.
- Set `VAPID_SUBJECT=mailto:info@edmneg.com`. Production refuses example or `.local` contacts.
- `WEB_PUSH` becomes `HEALTHY` after a real push is accepted by a browser push service. A real-device test is still required (`PUSH_DEVICE_TEST`).

## 7. What this does NOT do
It does not enable real money, payments, payouts or withdrawals to external accounts. It does not change pricing or the Fee Engine, and it does not touch DNS, MX or WHM/cPanel. Readiness tiers report; they never switch anything on.
