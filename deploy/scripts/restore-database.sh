#!/usr/bin/env bash
# EDMN — REAL RESTORE into a NEW (or verified-empty) database. Manual, owner-approved DR operation.
#
#   restore-database.sh <edmn-….dump.age|gpg> --identity <age identity> --target-db <name> --confirm-owner-approved
#                       [--existing-empty]     (target already created empty, e.g. by 01-roles.sh on a NEW host / external DB)
#
# Never restores over a database that contains tables. Never touches the database currently in use (it refuses the
# target when it is the database named in /etc/edmn/production.env, unless that database is EMPTY — the new-host
# case). Steps: verify backup → decrypt (offline key) → [create target as edmn_owner-owned, with the same role grants
# as 01-roles.sh] → pg_restore as edmn_owner → grants → read-only acceptance (--drill) on the restored database.
# It does NOT switch the application: pointing DATABASE_URL / migrate.env at the restored database is a separate,
# deliberate edit followed by deploy.sh normal (see docs/runbooks/DISASTER_RECOVERY.md).
# Local-PostgreSQL profile: uses the superuser from /etc/edmn/postgres.env only to CREATE DATABASE. External
# PostgreSQL: create the empty database with the provider first and pass --existing-empty.
source "$(dirname "$0")/lib.sh"

F="${1:-}"; shift || true
IDENTITY=""; TARGET=""; APPROVED=0; EXISTING=0
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="$2"; shift 2;;
    --target-db) TARGET="$2"; shift 2;;
    --confirm-owner-approved) APPROVED=1; shift;;
    --existing-empty) EXISTING=1; shift;;
    *) stop "unknown argument: $1";;
  esac
done
[ -f "$F" ] || stop "usage: restore-database.sh <backup> --identity <key> --target-db <name> --confirm-owner-approved [--existing-empty]"
[ "$APPROVED" = 1 ] || stop "a real restore needs the owner's written approval: pass --confirm-owner-approved"
[[ "$TARGET" =~ ^[a-z][a-z0-9_]{2,62}$ ]] || stop "--target-db must be a plain lowercase name"
MIG="$EDMN_ETC/migrate.env"; APP_ENV="$EDMN_ETC/production.env"
require_secret_file "$MIG"; require_secret_file "$APP_ENV"
OWNER_URL="$(env_value "$MIG" DATABASE_URL)"; APP_URL_DB="$(env_value "$APP_ENV" DATABASE_URL)"
[ -n "$OWNER_URL" ] && [ -n "$APP_URL_DB" ] || stop "owner / runtime DATABASE_URL missing"
with_db() { printf '%s' "$1" | sed -E "s#(://[^/]+/)[^?]*#\\1$2#"; }
LIVE_DB="$(printf '%s' "$APP_URL_DB" | sed -E 's#^[^/]*//[^/]+/([^?]*).*#\1#')"
NET="${BACKUP_DOCKER_NETWORK:-edmn_backend}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:16.4-bookworm}"
IMAGE="${EDMN_IMAGE:-edmn-app}"; TAG="$(state_get current_tag)"; TAG="${EDMN_IMAGE_TAG:-$TAG}"
is_sha "$TAG" || stop "no release image tag known (set EDMN_IMAGE_TAG)"

"$(dirname "$0")/verify-backup.sh" "$F" >/dev/null || stop "backup failed verification"
WORK="$(mktemp -d)"; trap '[ -f "$WORK/db.dump" ] && { command -v shred >/dev/null && shred -u "$WORK/db.dump" || rm -f "$WORK/db.dump"; }; rm -rf "$WORK"' EXIT
step "1/5 decrypt (offline key)"
case "$F" in
  *.age) [ -n "$IDENTITY" ] || stop "--identity required"; age -d -i "$IDENTITY" -o "$WORK/db.dump" "$F";;
  *.gpg) gpg --batch --yes -o "$WORK/db.dump" --decrypt "$F";;
esac
want="$(sed -n 's/.*"plain_sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$F.manifest.json")"
[ "$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)" = "$want" ] || stop "decrypted dump does not match its manifest"

