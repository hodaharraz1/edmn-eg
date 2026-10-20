# First-production database plan (both options prepared — choose after server discovery)

No production database exists, and none is created by anything in the repository.

The choice is made with the owner and Kntabo after [evaluate-server.mjs](PRODUCTION_GO_LIVE.md):

| Server size | Option |
|---|---|
| ≥ 3.5 GB RAM and ≥ 40 GB free | A |
| Smaller, or when preferred | B |

The application is identical in both cases; only `DATABASE_URL` and the backup network differ.

| Topic | **A — self-hosted PostgreSQL 16 (compose `postgres-local`)** | **B — external PostgreSQL 16** (e.g. a NEW Neon production project, separate from staging) |
|---|---|---|
| **Creation** | `COMPOSE_PROFILES=postgres-local` in `compose.env`. `deploy.sh first` starts the container on an **empty** volume `edmn_edmn_pgdata`. A first deploy refuses an existing volume or a non-empty database. | Owner creates a new project/database `edmn` in an EU region close to the server. Never a branch or copy of staging. |
| **Roles** | `01-roles.sh`, on first start only: `edmn_owner` (owns everything; migrate/seed), `edmn_app` (DML only, connection limit 40), `edmn_backup` (`pg_read_all_data`, limit 3). The superuser is unused by the app. | Same three roles, created by the owner with the provider console or SQL. Run the SQL of `deploy/compose/postgres/init/01-roles.sh` (the heredoc parts) as the provider's admin role. Not every provider grants `pg_read_all_data`; then give `edmn_backup` `SELECT` on all tables plus default privileges. |
| **Permissions** | Runtime: no CREATE on database or schema, no TRUNCATE, no ownership (rehearsed: DDL and TRUNCATE refused). Backup: cannot write. | Same. Verify with `has_table_privilege` / `has_schema_privilege` queries before the first deploy. |
| **Encoding / locale / TZ** | UTF8, `C.UTF-8`, data checksums, `timezone=UTC` (server and database) | UTF8 required. Set the database timezone with `ALTER DATABASE edmn SET timezone TO 'UTC'`. The app stores `timestamptz`. |
| **Migration** | `deploy.sh` → `migrate-preflight` → `migrate` as `edmn_owner` (`migrate.env`): advisory-locked and expand-only (destructive statements refused unless reviewed). | Identical. `DATABASE_URL_UNPOOLED` = the **direct** (non-pooler) owner URL; the advisory lock needs a session. |
| **Environment marker** | The first migration marks the database `PRODUCTION` permanently. Staging, test and unmarked runtimes are refused, and a staging-marked database cannot become production. | Identical. |
| **Connection limits** | `max_connections=50` (`EDMN_PG_MAX_CONNECTIONS`). Web pool 10 + worker pool 10 + acceptance/backup ≤ 4. | Use the provider's pooler for the runtime URL (`DATABASE_POOL_MAX=10`); the owner/migrate URL is direct. |
| **TLS** | Not needed: traffic stays on the internal Docker network `backend` (no published 5432). `sslmode=disable` is correct here. | **Required**: `sslmode=require` (or `verify-full` with the provider CA). `check-production-env.ts` refuses a networked URL without it. |
| **Health checks** | Container `pg_isready`; `/api/ready` (`database`, `migrations`); `watch.sh` (database reachable via the worker probe). | `/api/ready`, `watch.sh`, and the provider dashboard and alerts. |
| **Backup** | `backup.sh` (daily timer + pre-deploy): `pg_dump -Fc` as `edmn_backup`, encrypted with age, off-server upload. `BACKUP_DOCKER_NETWORK=edmn_backend`. | Same `backup.sh` with `BACKUP_DOCKER_NETWORK=edmn_edge` (egress), plus the provider's point-in-time restore. Provider snapshots **do not** replace an off-server encrypted dump in another account. |
| **Restore** | `restore-drill.sh` proves restorability into a throwaway container. A real restore is **manual and approved**: into a NEW database, then switch `DATABASE_URL` (`rollback.sh database` prints the procedure). | Provider point-in-time restore into a NEW branch/database, or `pg_restore` of the encrypted dump; then the same acceptance (`--db-only`). |
| **Volume / disk** | Volume on the Docker root filesystem. Keep ≥ 20 GB free (watch.sh warns at 80%, critical at 90%). | n/a |
| **Upgrade strategy** | Minor versions: bump `EDMN_POSTGRES_IMAGE` (16.x), then `docker compose up -d postgres` in a maintenance window, after a verified backup. Major versions (17+): never in place; dump → new volume → restore drill → switch. | Follow the provider's minor upgrades. Major upgrades in a new project, using the same dump / restore-drill path. |
| **Monitoring of size** | `pg_database_size('edmn')` in the backup manifest (row counts) over time. | Provider metrics. |
| **Cost** | Zero beyond the server. | Provider plan (owner decision; free tiers may suspend compute). |

**Shared rules:**
- Never connect staging to this database.
- Never restore staging data into it.
- Never run `scripts/reset-db.ts` against it (the environment marker refuses it).
- Never grant DDL to `edmn_app`.
