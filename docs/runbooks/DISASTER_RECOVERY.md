# Disaster recovery (self-hosted production)

**Severity and roles:** [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md). Any financial doubt is **SEV-1**: engage the global kill switch first ([REAL_MONEY_EMERGENCY_DISABLE.md](REAL_MONEY_EMERGENCY_DISABLE.md)).

**Recovery objectives** (proposed; the owner confirms):
- RPO ≤ 24 h: the daily backup plus pre-deploy backups.
- RTO ≤ 4 h on an existing host, ≤ 1 business day on a new host.

**These objectives hold ONLY when an off-server backup exists.** Until `backup-status.json` shows `OFF-SERVER COPY UPLOADED`, the server is a **single point of total data loss**. Every procedure below that says "restore" then has **no source** if the server itself is lost. Do not assume an external backup exists until the destination shows the object.

**Standard verification after any recovery:**
1. `deploy/scripts/watch.sh` shows HEALTHY.
2. `prod-acceptance.ts --db-only` (with `--expect-pricing` as in force) and `--http-only` both PASS.
3. Ledger debits = credits, and all invariants are 0.
4. `api.edmneg.com` and mail are unchanged (watch.sh `legacy:api` OK).
5. The incident is recorded.

| Scenario | Detection | Containment | Recovery | Verification |
|---|---|---|---|---|
| **Server lost** (hardware, provider, compromise) | External uptime monitor and heartbeat silence. SSH unreachable. | Kill switch is moot (the app is down). If compromise is suspected, rotate **all** secrets (manifest) before rebuilding; never reuse the host. | New host:
1. `server-discovery.sh`, then the install profile.
2. Recreate `/etc/edmn` from the secret manifest. Use **the same `DATA_ENCRYPTION_KEY`** (from its offline sealed copy), or encrypted data is unreadable. Use new other secrets if compromise is suspected.
3. Load the release image and start the empty database: `docker compose … up -d --wait postgres` (roles via `01-roles.sh`), or create the empty external database.
4. Download the latest **off-server** dump. Run `restore-database.sh <dump> --identity <offline key> --target-db edmn --existing-empty --confirm-owner-approved`. It restores as `edmn_owner`, re-grants `edmn_app`, and runs acceptance `--drill`.
5. `echo <sha> > /var/lib/edmn/current_tag`, then `deploy.sh normal --tag <sha>`.
6. Point the DNS A records at the new IP (DNS runbook). **Without an off-server backup: data is lost; start empty and inform users and the legal adviser.** | Standard + compare row counts with the dump manifest. |
| **Database corrupted** | `/api/ready` database/migrations error. `watch.sh` CRIT. PostgreSQL logs (checksum failures). Ledger-health CRITICAL. | Kill switch. Maintenance mode. Stop the worker (`docker compose stop worker`). Take an immediate **final backup** of what is readable. | Restore the newest good dump into a **NEW** database: `restore-database.sh <dump> --identity <key> --target-db edmn_restored_<date> --confirm-owner-approved`. It creates the database, restores, re-grants and verifies; it never touches the live one. Then point `DATABASE_URL`/`migrate.env` at it and run `deploy.sh normal`. Keep the corrupted one for forensics. | Standard + the restore-drill checklist on the new database. |
| **Database accidentally deleted** (table, rows or whole DB) | Acceptance or invariants fail. Missing data reported. Audit log. | Kill switch. Stop the worker. Preserve the current state (backup) before anything else. | As corrupted. With an external provider: point-in-time restore into a new branch at a time before the deletion. **Never** "repair" financial rows by hand: ledger corrections only through the audited finance tools. | Standard + targeted check of the affected entities. |
| **Deployment broken** | `deploy.sh` STOP at steps 8–12 (auto app rollback) or post-deploy alerts. | Automatic app-image rollback, or `rollback.sh app <previous sha>`. | Fix forward in a new commit. The DB stays on the expand-only schema. | `/api/ready` 200 + acceptance. |
| **Worker broken** | Container unhealthy. `watch.sh` CRIT (heartbeat stale; rehearsed). Critical schedules not current. | No money moves automatically, so no financial containment is needed. The tick timer keeps due jobs running if web is up. | `docker compose logs worker`; restart. If a code bug: `rollback.sh app`. Overdue jobs run immediately on recovery (rehearsed). | Heartbeat ≤ 180 s; `CRITICAL_SCHEDULES` PASS. |
| **Disk full** | `watch.sh` WARN 80% / CRIT 90%. PostgreSQL write errors. | Maintenance mode if writes fail. | Free space safely: `docker image prune` (old release images, **keeping current and previous**), the builder cache, old local backups **only if an off-server copy exists**. Grow the disk with Kntabo. Never delete the PostgreSQL volume or WAL by hand. | Standard. |
| **Certificate expired** | Browser errors. Uptime monitor TLS failure. `certbot renew --dry-run` failing. | None needed for data. | nginx: `certbot renew`, then `nginx -t && reload` (check port 80 / ACME reachability). cPanel: AutoSSL run in WHM (Kntabo). | `curl -vI https://www.edmneg.com` shows a new expiry date. |
| **Scanner unavailable** | `MALWARE_SCANNER` DEGRADED/FAILED. Files stuck in `SCAN_FAILED`. watch.sh container CRIT. | Nothing: it fails closed (files stay unopenable). | `docker compose --profile scanner up -d clamd scanner`. Check clamd memory and signatures. `SCAN_FAILED` files are retried every 15 min automatically. | EICAR → INFECTED, PDF → CLEAN, provider HEALTHY. |
| **Mail unavailable** | `SMTP` DEGRADED/FAILED. Outbox backlog. Ops page. | Nothing: messages queue (not lost, never faked). The mailbox `info@edmneg.com` is independent. | Fix provider credentials or service. The outbox retries; dead letters are re-queued from Ops after the fix ([EMAIL_OUTAGE.md](EMAIL_OUTAGE.md)). | `SMTP` HEALTHY; backlog drains. |
| **Backup destination unavailable** | `backup-status.json` = LOCAL COPY. Upload failure in the journal. Heartbeat silence. | **Real money must not be enabled or continued without off-server backups.** Consider maintenance for financial operations if the outage is long. | Fix destination credentials or provider. Run `backup.sh --reason manual` → `OFF-SERVER COPY UPLOADED`. | Status file + object visible in the destination. |
| **Legacy service conflict** (EDMN change affects Apache/nginx/api/mail) | `watch.sh` `legacy:api` CRIT (config hash changed). Kntabo report. api/mail monitoring. | **Immediately undo the EDMN proxy change** (remove `zz-edmn.conf` or the userdata include → test → reload). EDMN itself can keep running on loopback. | Compare `nginx -T` / `apachectl -S` with the saved before-files. Restore legacy files only from Kntabo's own copies. Never "fix" legacy config without Kntabo. | api.edmneg.com answers as recorded in the DNS runbook §1. Mail flows. |
