#!/usr/bin/env bash
# PKG-INFRA-01 — restore to a point in time (the restore drill). Never run against the live PGDATA:
# it always restores into $RESTORE_DIR and starts a throwaway PostgreSQL on $RESTORE_PORT.
#
#   ./restore-pitr.sh 2026-11-27T09:00:00Z          # point in time
#   ./restore-pitr.sh latest                        # newest base backup, replay all WAL
#
# Proof to record (docs/runbooks/BACKUP_RESTORE.md): the printed row counts and `ledger:check` result.
set -euo pipefail
TARGET=${1:?usage: restore-pitr.sh <ISO timestamp|latest>}
RESTORE_DIR=${RESTORE_DIR:-/var/lib/edmn/restore-drill}
RESTORE_PORT=${RESTORE_PORT:-55432}
WALG=/usr/local/bin/wal-g
set -a; . /etc/default/walg; set +a

rm -rf "$RESTORE_DIR" && mkdir -p "$RESTORE_DIR" && chown postgres:postgres "$RESTORE_DIR"
if [ "$TARGET" = latest ]; then
  sudo -u postgres "$WALG" backup-fetch "$RESTORE_DIR" LATEST
else
  sudo -u postgres "$WALG" backup-fetch "$RESTORE_DIR" LATEST   # newest base, then replay to TARGET
fi

cat > "$RESTORE_DIR/postgresql.auto.conf" <<EOF
restore_command = '$WALG wal-fetch %f %p'
recovery_target_time = '${TARGET}'
recovery_target_action = 'promote'
EOF
touch "$RESTORE_DIR/recovery.signal"
chown postgres:postgres "$RESTORE_DIR/postgresql.auto.conf"

sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D "$RESTORE_DIR" -o "-p $RESTORE_PORT" -w start
sleep 2
psql -p "$RESTORE_PORT" -d postgres -c 'select now() as restored_at, pg_is_in_recovery() as still_replaying;'
psql -p "$RESTORE_PORT" -d postgres -c 'select count(*) as journal_entries from journal_entries;' || true
echo "restore drill finished — stop it with: sudo -u postgres pg_ctl -D $RESTORE_DIR stop"
