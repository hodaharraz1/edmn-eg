# EDMN Runbooks (Batch 2)

| Runbook | When |
|---|---|
| [INCIDENT_RESPONSE](INCIDENT_RESPONSE.md) | Any incident: severity model (SEV-1..4, PROPOSED), roles, audited critical actions |
| [FINANCIAL_DRIFT](FINANCIAL_DRIFT.md) | Ledger health CRITICAL, debit ≠ credit, drift, duplicates — always SEV-1 |
| [REAL_MONEY_EMERGENCY_DISABLE](REAL_MONEY_EMERGENCY_DISABLE.md) | Stop every new money movement now |
| [REAL_MONEY_ENABLEMENT](REAL_MONEY_ENABLEMENT.md) | The only path to real money (master gate + owner) |
| [PRODUCTION_DEPLOYMENT](PRODUCTION_DEPLOYMENT.md) | Deploying, CI gates, rollback / forward-fix, pilot controls |
| [DATABASE_BACKUP](DATABASE_BACKUP.md) | Backup strategy, RPO/RTO (PROPOSED) |
| [DATABASE_RESTORE](DATABASE_RESTORE.md) | Isolated restore + post-restore financial verification |
| [STORAGE_OUTAGE](STORAGE_OUTAGE.md) | Private/public file storage failure, storage recovery verification |
| [JOB_FAILURE](JOB_FAILURE.md) | Scheduled jobs stale/failing, dead-lettered queue jobs |
| [EMAIL_OUTAGE](EMAIL_OUTAGE.md) | Email/SMS provider down, outbox backlog, dead letters |
| [SECRET_ROTATION](SECRET_ROTATION.md) | Rotating S7–S10 and application secrets, key versioning, leak scan |

Where things are: Ops deep health `/admin/ops`; financial control center `/admin/finance-control`; readiness `/api/ready`; liveness `/api/health`; ledger check `npm run ledger:check`.
Rules that every runbook inherits: never reset staging/production, never truncate or rewrite financial history, never mutate A-100016, never weaken Maker/Checker / KYC / payout verification, fail closed.
- `PRODUCTION_INFRASTRUCTURE.md` — connecting providers (cron, region, email delivery webhook, error tracking, private ClamAV scanner, Web Push) with every OWNER ACTION marked.
- `SELF_HOSTED_DEPLOYMENT.md` — self-hosted production on the existing EDMN server (`deploy/`): first vs normal deploy, roles, backups/restore drill, worker/watchdog, proxies/TLS, ClamAV, hardening, monitoring, acceptance.
- `SELF_HOSTED_DNS_CUTOVER.md` — www/admin/apex cutover only (api.edmneg.com, MX, SPF/DKIM/DMARC and mail records untouched), TTL, verification, rollback.
