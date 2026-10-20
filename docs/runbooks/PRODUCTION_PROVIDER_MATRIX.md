# Production provider matrix

Read this before calling any provider a "launch blocker". It is derived from the code:
- `src/server/ops/provider-health.ts`
- `runtime-env.ts`
- `commerce-gate.ts`
- `smsAvailable()` and the scanner gate

**Important production fact:** while real money is OFF, production **closes new orders, Protected Deal invitations and deal payments** (`commerce-gate.ts`). The "buyer pilot" on production is therefore accounts, browsing, identity and support, **not purchases**. Transactional pilots with test money run on **staging**.

| Provider | Public browsing | Registration / login | Buyer pilot (no money) | Seller pilot (onboarding, KYC, catalog) | Protected Deal | Real money | Can run degraded? | Failure mode |
|---|---|---|---|---|---|---|---|---|
| **SMTP** (transactional mail) | no | **yes** (boot requires `MAIL_DRIVER=smtp`; verification and reset mails) | yes | yes | yes | yes | Yes: the outbox queues and retries, nothing is lost | **Fail closed / queued.** Mail is never faked as sent. |
| **Email delivery webhook** | no | no | no | no | no | **yes** (`EMAIL_DELIVERY_EVIDENCE` gate) | Yes: messages stay `SENT`, not `DELIVERED` | Fail closed (no DELIVERED without signed evidence) |
| **Error tracking** (Sentry / webhook) | no | no | recommended | recommended | recommended | **yes** (`ERROR_TRACKING` gate) | Yes: internal `error_events` is always kept | Fail open (never breaks a request) |
| **Malware scanner** (private ClamAV) | no | no | only if buyers upload private files (support/dispute evidence) | **yes** in practice: ID scans and documents stay QUARANTINED (unopenable, including by reviewers) until CLEAN | yes (evidence) | **yes** (`MALWARE_SCANNING` gate) | Yes: uploads accepted, files blocked until scanned; `SCAN_FAILED` retried | **Fail closed** |
| **Web Push** (VAPID) | no | no | no | no | no | no (owner device test listed only) | Yes: in-app and e-mail notifications continue | Fail open (reported NOT CONFIGURED) |
| **SMS** (HTTP provider) | no | no (e-mail login works) | no | **yes**: mobile verification is required for seller onboarding | **yes** (delivery OTP) | **yes** (`MESSAGING_DRIVERS`) | Yes: SMS flows are refused with a clear message | **Fail closed** (never faked) |
| **Payment provider** | no | no | no | no | no (closed in production while real money is off) | **yes** (`PAYMENT_PROVIDER`, `PROVIDER_SIGNING_SECRET`) | n/a until the real-money programme | Fail closed |
| **Backup destination** (off-server) | no | no | **yes** (any real user data) | **yes** | yes | **yes** (`BACKUP_VERIFIED`, `RESTORE_DRILL`) | Yes, but every backup is labelled `LOCAL COPY — NOT DISASTER-RECOVERY BACKUP` and watch.sh warns | Honest degraded label (never "healthy") |
| **Uptime monitor** (external HTTP on `/api/ready`) | recommended | recommended | yes | yes | yes | **yes** (`MONITORING_ALERT_TEST`) | Yes: watch.sh still runs locally, but a dead server alerts nobody | n/a |
| **Heartbeat monitor** (dead-man's switch for backup/watch) | no | no | recommended | recommended | recommended | **yes** | Yes (local status files only) | n/a |

**Minimum per stage** (details and evidence: [GO_LIVE_ACCEPTANCE_MATRIX.md](GO_LIVE_ACCEPTANCE_MATRIX.md)):

| Stage | Required providers |
|---|---|
| PUBLIC WEBSITE | SMTP |
| BUYER PILOT | + off-server backup destination, uptime monitor; error tracking recommended |
| SELLER PILOT | + SMS, malware scanner |
| PROTECTED DEAL PILOT | **production:** only after real money (closed otherwise); **staging:** test money |
| REAL MONEY | all of the above + email webhook evidence, error tracking, heartbeat, payment provider |
