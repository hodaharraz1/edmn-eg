#!/usr/bin/env bash
# EDMN — LEGACY SAFETY PRE-DEPLOY CHECK (read-only discovery).
#
#   sudo preflight-legacy.sh [--report-dir /var/lib/edmn]
#
# Discovers what already runs on the server and STOPS (exit 1) unless it can PROVE that installing EDMN does not
# conflict with it. It only READS: it never stops, restarts, reloads, edits or deletes Apache, nginx, LiteSpeed,
# MySQL/MariaDB, PostgreSQL, Exim, Dovecot, Postfix, cPanel/WHM services, legacy containers or legacy apps.
#
# Detects: OS/glibc/resources, TCP listeners + owners, Docker containers/networks/volumes, Apache/nginx/LiteSpeed
# and their virtual hosts, every config file mentioning api.edmneg.com (sha256 baseline for "untouched" proof),
# mail services, PostgreSQL/MySQL, cPanel/WHM, firewall, disk mounts.
# Output: a timestamped report + legacy-baseline.sha256 (re-checked by watch.sh: api.edmneg.com config unchanged).
set -uo pipefail
umask 077
REPORT_DIR="${EDMN_STATE:-/var/lib/edmn}"
[ "${1:-}" = "--report-dir" ] && REPORT_DIR="$2"
WEB_PORT="${EDMN_WEB_PORT:-3000}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$REPORT_DIR"
R="$REPORT_DIR/legacy-preflight-$TS.txt"
STOPS=(); NOTES=()
blk() { STOPS+=("$*"); }
note() { NOTES+=("$*"); }
sec() { printf '\n## %s\n' "$*" >> "$R"; }
run() { { printf '$ %s\n' "$*"; "$@" 2>&1 | head -n 400; } >> "$R" || true; }
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(id -u)" = 0 ] || { echo "✗ STOP: run as root (read-only, but full visibility of listeners and configs is required to prove no conflict)" >&2; exit 1; }
echo "# EDMN legacy preflight $TS (read-only)" > "$R"

sec "OS / resources"
run cat /etc/os-release
run uname -r
have ldd && run ldd --version
run nproc
run free -m
run df -hT -x tmpfs -x devtmpfs
have findmnt && run findmnt -n -o TARGET,SOURCE,FSTYPE,OPTIONS /
mem_mb="$(free -m | awk '/^Mem:/{print $2}')"
[ "${mem_mb:-0}" -ge 3500 ] || note "RAM ${mem_mb} MB: below the 4 GB recommended for web+worker+postgres (+3 GB for ClamAV)"
root_free_gb="$(df -BG --output=avail / | tail -1 | tr -dc 0-9)"
[ "${root_free_gb:-0}" -ge 20 ] || blk "less than 20 GB free on / (${root_free_gb} GB)"

sec "cPanel / WHM"
CPANEL=no
if [ -d /usr/local/cpanel ]; then CPANEL=yes; run /usr/local/cpanel/cpanel -V; note "cPanel/WHM detected: use the Apache userdata include (deploy/proxy/apache), never the nginx template, never edit httpd.conf"; fi
echo "cpanel=$CPANEL" >> "$R"

sec "TCP listeners"
if have ss; then run ss -ltnpH; LISTEN="$(ss -ltnpH 2>/dev/null)"; else LISTEN=""; blk "ss not available — cannot enumerate listeners"; fi
port_owner() { echo "$LISTEN" | awk -v p=":$1" '$4 ~ p"$" {print $0}' | head -n3; }
[ -n "$LISTEN" ] && for p in 80 443; do
  o="$(port_owner $p)"
  if [ -z "$o" ]; then note "port $p is free: a reverse proxy (nginx) must be installed for EDMN — decide with Kntabo"; else
    case "$o" in *nginx*|*httpd*|*apache2*|*litespeed*|*lshttpd*) note "port $p owned by an existing web server → integrate via a vhost/include only";;
      *) blk "port $p is owned by an unknown process: $(echo "$o" | awk '{print $NF}')";; esac
  fi
done
o="$(port_owner "$WEB_PORT")"
if [ -n "$o" ] && ! echo "$o" | grep -q docker-proxy; then blk "EDMN app port $WEB_PORT is already used by: $(echo "$o" | awk '{print $NF}') (set EDMN_WEB_PORT to a free loopback port)"; fi
for p in 25 465 587 110 143 993 995 3306 5432 2082 2083 2086 2087 2095 2096; do
  o="$(port_owner $p)"; [ -n "$o" ] && echo "legacy listener :$p → $(echo "$o" | awk '{print $NF}')" >> "$R"
done

sec "Docker"
if have docker; then
  run docker version --format '{{.Server.Version}}'
  run docker compose version
  run docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  run docker network ls
  run docker volume ls
  docker ps -a --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -v '^edmn-' | grep -q "127.0.0.1:$WEB_PORT->\|0.0.0.0:$WEB_PORT->" && blk "a non-EDMN container publishes port $WEB_PORT"
  if docker volume inspect edmn_edmn_pgdata >/dev/null 2>&1 && [ ! -f "$REPORT_DIR/current_tag" ]; then blk "volume edmn_edmn_pgdata already exists before the first deploy — refusing to adopt unknown data"; fi
  docker ps -a --format '{{.Names}}' | grep -v '^edmn-' | sed 's/^/legacy container (left untouched): /' >> "$R"
