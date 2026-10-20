# PRODUCTION GO-LIVE — start here

This is the **only** starting document for EDMN production. Follow it top to bottom; every other production document is a sub-step linked from here.

Older production texts (`PRODUCTION_DEPLOYMENT.md`, `docs/DEPLOYMENT.md`, the Vercel parts of `PRODUCTION_INFRASTRUCTURE.md`) describe a Vercel-hosted production. They are kept as audit history and marked **SUPERSEDED for production**.

**Fixed rules:**
- Production runs **self-hosted on the existing EDMN server** (Docker).
- Vercel is **staging only**.
- Real money stays **OFF**. Activating it is a separate gate: [REAL_MONEY_ACTIVATION_GATE.md](REAL_MONEY_ACTIVATION_GATE.md).
- `api.edmneg.com`, `info@edmneg.com`, MX/SPF/DKIM/DMARC, WHM/cPanel and every legacy service stay untouched.

---

## 0. Before server access (done; frozen at the release SHA)

- All code, tooling, templates and runbooks below are in the repository.
- Local rehearsal from an empty database succeeds (see §10).
- Product and business logic are frozen. The release image is built from one commit SHA.

## 1. Execution order (server phase)

| # | Step | Tool / document | Changes the server? |
|---|---|---|---|
| 1 | **Server discovery** (first command ever run). Read-only, secrets redacted. Copy `discovery.json` off the server. | `sudo bash deploy/scripts/server-discovery.sh` | no |
| 2 | **Compatibility decision** on your own machine: SUPPORTED / WITH_WARNINGS / BLOCKED and profile A/B/C. The owner and Kntabo decide; nothing is applied. | `node deploy/scripts/evaluate-server.mjs discovery.json` | no |
| 3 | **Install infrastructure** for the chosen profile (dry run first, then `--apply`). | [SERVER_INSTALL_PROFILES.md](SERVER_INSTALL_PROFILES.md) | yes (approved) |
| 4 | **Legacy safety gate.** It must PASS; it STOPs otherwise. | `sudo deploy/scripts/preflight-legacy.sh` | no |
| 5 | **Insert production secrets** into `/etc/edmn/*.env`. Generate them on the server; never in chat. | [PRODUCTION_SECRETS_MANIFEST.md](PRODUCTION_SECRETS_MANIFEST.md) | yes |
| 6 | **Validate the configuration** (prints names only). | `docker compose -f deploy/compose/docker-compose.prod.yml --env-file /etc/edmn/compose.env run --rm --no-deps -T web node --import tsx scripts/check-production-env.ts` (exactly the environment the app will see), or `npx tsx scripts/check-production-env.ts --file /etc/edmn/production.env --migrate-file /etc/edmn/migrate.env` on a checkout | no |
| 7 | **Database** (local PostgreSQL 16, or external). | [PRODUCTION_DATABASE_PLAN.md](PRODUCTION_DATABASE_PLAN.md) | yes |
| 8 | **First deploy** (empty DB → migrate → reference seed → web/worker → acceptance). | `sudo -E deploy/scripts/deploy.sh first --tag <sha>` ([SELF_HOSTED_DEPLOYMENT.md](SELF_HOSTED_DEPLOYMENT.md) §4) | yes |
| 9 | **First SUPERADMIN** (interactive, one-time). | §6 below: `scripts/create-admin.ts` | DB only |
| 10 | **Timers, first backup, restore drill.** | [SELF_HOSTED_DEPLOYMENT.md](SELF_HOSTED_DEPLOYMENT.md) §6–§7 | yes |
| 11 | **Acceptance**, read-only (`--local` before DNS). | `scripts/prod-acceptance.ts` | no |
| 12 | **Reverse proxy** (port-80 blocks), then the **DNS cutover** and TLS. | [SELF_HOSTED_DEPLOYMENT.md](SELF_HOSTED_DEPLOYMENT.md) §8, [SELF_HOSTED_DNS_CUTOVER.md](SELF_HOSTED_DNS_CUTOVER.md) | yes (approved) |
| 13 | **Stage gates**: public website → pilots → (later) real money. | [GO_LIVE_ACCEPTANCE_MATRIX.md](GO_LIVE_ACCEPTANCE_MATRIX.md), [PRODUCTION_PROVIDER_MATRIX.md](PRODUCTION_PROVIDER_MATRIX.md) | no |