psqlc() { docker run --rm -i --network "$NET" -e PGTZ=UTC "$PG_IMAGE" psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 "${@:2}"; }
TARGET_OWNER_URL="$(with_db "$OWNER_URL" "$TARGET")"

step "2/5 target database '$TARGET'"
if [ "$EXISTING" = 1 ]; then
  n="$(psqlc "$TARGET_OWNER_URL" -c "select count(*) from information_schema.tables where table_schema='public'")" || stop "cannot connect to $TARGET as the owner role"
  [ "$n" = 0 ] || stop "target $TARGET is not empty ($n tables) — refusing to restore over data"
else
  [ "$TARGET" != "$LIVE_DB" ] || stop "target is the live database — choose a NEW name"
  PGENV="$EDMN_ETC/postgres.env"; require_secret_file "$PGENV"
  SU="$(env_value "$PGENV" POSTGRES_USER)"; SUPW="$(env_value "$PGENV" POSTGRES_PASSWORD)"
  ADMIN_URL="postgres://$SU:$SUPW@postgres:5432/postgres?sslmode=disable"
  exists="$(psqlc "$ADMIN_URL" -c "select count(*) from pg_database where datname='$TARGET'")" || stop "cannot reach PostgreSQL as superuser"
  [ "$exists" = 0 ] || stop "database $TARGET already exists — choose a NEW name (or --existing-empty if it is empty)"
  psqlc "$ADMIN_URL" -v db="$TARGET" <<'SQL' || stop "could not create $TARGET"
SELECT format('CREATE DATABASE %I OWNER edmn_owner ENCODING %L LC_COLLATE %L LC_CTYPE %L TEMPLATE template0', :'db', 'UTF8', 'C.UTF-8', 'C.UTF-8') \gexec
SELECT format('ALTER DATABASE %I SET timezone TO %L', :'db', 'UTC') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO edmn_app', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO edmn_backup', :'db') \gexec
SQL
  psqlc "$(with_db "$ADMIN_URL" "$TARGET")" <<'SQL' || stop "could not prepare the schema of $TARGET"
ALTER SCHEMA public OWNER TO edmn_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO edmn_app, edmn_backup;
SQL
fi
# Default privileges are per database: re-declare them in the target before any object is created.
psqlc "$TARGET_OWNER_URL" <<'SQL' || stop "could not set default privileges"
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edmn_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO edmn_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO edmn_app;
SQL
ok "target ready (empty, owned by edmn_owner)"

step "3/5 pg_restore as edmn_owner"
docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -v "$WORK:/in:ro" "$PG_IMAGE" \
  pg_restore -d "$TARGET_OWNER_URL" --no-owner --no-acl --exit-on-error /in/db.dump || stop "pg_restore failed — target left for inspection; the live database was not touched"
psqlc "$TARGET_OWNER_URL" <<'SQL' || stop "grants failed"
GRANT USAGE ON SCHEMA drizzle TO edmn_app, edmn_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO edmn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edmn_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO edmn_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO edmn_app;
SQL
ok "restored"

step "4/5 read-only acceptance on the restored database (runtime role)"
docker run --rm --network "$NET" -e DATABASE_URL="$(with_db "$APP_URL_DB" "$TARGET")" -e STORAGE_DRIVER=database \
  "$IMAGE:$TAG" node --import tsx scripts/prod-acceptance.ts --db-only --drill || stop "acceptance failed on the restored database — do NOT switch to it"

step "5/5 DONE — the application was NOT switched"
cat <<TXT
Restored into '$TARGET' and verified. To serve from it (owner decision, maintenance window):
  1. edit DATABASE_URL in $APP_ENV and DATABASE_URL/DATABASE_URL_UNPOOLED in $MIG → database '$TARGET'
  2. deploy/scripts/check-production-env (scripts/check-production-env.ts) → VALID
  3. deploy.sh normal --tag <sha>   (new host without state: echo <sha> > $EDMN_STATE/current_tag first)
  4. keep the previous database untouched for forensics until the owner releases it
TXT
