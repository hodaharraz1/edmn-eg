# Staging Deployment Report

**Status: BLOCKED at hosting-provider authorization.** Every step that does not need a hosting
account is done and verified. No public URL exists yet. Nothing was deployed, and no DNS,
`api.edmneg.com` or legacy system was touched.

## Why blocked

This cloud environment has **no credentials for any hosting provider**. The GCP/AWS variables
present are proxy placeholders with no access, there is no Railway, Render or Fly token, and
opening a tunnel from this environment is not permitted. A real public HTTPS deployment
therefore needs one authorization from the owner (see "What the owner must do").

## 1. Hosting provider (selected)

**Railway** (`railway.com`). Reasons:

- It runs the full application as a long-lived container: Next.js server **and** background worker.
- It provides managed PostgreSQL and a **persistent volume** for the existing local-disk file
  storage, so no storage rewrite and no loss of uploads.
- It gives a free `https://<name>.up.railway.app` domain with TLS.
- Its API is reachable from this environment (verified), so I can provision everything once
  authorized.

Rejected:

- **Vercel**: no persistent disk, so uploads would break without a storage rewrite.
- **Render**: works, but persistent disks need a paid plan plus a separate Postgres plan.
- **Fly.io**: workable, but needs more manual setup on the owner's side.

## 2. Application URL

Not yet assigned. It will be `https://<service>.up.railway.app` after provisioning.

## 3. Deployment architecture (prepared)

```
Railway project "edmn-staging"
 ├─ PostgreSQL 16 (managed, separate staging database — never the legacy DB)
 └─ service "web"  ← GitHub hodaharraz1/edmn-eg @ claude/great-tesla-nor0wt, built from Dockerfile
      container: scripts/start.sh
        1. npm run db:migrate          (idempotent)
        2. npm run db:seed             (reference data, idempotent)
        3. npm run db:seed:demo        (only if EDMN_ENVIRONMENT=staging and SEED_DEMO=true; idempotent)
        4. background worker loop      (outbox, order expiry, follow-ups, settlements)
        5. next start -H 0.0.0.0 -p $PORT
      volume mounted at /data → STORAGE_LOCAL_ROOT=/data/storage (public/ + private/)
      health check: /api/ready
```

## 4. Database provider

Railway PostgreSQL 16, created fresh for staging. Migrations and seeding run automatically on
every boot (idempotent). Constraints, indexes and foreign keys come from the committed migrations
`0000`–`0002`.

## 5. Storage architecture

Unchanged application storage driver (local disk), placed on a **Railway persistent volume** at
`/data/storage`. Private files are still served only through the authorized `/api/files/[id]`
route. No mock and no feature removal.

## 6. Environment variables (names only)

| Name | Value source |
|---|---|
| `NODE_ENV` | `production` (set in image) |
| `EDMN_ENVIRONMENT` | `staging` |
| `SEED_DEMO` | `true` |
| `DATABASE_URL` | reference to the Railway Postgres variable |
| `APP_URL`, `SELLER_APP_URL`, `ADMIN_APP_URL` | the Railway HTTPS domain |
| `SESSION_SECRET`, `DATA_ENCRYPTION_KEY` | generated at provisioning, stored only in Railway |
| `STAGING_DEMO_PASSWORD`, `STAGING_ADMIN_PASSWORD`, `STAGING_TOTP_SECRET` | generated at provisioning, stored only in Railway |
| `STORAGE_LOCAL_ROOT` | `/data/storage` |
| `MAIL_DRIVER`, `SMS_DRIVER` | `log` (no providers yet — simulated, recorded in Admin → الإشعارات outbox) |
| `COOKIE_SECURE` | forced on by production mode |

No secret is committed to Git or written to docs.

## Changes made in this task (application code)

| Change | Why |
|---|---|
| Root layout `export const dynamic = 'force-dynamic'`, plus on `robots.ts` | The build tried to prerender pages and needed a database at build time. Hosts build without one, and the build failed when tested without an env file. It now builds with no env or DB. |
| `EDMN_ENVIRONMENT=staging` mode | Visible staging banner; `noindex` metadata; `robots.txt` disallows all; demo seed allowed in production mode **only** when marked staging |
| Staging credentials from env (`demoCredentials()`) | The repository is **public**, so the demo admin password and TOTP secret in it are public knowledge. Staging refuses to seed unless it has its own generated secrets. Verified: the repository's default admin password is rejected on staging. |
| `scripts/admin-totp.ts` | Prints the staging 2FA code using `STAGING_TOTP_SECRET` inside the staging container |
| `Dockerfile`, `.dockerignore`, `scripts/start.sh`, `railway.json` | Container build and boot sequence. Base image from AWS ECR Public mirror of the official `node:22` image, to avoid Docker Hub pull limits. |
| Playwright `E2E_BASE_URL` | Runs the E2E suite against a deployed URL. In that mode global setup **never resets** the target database. |

