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
| `DATABASE_POOL_MAX` | `10` | | Pool size per process |
| `TEST_DATABASE_URL` | — | tests only | Database **wiped** by the Vitest suite |
| `E2E_DATABASE_URL` | `…/edmn_e2e` | E2E only | Database **reset and re-seeded** by Playwright |
| `SESSION_SECRET` | — | ✅ (≥ 32 chars, not the placeholder) | HMAC key for signed values |
| `DATA_ENCRYPTION_KEY` | — | ✅ (32 random bytes, base64) | AES-256-GCM key for national IDs, payout details, TOTP secrets — **back it up; losing it makes that data unrecoverable** |
| `SESSION_TTL_HOURS` | `720` | | Customer/seller session lifetime |
| `ADMIN_SESSION_TTL_HOURS` | `12` | | Admin session lifetime |
| `COOKIE_SECURE` | `false` | forced `true` in production | `Secure` flag on cookies |
| `STORAGE_DRIVER` | `local` | | Storage backend (`local` implemented) |
| `STORAGE_LOCAL_ROOT` | `./storage` | ✅ persistent volume | Root for `public/` and `private/` files |
| `UPLOAD_MAX_IMAGE_MB` | `8` | | Hard cap for image uploads (runtime setting can be lower) |
| `UPLOAD_MAX_DOCUMENT_MB` | `10` | | Hard cap for PDFs/documents |
| `MAIL_DRIVER` | `log` | `smtp` | `log` stores/prints messages (dev); `smtp` sends via SMTP |
| `MAIL_FROM` | `EDMN <no-reply@example.com>` | ✅ real sender | From header |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` | — | with `smtp` | SMTP credentials (**external input**) |
| `SMS_DRIVER` | `log` | `http` | `log` (dev) or a generic HTTP provider |
| `SMS_HTTP_URL`/`SMS_HTTP_TOKEN` | — | with `http` | SMS provider endpoint and token (**external input**) |
| `SMS_SENDER_ID` | `EDMN` | | Sender name |
| `LOG_LEVEL` | `info` | | `debug`/`info`/`warn`/`error` |
| `WORKER_POLL_MS` | `5000` | | Worker loop interval |
| `NEXT_PUBLIC_LOGO_URL` | empty | when the official logo exists | Official logo URL/path; empty shows the neutral placeholder |

Playwright extras: `E2E_PORT` (default 3100), `E2E_SKIP_BUILD=1`, `PLAYWRIGHT_CHROMIUM_PATH`.

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
