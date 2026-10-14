#!/usr/bin/env bash
# EDMN — server security baseline for Ubuntu 22.04/24.04 and Debian 12.
#
#   sudo ./ubuntu-debian.sh            # DRY RUN (default): prints every command, changes nothing
#   sudo ./ubuntu-debian.sh --apply    # executes, step by step, stopping at the first failure
#
# NOT executed by the EDMN team without Kntabo/owner approval and an open second SSH session (lock-out safety).
# Legacy-safe: never stops, removes or reconfigures Apache, nginx, MySQL/MariaDB, PostgreSQL, Exim, Dovecot,
# Postfix, cPanel/WHM or any existing container. On a cPanel/WHM or CSF-managed server the firewall and SSH steps
# STOP (they belong to WHM / CSF) and only the EDMN-specific steps are offered.
#
# Steps: 1 updates + unattended security upgrades  2 dedicated `edmn` user  3 SSH key-only (drop-in, validated)
#        4 firewall (ufw: SSH, 80, 443 — plus every port already listening for mail/cPanel, never closed)
#        5 fail2ban (sshd jail)  6 Docker Engine + Compose plugin (official repo)  7 directories, ownership and
#        permissions (/opt/edmn, /etc/edmn 0750, *.env 0640, /var/lib/edmn, /var/backups/edmn 0700, logs)
#        8 Docker log rotation defaults  9 systemd timers (installed, enabled only after the first deploy)
set -Eeuo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
SSH_PORT="${SSH_PORT:-$( { command -v sshd >/dev/null 2>&1 && sshd -T 2>/dev/null || true; } | awk '/^port /{print $2; exit}')}"; SSH_PORT="${SSH_PORT:-22}"
act() { local d="$1"; shift; printf '\n# %s\n' "$d"; printf '  %q' "$@"; printf '\n'; [ $APPLY = 1 ] && "$@"; return 0; }
sh_act() { printf '\n# %s\n  %s\n' "$1" "$2"; [ $APPLY = 1 ] && bash -c "$2"; return 0; }
stop() { echo "✗ STOP: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || stop "run with sudo/root"
. /etc/os-release; case "$ID" in ubuntu|debian) ;; *) stop "this script is for Ubuntu/Debian (found $ID) — use almalinux-rocky.sh";; esac
MANAGED=0
[ -d /usr/local/cpanel ] && { echo "NOTE: cPanel/WHM detected — firewall and SSH policy are WHM/CSF-managed; those steps are skipped"; MANAGED=1; }
command -v csf >/dev/null 2>&1 && { echo "NOTE: CSF detected — firewall step skipped (open ports through CSF only)"; MANAGED=1; }
[ $APPLY = 1 ] && echo "APPLY MODE — make sure a second root SSH session is open." || echo "DRY RUN — nothing will be changed."

act "1. package updates" apt-get update
act "1. security upgrades now" apt-get -y upgrade
act "1. unattended security upgrades" apt-get install -y unattended-upgrades apt-listchanges
sh_act "1. enable unattended upgrades (security only, no automatic reboot)" "printf 'APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\n' > /etc/apt/apt.conf.d/20auto-upgrades"

id edmn >/dev/null 2>&1 || act "2. dedicated service user (no password, no sudo)" useradd --system --create-home --home-dir /opt/edmn --shell /usr/sbin/nologin edmn

