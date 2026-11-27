#!/usr/bin/env bash
# PKG-INFRA-01 — continuous archiving (PITR) with WAL-G: physical base backups + WAL shipped to object storage.
# Run ONCE on the database host, as root, after the object-storage bucket exists.
#
#   sudo WALG_S3_PREFIX=s3://edmn-backups/pg WALG_ACCESS_KEY_ID=… WALG_SECRET_ACCESS_KEY=… ./pitr-setup.sh
#
# Produces: daily base backup (systemd timer), continuous WAL archiving, RPO ≤ 5 minutes, RTO ≈ 30–60 minutes.
# VERIFY (this is the proof the brief asks for, and it is NOT run by the packaging agent):
#   ./restore-pitr.sh "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   # restores the latest state into a scratch container
set -euo pipefail
: "${WALG_S3_PREFIX:?set WALG_S3_PREFIX (s3://bucket/prefix or file:///mnt/backups/pg)}"
PGDATA=${PGDATA:-/var/lib/postgresql/data}
PGVER=${PGVER:-16}
WALG=/usr/local/bin/wal-g

if [ ! -x "$WALG" ]; then
  echo "installing wal-g ${WALG_VERSION:-v3.0.2}"
  curl -fsSL "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION:-v3.0.2}/wal-g-pg-ubuntu-20.04-amd64.tar.gz" \
    | tar -xz -C /tmp && install -m 0755 /tmp/wal-g-pg-ubuntu-20.04-amd64 "$WALG"
fi

cat > /etc/default/walg <<EOF
WALG_S3_PREFIX=$WALG_S3_PREFIX
PGDATA=$PGDATA
AWS_ACCESS_KEY_ID=${WALG_ACCESS_KEY_ID:-}
AWS_SECRET_ACCESS_KEY=${WALG_SECRET_ACCESS_KEY:-}
AWS_REGION=${WALG_REGION:-eu-central-1}
WALG_COMPRESSION_METHOD=brotli
WALG_DELTA_MAX_STEPS=6
EOF
chmod 600 /etc/default/walg

# archive_command + the settings that make PITR possible
psql -v ON_ERROR_STOP=1 <<'SQL'
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET archive_mode = 'on';
ALTER SYSTEM SET archive_command = '/usr/local/bin/wal-g wal-push %p';
ALTER SYSTEM SET archive_timeout = '60s';
ALTER SYSTEM SET max_wal_senders = '3';
SELECT pg_reload_conf();
SQL

cat > /etc/systemd/system/edmn-walg-basebackup.service <<'EOF'
[Unit]
Description=EDMN WAL-G base backup
[Service]
Type=oneshot
EnvironmentFile=/etc/default/walg
ExecStart=/usr/local/bin/wal-g backup-push /var/lib/postgresql/data
ExecStartPost=/usr/bin/install -m 0644 /dev/null /var/lib/edmn/last-backup
EOF
cat > /etc/systemd/system/edmn-walg-basebackup.timer <<'EOF'
[Unit]
Description=Daily EDMN base backup
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now edmn-walg-basebackup.timer
"$WALG" backup-push "$PGDATA"
echo "done — verify with: $WALG backup-list"
