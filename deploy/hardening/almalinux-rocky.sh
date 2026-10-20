#!/usr/bin/env bash
# EDMN — server security baseline for AlmaLinux / Rocky Linux 8 and 9 (also CloudLinux without cPanel).
#
#   sudo ./almalinux-rocky.sh            # DRY RUN (default): prints every command, changes nothing
#   sudo ./almalinux-rocky.sh --apply    # executes, stopping at the first failure
#
# Same contract as ubuntu-debian.sh: never stops/removes/reconfigures Apache, nginx, LiteSpeed, MySQL/MariaDB,
# PostgreSQL, Exim, Dovecot, cPanel/WHM or legacy containers. On cPanel/WHM or CSF servers the firewall and SSH
# steps are skipped (WHM / CSF own them). SELinux is left as configured (never disabled).
set -Eeuo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
SSH_PORT="${SSH_PORT:-$( { command -v sshd >/dev/null 2>&1 && sshd -T 2>/dev/null || true; } | awk '/^port /{print $2; exit}')}"; SSH_PORT="${SSH_PORT:-22}"
act() { local d="$1"; shift; printf '\n# %s\n' "$d"; printf '  %q' "$@"; printf '\n'; [ $APPLY = 1 ] && "$@"; return 0; }
sh_act() { printf '\n# %s\n  %s\n' "$1" "$2"; [ $APPLY = 1 ] && bash -c "$2"; return 0; }
stop() { echo "✗ STOP: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || stop "run with sudo/root"
. /etc/os-release; case "$ID" in almalinux|rocky|rhel|cloudlinux|centos) ;; *) stop "this script is for AlmaLinux/Rocky (found $ID) — use ubuntu-debian.sh";; esac
MANAGED=0
[ -d /usr/local/cpanel ] && { echo "NOTE: cPanel/WHM detected — firewall and SSH policy are WHM/CSF-managed; those steps are skipped"; MANAGED=1; }
command -v csf >/dev/null 2>&1 && { echo "NOTE: CSF detected — firewall step skipped (open ports through CSF only)"; MANAGED=1; }
[ $APPLY = 1 ] && echo "APPLY MODE — make sure a second root SSH session is open." || echo "DRY RUN — nothing will be changed."
command -v getenforce >/dev/null 2>&1 && echo "SELinux: $(getenforce) (left unchanged; Docker volumes use the :Z label only if Enforcing requires it)"

act "1. security updates now" dnf -y upgrade --security
act "1. automatic security updates" dnf install -y dnf-automatic
sh_act "1. dnf-automatic: security only, apply, no reboot" "sed -i -e 's/^upgrade_type.*/upgrade_type = security/' -e 's/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf"
act "1. enable timer" systemctl enable --now dnf-automatic.timer
act "1. EPEL (fail2ban, age)" dnf install -y epel-release

id edmn >/dev/null 2>&1 || act "2. dedicated service user (no password, no sudo)" useradd --system --create-home --home-dir /opt/edmn --shell /sbin/nologin edmn

