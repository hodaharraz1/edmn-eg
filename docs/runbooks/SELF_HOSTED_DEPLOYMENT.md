# Self-hosted production deployment (existing EDMN server)

This is the operational procedure for the package in `deploy/`. Deploying with it is an infrastructure operation; it needs no new application code.

**What is fixed:**
- The app runs as `web` and `worker` containers of ONE immutable image, tagged with the release commit SHA.
- Real money stays OFF. It is a database setting changed only through Maker/Checker; no file here can turn it on.
- `api.edmneg.com`, MX, SPF/DKIM/DMARC, the mailbox `info@edmneg.com`, WHM/cPanel and every legacy service stay untouched.

**What is still unknown** (blocked on Kntabo):
- OS, RAM/CPU/disk
- root/SSH access
- whether cPanel/WHM is present
- what owns ports 80/443
- whether Docker is allowed
- where `api.edmneg.com` and mail are hosted
- outbound SMTP

The first step on the server (`preflight-legacy.sh`) discovers and reports most of these. It never changes anything.

Rehearsed end-to-end in a local Docker environment (see the batch report). Covered:
- first deploy and normal deploy
- automatic app-image rollback
- backup, verify, restore drill
- restart and crash safety
- nginx/Apache coexistence with a legacy `api` vhost

---

## 0. Files on the server (never in git)

| Path | Mode | Content |
|---|---|---|
| `/opt/edmn` | 0750 `edmn` | Release checkout at the release SHA (`deploy/`, `drizzle/`). |
| `/etc/edmn/production.env` | 0640 `root:edmn` | App environment, from `.env.production.example`. Uses the runtime DB role `edmn_app`. |
| `/etc/edmn/migrate.env` | 0640 | `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for the schema owner `edmn_owner`. Used only by migrate/seed. |
| `/etc/edmn/postgres.env` | 0600 | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB=postgres`, `EDMN_OWNER_PASSWORD`, `EDMN_APP_PASSWORD`, `EDMN_BACKUP_PASSWORD` (≥ 24 chars each). Only with profile `postgres-local`. |
| `/etc/edmn/scanner.env` | 0600 | `SCANNER_TOKEN`, the same value as `MALWARE_SCANNER_TOKEN`. |
| `/etc/edmn/backup.env` | 0600 | See §6. Values containing spaces **must be quoted** (the file is sourced by bash). |
| `/etc/edmn/compose.env` | 0644 | Non-secret: `EDMN_IMAGE=edmn-app`, `EDMN_WEB_PORT=3000`, `EDMN_EXPECT_PRICING=none`, `COMPOSE_PROFILES=postgres-local,scanner`. |
| `/etc/edmn/cron-header` | 0600 root | One line: `Authorization: Bearer <CRON_SECRET>`. Used by the watchdog timer only. |
| `/etc/edmn/monitor.env` | 0600 | Optional `WATCH_HEARTBEAT_URL`, `WATCH_ALERT_URL`. |

Generate every secret **on the server**:
- `openssl rand -base64 48` for secrets
- `openssl rand -base64 32` for `DATA_ENCRYPTION_KEY`

Never paste secrets into chat, tickets or git.
- Production refuses staging `SESSION_SECRET`, `CRON_SECRET` and `DATA_ENCRYPTION_KEY` by one-way fingerprint.
- It refuses the staging database, localhost databases and http URLs.
- `.gitignore` ignores `*.env`.

## 1. Server baseline (once, with Kntabo)

1. Get Kntabo's written OK for:
   - Docker
   - a dedicated `edmn` user
   - firewall changes
   - ports 80/443 integration
2. Open a **second** root SSH session (lock-out safety).
3. Run the dry run and read every line:
   - Ubuntu/Debian: `sudo deploy/hardening/ubuntu-debian.sh`
   - AlmaLinux/Rocky: `sudo deploy/hardening/almalinux-rocky.sh`
4. Run it again with `--apply`.

On cPanel/WHM or CSF servers the firewall and SSH steps are skipped by design.

What the script does:
- **Updates:** security updates, plus unattended security upgrades with no automatic reboot.
- **Service user:** creates `edmn`, with no shell and no sudo.
- **SSH:** key-only, via a drop-in that is validated with `sshd -t` before reload. It refuses to run if the admin has no key.
- **Firewall:** SSH, 80 and 443, plus **every port that already listens** (mail, cPanel, legacy). It never closes a legacy service.
- **fail2ban:** an `sshd` jail.
- **Docker:** Docker CE and the Compose plugin. Default log rotation is set only if `daemon.json` is absent.
- **Directories and permissions:** creates the EDMN directories with the modes above.
- **systemd units:** installs them but does not enable them yet.

## 2. Legacy safety preflight (read-only, STOP on doubt)

```bash
sudo EDMN_WEB_PORT=3000 /opt/edmn/deploy/scripts/preflight-legacy.sh
```

