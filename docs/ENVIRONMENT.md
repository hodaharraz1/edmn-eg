# Environment Configuration

Template: [`.env.example`](../.env.example) (placeholders only). Development uses `.env.local`
(git-ignored). The app validates everything at startup in `src/server/core/env.ts`; CLI scripts load
`.env.local`/`.env` via `scripts/_env.ts`. Check a configuration with `npm run env:check`.

Business configuration (commissions, payment destinations, enabled methods, settlement mode/dates,
withdrawal minimum, moderation, templates, legal texts, CMS) is **not** environment configuration — it
lives in the database and is managed in the Admin with audit (see ARCHITECTURE.md → Configuration).

| Variable | Default | Required in production | Description |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | Runtime mode; production enables safety checks and secure cookies |
| `APP_URL` | `http://localhost:3000` | ✅ **https** | Public storefront URL (absolute links in emails, invitations, sitemap) |
| `SELLER_APP_URL` | `…/seller` | ✅ | Seller Center URL (e.g. `https://seller.edmneg.com`) |
| `ADMIN_APP_URL` | `…/admin` | ✅ | Admin URL (e.g. `https://admin.edmneg.com`) |
| `ENFORCE_HOSTS` | `false` | recommended `true` | Route by Host header and block seller/admin paths on other hosts |
| `SELLER_HOST` | `seller.edmneg.com` | with `ENFORCE_HOSTS` | Seller Center host name |
| `ADMIN_HOST` | `admin.edmneg.com` | with `ENFORCE_HOSTS` | Admin host name |
| `DATABASE_URL` | — | ✅ | PostgreSQL connection string |
| `DATABASE_URL_UNPOOLED` | — | | Direct (non-pooler) URL used for migrations/seeds by `scripts/vercel-build.sh` |
| `DATABASE_POOL_MAX` | `10` | | Pool size per process (use 2–3 on serverless) |
| `TEST_DATABASE_URL` | — | tests only | Database **wiped** by the Vitest suite |
| `E2E_DATABASE_URL` | `…/edmn_e2e` | E2E only | Database **reset and re-seeded** by Playwright |
| `SESSION_SECRET` | — | ✅ (≥ 32 chars, not the placeholder) | HMAC key for signed values |
| `DATA_ENCRYPTION_KEY` | — | ✅ (32 random bytes, base64) | AES-256-GCM key for national IDs, payout details, TOTP secrets — **back it up; losing it makes that data unrecoverable** |
| `SESSION_TTL_HOURS` | `720` | | Customer/seller session lifetime |
| `ADMIN_SESSION_TTL_HOURS` | `12` | | Admin session lifetime |
| `COOKIE_SECURE` | `false` | forced `true` in production | `Secure` flag on cookies |
| `STORAGE_DRIVER` | `local` | | Storage backend: `local` (disk) or `database` (files in PostgreSQL, for hosts without persistent disk) |
| `STORAGE_LOCAL_ROOT` | `./storage` | ✅ persistent volume | Root for `public/` and `private/` files |
| `UPLOAD_MAX_IMAGE_MB` | `8` | | Hard cap for image uploads (the admin setting can only lower it; use 4 on Vercel) |
| `UPLOAD_MAX_DOCUMENT_MB` | `10` | | Hard cap for PDFs/documents (use 4 on Vercel) |
| `MAIL_DRIVER` | `log` | `smtp` | `log` stores/prints messages (dev); `smtp` sends via SMTP |
| `MAIL_FROM` | `EDMN <no-reply@example.com>` | ✅ real sender | From header |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` | — | with `smtp` | SMTP credentials (**external input**) |
| `SMS_DRIVER` | `log` | `http` | `log` (dev) or a generic HTTP provider |
| `SMS_HTTP_URL`/`SMS_HTTP_TOKEN` | — | with `http` | SMS provider endpoint and token (**external input**) |
| `SMS_SENDER_ID` | `EDMN` | | Sender name |
| `LOG_LEVEL` | `info` | | `debug`/`info`/`warn`/`error` |
| `WORKER_POLL_MS` | `5000` | | Worker loop interval |
| `INLINE_WORKER` | `false` | serverless only | `true` runs one throttled worker pass after page renders (hosts without a long-running worker) |
| `CRON_SECRET` | — | serverless only | Bearer token for `/api/cron/tick`; the route returns 404 when unset |
| `NEXT_PUBLIC_LOGO_URL` | empty | when the official logo exists | Official logo URL/path; empty shows the neutral placeholder |

Staging-only variables (a public staging deployment must never reuse the repository's demo credentials):

| Variable | Description |
|---|---|
| `EDMN_ENVIRONMENT` | `staging` marks a public test deployment: visible staging banner, `noindex` + `robots.txt: Disallow /`, demo seed allowed with `NODE_ENV=production` |
| `SEED_DEMO` | `true` → `scripts/start.sh` runs the (idempotent) demo seed on boot; staging only |
| `STAGING_DEMO_PASSWORD` | password for all staging demo customers/sellers (≥ 10 chars, generated) |
| `STAGING_ADMIN_PASSWORD` | password for all staging staff accounts (≥ 14 chars, generated) |
| `STAGING_TOTP_SECRET` | base32 TOTP secret for staging staff 2FA (≥ 32 chars, generated); add it to an authenticator app |

Playwright extras: `E2E_PORT` (default 3100), `E2E_SKIP_BUILD=1`, `PLAYWRIGHT_CHROMIUM_PATH`, `E2E_BASE_URL` (run against a deployed URL — no local server, **no database reset**).

## Production safety checks

With `NODE_ENV=production` the app refuses to start if: `SESSION_SECRET` or `DATA_ENCRYPTION_KEY`
is a placeholder, `APP_URL` is not HTTPS, `MAIL_DRIVER=smtp` without `SMTP_HOST`, or
`SMS_DRIVER=http` without `SMS_HTTP_URL`.

## Mapping to the specification's categories

| Category | Variables |
|---|---|
| App URLs | `APP_URL`, `SELLER_APP_URL`, `ADMIN_APP_URL`, `*_HOST`, `ENFORCE_HOSTS` |
| Database | `DATABASE_URL`, `DATABASE_POOL_MAX` |
| Cache | none required (PostgreSQL + Next.js caches); add Redis only if scaling requires it |
| Queue | PostgreSQL `jobs` table; `WORKER_POLL_MS` |
| Storage | `STORAGE_DRIVER`, `STORAGE_LOCAL_ROOT`, `UPLOAD_MAX_*` |
| Mail | `MAIL_*`, `SMTP_*` |
| SMS | `SMS_*` |
| Session | `SESSION_SECRET`, `SESSION_TTL_HOURS`, `ADMIN_SESSION_TTL_HOURS`, `COOKIE_SECURE` |
| Logging | `LOG_LEVEL` |
