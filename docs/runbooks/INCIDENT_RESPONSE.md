# Incident Response

> Severity levels and response targets below are a **PROPOSAL** — they need owner approval and an on-call roster (OWNER ACTION).

## Severity model (PROPOSED)
| SEV | Definition | Examples | First response (proposed) |
|---|---|---|---|
| **SEV-1** | Money or identity integrity at risk, or data exposure | Ledger CRITICAL / debit ≠ credit / drift / duplicate money event (**always SEV-1**), wrong payout, National ID or bank detail exposed, secret leaked, environment fingerprint VIOLATION | Immediately; engage emergency kill switch first |
| **SEV-2** | Core flow down for many users, no integrity risk | Checkout / login / payment-proof upload failing, DB unreachable, readiness 503 | ≤ 30 min |
| **SEV-3** | Degraded, workaround exists | Email/SMS provider down (outbox backing up), scheduled jobs STALE, malware scanner down (files quarantined) | Same business day |
| **SEV-4** | Cosmetic / single user | Wording, a single failed notification | Backlog |

## First 15 minutes (any SEV-1)
1. **Contain money first**: `/admin/finance-control` → «إيقاف الطوارئ» (needs `finance.controls` + fresh 2FA + reason; audited as `killswitch.global_engaged`). Login, support, history, disputes stay available.
2. Open `/admin/ops`: fingerprint, readiness, ledger health, jobs, outbox, error groups (`error_events`).
3. Run a fresh read-only ledger health check (Ops → «شغّل فحص الآن», audited `ledger.health_checked`).
4. Record the timeline (UTC), who did what, request ids (`x-request-id` → audit_logs.request_id).
5. Follow the specific runbook (FINANCIAL_DRIFT, SECRET_ROTATION, STORAGE_OUTAGE…).

## Critical actions are audited
Kill switches (`killswitch.*`), ledger health checks, dead-letter requeues, sensitive document views (`file.sensitive_viewed`), approvals, settings changes — all write `audit_logs` (append-only by trigger). Never act directly in SQL on production data; if SQL is unavoidable it must be read-only (`set default_transaction_read_only = on`).

## Closing
Release the global kill switch only with **two people** (request + approval by a second `finance.controls` holder). Write a post-incident note: cause, impact (users, amounts), evidence (health snapshots), fix commit, prevention.