**What it discovers:**
- OS, glibc and resources
- listeners and who owns them
- Docker containers, networks and volumes
- nginx/Apache/LiteSpeed virtual hosts
- every config file mentioning `api.edmneg.com` (it saves a sha256 baseline)
- mail services, PostgreSQL/MySQL, cPanel, firewall and mounts

**It STOPS when it cannot prove there is no conflict.** Examples:
- `ss` is missing
- an unknown process owns 80/443
- the app port is taken
- `/` has less than 20 GB free
- an `edmn_pgdata` volume exists before the first deploy
- **nginx serves 80/443 without an explicit `default_server`**: adding any server block could change which site answers unknown hosts, possibly `api.edmneg.com`

**It never** stops, reloads, edits or deletes Apache, nginx, MySQL/MariaDB, PostgreSQL, Exim, Dovecot, cPanel services, or legacy containers and apps.

`watch.sh` re-checks the `api.edmneg.com` config hashes every 5 minutes and alerts on any change.

## 3. Database

**Option A — self-hosted PostgreSQL 16** (compose profile `postgres-local`):
- Private: the `backend` network is `internal`, and **no port is published** (no public 5432).
- Persistent volume `edmn_pgdata`; healthcheck `pg_isready`.
- UTF8, locale `C.UTF-8`, data checksums, timezone UTC.

On first start of an empty volume, `deploy/compose/postgres/init/01-roles.sh` creates:

| Role | Use | Rights |
|---|---|---|
| `edmn_owner` | migrate / seed only | Owns the database and every object. |
| `edmn_app` | web / worker | `SELECT/INSERT/UPDATE/DELETE` through default privileges. No DDL, no TRUNCATE, no ownership. |
| `edmn_backup` | `pg_dump` | `pg_read_all_data`. Cannot write. |

The rehearsal verified this:
- `edmn_app` gets "permission denied for schema public" on CREATE TABLE, and "permission denied" on TRUNCATE.
- `edmn_backup` cannot UPDATE.
- The app works fully as `edmn_app`.

The production database is **not** created by this package. It is created on the server, during the first deploy, after approval.

**Option B — external PostgreSQL** (for example a Neon production project, separate from staging):
- Do not enable `postgres-local`.
- Set `DATABASE_URL` (runtime role, `sslmode=require`) in `production.env`, and the owner URL in `migrate.env`.
- Set `BACKUP_DOCKER_NETWORK=edmn_edge` (backups need egress).
- Nothing else changes.

## 4. First deploy (once)

**Prerequisites:**
- §1 and §2 done.
- The image exists on the server. Either:
  - `docker build --build-arg EDMN_RELEASE=<sha> -t edmn-app:<sha> .` on the server, or
  - `docker load` of `edmn-<sha>.tar`, with its `.sha256` next to it.
- The env files are filled.

```bash
sudo -E /opt/edmn/deploy/scripts/deploy.sh first --tag <40-hex sha> [--image-archive /path/edmn-<sha>.tar]
```

The first deploy additionally verifies:
- **Empty, separate database:** zero tables in `public`, and no existing volume. A first deploy never adopts a database.
- **Environment marker:** the first migration marks the database `PRODUCTION`. A staging/test marker or app is refused.
- **No staging secret reuse:** checked by the app's own policy (`scripts/check-env.ts` inside the release image).
- **No demo/E2E credentials:**
  - no `STAGING_*`, `SEED_DEMO` or `E2E_*` variables
  - no `*.local`, `*.test` or `@example.*` accounts (acceptance)
- **Admin host enforcement:**
  - `ENFORCE_ADMIN_HOST=true` and `ADMIN_HOST=admin.edmneg.com` are set
  - `/admin` on www gets a 307 to `https://admin.edmneg.com`
  - the admin host serves the console login
- **Real Money OFF:** `payments.realMoneyEnabled` is unset or false.
- **Storage:** `STORAGE_DRIVER=database`, and every file has its object.
- **Worker:** heartbeat ≤ 180 s, and the critical schedules are current.
- **Provider readiness:** reported from evidence only. `CONFIGURED_UNVERIFIED` is never upgraded.

Afterwards:
1. Run `systemctl enable --now edmn-watch.timer edmn-backup.timer edmn-tick.timer`.
2. Run the first backup: `backup.sh --reason first`.
3. Run a **restore drill** with the offline key (§6).

## 5. Normal deploy (every release)

```bash
sudo -E /opt/edmn/deploy/scripts/deploy.sh normal --tag <sha>
```

Steps:
1. PRECHECK
2. BACKUP
3. VERIFY BACKUP
4. LOAD/SELECT IMAGE
5. MIGRATION PREFLIGHT
6. EXPLICIT MIGRATION
7. REFERENCE SEED
8. START WEB/WORKER
9. `/api/health`
10. `/api/ready`
11. SMOKE
12. FINANCIAL INVARIANTS and read-only acceptance
13. SUCCESS