## 7–8. Build result

- `npm run build` **with no `.env` file and no database**: ✅ succeeds after the fix (it failed before).
- Docker image: the Dockerfile could not be fully built inside this sandbox because the build
  container has no network route to the npm registry here. That is an environment limitation; the
  host builds with normal network. It will be verified by the first Railway build.

## 9. Test results (this task)

| Check | Result |
|---|---|
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ |
| `npm test` (unit + integration) | ✅ 79 / 79 |
| **Staging simulation**: `scripts/start.sh` run exactly as the container runs it, with `NODE_ENV=production`, `EDMN_ENVIRONMENT=staging`, a fresh database, freshly generated secrets, and no `.env.local` | ✅ migrate, seed (credentials not printed), worker, web ready |
| **Full E2E suite against that production-mode staging instance** (`E2E_BASE_URL`) | ✅ **26 / 26**. Covers both critical flows from seller registration to paid withdrawal, the external deal flow, security and authorization, and mobile layout. |
| Restart persistence | ✅ second boot skips the seed; uploaded media still served; private file still returns 404 to anonymous users |
| Security probes on the production-mode instance | ✅ no source maps, `/.env` and `/.git/config` → 404, HSTS/CSP/X-Frame-Options present, staging banner shown, `robots.txt` blocks all, no secrets in client bundles |

## 10–14. Public URL tests

**Not run — no public URL exists yet.** After provisioning I will rerun, against the public HTTPS
URL:

- the full Playwright suite (`E2E_BASE_URL`): marketplace E2E, external-deal E2E, security and
  authorization, mobile at 360/375/390/430 px;
- the restart persistence check;
- HTTP security probes;
- confirmation that cookies carry the `Secure` flag.

## 15. Known staging limitations

- Email and SMS are simulated (`log` drivers); messages appear in the Admin outbox, and nothing
  is delivered.
- Payment destinations are the demo "NOT REAL" accounts; no money moves.
- There is a single web instance with an in-container worker. That is fine for staging; for
  production run the worker as a separate service.
- Local-disk storage on a volume ties the app to one instance; production should use object
  storage (S3 driver not yet implemented).

## 16. External services still missing

SMTP, SMS provider, real collection accounts, official logo, lawyer-approved legal texts, and a
production domain decision.

## 17. Redeployment

Push to `claude/great-tesla-nor0wt`; Railway rebuilds and redeploys automatically. Migrations and
seeding run on boot and are idempotent.

## 18. Rollback

In Railway → service → Deployments, choose the previous successful deployment → Redeploy.

- The database is not rolled back automatically. Migrations are additive.
- For data rollback, restore a Railway Postgres backup or snapshot.
- The volume persists across deployments.

## 19. Recommendation for production

Use a separate production project with:

- managed PostgreSQL with point-in-time recovery;
- object storage for files;
- a separate worker service;
- real SMTP/SMS;
- real verified collection accounts;
- counsel-approved legal documents;
- `EDMN_ENVIRONMENT` unset and `SEED_DEMO` unset;
- the official domain connected only after owner approval.

See `docs/DEPLOYMENT.md` and `docs/FINAL_IMPLEMENTATION_REPORT.md`.

## What the owner must do (the only blocker)

1. Create or sign in to a Railway account at railway.com (sign in with GitHub). A trial or Hobby
   plan is enough.
2. Create an **account token**: Account Settings → Tokens → Create.
3. Add that token to **this cloud environment's settings** as an environment variable named
   `RAILWAY_API_TOKEN`: the environment menu in the session title bar → Edit → environment
   variables. Do **not** paste it in chat.
4. Start a new session (or tell me it's added) so the variable is loaded.

Then I will:

- create the project, PostgreSQL, volume and service;
- generate and store the secrets in Railway;
- deploy;
- run every public-URL test listed above;
- fill in sections 2 and 10–14 of this report.
