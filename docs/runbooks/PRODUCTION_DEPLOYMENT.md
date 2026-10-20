# Production Deployment

> **SUPERSEDED for production** (kept as audit history): production is self-hosted on the existing EDMN server — start at [`docs/runbooks/PRODUCTION_GO_LIVE.md`](PRODUCTION_GO_LIVE.md). Vercel is staging only.

> There is **no production environment yet**. This runbook is the contract for creating and deploying it. Never point a staging build at a production database, never copy staging data, passwords, OTP/TOTP seeds or secrets.

## 1. One-time creation (OWNER ACTIONS)
1. New Vercel project (or plan with a real scheduler — Hobby only runs one daily cron). The region is a per-project dashboard setting (Frankfurt for production; `vercel.json` no longer pins one). Provider wiring, cron options, region, email webhook, scanner and error tracking: **`PRODUCTION_INFRASTRUCTURE.md`**.
2. New database (fresh — never a staging branch). The migration runner marks it PRODUCTION on first deploy; from then on nothing but a PRODUCTION runtime may use it (`deployment_environment_guard`), and `.local` demo/E2E accounts and TEST payment destinations are refused by triggers.
3. Environment variables per `src/server/core/runtime-env.ts` (`ENV_POLICY`). PRODUCTION boot refuses: missing CRON_SECRET/SMTP, a placeholder `MAIL_FROM`, admin not isolated (`ENFORCE_ADMIN_HOST=true` or `ENFORCE_HOSTS=true` required), `STAGING_*`, `SEED_DEMO`, `E2E_*`, placeholder/public secrets, equal SESSION_SECRET/DATA_ENCRYPTION_KEY, http APP_URL, local storage on Vercel. SMS is optional to boot (without it mobile verification, seller onboarding and Protected Deals are refused, never faked). Set `DATA_ENCRYPTION_KEY_ID` from day one.
   Recommended domain layout for launch: `APP_URL=https://www.edmneg.com` (buyers and the Seller Center under `/seller`), `ENFORCE_ADMIN_HOST=true`, `ADMIN_HOST=admin.edmneg.com` (admin console on its own origin). The seller subdomain (`ENFORCE_HOSTS=true`) is supported but means a separate login on seller.edmneg.com — not recommended for launch.
   Public launch before real money is safe: with `payments.realMoneyEnabled` off, production shows a banner and refuses new orders / deal invitations / deal payments (`src/server/ops/commerce-gate.ts`); browsing, accounts, identity, seller onboarding and support work. `marketplace.maintenanceMode` closes new commerce at any time.
4. First SUPER_ADMIN: `npm run admin:create` from an interactive terminal (one-time; refuses when a SUPER_ADMIN exists, refuses `.local` emails, prints the TOTP URI once). Never through CI, never with a seeded password.

## 2. CI gates (every change)
`.github/workflows/ci.yml` (manual/PR): `npm ci` → `npm run lint` → `npm run typecheck` → `npx vitest run` (Postgres service) → `npx tsx scripts/secret-scan.ts`. Full E2E (`npx playwright test`) runs locally before any push (docs/TESTING_POLICY.md). A red gate blocks the deploy.

## 3. Deploy
- Build: `scripts/vercel-build.sh` → `scripts/migrate.ts` (preflight: environment marker compatible **before DDL**; destructive statements refused unless the migration carries `-- edmn:allow-destructive: <reason>`; advisory lock so two deploys never migrate concurrently) → reference seed (demo seed only when `EDMN_ENVIRONMENT=staging` and `SEED_DEMO=true`) → `next build`.
- Migrations are **expand → migrate → contract**: add columns/tables (old code keeps working), backfill in a job, switch reads, and only in a later release drop the old shape (reviewed contract migration).
- After deploy: `/api/ready` must be 200 with all checks `ok`; `/admin/ops` fingerprint OK; run a manual ledger health check; targeted smoke specs only.

## 4. Rollback / forward-fix policy
- **Code**: Vercel "Promote previous deployment" (instant) is allowed when the schema is backward compatible (always true with expand-only migrations).
- **Schema**: never roll back a migration by hand. Fix forward with a new additive migration. Never restore a backup over a live database (DATABASE_RESTORE.md).
- **Money**: if a deploy touches money paths and misbehaves → engage the emergency kill switch first, then roll back code.

## 5. Pilot controls (configurable, no invented limits)
Settings (fresh 2FA, audited): `pilot.enabled`, `pilot.allowedUserIds`, `pilot.maxOrderAmount`, `pilot.maxDealAmount` (null = no cap until the owner sets one). Enforced in `placeOrder`, `inviteSeller`, `startDealPayment` (`src/server/ops/pilot.ts`). Existing orders/deals, support and disputes are never affected.
