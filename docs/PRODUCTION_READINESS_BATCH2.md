# EDMN Marketplace V1 — Production Readiness Batch 2

Infrastructure, reliability, security operations, backups, monitoring, jobs, communications, storage and deployment safety.
Branch `claude/great-tesla-nor0wt`, starting commit `f23f3f8`. **No production environment exists or was created. Real money is OFF.**

## 1. Phase 0 audit (before Batch 2)

| Area | Found | Class (before) |
|---|---|---|
| Branch / HEAD / tree | `claude/great-tesla-nor0wt` @ `f23f3f8`, clean | READY |
| Deployment / Vercel config | Hobby, `iad1`, build = migrate → seed → (staging demo) → `next build`; one cron `17 3 * * *` | PARTIAL (daily cron only) |
| DB provider / config | Neon (pooled runtime, unpooled migrations); pool max 10, connect 10 s, **no statement/lock/idle-tx timeouts** | PARTIAL |
| Migrations | drizzle migrator, no lock, no destructive preflight; environment marked **after** DDL | PARTIAL |
| File storage | `STORAGE_DRIVER=database` on staging (objects in Postgres), local disk driver, path-traversal-safe keys, private files via authorized route | PARTIAL (no classes/scan) |
| Cron / background jobs | in-memory schedule cadence per instance (no singleton), queue with SKIP LOCKED, stuck recovery, no telemetry | PARTIAL |
| Outbox / notifications | retry count only (no backoff/claim → possible double send), FAILED at 5, secrets redacted after 1 h but **readable in plaintext until then** | PARTIAL |
| Email | SMTP adapter, `MAIL_DRIVER=log` on staging | PROVIDER CREDENTIAL REQUIRED |
| Push | VAPID configured on staging, subscription lifecycle + revoke on 404/410 | PARTIAL (no device evidence) |
| SMS | HTTP adapter, `SMS_DRIVER=log` | PROVIDER CREDENTIAL REQUIRED |
| Secrets / env | zod env, production refusals for placeholders/staging creds; no classification; single encryption key, no key id | PARTIAL |
| Health / readiness | `/api/health` liveness, `/api/ready` DB+migrations+storage (public counts) | PARTIAL |
| Logging | structured JSON, strong redaction, request id from proxy (unvalidated) | PARTIAL |
| Monitoring / error tracking | none | MISSING |
| Backup / restore | runbook draft, **no drill** | MISSING (evidence) |
| Rate limiting | Postgres fixed window (distributed-safe) | READY |
| Session security | httpOnly/secure/lax cookies, admin 2FA + step-up, **no idle timeout** | PARTIAL |
| Upload security | magic-byte sniffing, sharp re-encode, size caps, safe keys, no SVG | PARTIAL (no malware scan) |
| Malware scanning | none | MISSING / EXTERNAL DEPENDENCY |
| CSP / headers | HSTS, XFO, nosniff, CSP with `'unsafe-inline'` scripts everywhere | PARTIAL |
| Trusted proxy | X-Real-IP trusted outside Vercel unconditionally | PARTIAL (spoofable self-hosted) |
| Production guards | DB marker + triggers (C8), demo seed guards | READY |
| Real-money guards | `goLiveGate`, realMoney off, staging can never enable | READY (infra gates missing) |
| Reconciliation | statement import, suggested/confirmed matches | PARTIAL (status vocabulary) |
| Docs / runbooks | backup + incident drafts | PARTIAL |
| `reset-db --force` | could drop a non-local database | RISK (fixed) |

## 2. What Batch 2 implemented (code, all tested)