Any failure prints `✗ STOP` and exits non-zero.
- **Failure in steps 1–7:** the running release is untouched.
- **Failure in steps 8–12:** web and worker automatically return to the **previous image** and `/api/ready` is re-checked.

**The database is never rolled back automatically.**
- Migrations are expand-only, because the preflight refuses `DROP`, `TRUNCATE`, `DELETE FROM`, type changes and renames.
- So the previous image runs on the newer schema.

**Restarts never migrate:**
- `web` runs `next start` and `worker` runs `scripts/worker.ts` directly.
- `scripts/start.sh` exits 64 when `EDMN_ENVIRONMENT=production`.

Manual app rollback: `deploy/scripts/rollback.sh app [<sha>]`.

Database rollback: `rollback.sh database` prints the manual, owner-approved procedure and changes nothing. That procedure is a restore into a **new** database; it never restores over the live one.

## 6. Backups and the restore drill

`/etc/edmn/backup.env`:

```bash
BACKUP_DATABASE_URL=postgres://edmn_backup:<PW>@postgres:5432/edmn?sslmode=disable
BACKUP_ENCRYPTION=age                      # or gpg
BACKUP_AGE_RECIPIENT=age1…                 # PUBLIC key only — the private key stays offline with the owner
BACKUP_RETENTION_DAYS=14
BACKUP_KEEP_MIN=3
BACKUP_UPLOAD_CMD='rclone copy {} edmn-offsite:edmn-backups/'   # owner-chosen tool/provider; {} = file
BACKUP_HEARTBEAT_URL=https://hc-ping.com/<uuid>                # optional dead-man's switch
```

**`backup.sh`**, run daily at 03:15 Cairo by timer and before every deploy:
1. Runs `pg_dump -Fc` as `edmn_backup`.
2. Checks the dump with `pg_restore --list`.
3. Writes a manifest of counts, ledger totals, and pricing/settings snapshot hashes.
4. Encrypts with the public key, then shreds the plaintext.
5. Runs the off-server upload.
6. Applies retention.
7. Writes the status file and pings the heartbeat.

**Without a successful upload, the status is `LOCAL COPY — NOT DISASTER-RECOVERY BACKUP`.** `watch.sh` reports it as a warning; it is never reported as healthy.

With `STORAGE_DRIVER=database`, private files are inside the dump.

**`verify-backup.sh`** proves integrity:
- checksum, size and age-format header
- the manifest shows a `PRODUCTION` database with table data

It does **not** claim restorability. Only the drill does.

**`restore-drill.sh <file> --identity <offline key> --tag <sha>`** (run monthly, on the server with a temporary key copy or on any Docker machine):
1. Decrypts the backup.
2. Restores into a throwaway PostgreSQL on an internal network, using tmpfs.
3. Compares against the manifest: schema, migrations, marker, row counts, ledger totals, and pricing/settings snapshot hashes.
4. Runs the read-only acceptance in drill mode: ledger balanced; drift, duplicates, stranded, allocation and source mismatches all zero; no demo accounts; Real Money OFF.
5. Destroys everything it created.

The rehearsal also proved that a tampered snapshot makes the drill fail.

## 7. Worker, scheduler and watchdog

- The **primary scheduler** is the `worker` container.
  - It runs due schedules every 5 s under database leases.
  - It has `restart: unless-stopped`; a crash was rehearsed and it restarted.
- The **watchdog** `edmn-tick.timer` runs every minute and calls `/api/cron/tick` on loopback with the secret header file.
  - It is optional and harmless: it is due-based and leased.
  - The rehearsal ran 16 concurrent ticks alongside the worker with **0 duplicate runs**.
  - After a 4-minute worker outage, overdue jobs ran immediately on restart.
- There is **no Vercel Cron.**
- Jobs never move money. Release, refund and payout stay human-approved under Maker/Checker.

## 8. Reverse proxy and TLS

The application listens on `127.0.0.1:3000` only. Set `TRUSTED_PROXY=true`; it is correct only because nothing else can reach the port.

**nginx (non-cPanel):**
1. Install `deploy/proxy/nginx/edmn.conf` as the **last-loaded** file:
   - Debian: `/etc/nginx/sites-enabled/zz-edmn.conf`
   - RHEL: `conf.d/zz-edmn.conf`
2. Install `nginx-tls.conf` as `/etc/edmn/nginx-tls.conf`.
3. Save `nginx -T > before.txt`, install, run `nginx -t`, then `systemctl reload nginx`.
4. Save `nginx -T > after.txt`. The diff must show only the EDMN file.

Its leading guard blocks refuse unknown hosts, so the file can never capture `api.edmneg.com`, even as an implicit default. This was rehearsed. If the host has no IPv6, remove the `[::]` listen lines.

