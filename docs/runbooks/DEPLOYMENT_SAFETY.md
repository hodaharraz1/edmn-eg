# Deployment safety — no automatic database changes

**Rule:** a deployment never changes a shared database as a side effect. Building, installing, starting or previewing
the application runs **no migration and no seed**. Database changes are separate, deliberate operator steps. Each
environment has its own database. Enforced in code by `src/server/core/deploy-policy.ts` and tested by
`tests/unit/deploy-policy.test.ts` and `tests/integration/deployment-safety.test.ts`.

## Incident that led here (2026-10-21)

Pushing `claude/awesome-davinci-ojxuul` @ `ce1762e` triggered a Vercel **Preview** build of project `edmn-staging`.
The build command (`scripts/vercel-build.sh`) ran `migrate → seed → demo seed → next build`. Confirmed log:

```
Running "sh scripts/vercel-build.sh"
✗ migration failed DATABASE_URL is not configured
```

The migration step stopped because `DATABASE_URL` was not configured in the Preview scope. No seed ran, and this
preview did not reach the staging database. The staging database itself was not inspected. The design flaw stands: any
deployment, preview or not, with database credentials would have migrated and seeded that database before the
application was even built. A failed build could have left the shared database half-changed.

## Deployment matrix

| | Local | Branch / PR preview | Staging | Production |
|---|---|---|---|---|
| Database variable | `DATABASE_URL` | **`PREVIEW_DATABASE_URL` only**; `DATABASE_URL*` are ignored, and refused if they share its server | `DATABASE_URL` (runtime role) | `DATABASE_URL` (DML-only runtime role) |
| Marker | DEVELOPMENT / TEST | **PREVIEW**: written only by `scripts/preview-db-init.ts` on an **empty** database | STAGING | PRODUCTION |
| Build (`next build`) | no DB | no DB | no DB | no DB |
| Runtime | any non-shared DB | every connection refused unless the DB is PREVIEW | STAGING DB only | PRODUCTION DB only |
| Migrations | `npx tsx scripts/migrate.ts` | `EDMN_DEPLOYMENT=preview … migrate.ts`, only on a PREVIEW DB | `migrate.ts --authorize=staging` + `EDMN_DB_CHANGE_AUTHORIZATION=staging:<commit>`, via the protected workflow | `deploy/scripts/deploy.sh` (backup → preflight → `migrate.ts --authorize=production`, release-bound) |
| Reference data | bootstrap (`seed.ts`) | bootstrap on the PREVIEW DB | **insert-missing only** (part of `migrate.ts`; `seed.ts --authorize=staging` is insert-missing too) | **insert-missing only, part of the migrate step**; `seed.ts` is refused |
| Demo data | `seed.ts --demo` | `seed.ts --demo` on the PREVIEW DB | explicit and authorized only; never at build or start | refused (database triggers also refuse fixtures) |
| Container start (`scripts/start.sh`) | migrates + seeds its own DB | n/a | **no DB changes** | refused (compose runs web and worker directly) |

`migrate.ts`, `seed.ts` and `preview-db-init.ts` exit with code **78 before opening any connection** when run:
- inside `next build`
- from an npm install / build / start lifecycle hook
- anywhere on Vercel (`VERCEL` is set)
- against the wrong environment without authorization

### Two layers, neither sufficient alone

1. **Isolation (the actual access control).** Previews have no shared-database credentials, and the runtime guard
   refuses any database that is not PREVIEW. That blocks reads and writes, not only DDL. Staging and production DDL
   credentials exist only where the deliberate step runs: the GitHub `staging` environment secret, or
   `/etc/edmn/migrate.env` for self-hosted production.
2. **Tripwire.** `--authorize=<env>` + `EDMN_DB_CHANGE_AUTHORIZATION=<env>:<commit>`. The commit must be the checked-out
   code (git HEAD; for images without `.git`, `EDMN_RELEASE`). This stops accidents; it does not replace (1).

## Reference data: insert-missing

`seedReference({ mode: 'insert-missing' })` only inserts rows that do not exist. It never updates, deletes or re-currents.

