# Staging Deployment Report

**Status: DEPLOYED AND VERIFIED ON THE PUBLIC HTTPS URL** (2026-10-05).

**URL: https://edmn-staging.vercel.app**

This is a test deployment. No DNS was changed, and nothing touched `api.edmneg.com`, the legacy
system or its database. All data, accounts and payment destinations are fake, and no money
moves. Cost: **0** (free plans, no payment card).

## 1. Hosting (100% free, no payment card)

| Part | Provider | Plan |
|---|---|---|
| Web app (Next.js, serverless functions) | **Vercel** project `edmn-staging`, region `iad1` | Hobby (free) |
| PostgreSQL | **Neon**, separate database `edmn_staging` (us-east-1, PostgreSQL 18) | Free |
| Uploaded files | inside the Neon database (`STORAGE_DRIVER=database`) | counts toward 0.5 GB (≈16 MB used) |
| HTTPS | `*.vercel.app` certificate | included |

Rejected options:

| Option | Reason |
|---|---|
| Render | Its API and dashboard both required a payment card, even for the free web service. |
| Hugging Face Docker Spaces | Require a PRO subscription. |
| Railway | Paid after the trial. |
| Fly.io | Requires a card. |

## 2. Architecture

```
GitHub hodaharraz1/edmn-eg @ claude/great-tesla-nor0wt  (Vercel production branch)
  └─ Vercel build: scripts/vercel-build.sh
       migrate (direct Neon URL) → reference seed → staging demo seed (idempotent) → next build
  └─ Runtime: serverless functions, pooled Neon URL, DATABASE_POOL_MAX=3
       background work: after-response tick (INLINE_WORKER, ≤ 1 pass/min/instance)
                        + Vercel Cron daily → /api/cron/tick (Bearer CRON_SECRET)
Neon edmn_staging  ← separate staging database (never the legacy DB)
```

## 3. Changes made for this host

All changes are additive; the Docker/VM path is unchanged.

| Change | Why |
|---|---|
| `vercel.json`, `scripts/vercel-build.sh` | Build command: migrations and seeds on the direct DB connection, then `next build` |
| `src/server/jobs/tick.ts` | One worker pass, shared by `scripts/worker.ts`, the cron route and the inline trigger |
| `src/app/api/cron/tick` | Scheduled work for hosts without a long-running worker. Returns 404 unless `Authorization: Bearer <CRON_SECRET>` is sent (constant-time compare). |
| Root layout `after()` hook (`INLINE_WORKER=true` only) | Hobby cron runs once a day only. With this hook, notifications, order expiry and similar work run shortly after page activity. |
| Upload hard cap = min(admin setting, `UPLOAD_MAX_*_MB`) | `UPLOAD_MAX_*_MB` is now enforced as a hard cap. On this deployment it is set to 4 MB, below Vercel's 4.5 MB request-body limit. |

Earlier staging changes:

- staging mode (banner, noindex, `robots.txt`)
- credentials from env
- database storage driver
- Playwright remote mode

## 4. Environment variables (names only — values stored only in Vercel, encrypted)

| Variables | Value |
|---|---|
| `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct) | secret |
| `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET` | secret |
| `STAGING_DEMO_PASSWORD`, `STAGING_ADMIN_PASSWORD`, `STAGING_TOTP_SECRET` | secret |
| `APP_URL`, `SELLER_APP_URL`, `ADMIN_APP_URL` | `https://edmn-staging.vercel.app` (+ `/seller`, `/admin`) |
| `EDMN_ENVIRONMENT` | `staging` |
| `SEED_DEMO` | `true` |
| `STORAGE_DRIVER` | `database` |
| `INLINE_WORKER` | `true` |
| `DATABASE_POOL_MAX` | `3` |
| `MAIL_DRIVER`, `SMS_DRIVER` | `log` (simulated) |
| `UPLOAD_MAX_IMAGE_MB`, `UPLOAD_MAX_DOCUMENT_MB` | `4` |
| `MAIL_FROM`, `LOG_LEVEL` | non-secret settings |

Secret handling:

- No secret is committed to Git or written in this report.
- The Vercel build log was scanned for every secret value: none found.
- Client bundles were scanned for every secret value: none found.

## 5. Accounts

Passwords are **not** the repository defaults. They were generated for this deployment and handed
to the owner privately. The repository's default admin password was tested on the public URL and is **rejected**.

| Role | Email |
|---|---|
| Customer | `ahmed@demo.edmn.local` (also `mona@`, `karim@`… `demo.edmn.local`) |
| Seller | `techzone@demo.edmn.local` (other demo sellers on `@demo.edmn.local`) |
| Admin (super admin, 2FA) | `admin@edmn.local` at `/admin/login` |