| Part | Implementation | Files |
|---|---|---|
| A Environments | LOCAL/TEST/STAGING/PRODUCTION runtime model; env-var policy REQUIRED / OPTIONAL / FORBIDDEN_IN_PRODUCTION / STAGING_ONLY / SECRET (names only, never values); production fatal, staging warns on rules it predates | `src/server/core/runtime-env.ts`, `env.ts` |
| A Fingerprint | DB marker compatibility (prod only on PRODUCTION; nothing else on PRODUCTION; local never on STAGING), storage namespace marker, encryption-key check value recorded per environment; VIOLATION blocks money + fails readiness; verified at boot (`instrumentation.ts`) and by the money gate | `src/server/db/fingerprint.ts`, `src/instrumentation.ts` |
| B Database | statement 30 s / lock 10 s / idle-in-tx 60 s per transaction (SET LOCAL, pooler-safe), client query ceiling; migration advisory lock, destructive-statement preflight (expand/contract marker), environment check **before** DDL; `reset-db` refuses STAGING/PRODUCTION markers | `src/server/db/client.ts`, `migrations.ts`, `scripts/migrate.ts`, `scripts/reset-db.ts` |
| C Backup/restore | isolated local restore drill with financial verification + evidence; storage integrity verifier; RPO/RTO PROPOSED | `scripts/restore-drill.ts`, `scripts/storage-verify.ts`, runbooks |
| D Jobs | DB lease singleton per schedule, DB-decided cadence, `job_runs` telemetry, retries via consecutive failures, ABANDONED stuck detection, health states; alerts sweep through the scheduler; `ledger.health`, `files.scan`, telemetry pruning jobs | `src/server/jobs/scheduler.ts`, `tick.ts`, `worker.ts` |
| E Outbox | SKIP LOCKED claim (no double send), exponential backoff, dead letter, provider message id + idempotency reference, DELIVERED/BOUNCED only from provider events, AES-GCM sealed secrets in production (destroyed after hand-off), audited dead-letter requeue | `src/server/modules/notifications/outbox.ts`, `providers.ts` |
| F/G/H Comms | provider truth on Ops page ("EMAIL CODE READY / PROVIDER NOT CONFIGURED", "PUSH … REAL-DEVICE TEST REQUIRED"); SMS kept as adapter (OTP semantics unchanged) | `src/server/ops/health.ts` |
| I/J Storage | PUBLIC / PRIVATE / HIGHLY_SENSITIVE classes; scan lifecycle UNSCANNED / QUARANTINED / SCANNING / CLEAN / INFECTED / REJECTED / SCAN_FAILED; scanner abstraction (HTTP, e.g. ClamAV REST) — **no fake scanner**; production serves only CLEAN private files | `src/server/storage/scanning.ts`, `access.ts`, `uploads.ts` |
| K Secrets | versioned key ring (v2.<kid>, previous keys decrypt-only, v1 compatible), re-encryption script (dry-run default), leak scan (tree + history, locations only) | `src/server/core/crypto.ts`, `scripts/reencrypt.ts`, `scripts/secret-scan.ts` |
| L Monitoring | provider-neutral error tracking (`error_events`, grouped, redacted, optional DSN forwarding), env in every log line, sanitized correlation ids, configurable `ops.thresholds`, Ops deep health page | `src/server/core/error-tracking.ts`, `src/proxy.ts`, `/admin/ops` |
| M Financial | read-only ledger health snapshots (append-only), CRITICAL blocks new money movements; emergency global kill switch (2FA + reason + audit; two-person release); master gate +11 infrastructure gates | `ledger-health.ts`, `controls.ts` |
| N Security | strict per-request nonce CSP on the admin surface (`'strict-dynamic'`, no `'unsafe-inline'` scripts), COOP, frame-src none; staff idle timeout (30 min PROPOSED, configurable); trusted-proxy fix (`TRUSTED_PROXY`) | `src/proxy.ts`, `next.config.ts`, `auth/service.ts`, `web/client-ip.ts` |
| O Deployment | CI workflow (lint, typecheck, vitest, secret scan), deploy/rollback policy, pilot allow-list + caps (null = owner decides) | `.github/workflows/ci.yml`, `src/server/ops/pilot.ts` |
| P Health | liveness unchanged; readiness = DB, migrations ≥ shipped, fingerprint, config policy, storage (status words only) | `/api/ready` |
| Q Retention | classification with LEGAL/POLICY OWNER INPUT REQUIRED; financial/audit never auto-deleted | `src/server/ops/retention.ts` |
| R Reconciliation | MATCHED / UNMATCHED / DUPLICATE_SUSPECTED / AMOUNT_MISMATCH / REFERENCE_MISMATCH / REVIEW_REQUIRED classification on top of the existing workflow; no fake provider | `finance/reconciliation.ts` |
| S Isolation | production refusals retained + extended; one-time SUPER_ADMIN bootstrap (refuses if one exists, refuses `.local`, interactive only) | `scripts/create-admin.ts` |
| T Runbooks | 11 runbooks + index | `docs/runbooks/` |

