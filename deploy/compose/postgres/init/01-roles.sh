#!/bin/bash
# EDMN — PostgreSQL 16 role / database separation (runs ONCE, only when the data volume is EMPTY, via the official
# image's /docker-entrypoint-initdb.d). It never runs against an existing database and never touches any other
# database on the host (it lives only inside the edmn_pgdata volume of the "postgres-local" profile).
#
#   POSTGRES_USER        cluster superuser (maintenance only; never used by the application)
#   edmn_owner           owns database `edmn` and every schema object; used ONLY by migrate / seed (migrate.env)
#   edmn_app             runtime role (web + worker): DML only (SELECT/INSERT/UPDATE/DELETE), no DDL, no ownership
#   edmn_backup          read-only for pg_dump (pg_read_all_data); cannot write anything
#
# Passwords come from /etc/edmn/postgres.env (EDMN_OWNER_PASSWORD, EDMN_APP_PASSWORD, EDMN_BACKUP_PASSWORD) —
# generated on the server (openssl rand -base64 36), never committed. Encoding UTF8, locale C.UTF-8, timezone UTC.
set -euo pipefail

for v in EDMN_OWNER_PASSWORD EDMN_APP_PASSWORD EDMN_BACKUP_PASSWORD; do
  val="${!v:-}"
  if [ "${#val}" -lt 24 ]; then echo "✗ $v must be set in postgres.env (≥ 24 characters) — refusing to create roles" >&2; exit 1; fi
done
DB="${EDMN_DB_NAME:-edmn}"

# Passwords are passed as psql variables (:'name' quoting) — never interpolated into SQL text or logged.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$EDMN_OWNER_PASSWORD" -v app_pw="$EDMN_APP_PASSWORD" -v backup_pw="$EDMN_BACKUP_PASSWORD" -v db="$DB" <<'SQL'
CREATE ROLE edmn_owner  LOGIN PASSWORD :'owner_pw'  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE edmn_app    LOGIN PASSWORD :'app_pw'    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 40;
CREATE ROLE edmn_backup LOGIN PASSWORD :'backup_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3;
GRANT pg_read_all_data TO edmn_backup;
SELECT format('CREATE DATABASE %I OWNER edmn_owner ENCODING %L LC_COLLATE %L LC_CTYPE %L TEMPLATE template0', :'db', 'UTF8', 'C.UTF-8', 'C.UTF-8') \gexec
SELECT format('ALTER DATABASE %I SET timezone TO %L', :'db', 'UTC') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO edmn_app', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO edmn_backup', :'db') \gexec
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB" <<'SQL'
-- The owner owns the public schema; nobody else may create objects in it.
ALTER SCHEMA public OWNER TO edmn_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO edmn_app, edmn_backup;
-- The migrator's bookkeeping schema (created by the first migration as edmn_owner): read-only for the runtime
-- role so the acceptance suite can compare applied migrations with the journal.
CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION edmn_owner;
GRANT USAGE ON SCHEMA drizzle TO edmn_app, edmn_backup;
-- Everything edmn_owner creates from now on (all migrations): DML for the runtime role, nothing more.
ALTER DEFAULT PRIVILEGES FOR ROLE edmn_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edmn_app;
ALTER DEFAULT PRIVILEGES FOR ROLE edmn_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO edmn_app;
ALTER DEFAULT PRIVILEGES FOR ROLE edmn_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO edmn_app;
ALTER DEFAULT PRIVILEGES FOR ROLE edmn_owner IN SCHEMA drizzle GRANT SELECT ON TABLES TO edmn_app;
SQL

echo "✓ EDMN roles created (edmn_owner / edmn_app / edmn_backup) on database ${DB} — passwords not printed"