Bootstrap mode (local, test, preview only) additionally:
- rewrites governorate names
- promotes untouched seeded legal drafts to current
- applies a one-time CMS copy fix

Inventory of what the reference data covers:

| Data | insert-missing behaviour |
|---|---|
| 27 governorates | insert by id; never renames |
| Roles + default permissions | role inserted if missing; a role's default permissions only if it has none. SUPER_ADMIN always holds every permission (not admin-editable by design) |
| Additive permission grants | once per grant id (`rbac.additiveGrants`); never re-added after an admin removes them |
| Payment methods (3) | insert if missing, disabled |
| Category tree, attributes, options, category ↔ attribute links | insert if missing |
| Commission benchmark rules | default rule and per-category rule only if none exists |
| Listing policy rules | insert if missing |
| Legal documents (v1.0, v1.1 drafts, v1.2 drafts) | missing versions added as **non-current**. A document gets a current version only if it has none (fresh install). The published version of an existing install is never changed. Audited as `legal.reference_version_added` |
| Homepage CMS blocks | only when the homepage has no blocks at all |
| Pricing drafts, payout channels, refund-policy draft, used-phone policy | insert only when absent (unchanged functions) |

Proven by tests:
- On an **empty** database, insert-missing produces exactly the bootstrap reference set.
- On an **existing** database it preserves admin edits: renamed governorate and category, edited payment method, edited
  CMS block, removed permission, admin-published legal version.
- Missing reference rows are restored.

## Staging: how a release is deployed now

1. Merge to the staging branch is **not** enough any more: Vercel only builds.
2. **Before** the new code goes live, run the migration for that exact commit (expand-only migrations, so the old code
   keeps working):
   - **GitHub:** *Actions → Migrate staging database* (`.github/workflows/migrate-staging.yml`) with the commit SHA.
     It requires the `staging` environment (required reviewers) and the `STAGING_MIGRATION_DATABASE_URL` secret.
     A `workflow_dispatch` workflow can only be started once the file exists on the repository's default branch.
     Until then, an operator runs the same commands from a checkout of that commit:
     ```bash
     export EDMN_ENVIRONMENT=staging DATABASE_URL=<staging owner URL> DATABASE_URL_UNPOOLED=<same>
     export EDMN_DB_CHANGE_AUTHORIZATION=staging:$(git rev-parse HEAD)
     npx tsx scripts/migrate.ts --preflight
     npx tsx scripts/migrate.ts --authorize=staging
     npm run -s ledger:check
     ```
3. Push or promote the code to the staging branch. `/api/ready` returns 503 while the database is behind the code.

## Production

`deploy/scripts/deploy.sh` stays the only path:
1. backup
2. verify backup
3. preflight
4. `migrate --authorize=production`, bound to the release tag, as the owner role from `/etc/edmn/migrate.env`
5. start web and worker

There is no seed step and no seed service. Real Money stays OFF.

## External configuration (owner actions — not done by code)

1. **Vercel `edmn-staging` → Environment Variables:**
   - `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `EDMN_ENVIRONMENT`, `STAGING_*`: scope **Production only** (never Preview or
     Development).
   - Remove `SEED_DEMO`; nothing reads it on Vercel any more.
   - Previews get either nothing (they build and run without a database, and pages needing one show errors) or an
     isolated `PREVIEW_DATABASE_URL`.
2. **Neon:**
   - Create a DML-only runtime role for staging and use it in Vercel.
   - Keep the owner role only in the GitHub `staging` environment secret `STAGING_MIGRATION_DATABASE_URL`.
   - Optional isolated preview database: a separate Neon project or branch created **empty**, then:
     ```bash
     EDMN_DEPLOYMENT=preview PREVIEW_DATABASE_URL=<url> npx tsx scripts/preview-db-init.ts --confirm-database=<name>
     ```
3. **GitHub:** create the `staging` environment with required reviewers and add the secret.
4. **Before staging runs Phase 1 code:** provision `DELIVERY_OTP_KEY` and `MOBILE_TOKEN_KEY`, otherwise delivery codes
   and mobile tokens fail closed.