Migration `0016_batch2_infrastructure_reliability` is purely additive (5 new tables, nullable/defaulted columns, two check constraints satisfied by existing values, two protective triggers).

## 3. Final go-live matrix

| Gate | Status |
|---|---|
| Environment model, fingerprint, startup validation | CODE READY → STAGING VERIFIED after deploy |
| DB timeouts, migration lock/preflight | CODE READY (tested locally) |
| Backup strategy | OWNER ACTION REQUIRED (Neon plan PITR window) |
| Restore drill | CODE READY (local drill PASS) — **production/provider drill NOT DONE** |
| Reliable jobs / telemetry | CODE READY; production scheduler: EXTERNAL PROVIDER REQUIRED (Hobby = daily cron) |
| Outbox reliability / sealed secrets | CODE READY |
| Email delivery | EXTERNAL PROVIDER REQUIRED (no delivery evidence) |
| SMS | EXTERNAL PROVIDER REQUIRED |
| Web Push | OWNER ACTION REQUIRED (real-device matrix) |
| Storage classes / private access | CODE READY |
| Malware scanning | EXTERNAL PROVIDER REQUIRED — MALWARE SCANNER ACTIVE: NO |
| Secrets rotation S7–S10 | OWNER ACTION REQUIRED |
| Key versioning | CODE READY |
| Error tracking / alerting to a human | EXTERNAL PROVIDER REQUIRED (internal sink only) |
| Ledger health + emergency kill switch | CODE READY |
| Admin CSP / idle timeout / trusted proxy | CODE READY |
| Public-page CSP without `'unsafe-inline'` | NOT READY (needs all-dynamic rendering or a paid plan) |
| Payment provider + reconciliation feed | EXTERNAL PROVIDER REQUIRED |
| Legal texts, tax treatment, fee approvals | LEGAL APPROVAL REQUIRED |
| Retention periods | LEGAL APPROVAL REQUIRED |
| Incident severities / on-call | OWNER ACTION REQUIRED |

## 4. Owner actions & external dependencies

