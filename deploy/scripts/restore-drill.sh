#!/usr/bin/env bash
# EDMN — RESTORE DRILL. Proves a backup restores and is financially consistent. Touches NO live database.
#
#   restore-drill.sh <edmn-….dump.age|gpg> [--identity <age identity file>] [--tag <image sha>] [--keep]
#
#   1. Decrypts with the OFFLINE private key (age identity file, or the gpg keyring of the operator running it).
#      Run it on the server only with a temporary identity copy (deleted afterwards), or on any machine with Docker.
#   2. Restores into a THROWAWAY PostgreSQL 16 container on an isolated internal network (tmpfs, random password
#      never printed). No live database, volume or port is used.
#   3. Verifies against the manifest: schema (table count, migrations, PRODUCTION marker), row counts of critical
#      tables (≥ manifest: the manifest is read just before pg_dump starts), ledger totals, and the critical
#      snapshot hashes (pricing versions, system settings — must be identical).
#   4. Runs the application's read-only acceptance in --drill mode on the restored copy: ledger balanced, drift,
#      duplicates, stranded balances, allocation and source mismatches all zero, no demo accounts, real money OFF.
#   5. Destroys the container, network and decrypted file (unless --keep for investigation).
# Writes the result to $EDMN_STATE/restore-drill-status.json. Exit 0 only when every check passes.
source "$(dirname "$0")/lib.sh"

F="${1:-}"; shift || true
IDENTITY=""; TAG="$(state_get current_tag)"; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="$2"; shift 2;;
    --tag) TAG="$2"; shift 2;;
    --keep) KEEP=1; shift;;
    *) stop "unknown argument: $1";;
  esac
done
[ -f "$F" ] || stop "usage: restore-drill.sh <encrypted backup> [--identity file] [--tag sha]"
M="$F.manifest.json"; [ -f "$M" ] || stop "manifest missing"
is_sha "$TAG" || stop "--tag <release sha> is required (image used for the acceptance checks)"
IMAGE="${EDMN_IMAGE:-edmn-app}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:16.4-bookworm}"
"$(dirname "$0")/verify-backup.sh" "$F" >/dev/null || stop "backup failed on-server verification"

ID="edmn-drill-$(date -u +%Y%m%d%H%M%S)"
WORK="$(mktemp -d)"
PW="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cleanup() {
  if [ "$KEEP" = 0 ]; then docker rm -f "$ID" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true; fi
  [ -f "$WORK/db.dump" ] && { command -v shred >/dev/null && shred -u "$WORK/db.dump" || rm -f "$WORK/db.dump"; }
  rm -rf "$WORK"
}
trap cleanup EXIT
RESULT=FAIL
record() { state_set restore-drill-status.json "{\"time\":\"$(date -u +%FT%TZ)\",\"backup\":\"$(basename "$F")\",\"result\":\"$RESULT\"}"; }

step "1/5 decrypt (offline key)"
case "$F" in
  *.age) [ -n "$IDENTITY" ] || stop "--identity <age identity file> is required"; require_cmd age; age -d -i "$IDENTITY" -o "$WORK/db.dump" "$F";;
  *.gpg) require_cmd gpg; gpg --batch --yes -o "$WORK/db.dump" --decrypt "$F";;
esac
want="$(sed -n 's/.*"plain_sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$M")"
[ "$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)" = "$want" ] || stop "decrypted dump does not match the manifest"
ok "decrypted and matches the manifest"

step "2/5 restore into a throwaway PostgreSQL (isolated network, tmpfs)"
docker network create --internal "$ID" >/dev/null
docker run -d --name "$ID" --network "$ID" --tmpfs /var/lib/postgresql/data:rw,size=4g -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=edmn_drill \
  -e TZ=UTC "$PG_IMAGE" -c timezone=UTC >/dev/null
