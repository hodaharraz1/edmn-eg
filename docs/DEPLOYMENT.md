# Deployment

The codebase is deployment-ready; it has **not** been deployed to any external account (no hosting
credentials were provided). This guide describes a conventional single-region setup: one or more
Node.js app instances behind a TLS reverse proxy, one worker process, PostgreSQL, and persistent
file storage.

## Requirements

| Component | Minimum |
|---|---|
| Node.js | 22 LTS |
| PostgreSQL | 16 (with `pg_trgm`), daily backups + WAL archiving recommended |
| Storage | persistent volume for `STORAGE_LOCAL_ROOT` (shared by all app instances and the worker), or implement the S3 driver |
| TLS | HTTPS mandatory (`APP_URL` must be `https://…`; HSTS is sent) |
| SMTP / SMS | provider credentials for real email/SMS (`MAIL_DRIVER=smtp`, `SMS_DRIVER=http`) |

## Build and release

```bash
npm ci
npm run typecheck && npm run lint && npm test     # in CI
npm run build                                     # .next production build
npm run db:migrate                                # run once per release, before starting new instances
npm run db:seed                                   # first release only: reference data (idempotent, no demo data)
npm run admin:create                              # first release only: bootstrap the super admin (interactive)
npm start                                         # or: npx next start -p $PORT
```

Migrations are additive and reviewed; run them before switching traffic. `db:reset` and
`db:seed:demo` refuse to run in production.

## Environment

Copy `.env.example` and fill every value (see [ENVIRONMENT.md](ENVIRONMENT.md)). The app validates
the environment at startup and **refuses to boot** in production with placeholder secrets, a
non-HTTPS `APP_URL`, or an incomplete mail/SMS driver. Check before starting:

```bash
NODE_ENV=production npm run env:check
```

Store secrets in the platform's secret manager, never in the repository.

## Processes

| Process | Command | Instances |
|---|---|---|
| Web | `npm start` (`next start`) | 1..N (stateless; sessions are in PostgreSQL) |
| Worker | `npm run worker` | 1 (safe to run 2 for redundancy — jobs use `SKIP LOCKED`, schedules are idempotent) |

### systemd example

```ini
# /etc/systemd/system/edmn-web.service
[Service]
WorkingDirectory=/srv/edmn
EnvironmentFile=/etc/edmn/env
ExecStart=/usr/bin/npm start
Restart=always
User=edmn

# /etc/systemd/system/edmn-worker.service
[Service]
WorkingDirectory=/srv/edmn
EnvironmentFile=/etc/edmn/env
ExecStart=/usr/bin/npm run worker
Restart=always
User=edmn
```

### Scheduler / cron

The worker contains its own schedule (order expiry every 5 min, follow-ups and completion hourly,
scheduled settlements hourly, outbound delivery every minute). If you prefer an external scheduler
instead of a long-running worker, run `npm run worker:once` from cron every minute:

```cron
* * * * * cd /srv/edmn && /usr/bin/npm run -s worker:once >> /var/log/edmn/worker.log 2>&1
```

Recommended additional cron:

```cron
15 2 * * * cd /srv/edmn && /usr/bin/npm run -s ledger:check || /usr/local/bin/alert "EDMN ledger drift"
```

## Reverse proxy (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name edmneg.com www.edmneg.com seller.edmneg.com admin.edmneg.com;
  ssl_certificate     /etc/letsencrypt/live/edmneg.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/edmneg.com/privkey.pem;

  client_max_body_size 15m;            # uploads (server actions limit is 12 MB)
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
  # Optional: an extra rate limit for auth endpoints
  # limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/m;
}
server { listen 80; server_name _; return 301 https://$host$request_uri; }
```

Hosts: set `SELLER_HOST=seller.edmneg.com`, `ADMIN_HOST=admin.edmneg.com` and `ENFORCE_HOSTS=true`
to serve the Seller Center and Admin only on their own subdomains. Restricting `admin.` to an office
VPN / IP allow-list at the proxy is strongly recommended.

`X-Forwarded-For` is used for audit IPs and rate limiting — only trust it from your proxy.

## Storage

`STORAGE_LOCAL_ROOT` contains `public/` (product images, logos; served via `/media/...`) and
`private/` (identity documents, payment proofs, waybills, evidence). It must be:

- on a persistent, backed-up volume shared by all app instances and the worker;
- **not** exposed directly by the web server (private files are only served through
  `/api/files/[id]` after authorization).

For object storage (S3/R2/MinIO), implement the `StorageDriver` interface in
`src/server/storage/storage.ts` (put/get/exists/delete by visibility + key) and register it with
`setStorageDriver`; keep private objects in a non-public bucket.

## Health checks

- `GET /api/health` — liveness (process up).
- `GET /api/ready` — readiness: database reachable and migrated, storage readable, job backlog;
  returns 503 when not ready. Point the load balancer at it.

## Logging and monitoring

Structured JSON logs on stdout/stderr (`LOG_LEVEL`), with sensitive keys redacted. Ship them to your
log platform. Alert on: `level=error`, `schedule.failed`, `outbound.send_failed` spikes,
`ledger:check` failures, `/api/ready` failures, withdrawals past SLA (Admin dashboard).

## Backups and restore

- **Database:** nightly `pg_dump -Fc` (keep 30 days) **and** continuous WAL archiving / managed PITR.
  ```bash
  pg_dump -Fc -d "$DATABASE_URL" -f edmn-$(date +%F).dump
  pg_restore --clean --if-exists -d "$DATABASE_URL" edmn-YYYY-MM-DD.dump
  ```
- **Files:** nightly sync of `STORAGE_LOCAL_ROOT` (both `public/` and `private/`) to encrypted
  off-site storage; private files contain identity documents — encrypt backups and restrict access.
- **Keys:** back up `DATA_ENCRYPTION_KEY` separately and securely. **Without it, encrypted national
  IDs, payout details and TOTP secrets cannot be recovered.** Never rotate it without a re-encryption
  migration.
- After a restore: run `npm run db:migrate`, `npm run ledger:check`, and verify `/api/ready`.
- Test a restore into a staging database at least monthly.

## Release checklist

1. CI green (typecheck, lint, unit+integration, E2E).
2. Backup taken.
3. `npm run db:migrate`.
4. Deploy web instances, then restart the worker.
5. `/api/ready` OK, `npm run ledger:check` OK, smoke-test login/admin 2FA.