else
  note "Docker is not installed (runbook: deploy/hardening/*.sh --apply installs it; Kntabo must allow it)"
fi

sec "Web servers and virtual hosts"
NGINX_DUMP=""; APACHE_DUMP=""
if have nginx; then NGINX_DUMP="$(nginx -T 2>/dev/null || true)"; printf '%s\n' "$NGINX_DUMP" | grep -E '^\s*(server_name|listen)\b' >> "$R"; fi
for a in apachectl httpd apache2ctl; do if have "$a"; then APACHE_DUMP="$("$a" -S 2>&1 || true)"; printf '%s\n' "$APACHE_DUMP" >> "$R"; break; fi; done
have lshttpd && note "LiteSpeed detected: the Apache include syntax applies (LiteSpeed reads Apache config) — verify with Kntabo"
for name in www.edmneg.com edmneg.com admin.edmneg.com; do
  if printf '%s\n%s\n' "$NGINX_DUMP" "$APACHE_DUMP" | grep -Eiq "(server_name|namevhost|alias)[^#]*[[:space:]]$name([[:space:];]|$)"; then
    note "a virtual host for $name already exists (legacy site?) — the cutover must replace ONLY its proxying, after approval"
  fi
done
# nginx answers an unknown Host with the port's default server: an explicit default_server, else the FIRST block.
# Without an explicit default, adding any server block could change who answers hosts served "by default"
# (possibly api.edmneg.com) — that cannot be proven safe, so STOP and let Kntabo confirm/add an explicit default.
if [ -n "$NGINX_DUMP" ]; then
  for p in 80 443; do
    if printf '%s\n' "$NGINX_DUMP" | grep -Eq "^[[:space:]]*listen[[:space:]]+([^;]*:)?$p([[:space:]]|;)"; then
      printf '%s\n' "$NGINX_DUMP" | grep -Eq "^[[:space:]]*listen[[:space:]]+([^;]*:)?$p[^;]*default_server" \
        || blk "nginx has server blocks on :$p but no explicit default_server — installing EDMN could change which site answers unknown hosts (incl. api.edmneg.com); Kntabo must confirm an explicit default first"
    fi
  done
fi
if [ -n "$APACHE_DUMP" ]; then
  printf '%s\n' "$APACHE_DUMP" | grep -Ei 'default server' >> "$R"
  note "Apache: record the 'default server' lines above; after installing the EDMN include they must be IDENTICAL (apachectl -S)"
fi
if printf '%s\n' "$NGINX_DUMP" | grep -Eq 'server_name[^;]*\*\.edmneg\.com'; then note "a wildcard *.edmneg.com nginx server exists — EDMN uses exact names only (more specific wins)"; fi

sec "api.edmneg.com — configuration baseline (must remain untouched)"
BASE="$REPORT_DIR/legacy-baseline.sha256"
: > "$BASE.new"
for d in /etc/nginx /etc/apache2 /etc/httpd /usr/local/apache/conf /usr/local/lsws/conf /var/cpanel/userdata /etc/letsencrypt/renewal; do
  [ -d "$d" ] && grep -rlis 'api\.edmneg\.com' "$d" 2>/dev/null | while read -r f; do sha256sum "$f" >> "$BASE.new"; done
done
if [ -s "$BASE.new" ]; then mv "$BASE.new" "$BASE"; echo "api.edmneg.com config files: $(wc -l < "$BASE")" >> "$R"; cat "$BASE" >> "$R"
else rm -f "$BASE.new"; note "no local config mentions api.edmneg.com (it may be hosted elsewhere — confirm with Kntabo)"; fi

sec "Mail services (never touched)"
for s in exim postfix dovecot cpanel cpsrvd mailman spamd; do
  have systemctl && st="$(systemctl is-active "$s" 2>/dev/null || true)" && [ "$st" = active ] && echo "service $s: active" >> "$R"
done

sec "Databases (never touched)"
for s in postgresql mysql mysqld mariadb; do
  have systemctl && [ "$(systemctl is-active "$s" 2>/dev/null || true)" = active ] && echo "service $s: active" >> "$R"
done
echo "$LISTEN" | grep -q ':5432 ' && note "a PostgreSQL already listens on 5432 — EDMN's postgres publishes no port (no conflict); never reuse the legacy instance"

sec "Firewall"
have csf && { run csf -v; note "CSF/LFD detected: open ports through CSF only (hardening scripts stop instead of enabling ufw/firewalld)"; }
have ufw && run ufw status verbose
have firewall-cmd && run firewall-cmd --state
have fail2ban-client && run fail2ban-client status

sec "RESULT"
for n in "${NOTES[@]}"; do echo "NOTE: $n" | tee -a "$R"; done
if [ "${#STOPS[@]}" -gt 0 ]; then
  for s in "${STOPS[@]}"; do echo "✗ STOP: $s" | tee -a "$R" >&2; done
  echo "Report: $R" >&2
  exit 1
fi
echo "✓ no conflict found by read-only discovery (report: $R). Nothing was stopped or modified." | tee -a "$R"