**If anything fails:** use [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) and [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

**Never:**
- skip step 4
- run `scripts/start.sh` in production (it exits 64)
- restore over a live database
- enable real money from the environment (there is no such variable)

## 2. Authoritative filesystem layout

| Path | Owner:group | Mode | Purpose | Persistence |
|---|---|---|---|---|
| `/opt/edmn/` | `edmn:edmn` | 0750 | Release checkout at the release SHA (`deploy/`, `drizzle/`, docs). Replaced per release. | disposable (re-cloned) |
| `/etc/edmn/` | `root:edmn` | 0750 | Configuration directory. | **persistent, secret** |
| `/etc/edmn/production.env` | `root:edmn` | 0640 | App environment (runtime DB role `edmn_app`). | secret |
| `/etc/edmn/migrate.env` | `root:edmn` | 0640 | Owner DB URL (`edmn_owner`), migrate/seed only. | secret |
| `/etc/edmn/postgres.env` | `root:root` | 0600 | PostgreSQL superuser and role passwords (local DB only). | secret |
| `/etc/edmn/scanner.env` | `root:root` | 0600 | `SCANNER_TOKEN`. | secret |
| `/etc/edmn/backup.env` | `root:root` | 0600 | Backup role URL, age **public** recipient, upload command, heartbeat. | secret |
| `/etc/edmn/cron-header` | `root:root` | 0600 | `Authorization: Bearer <CRON_SECRET>` for the watchdog timer. | secret |
| `/etc/edmn/monitor.env` | `root:root` | 0600 | Optional heartbeat/alert URLs. | secret |
| `/etc/edmn/compose.env` | `root:edmn` | 0644 | Non-secret: image name, web port, profiles, expected pricing. | persistent |
| `/etc/edmn/nginx-tls.conf` | `root:root` | 0644 | nginx TLS snippet (profile B). | persistent |
| `/var/lib/edmn/` | `root:root` | 0750 | State: `current_tag`, `previous_tag`, `last_deploy_result`, `backup-status.json`, `restore-drill-status.json`, `watch-status`, `legacy-baseline.sha256`, preflight reports, `deploy.lock`. | persistent (small) |
| `/var/backups/edmn/` | `root:root` | 0700 | Encrypted dumps, manifests and checksums (local copy; retention 14 days, keeping at least 3). | persistent; **not DR** until off-server |
| `/var/log/edmn/` | — | — | **Not used.** Containers log to Docker json-file (50 MB × 5). Timers log to the journal (`journalctl -u edmn-*`). | — |
| Docker volume `edmn_edmn_pgdata` | Docker | — | PostgreSQL data (local DB profile). | **persistent, critical** |
| Docker volume `edmn_edmn_clamav` | Docker | — | ClamAV signatures. | disposable |
| `/var/www/letsencrypt/` | `root:root` | 0755 | ACME webroot (profile B). | disposable |

Application files (uploads) live **inside PostgreSQL** (`STORAGE_DRIVER=database`), so the dump covers them. There is no separate files directory.

## 3. Repository production inventory (authoritative)

"Tested" means covered by automated tests (`tests/integration/self-hosted.test.ts`, `pre-server.test.ts`) and/or the local rehearsal. "Server" means it only makes sense on the server. "Secret" means it needs production secrets to run.

| Path | Purpose | Tested | Server | Secret |
|---|---|---|---|---|
| `Dockerfile` | Immutable release image (web, worker, scanner wrapper, ops scripts); revision label = SHA | yes (built, rehearsed) | no | no |
| `deploy/compose/docker-compose.prod.yml` | Production services and profiles | yes | yes | yes (env files) |
| `deploy/compose/postgres/init/01-roles.sh` | `edmn_owner` / `edmn_app` / `edmn_backup` roles, UTF8, UTC | yes (rehearsed) | yes | yes |
| `.env.production.example` | Every production variable (names and placeholders, tier markers) | yes | no | no |
| `scripts/check-production-env.ts` | Production config checker (names only) | yes | no | reads secrets, prints none |
| `deploy/scripts/server-discovery.sh` | Read-only server discovery (JSON + summary, redacted) | yes (run locally) | yes | no |
| `deploy/scripts/evaluate-server.mjs` | Offline compatibility decision and profile | yes | no | no |
| `deploy/scripts/preflight-legacy.sh` | Legacy-safety gate (STOP on doubt), `api.edmneg.com` baseline | yes | yes | no |
| `deploy/hardening/ubuntu-debian.sh`, `almalinux-rocky.sh` | Server baseline (dry run by default) | dry-run tested (Ubuntu) | yes | no |
| `deploy/scripts/deploy.sh` (+ `lib.sh`) | First/normal deploy, 12 steps, STOP, app-only auto-rollback | yes (rehearsed) | yes | yes |
| `deploy/scripts/rollback.sh` | `app [<sha>]`; `database` prints the manual procedure only | yes | yes | no |
| `scripts/migrate.ts` (`--preflight`) | Explicit, advisory-locked migrations with environment marker | yes | — | yes |
| `scripts/seed.ts` | Idempotent reference seed (demo only with `--demo`, refused in production) | yes | — | yes |
| `scripts/create-admin.ts` | One-time first SUPER_ADMIN (interactive) | yes (rehearsed) | yes | yes |
| `scripts/worker.ts`, `scripts/worker-health.mjs` | Worker (primary scheduler) and heartbeat probe | yes | — | yes |
| `deploy/scripts/tick.sh` + `deploy/systemd/edmn-tick.*` | Watchdog tick (optional) | yes | yes | yes (header file) |
| `deploy/scripts/backup.sh`, `verify-backup.sh`, `restore-drill.sh` + `edmn-backup.*` | Encrypted backup, verification, restore drill | yes (rehearsed) | yes | yes |
| `deploy/scripts/watch.sh` + `edmn-watch.*` | Evidence-based local monitoring | yes | yes | no |
| `scripts/prod-acceptance.ts` | Read-only acceptance suite | yes | — | DB URL |
| `deploy/proxy/nginx/edmn.conf`, `nginx-tls.conf` | nginx profile B (guard blocks, apex 301) | yes (nginx 1.27 live) | yes | no |
| `deploy/proxy/apache/edmn.conf` | Apache/cPanel profile A | yes (httpd 2.4 live) | yes | no |
| `ops/scanner/clamd-http.mjs` + compose profile `scanner` | Private ClamAV wrapper | yes (EICAR live) | yes | yes (token) |
| `scripts/start.sh` | **Staging / single-container only**; refuses production | yes | — | — |
| `docs/runbooks/*.md` | This document and its sub-runbooks | links tested | — | — |

**Conflicts resolved:**
- `PRODUCTION_DEPLOYMENT.md` and `docs/DEPLOYMENT.md` (Vercel / generic) are superseded by this document.
- `PRODUCTION_INFRASTRUCTURE.md` remains valid only for the **provider wiring** (SMTP domain verification, webhook, Sentry, VAPID). Its Vercel / Neon / cron options are superseded by the self-hosted worker and §7.
- `DATABASE_BACKUP.md` / `DATABASE_RESTORE.md` (provider-snapshot oriented) are superseded for self-hosted by `SELF_HOSTED_DEPLOYMENT.md` §6.

## 4. What an empty production database gets (zero-data bootstrap)

Verified from an empty database (rehearsal, §10). After `deploy.sh first`:

| Item | Result |
|---|---|
| Migrations | All 19, advisory-locked. The database is marked `PRODUCTION` (permanent). |
| Reference seed (idempotent) | Categories (66) and attributes (13) |
| | Governorates and system settings at their defaults |
| | Legal v1.0 **APPROVED** (owner instruction of 2026-10-05) |
| | Legal v1.1 / v1.2 as **DRAFT** (legal review required) |
| | Owner-approved pricing **drafts** (not published), payout channels, refund-policy draft |
| No demo data | No demo users, sellers, products or orders. `seed --demo` is refused in production. `.local` accounts and TEST payment destinations are refused by database triggers. |
| Settings | `payments.realMoneyEnabled` unset (= **false**). Withdrawal dual-control threshold 0. Maintenance off. |
| Fee Engine | **No PUBLISHED pricing version** (acceptance expects `none`). Publishing pricing is an owner Maker/Checker action in the admin pricing center. Until then no fee can be charged; production transactions are closed anyway while real money is off. |
| Staff | **None.** The first SUPER_ADMIN is created by §6. |
| Commerce | **New orders, Protected Deal invitations and deal payments are CLOSED in production while real money is OFF**, by design (`src/server/ops/commerce-gate.ts`). Browsing, registration, login, identity, seller onboarding, catalog, support and messaging work. |

No production step depends on demo or staging data. No bootstrap gap was found that needs a code change.

## 5. Health / acceptance evidence expected right after step 8

| Check | Expected |
|---|---|
| `/api/health` | 200 |
| `/api/ready` | 200 (`database`, `migrations`, `environment`, `configuration`, `storage` all ok) |
| `prod-acceptance --db-only --expect-pricing=none` | PASS 18/18 |
| `prod-acceptance --http-only --local` | PASS 7/7 |
| Providers | `CONFIGURED_UNVERIFIED` or `NOT_CONFIGURED`, never upgraded without evidence |

## 6. First SUPER_ADMIN (one-time, interactive)

On the server, after step 8, from an **interactive** root SSH session (a TTY is required; the script refuses files, arguments and CI):

```bash
cd /opt/edmn && docker compose -f deploy/compose/docker-compose.prod.yml --env-file /etc/edmn/compose.env \
  run --rm --no-deps web node --import tsx scripts/create-admin.ts
```

**What it does (no default password, no committed credential, no demo admin):**
- It refuses if any SUPER_ADMIN exists. It is single-use; further staff are created from the console, audited and role-separated.
- It refuses `.local` e-mails.
- The password is typed by the owner. It is never echoed or logged. The staff policy is enforced (≥ 12 characters, letters + digits + symbol).
- It writes the user and the role, and the audit event `admin.bootstrap_created`.
- It prints the TOTP enrolment URI **once**. The owner adds it to an authenticator app immediately; it is not stored anywhere else.

**First login, at `https://admin.edmneg.com/login` (or via `--local` before DNS):**
1. Enter the password; you are sent to `/admin/2fa`.
2. Enter the authenticator code. This sets `totp_enabled_at` and elevates the session. Codes are single-use (replay refused).
3. Sensitive actions then ask for a **fresh 2FA step-up**.

The owner should immediately:
- create the second staff account (checker), so that Maker/Checker has two people;
- record the event in the go-live log.

Never create the admin through seeds, environment variables, CI or chat. Production also refuses every password and TOTP seed that is public in this repository (demo fixtures).

## 7. Scheduling and providers in production
- **Worker container:** primary scheduler.
- **`edmn-tick.timer`:** watchdog.
- **No Vercel Cron.** `vercel.json`'s daily cron only affects staging.
- Provider requirements per stage: [PRODUCTION_PROVIDER_MATRIX.md](PRODUCTION_PROVIDER_MATRIX.md).

## 8. Stage decisions
[GO_LIVE_ACCEPTANCE_MATRIX.md](GO_LIVE_ACCEPTANCE_MATRIX.md) is the authoritative launch decision document.

Deploying the website **is not** activating real money.

## 9. Remaining items (only outside-the-repository work)
See the final classification at the end of [GO_LIVE_ACCEPTANCE_MATRIX.md](GO_LIVE_ACCEPTANCE_MATRIX.md) §6:

| Category | Covers |
|---|---|
| A | Server |
| B | DNS |
| C | Owner credentials |
| D | Providers |
| E | Legal / accounting |

## 10. Local rehearsal evidence
The full bootstrap was rehearsed with throwaway local resources only. Scenarios:
- discovery → evaluator → config check
- first deploy on an empty database
- first SUPER_ADMIN plus TOTP login
- restart and crash
- backup, verify and restore drill
- app rollback
- acceptance
- scanner failure
- database failure
- worker failure

Results are in the batch report for the release commit.
