# Staging Deployment Report

**Status: BLOCKED at hosting-provider authorization.** Every step that does not need a hosting
account is done and verified. No public URL exists yet. Nothing was deployed, and no DNS,
`api.edmneg.com` or legacy system was touched.

## Why blocked

This cloud environment has **no credentials for any hosting provider**. The GCP/AWS variables
present are proxy placeholders with no access, there is no Railway, Render or Fly token, and
opening a tunnel from this environment is not permitted. A real public HTTPS deployment
therefore needs one authorization from the owner (see "What the owner must do").

## 1. Hosting provider (selected) — 100% free, no payment card

Owner requirement: **zero cost**. Selected:

| Part | Provider | Free tier |
|---|---|---|
| Web app + worker (Docker) | **Render** free web service | free; 512 MB RAM; sleeps after ~15 min idle (first request then takes ~1 min) |
| PostgreSQL | **Neon** free | free, no expiry; 0.5 GB storage |
| Uploaded files | **inside the Neon database** (`STORAGE_DRIVER=database`) | counts toward 0.5 GB (all demo data ≈ 1 MB) |
| HTTPS domain | `https://<name>.onrender.com` | free, TLS included |

Both providers sign in with GitHub. No payment card is needed for their free plans as far as
publicly documented. Free tiers can change; nothing in this setup upgrades automatically.

Rejected for cost:

- **Railway**: paid after a one-time trial.
- **Render Postgres free**: expires after 30 days.
- **Render persistent disk**: paid.
- **Fly.io**: requires a payment card.
- **Vercel**: free, but its 4.5 MB request limit breaks uploads up to 8 MB, and it can't run the worker.

## 2. Application URL

Not yet assigned. It will be `https://<service>.onrender.com` after provisioning.

## 3. Deployment architecture (prepared)

```
Neon project "edmn-staging"   → PostgreSQL (separate staging DB — never the legacy DB)
Render free web service       ← GitHub hodaharraz1/edmn-eg @ claude/great-tesla-nor0wt, Dockerfile
  scripts/start.sh: migrate → seed → staging demo seed (idempotent) → worker → next start
  files: stored in Postgres table stored_objects (survive restarts/redeploys with the DB)
  health check: /api/ready
```

## 4. Database provider

Neon PostgreSQL (free tier), created fresh for staging. Migrations `0000`–`0003` and seeds run
automatically on boot (idempotent).

## 5. Storage architecture

The free web service has an **ephemeral disk**, so files would be lost on restart. A minimal storage
adaptation was added: `STORAGE_DRIVER=database` stores object bytes in a new additive table
`stored_objects` (migration `0003`), keyed exactly like the disk driver.

- Access control is unchanged: private files are still served only through `/api/files/[id]` with
  the same per-purpose authorization.
- The local-disk driver remains the default.
- Covered by new integration tests.

## 6. Environment variables (names only)

| Name | Value source |
|---|---|
| `NODE_ENV` | `production` (set in image) |
| `EDMN_ENVIRONMENT` | `staging` |
| `SEED_DEMO` | `true` |
| `DATABASE_URL` | Neon connection string (secret) |
| `APP_URL`, `SELLER_APP_URL`, `ADMIN_APP_URL` | the Render HTTPS domain |
| `SESSION_SECRET`, `DATA_ENCRYPTION_KEY` | generated at provisioning, stored only in Render |
| `STAGING_DEMO_PASSWORD`, `STAGING_ADMIN_PASSWORD`, `STAGING_TOTP_SECRET` | generated at provisioning, stored only in Render |
| `STORAGE_DRIVER` | `database` |
| `NODE_OPTIONS` | `--max-old-space-size=320` (fit 512 MB) |
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
  host builds with normal network. It will be verified by the first Render build.

## 9. Test results (this task)

| Check | Result |
|---|---|
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ |
| `npm test` (unit + integration) | ✅ 81 / 81 (incl. database storage driver) |
| **Staging simulation**: `scripts/start.sh` run exactly as the container runs it, with `NODE_ENV=production`, `EDMN_ENVIRONMENT=staging`, a fresh database, freshly generated secrets, and no `.env.local` | ✅ migrate, seed (credentials not printed), worker, web ready |
| **Full E2E suite against that production-mode staging instance** (`E2E_BASE_URL`), with files stored in the database and memory capped as on the free tier | ✅ **26 / 26**; peak memory ≈ 445 MB of the 512 MB limit. Covers both critical flows from seller registration to paid withdrawal, the external deal flow, security and authorization, and mobile layout. |
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
- **Free tier sleeps after ~15 min idle.** The first visit then takes about a minute, and the
  background worker only runs while the service is awake.
- 512 MB RAM and the 0.5 GB database limit are enough for staging and testing only.
- Files are stored in Postgres, which is fine for staging. Production should use object storage
  (an S3 driver is not yet implemented) and a separate worker service.

## 16. External services still missing

SMTP, SMS provider, real collection accounts, official logo, lawyer-approved legal texts, and a
production domain decision.

## 17. Redeployment

Push to `claude/great-tesla-nor0wt`; Render rebuilds and redeploys automatically. Migrations and
seeding run on boot and are idempotent.

## 18. Rollback

In Render → service → Events/Deploys, choose a previous deploy → Rollback.

- The database is not rolled back automatically. Migrations are additive.
- For data rollback, use Neon point-in-time restore (free tier keeps a short history window).

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

1. Sign in to **render.com** with GitHub, then Account Settings → **API Keys** → create a key.
2. Sign in to **neon.tech** with GitHub, then Account settings → **API keys** → create a key.
3. In **this cloud environment's settings** (the environment menu in the session title bar →
   Edit → environment variables), add `RENDER_API_KEY` and `NEON_API_KEY`. Do **not** paste them
   in chat.
4. Start a new session (or tell me they're added).

Then I will:

- create the Neon database and the Render service;
- generate the secrets and store them in Render;
- deploy;
- run every public-URL test;
- fill in sections 2 and 10–14 of this report.

Nothing will be put on a paid plan.