| SERVICE | PURPOSE | WHY | FREE/PAID | OWNER ACTION | EXACT CREDENTIAL | WHERE IT GOES | SECURITY NOTES | STAGING CONTINUES? | BLOCKS PRODUCTION? | BLOCKS REAL MONEY? |
|---|---|---|---|---|---|---|---|---|---|---|
| Transactional email | password reset, verification, notifications | log driver delivers nothing | free tier → paid | create account, verify sending domain (SPF/DKIM/DMARC) | SMTP host/user/password (or API key) | Vercel env `MAIL_DRIVER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | production-only key; never reuse on staging | YES | YES | YES |
| SMS (Egypt) | phone verification, delivery OTP | log driver | paid per message | contract, register sender ID (NTRA rules) | endpoint + token | `SMS_DRIVER=http`, `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`, `SMS_SENDER_ID` | adapter payload may need mapping to the chosen API | YES | YES | YES |
| Error tracking | errors reach a human | internal sink only | free tier | create project (EU/any region), set alert rule to on-call | DSN / ingest URL | `ERROR_TRACKING_DSN` | redacted payload only | YES | YES | YES |
| Malware scanner | scan PDFs/evidence/ID scans | none | self-hosted (free) + small VM | deploy ClamAV REST container | URL (+ token) | `MALWARE_SCANNER_URL`, `MALWARE_SCANNER_TOKEN` | documents must not leave our infrastructure (no public multi-engine services) | YES | YES | YES |
| Scheduler | 5-min jobs, ledger health | Hobby cron is daily | paid plan or external cron | Vercel Pro cron or external trigger every 5 min | CRON_SECRET (existing pattern) | `vercel.json` crons / external caller | Bearer secret, timing-safe | YES | YES | YES |
| Production database | prod data with PITR | none exists | paid | create NEW project, choose PITR ≥ 7 days | connection strings | production Vercel env only | never a staging branch | YES | YES | YES |
| Backup drill | proof of restore | not done | — | Neon branch restore + checklist | — | evidence → reviewed change | isolated target only | YES | YES | YES |
| Object storage (later) | large files off the DB | DB storage grows | paid | create private bucket, versioning on | access key | new driver (not implemented) | private, server-side access only | YES | NO (DB storage works) | NO |
| Payment provider | collections/payouts + statements | manual transfers today | contract | choose PSP | API keys + webhook secret | `PAYMENT_WEBHOOK_SECRET` etc. | signature verification | YES | — | YES |
| Secret rotation | S7–S10 exposed in chat | — | free | revoke + reissue | — | provider consoles | never paste secrets in chat | YES | YES | YES |
| Push real devices | browser notifications | no device evidence | free | test Chrome/Edge desktop + Android Chrome | — | — | — | YES | NO | NO |
| Legal / tax | policies, fee tax treatment, retention | counsel/accountant | paid | approve | — | settings `legal.policiesApproved`, pricing | — | YES | YES | YES |

### Provider comparisons (recommendations; nothing purchased)
- **Email**: Postmark (best transactional deliverability, simple, paid after a small trial) · Amazon SES (cheapest at volume, more setup, sandbox exit request) · Resend (developer friendly, free tier). **Recommend Postmark** for a low-volume, high-trust launch; SES if cost dominates. Egypt: all deliver to Gmail/Outlook; deliverability depends on domain authentication.
- **SMS Egypt**: Cequens (Egyptian, local routes, sender-ID registration support) · Victory Link (Egyptian aggregator) · Twilio (global API, higher per-message cost, Egyptian sender-ID constraints). **Recommend a local aggregator (Cequens)** for delivery rates and NTRA sender-ID compliance; verify current pricing/terms directly.
- **Error tracking**: Sentry (free developer tier, mature alerting) · Better Stack (logs + uptime + errors) · Highlight. **Recommend Sentry** (point `ERROR_TRACKING_DSN` at a relay/ingest endpoint or swap the adapter for the SDK later).
- **Malware scanning**: self-hosted ClamAV REST (free, documents stay private) · AWS GuardDuty Malware Protection for S3 (needs S3) · public multi-engine services (**not acceptable** for National IDs). **Recommend ClamAV REST** on a small private VM/container.
- **Scheduler**: Vercel Pro crons · Upstash QStash · a tiny always-on worker (`npm run worker`). **Recommend Vercel Pro** if moving plans anyway, else QStash calling `/api/cron/tick`.
- Verify current prices and Egypt coverage with each vendor before contracting — this document does not quote prices.

## 5. Readiness answers
- **A. APPLICATION CODE READY**: YES for the Batch 2 scope (tests green), with the public-CSP limitation documented.
- **B. STAGING OPERATIONALLY READY**: see the deployment report (targeted staging + post-deploy financial check).
- **C. CONTROLLED PRODUCTION PILOT READY**: **NO** — no production environment, no email/SMS provider, no restore drill on production backups, no external alerting, no scanner, S7–S10 not rotated.
- **D. REAL-MONEY READY**: **NO** — all of C plus payment provider, legal, tax and fee approvals.