**Apache / cPanel:** use `deploy/proxy/apache/edmn.conf`.
- With cPanel, put only section B in the userdata include (paths are in the file). Then run `rebuildhttpdconf` and a graceful restart.
- Compare `apachectl -S` "default server" lines before and after; they must be identical.
- A legacy `api.edmneg.com` vhost keeps answering (rehearsed).

**Both templates:**
- forward `Host`, `X-Real-IP`, `X-Forwarded-For` and `X-Forwarded-Proto`
- allow a 12 MB body (app max 10 MB) with 120 s timeouts
- return 404/403 for `/api/cron/tick` from outside
- add no security headers (the app sets them)
- answer the **apex** themselves with a 301 to www

The app's HSTS has `includeSubDomains`. Served from the apex it would force https on `api.` and the mail hosts, so the apex is never proxied.

No WebSocket is needed; live messaging uses polling.

**TLS with Let's Encrypt.** Do not issue certificates before the DNS cutover is approved.

| Setup | Steps |
|---|---|
| nginx | `certbot certonly --webroot -w /var/www/letsencrypt -d www.edmneg.com -d edmneg.com -d admin.edmneg.com` |
| cPanel | AutoSSL issues them once the domains are on the account and resolve to the server |

Prerequisites:
- The names resolve to this server, so it can only be done **after** the DNS step for each name.
- Port 80 is reachable.
- A CAA record, if any, allows `letsencrypt.org`.

Before the cutover, install only the port-80 blocks. nginx will not load a 443 block whose certificate files are missing.

Renewal:
- `certbot.timer` runs it.
- Test it with `certbot renew --dry-run`.
- Add a deploy hook that reloads nginx.

Rollback: remove the EDMN file, then test and reload. Certificates can stay; they are harmless.

## 9. Malware scanner (ClamAV)

Compose profile `scanner`:
- `clamd` (freshclam updates signatures through its own egress network).
- `scanner`, the wrapper `ops/scanner/clamd-http.mjs`, built into the release image.

Both are on the internal `backend` network with **no published port**.

App settings:
- `MALWARE_SCANNER_URL=http://scanner:8080/scan`
- `MALWARE_SCANNER_PRIVATE_NETWORK=true`
- `MALWARE_SCANNER_TOKEN`, the same value as `SCANNER_TOKEN`

**The HTTP rule:** production accepts plain http **only** with the explicit flag **and** a host that can only be private:
- a single-label compose service name
- `localhost`
- 127/8, 10/8, 172.16/12 or 192.168/16

A dotted hostname or a public IP over http is refused, as is a URL with credentials. HTTPS is always accepted.

**Fail closed:** unavailable, timeout, non-200, malformed, `INFECTED` and `REJECTED` all keep the file unopenable. `SCAN_FAILED` is retried after 15 minutes.

Allow about 3 GB RAM for clamd.

## 10. Monitoring (zero-cost first)

`watch.sh` runs every 5 minutes from `edmn-watch.timer`. It checks:
- container health
- disk, RAM and CPU
- `/api/ready`
- worker heartbeat, failing schedules, latest ledger health and dead letters
- backup age and off-server status
- restore-drill age
- the legacy `api` config hashes

**Overall result:**

| Result | Meaning |
|---|---|
| `HEALTHY` | Only with evidence for every check. |
| `DEGRADED` | Warnings. |
| `UNKNOWN` | Missing evidence. |
| `CRITICAL` | Failures. |

A stopped worker was rehearsed and reported `CRITICAL`.

**External hooks** (free tiers are enough):
- `WATCH_HEARTBEAT_URL`, pinged only when `HEALTHY`.
- `WATCH_ALERT_URL`, a JSON POST on `CRITICAL` or `UNKNOWN`.
- An uptime monitor on `https://www.edmneg.com/api/ready`.
- Sentry via `ERROR_TRACKING_DSN`.

## 11. Production acceptance (read-only)

```bash
docker compose -f deploy/compose/docker-compose.prod.yml --env-file /etc/edmn/compose.env --profile ops \
  run --rm acceptance node --import tsx scripts/prod-acceptance.ts --db-only --expect-pricing=none
docker run --rm --network host -e APP_URL=https://www.edmneg.com -e ADMIN_HOST=admin.edmneg.com edmn-app:<sha> \
  node --import tsx scripts/prod-acceptance.ts --http-only            # after DNS; --local before DNS
```

The suite runs in one `READ ONLY` transaction and creates nothing. Exit 1 on any FAIL.

A missing expectation, such as the Fee Engine version, is a FAIL, never a skip.

`--expect-pricing` must match the published versions the owner approved:
- `none` until pricing is activated through Maker/Checker
- then `MARKETPLACE:<n>,PROTECTED_DEAL:<n>`