**Admin 2FA:** add the staging TOTP secret to Google Authenticator / Microsoft Authenticator.
Use "Enter a setup key", type "Time based", and paste the secret. The app then shows the 6-digit
code.

## 6. Build

| Check | Result |
|---|---|
| Vercel production build (commit `8065970`) | ✅ READY in about 2 min |
| Migrations | ✅ 4 applied |
| Seeds | ✅ reference + staging demo (credentials not printed) |
| `npm run lint`, `npm run typecheck` | ✅ |
| `npm test` (unit + integration) | ✅ 81 / 81 |

## 7. Tests against the public HTTPS URL

| Check | Result |
|---|---|
| `/api/health`, `/api/ready` | ✅ 200; database ok, 4 migrations, storage ok, 0 failed jobs |
| **Full Playwright E2E suite** (`E2E_BASE_URL=https://edmn-staging.vercel.app`, real browser) | ✅ **26 / 26 passed** (3.4 min) |

The E2E suite covers:

- seller registration → OTP → KYB review → product approval → purchase → payment proof →
  verification → shipping → delivery → settlement → withdrawal paid
- the external protected deal from wizard to payout
- security and authorization (admin needs a staff session, customer ≠ admin, private files not
  public, no cross-customer or cross-seller order access)
- Arabic RTL storefront and search
- legal drafts
- 360 px phone layouts

Mobile 375 / 390 / 430 px:

- ✅ no horizontal overflow on home, search, cart and account orders
- the staging banner is visible

## 8. Security probes (public URL)

| Probe | Result |
|---|---|
| HSTS, CSP, X-Frame-Options DENY, nosniff, Referrer-Policy | ✅ present |
| `X-Powered-By` | ✅ absent |
| `/.env`, `/.git/config` | ✅ 404 |
| Source maps | ✅ not shipped (no `sourceMappingURL`; `.map` → 403) |
| `/admin`, `/seller` without session | ✅ redirect to login |
| `/api/cron/tick` without or with a wrong token | ✅ 404 |
| `/api/cron/tick` with the right token | ✅ runs |
| Session cookie | ✅ `Secure`, `HttpOnly`, `SameSite=Lax` |
| Repository default admin password | ✅ rejected |
| Indexing | ✅ `noindex, nofollow`; `robots.txt` → `Disallow: /` |
| Staging banner | ✅ shown on every page |

## 9. Database / storage state after tests

16 MB used of 0.5 GB:

- 16 users
- 6 orders
- 174 stored objects (images and private documents)
- 153 simulated outbound messages, viewable in Admin → notifications outbox

Files are stored in PostgreSQL, so they survive redeploys.

## 10. Known limitations (staging only)

- **Uploads max 4 MB per request** (Vercel limit). Several large product photos in one submit can
  exceed it; upload them in smaller batches.
- **Background work** runs after page activity (≤ once a minute per instance) plus a daily cron.
  With no visitors, time-based work (order expiry, scheduled settlement) waits for the next visit
  or the daily run.
- **Email and SMS are simulated**: nothing is delivered. Messages and OTP codes appear in the
  Admin outbox.
- **Payment destinations are demo "NOT REAL" accounts**; no money moves.
- **Neon free compute sleeps when idle**, so the first request after idle is slower (about 1–2 s).
- Free quotas: Vercel Hobby and Neon 0.5 GB. **Vercel Hobby is for non-commercial use**; a real
  launch needs a paid plan or another host.
- Admin, seller and storefront share one domain (`ENFORCE_HOSTS=false`); production should use
  separate hosts.

## 11. Redeploy / rollback

- **Redeploy:** push to `claude/great-tesla-nor0wt`, and Vercel rebuilds automatically.
  Migrations and seeds are idempotent.
- **Rollback:** Vercel → project `edmn-staging` → Deployments → previous deployment → "Promote to
  Production". The database is not rolled back; migrations are additive. Use Neon restore if
  needed.
- **Tear down:** delete the Vercel project and the Neon database. Nothing else depends on them.

## 12. External services still missing

- SMTP
- SMS provider
- real verified collection accounts
- official logo
- lawyer-approved legal texts
- production domain decision (owner approval required before any DNS change)

## 13. Recommendation for production

Use a separate production project with:

- managed PostgreSQL with point-in-time recovery
- object storage for files
- a long-running worker (Docker path: `Dockerfile` + `scripts/start.sh`)
- real SMTP and SMS
- verified collection accounts
- counsel-approved legal texts
- `EDMN_ENVIRONMENT` and `SEED_DEMO` unset

See `docs/DEPLOYMENT.md`.