if [ $MANAGED = 0 ]; then
  ADMIN_USER="${SUDO_USER:-root}"
  KEYS="$(getent passwd "$ADMIN_USER" | cut -d: -f6)/.ssh/authorized_keys"
  if [ ! -s "$KEYS" ]; then
    [ $APPLY = 1 ] && stop "no SSH key in $KEYS for $ADMIN_USER — refusing to disable password login (lock-out risk)"
    echo "WARNING (dry run): no SSH key in $KEYS — --apply would STOP here (lock-out protection)"
  fi
  sh_act "3. SSH: key-only, no root password login (drop-in)" "printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\nPubkeyAuthentication yes\nMaxAuthTries 4\nLoginGraceTime 30\nX11Forwarding no\n' > /etc/ssh/sshd_config.d/60-edmn-hardening.conf"
  act "3. validate sshd configuration BEFORE reload" sshd -t
  act "3. reload sshd (existing sessions stay open)" systemctl reload ssh

  act "4. firewall package" apt-get install -y ufw
  act "4. default deny incoming" ufw default deny incoming
  act "4. default allow outgoing" ufw default allow outgoing
  act "4. SSH" ufw allow "$SSH_PORT/tcp"
  act "4. HTTP (ACME + redirect)" ufw allow 80/tcp
  act "4. HTTPS" ufw allow 443/tcp
  # Never close a port something already serves (mail, legacy apps): keep every current public listener open.
  for p in $(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Ev '^(127\.|\[::1\]|::1)' | sed 's/.*://' | sort -un); do
    case "$p" in 22|80|443|"$SSH_PORT") ;; *) act "4. keep existing listener :$p reachable (legacy service)" ufw allow "$p/tcp";; esac
  done
  echo "  NOTE: Docker-published ports bypass ufw — EDMN publishes only 127.0.0.1:3000, so nothing is exposed."
  act "4. enable firewall" ufw --force enable

  act "5. fail2ban" apt-get install -y fail2ban
  sh_act "5. sshd jail" "printf '[sshd]\nenabled = true\nport = $SSH_PORT\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n' > /etc/fail2ban/jail.d/edmn-sshd.local"
  act "5. start fail2ban" systemctl enable --now fail2ban
fi

if ! command -v docker >/dev/null 2>&1; then
  act "6. Docker prerequisites" apt-get install -y ca-certificates curl gnupg
  act "6. Docker apt keyring dir" install -m 0755 -d /etc/apt/keyrings
  sh_act "6. Docker GPG key" "curl -fsSL https://download.docker.com/linux/$ID/gpg -o /etc/apt/keyrings/docker.asc && chmod a+r /etc/apt/keyrings/docker.asc"
  sh_act "6. Docker repository" "echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID \$VERSION_CODENAME stable\" > /etc/apt/sources.list.d/docker.list"
  act "6. refresh" apt-get update
  act "6. Docker Engine + Compose plugin" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "# 6. Docker already installed: $(docker --version) — not touched"
fi
sh_act "8. Docker default log rotation (only if no daemon.json exists — never overwrite)" "[ -e /etc/docker/daemon.json ] || printf '{\n  \"log-driver\": \"json-file\",\n  \"log-opts\": { \"max-size\": \"50m\", \"max-file\": \"5\" },\n  \"live-restore\": true\n}\n' > /etc/docker/daemon.json"
act "6. Docker enabled at boot" systemctl enable --now docker
act "6. backup encryption tool (public-key)" apt-get install -y age

act "7. release dir" install -d -o edmn -g edmn -m 0750 /opt/edmn
act "7. secrets dir" install -d -o root -g edmn -m 0750 /etc/edmn
act "7. state dir" install -d -o root -g root -m 0750 /var/lib/edmn
act "7. backups dir" install -d -o root -g root -m 0700 /var/backups/edmn
act "7. ACME webroot" install -d -o root -g root -m 0755 /var/www/letsencrypt
sh_act "7. env file permissions (root:edmn 0640; cron-header 0600 root)" "for f in /etc/edmn/*.env; do [ -e \"\$f\" ] && chown root:edmn \"\$f\" && chmod 0640 \"\$f\"; done; [ -e /etc/edmn/cron-header ] && chown root:root /etc/edmn/cron-header && chmod 0600 /etc/edmn/cron-header; true"
sh_act "7. journald retention (persistent, capped)" "mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nStorage=persistent\nSystemMaxUse=1G\n' > /etc/systemd/journald.conf.d/edmn.conf && systemctl restart systemd-journald"

sh_act "9. install systemd units (NOT enabled until the first deploy succeeded)" "cp /opt/edmn/deploy/systemd/edmn-*.service /opt/edmn/deploy/systemd/edmn-*.timer /etc/systemd/system/ && systemctl daemon-reload"
echo
echo "# After the first successful deploy:  systemctl enable --now edmn-watch.timer edmn-backup.timer edmn-tick.timer"
echo "# Done ($([ $APPLY = 1 ] && echo applied || echo 'dry run — re-run with --apply'))."