if [ $MANAGED = 0 ]; then
  ADMIN_USER="${SUDO_USER:-root}"
  KEYS="$(getent passwd "$ADMIN_USER" | cut -d: -f6)/.ssh/authorized_keys"
  if [ ! -s "$KEYS" ]; then
    [ $APPLY = 1 ] && stop "no SSH key in $KEYS for $ADMIN_USER — refusing to disable password login (lock-out risk)"
    echo "WARNING (dry run): no SSH key in $KEYS — --apply would STOP here (lock-out protection)"
  fi
  sh_act "3. SSH: key-only (drop-in; RHEL 9 includes sshd_config.d, RHEL 8 needs the Include line)" "mkdir -p /etc/ssh/sshd_config.d && grep -q '^Include /etc/ssh/sshd_config.d/' /etc/ssh/sshd_config || sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config; printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nChallengeResponseAuthentication no\nPermitRootLogin prohibit-password\nPubkeyAuthentication yes\nMaxAuthTries 4\nLoginGraceTime 30\nX11Forwarding no\n' > /etc/ssh/sshd_config.d/60-edmn-hardening.conf"
  act "3. validate sshd configuration BEFORE reload" sshd -t
  act "3. reload sshd" systemctl reload sshd

  act "4. firewalld" dnf install -y firewalld
  act "4. start firewalld" systemctl enable --now firewalld
  act "4. SSH" firewall-cmd --permanent --add-port="$SSH_PORT/tcp"
  act "4. HTTP" firewall-cmd --permanent --add-service=http
  act "4. HTTPS" firewall-cmd --permanent --add-service=https
  for p in $(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Ev '^(127\.|\[::1\]|::1)' | sed 's/.*://' | sort -un); do
    case "$p" in 22|80|443|"$SSH_PORT") ;; *) act "4. keep existing listener :$p reachable (legacy service)" firewall-cmd --permanent --add-port="$p/tcp";; esac
  done
  act "4. apply firewall" firewall-cmd --reload

  act "5. fail2ban" dnf install -y fail2ban fail2ban-firewalld
  sh_act "5. sshd jail" "printf '[sshd]\nenabled = true\nport = $SSH_PORT\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n' > /etc/fail2ban/jail.d/edmn-sshd.local"
  act "5. start fail2ban" systemctl enable --now fail2ban
fi

if ! command -v docker >/dev/null 2>&1; then
  command -v podman >/dev/null 2>&1 && echo "NOTE: podman is installed; Docker CE is installed alongside (podman-docker shim must not be used for compose)"
  act "6. dnf plugins" dnf install -y dnf-plugins-core
  act "6. Docker CE repository (official, RHEL-compatible)" dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  act "6. Docker Engine + Compose plugin" dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "# 6. Docker already installed: $(docker --version) — not touched"
fi
sh_act "8. Docker default log rotation (only if no daemon.json exists — never overwrite)" "mkdir -p /etc/docker; [ -e /etc/docker/daemon.json ] || printf '{\n  \"log-driver\": \"json-file\",\n  \"log-opts\": { \"max-size\": \"50m\", \"max-file\": \"5\" },\n  \"live-restore\": true\n}\n' > /etc/docker/daemon.json"
act "6. Docker enabled at boot" systemctl enable --now docker
act "6. backup encryption tool (public-key)" dnf install -y age

act "7. release dir" install -d -o edmn -g edmn -m 0750 /opt/edmn
act "7. secrets dir" install -d -o root -g edmn -m 0750 /etc/edmn
act "7. state dir" install -d -o root -g root -m 0750 /var/lib/edmn
act "7. backups dir" install -d -o root -g root -m 0700 /var/backups/edmn
act "7. ACME webroot" install -d -o root -g root -m 0755 /var/www/letsencrypt
sh_act "7. env file permissions (root:edmn 0640; cron-header 0600 root)" "for f in /etc/edmn/*.env; do [ -e \"\$f\" ] && chown root:edmn \"\$f\" && chmod 0640 \"\$f\"; done; [ -e /etc/edmn/cron-header ] && chown root:root /etc/edmn/cron-header && chmod 0600 /etc/edmn/cron-header; true"
sh_act "7. journald retention" "mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nStorage=persistent\nSystemMaxUse=1G\n' > /etc/systemd/journald.conf.d/edmn.conf && systemctl restart systemd-journald"
sh_act "9. install systemd units (NOT enabled until the first deploy succeeded)" "cp /opt/edmn/deploy/systemd/edmn-*.service /opt/edmn/deploy/systemd/edmn-*.timer /etc/systemd/system/ && systemctl daemon-reload"
echo
echo "# After the first successful deploy:  systemctl enable --now edmn-watch.timer edmn-backup.timer edmn-tick.timer"
echo "# Done ($([ $APPLY = 1 ] && echo applied || echo 'dry run — re-run with --apply'))."
