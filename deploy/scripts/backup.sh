#!/usr/bin/env bash
# EDMN — encrypted PostgreSQL backup (pre-deploy and daily).
#
#   backup.sh [--reason daily|pre-deploy-<sha>|manual] [--print-path]
#
#   1. pg_dump -Fc as the READ-ONLY role edmn_backup (pg_read_all_data), through a postgres client container
#      (no client install on the host; version ≥ server). With STORAGE_DRIVER=database the uploaded files are
#      inside the database, so one dump covers data AND private files.
#   2. Validates the dump (pg_restore --list must list table data) and records a manifest: table count, row counts
#      of critical tables, ledger debit/credit totals, sha256 — counts only, never record values.
#   3. Encrypts with a PUBLIC key only (age recipient or GnuPG key id). The server cannot decrypt its own backups;
#      the private key lives offline with the owner. The plaintext dump never leaves the 0700 work dir and is
#      deleted (shred when available) before the script ends.
#   4. Off-server copy through BACKUP_UPLOAD_CMD (any tool: rclone, aws s3 cp, scp…, configured by the owner).
#      Without a successful upload the status is "LOCAL COPY — NOT DISASTER-RECOVERY BACKUP".
#   5. Retention (BACKUP_RETENTION_DAYS, keeping at least BACKUP_KEEP_MIN newest), status file, optional heartbeat.
#
# Configuration: /etc/edmn/backup.env (0600) — see deploy/README.md. No provider credential is hardcoded here.
source "$(dirname "$0")/lib.sh"
exec 3>&1 1>&2                     # logs → stderr; only --print-path output → stdout

REASON="manual"; PRINT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --reason) REASON="$2"; shift 2;;
    --print-path) PRINT=1; shift;;
    *) stop "unknown argument: $1";;
  esac
done
[[ "$REASON" =~ ^[a-z0-9-]{1,80}$ ]] || stop "invalid --reason"

BENV="$EDMN_ETC/backup.env"
require_secret_file "$BENV"
set -a; source "$BENV"; set +a     # values are used, never printed
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL (edmn_backup role) must be set in backup.env}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:16.4-bookworm}"
NET="${BACKUP_DOCKER_NETWORK:-edmn_backend}"
ENC="${BACKUP_ENCRYPTION:-age}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
KEEP_MIN="${BACKUP_KEEP_MIN:-3}"
case "$ENC" in
  age) require_cmd age; : "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age public key) must be set}";;
  gpg) require_cmd gpg; : "${BACKUP_GPG_RECIPIENT:?BACKUP_GPG_RECIPIENT (public key id) must be set}";;
  *) stop "BACKUP_ENCRYPTION must be age or gpg (unencrypted backups are not allowed)";;
esac
require_cmd docker sha256sum

mkdir -p "$EDMN_BACKUP_DIR"; chmod 700 "$EDMN_BACKUP_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="edmn-$TS-$REASON"
WORK="$(mktemp -d "$EDMN_BACKUP_DIR/.work.XXXXXX")"
cleanup() { [ -f "$WORK/db.dump" ] && { command -v shred >/dev/null && shred -u "$WORK/db.dump" || rm -f "$WORK/db.dump"; }; rm -rf "$WORK"; }
trap cleanup EXIT

pgc() { docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -e PGURL="$BACKUP_DATABASE_URL" -e PGCONNECT_TIMEOUT=10 -e PGTZ=UTC -v "$WORK:/out" "$PG_IMAGE" "$@"; }