for _ in $(seq 1 60); do docker exec "$ID" pg_isready -U postgres -d edmn_drill >/dev/null 2>&1 && break; sleep 2; done
docker exec "$ID" pg_isready -U postgres -d edmn_drill >/dev/null 2>&1 || stop "throwaway PostgreSQL did not start"
docker cp "$WORK/db.dump" "$ID:/tmp/db.dump" >/dev/null   # copied into the container (no world-readable host path)
docker exec -u root "$ID" chown postgres /tmp/db.dump
docker exec "$ID" pg_restore -U postgres -d edmn_drill --no-owner --no-acl --exit-on-error /tmp/db.dump || stop "pg_restore failed"
ok "restored"

step "3/5 schema, row counts, ledger totals, critical snapshots vs manifest"
PSQL=(docker exec -e PGTZ=UTC "$ID" psql -U postgres -d edmn_drill -X -A -t -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "select json_build_object(
  'tables', (select count(*) from information_schema.tables where table_schema = 'public'),
  'marker', (select environment from deployment_environment where id),
  'migrations', (select count(*) from drizzle.__drizzle_migrations),
  'rows', json_build_object('users', (select count(*) from users), 'orders', (select count(*) from orders),
     'journal_entries', (select count(*) from journal_entries), 'journal_lines', (select count(*) from journal_lines),
     'ledger_accounts', (select count(*) from ledger_accounts), 'files', (select count(*) from files),
     'stored_objects', (select count(*) from stored_objects), 'withdrawal_requests', (select count(*) from withdrawal_requests),
     'withdrawal_allocations', (select count(*) from withdrawal_allocations), 'pricing_versions', (select count(*) from pricing_versions),
     'audit_logs', (select count(*) from audit_logs)),
  'ledger', (select json_build_object('debits', coalesce(sum(debit),0), 'credits', coalesce(sum(credit),0)) from journal_lines),
  'critical', json_build_object(
     'pricing_versions', (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from pricing_versions t),
     'system_settings', (select md5(coalesce(string_agg(t.key || '=' || t.value::text, '|' order by t.key), '')) from system_settings t)))" > "$WORK/restored.json"
# Comparison runs in the release image (no Node.js needed on the host).
docker run --rm --user "$(id -u):$(id -g)" -v "$(realpath "$M"):/m.json:ro" -v "$WORK/restored.json:/r.json:ro" "$IMAGE:$TAG" node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).db, r = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const fails = [];
if (r.tables !== m.tables) fails.push(`tables ${r.tables} != ${m.tables}`);
if (r.migrations !== m.migrations) fails.push(`migrations ${r.migrations} != ${m.migrations}`);
if (r.marker !== "PRODUCTION" || r.marker !== m.marker) fails.push(`marker ${r.marker}`);
for (const [k, v] of Object.entries(m.rows)) if (r.rows[k] < v) fails.push(`rows.${k} ${r.rows[k]} < manifest ${v}`);
if (Number(r.ledger.debits) !== Number(r.ledger.credits)) fails.push("restored ledger debits != credits");
if (Number(r.ledger.debits) < Number(m.ledger.debits)) fails.push("restored ledger smaller than manifest");
for (const k of Object.keys(m.critical)) if (r.critical[k] !== m.critical[k]) fails.push(`critical snapshot ${k} differs`);
for (const f of fails) console.error("  ✗ " + f);
console.log(`  tables=${r.tables} migrations=${r.migrations} marker=${r.marker} ledger debits=${r.ledger.debits} credits=${r.ledger.credits}`);
process.exit(fails.length ? 1 : 0);' /m.json /r.json || { record; stop "restored copy does not match the manifest"; }
ok "schema, counts, ledger totals and critical snapshots match"

step "4/5 read-only acceptance (--drill) on the restored copy"
docker run --rm --network "$ID" -e DATABASE_URL="postgres://postgres:$PW@$ID:5432/edmn_drill" -e STORAGE_DRIVER=database \
  "$IMAGE:$TAG" node --import tsx scripts/prod-acceptance.ts --db-only --drill || { record; stop "acceptance on the restored copy failed"; }

step "5/5 cleanup"
RESULT=PASS; record
ok "RESTORE DRILL PASSED for $(basename "$F")"