step "backup $NAME"
log "manifest (counts only) …"
pgc sh -c 'psql "$PGURL" -X -q -A -t -v ON_ERROR_STOP=1 -c "begin transaction read only;" -c "
select json_build_object(
  '"'"'tables'"'"', (select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'),
  '"'"'marker'"'"', (select environment from deployment_environment where id),
  '"'"'migrations'"'"', (select count(*) from drizzle.__drizzle_migrations),
  '"'"'rows'"'"', json_build_object(
     '"'"'users'"'"', (select count(*) from users), '"'"'orders'"'"', (select count(*) from orders),
     '"'"'journal_entries'"'"', (select count(*) from journal_entries), '"'"'journal_lines'"'"', (select count(*) from journal_lines),
     '"'"'ledger_accounts'"'"', (select count(*) from ledger_accounts), '"'"'files'"'"', (select count(*) from files),
     '"'"'stored_objects'"'"', (select count(*) from stored_objects), '"'"'withdrawal_requests'"'"', (select count(*) from withdrawal_requests),
     '"'"'withdrawal_allocations'"'"', (select count(*) from withdrawal_allocations), '"'"'pricing_versions'"'"', (select count(*) from pricing_versions),
     '"'"'audit_logs'"'"', (select count(*) from audit_logs)),
  '"'"'ledger'"'"', (select json_build_object('"'"'debits'"'"', coalesce(sum(debit),0), '"'"'credits'"'"', coalesce(sum(credit),0)) from journal_lines),
  '"'"'critical'"'"', json_build_object(
     '"'"'pricing_versions'"'"', (select md5(coalesce(string_agg(t::text, '"'"'|'"'"' order by t.id), '"'"''"'"')) from pricing_versions t),
     '"'"'system_settings'"'"', (select md5(coalesce(string_agg(t.key || '"'"'='"'"' || t.value::text, '"'"'|'"'"' order by t.key), '"'"''"'"')) from system_settings t))
);" -c "rollback;" > /out/manifest.json' || stop "could not read the manifest (database unreachable or not migrated)"

log "pg_dump -Fc …"
pgc sh -c 'pg_dump "$PGURL" -Fc -Z 6 --quote-all-identifiers -f /out/db.dump' || stop "pg_dump failed"
pgc sh -c 'pg_restore --list /out/db.dump > /out/list.txt' || stop "dump is not a valid custom-format archive"
DATA_ENTRIES="$(grep -c ' TABLE DATA ' "$WORK/list.txt" || true)"
[ "${DATA_ENTRIES:-0}" -gt 0 ] || stop "dump lists no table data"
PLAIN_SHA="$(sha256sum "$WORK/db.dump" | cut -d' ' -f1)"

log "encrypting ($ENC, public key only) …"
OUT="$EDMN_BACKUP_DIR/$NAME.dump.$ENC"
case "$ENC" in
  age) age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT" "$WORK/db.dump";;
  gpg) gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "$OUT" --encrypt "$WORK/db.dump";;
esac
ENC_SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"
SIZE="$(stat -c %s "$OUT")"
{
  printf '{"name":"%s","created":"%s","reason":"%s","encryption":"%s","file":"%s","bytes":%s,"sha256":"%s","plain_sha256":"%s","table_data_entries":%s,"db":' \
    "$NAME" "$TS" "$REASON" "$ENC" "$(basename "$OUT")" "$SIZE" "$ENC_SHA" "$PLAIN_SHA" "$DATA_ENTRIES"
  tr -d '\n' < "$WORK/manifest.json"; printf '}\n'
} > "$OUT.manifest.json"
(cd "$EDMN_BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$OUT.sha256")
ok "encrypted backup $(basename "$OUT") ($SIZE bytes, $DATA_ENTRIES table-data entries)"

# ── off-server copy ──
LABEL="LOCAL COPY — NOT DISASTER-RECOVERY BACKUP"
if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  log "off-server upload …"
  up_ok=1
  for f in "$OUT" "$OUT.manifest.json" "$OUT.sha256"; do
    bash -c "${BACKUP_UPLOAD_CMD//\{\}/\"$f\"}" >/dev/null 2>&1 || up_ok=0
  done
  if [ "$up_ok" = 1 ]; then LABEL="OFF-SERVER COPY UPLOADED"; ok "uploaded off-server"; else log "✗ off-server upload FAILED"; fi
else
  log "BACKUP_UPLOAD_CMD not configured"
fi

# ── retention (never below KEEP_MIN newest) ──
mapfile -t all < <(ls -1t "$EDMN_BACKUP_DIR"/edmn-*.dump.{age,gpg} 2>/dev/null || true)
i=0
for f in "${all[@]}"; do
  i=$((i + 1))
  [ "$i" -le "$KEEP_MIN" ] && continue
  if [ -n "$(find "$f" -mtime +"$RETENTION" -print 2>/dev/null)" ]; then rm -f "$f" "$f.manifest.json" "$f.sha256"; log "retention: removed $(basename "$f")"; fi
done

state_set backup-status.json "{\"time\":\"$TS\",\"file\":\"$(basename "$OUT")\",\"bytes\":$SIZE,\"sha256\":\"$ENC_SHA\",\"status\":\"$LABEL\"}"
[ "$LABEL" = "OFF-SERVER COPY UPLOADED" ] && [ -n "${BACKUP_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$BACKUP_HEARTBEAT_URL" >/dev/null 2>&1 || true
log "STATUS: $LABEL"
[ "$PRINT" = 1 ] && echo "$OUT" >&3
exit 0
