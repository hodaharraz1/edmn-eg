#!/usr/bin/env bash
# EDMN — SERVER DISCOVERY (the FIRST command to run on the server). READ-ONLY.
#
#   sudo bash server-discovery.sh [--out <dir>]        # default: ./edmn-discovery-<UTC timestamp>/
#
# Writes exactly two files into the output directory and changes NOTHING else on the host:
#   discovery.json   machine-readable report → evaluate offline with: node deploy/scripts/evaluate-server.mjs discovery.json
#   summary.txt      human-readable summary
# It never starts, stops, reloads, installs or edits anything; it never reads env/secret files, never dumps
# databases and never prints credentials: every captured line passes through redact() (passwords, tokens,
# connection strings, private keys, key=value secrets). Without root, items it cannot see are reported "unknown".
set -uo pipefail
umask 077
export LC_ALL=C
OUT=""
[ "${1:-}" = "--out" ] && OUT="${2:-}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${OUT:-$PWD/edmn-discovery-$TS}"
mkdir -p "$OUT" || { echo "cannot create $OUT" >&2; exit 1; }
J="$OUT/discovery.json"; T="$OUT/summary.txt"
ROOT=no; [ "$(id -u)" = 0 ] && ROOT=yes

have() { command -v "$1" >/dev/null 2>&1; }
# Redaction: applied to EVERY captured string before it is written anywhere.
redact() {
  sed -E \
    -e 's#(Bearer|Basic)[[:space:]]+[A-Za-z0-9._~+/=-]+#\1 [REDACTED]#g' \
    -e 's#([a-z][a-z0-9+.-]*://)[^/@[:space:]:]+:[^@[:space:]]+@#\1[REDACTED]@#Ig' \
    -e 's#-----BEGIN [A-Z ]*PRIVATE KEY-----.*#[REDACTED PRIVATE KEY]#g' \
    -e 's#((pass(word|wd)?|secret|token|api[_-]?key|auth|credential|private[_-]?key)[A-Za-z0-9_]*[[:space:]]*[=:][[:space:]]*)[^[:space:],;]+#\1[REDACTED]#Ig'
}
jesc() { redact | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/ /g' | tr -d '\000-\010\013\014\016-\037' | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }
FIRST=1
kv() { # key value  (value is a string; written JSON-escaped)
  local v; v="$(printf '%s' "$2" | jesc)"
  [ $FIRST = 1 ] || printf ',\n' >> "$J"; FIRST=0
  printf '  "%s": "%s"' "$1" "$v" >> "$J"
}
run() { "$@" 2>/dev/null | head -n 200; }
svc() { have systemctl && systemctl is-active "$1" 2>/dev/null | head -1 || echo unknown; }
ver() { have "$1" && { "$@" 2>&1 | head -n1; } || echo absent; }

printf '{\n' > "$J"
kv schema "edmn-discovery/1"
kv generated_at "$TS"
kv run_as_root "$ROOT"
kv hostname "$(hostname 2>/dev/null)"

# ── system ──
. /etc/os-release 2>/dev/null || true
kv os_id "${ID:-unknown}"; kv os_version "${VERSION_ID:-unknown}"; kv os_pretty "${PRETTY_NAME:-unknown}"
kv kernel "$(uname -r)"; kv arch "$(uname -m)"
kv virtualization "$(have systemd-detect-virt && systemd-detect-virt 2>/dev/null || echo unknown)"
kv glibc "$(ldd --version 2>/dev/null | head -n1)"
kv cpu_count "$(nproc 2>/dev/null || echo 0)"
kv cpu_model "$(awk -F: '/model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null | sed 's/^ //')"
kv mem_total_mb "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
kv mem_available_mb "$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
kv swap_total_mb "$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)"
kv load_avg "$(cut -d' ' -f1-3 /proc/loadavg)"
kv root_fs_free_gb "$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc 0-9)"
kv root_fs_size_gb "$(df -BG --output=size / 2>/dev/null | tail -1 | tr -dc 0-9)"
kv root_fs_used_pct "$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc 0-9)"
kv filesystems "$(df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null)"
kv mounts "$(findmnt -rn -o TARGET,SOURCE,FSTYPE 2>/dev/null | grep -Ev '^/(proc|sys|dev|run)' | head -n 60)"
kv var_fs_free_gb "$(df -BG --output=avail /var 2>/dev/null | tail -1 | tr -dc 0-9)"
kv systemd "$(have systemctl && systemctl --version 2>/dev/null | head -n1 || echo absent)"
kv cron "$( (have crond || have cron || [ -d /etc/cron.d ]) && echo present || echo absent)"

# ── runtimes / services ──
DV=absent; if have docker; then DV="$(docker version --format '{{.Server.Version}}' 2>/dev/null | head -n1)"; [ -n "$DV" ] || DV="client-only-or-daemon-unreachable"; fi
kv docker_version "$DV"
kv docker_compose_version "$(have docker && docker compose version --short 2>/dev/null || echo absent)"
kv docker_root_dir "$(have docker && docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo unknown)"
kv docker_containers "$(have docker && docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo unknown)"
kv docker_networks "$(have docker && docker network ls --format '{{.Name}}\t{{.Driver}}' 2>/dev/null || echo unknown)"
kv docker_volumes "$(have docker && docker volume ls --format '{{.Name}}' 2>/dev/null || echo unknown)"
kv podman "$(ver podman --version)"
kv node_version "$(ver node --version)"
kv postgres_version "$( (have postgres && postgres --version) 2>/dev/null || (have psql && psql --version) 2>/dev/null || ls -d /usr/lib/postgresql/* /usr/pgsql-* 2>/dev/null | head -3 || echo absent)"
kv postgres_service "$(svc postgresql)"
kv mysql_version "$( (have mysqld && mysqld --version) 2>/dev/null || (have mysql && mysql --version) 2>/dev/null || echo absent)"
kv mysql_service "$(svc mysqld) / mariadb:$(svc mariadb) / mysql:$(svc mysql)"
kv clamav_version "$(ver clamd --version)"
kv clamav_service "$(svc clamav-daemon) / clamd:$(svc clamd@scan)"
kv apache_version "$( (have httpd && httpd -v) 2>/dev/null | head -n1 || (have apache2 && apache2 -v) 2>/dev/null | head -n1 || echo absent)"
kv apache_service "httpd:$(svc httpd) apache2:$(svc apache2)"
kv nginx_version "$(have nginx && nginx -v 2>&1 | head -n1 || echo absent)"
kv nginx_service "$(svc nginx)"
kv litespeed "$( (have lshttpd || [ -d /usr/local/lsws ]) && echo present || echo absent)"
kv cpanel_version "$( [ -x /usr/local/cpanel/cpanel ] && /usr/local/cpanel/cpanel -V 2>/dev/null | head -n1 || echo absent)"
kv cpanel_accounts_count "$( [ -d /var/cpanel/users ] && ls /var/cpanel/users 2>/dev/null | wc -l || echo 0)"
kv plesk "$( [ -d /usr/local/psa ] && echo present || echo absent)"
kv directadmin "$( [ -d /usr/local/directadmin ] && echo present || echo absent)"

# ── security / network ──
kv firewall_ufw "$(have ufw && { [ $ROOT = yes ] && ufw status 2>/dev/null | head -n 30 || echo 'present (status needs root)'; } || echo absent)"
kv firewall_firewalld "$(have firewall-cmd && firewall-cmd --state 2>/dev/null || echo absent)"
kv firewall_csf "$(have csf && csf -v 2>/dev/null | head -n1 || echo absent)"
kv firewall_iptables_rules "$(have iptables && [ $ROOT = yes ] && iptables -S 2>/dev/null | wc -l || echo unknown)"
kv fail2ban "$(have fail2ban-client && { [ $ROOT = yes ] && fail2ban-client status 2>/dev/null | tr '\n' ' ' || echo present; } || echo absent)"
SSPORTS=""
if have ss; then SSPORTS="$(ss -ltnpH 2>/dev/null | awk '{p=$4; sub(/.*:/,"",p); proc=$6; gsub(/users:\(\(|"|\).*/,"",proc); split(proc,a,","); print p" "$4" "a[1]}' | sort -n -u)"; fi
kv listeners "${SSPORTS:-unknown (ss missing)}"
owner_of() { printf '%s\n' "$SSPORTS" | awk -v p="$1" '$1==p{print $3}' | sort -u | tr '\n' ' ' | sed 's/ $//'; }
kv port_80_owner "$(owner_of 80)"; kv port_443_owner "$(owner_of 443)"; kv port_3000_owner "$(owner_of 3000)"
kv port_5432_owner "$(owner_of 5432)"; kv port_3306_owner "$(owner_of 3306)"; kv port_25_owner "$(owner_of 25)"
kv ssh_port "$( (have sshd && [ $ROOT = yes ] && sshd -T 2>/dev/null | awk '/^port /{print $2}' | tr '\n' ' ') || grep -Ei '^[[:space:]]*Port[[:space:]]' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' || echo unknown)"
kv ssh_password_auth "$( (have sshd && [ $ROOT = yes ] && sshd -T 2>/dev/null | awk '/^passwordauthentication /{print $2}') || echo unknown)"
kv hosting_users "$(awk -F: '$3>=1000 && $3<65000 {print $1" "$7}' /etc/passwd 2>/dev/null | head -n 50)"
kv edmn_user "$(id edmn >/dev/null 2>&1 && echo exists || echo absent)"

# ── mail / dns / tls ──
kv exim "$(svc exim) $(have exim && exim -bV 2>/dev/null | head -n1)"
kv dovecot "$(svc dovecot) $(have dovecot && dovecot --version 2>/dev/null)"
kv postfix "$(svc postfix)"
kv dns_services "named:$(svc named) bind9:$(svc bind9) pdns:$(svc pdns) port53:$(owner_of 53)"
kv certbot "$(ver certbot --version)"
kv letsencrypt_live_names "$( [ $ROOT = yes ] && ls /etc/letsencrypt/live 2>/dev/null | grep -v README || echo unknown)"
kv cpanel_autossl "$( [ -d /var/cpanel/autossl ] || [ -f /var/cpanel/autossl.json ] && echo present || echo absent)"

# ── virtual hosts (names only) and domain references (file paths only, never contents) ──
NGX=""; [ "$(have nginx && echo y)" = y ] && [ $ROOT = yes ] && NGX="$(nginx -T 2>/dev/null)"
kv nginx_server_names "$(printf '%s\n' "$NGX" | grep -E '^[[:space:]]*server_name' | sed 's/^[[:space:]]*//' | sort -u | head -n 100)"
kv nginx_listens "$(printf '%s\n' "$NGX" | grep -E '^[[:space:]]*listen' | sed 's/^[[:space:]]*//' | sort | uniq -c | head -n 40)"
kv nginx_default_server "$(printf '%s\n' "$NGX" | grep -Eq 'default_server' && echo explicit || { [ -n "$NGX" ] && echo implicit || echo unknown; })"
APS=""; for a in apachectl httpd apache2ctl; do have "$a" && { APS="$("$a" -S 2>&1)"; break; }; done
kv apache_vhosts "$(printf '%s\n' "$APS" | grep -E 'namevhost|default server|alias' | sed 's/^[[:space:]]*//' | head -n 100)"
refs() { # files under config roots that mention the host (paths only)
  for d in /etc/nginx /etc/apache2 /etc/httpd /usr/local/apache/conf /usr/local/lsws/conf /var/cpanel/userdata /etc/letsencrypt/renewal /etc/named /var/named; do
    [ -d "$d" ] && grep -rlisF "$1" "$d" 2>/dev/null
  done | head -n 40
  return 0
}
for h in api.edmneg.com www.edmneg.com admin.edmneg.com server.edmneg.com edmneg.com; do
  if [ $ROOT = yes ]; then r="$(refs "$h")"; kv "refs_$(echo "$h" | tr '.' '_')" "${r:-none}"; else kv "refs_$(echo "$h" | tr '.' '_')" 'unknown (needs root)'; fi
done

# ── pressure ──
kv disk_pressure "$(df --output=target,pcent -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR>1{gsub("%","",$2); if ($2+0>=80) print $1" "$2"%"}')"
kv memory_pressure_pct_available "$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{if(t) print int(a*100/t)}' /proc/meminfo)"
printf '\n}\n' >> "$J"

# ── human-readable summary ──
g() { sed -n "s/^  \"$1\": \"\(.*\)\",\{0,1\}$/\1/p" "$J" | sed 's/\\n/; /g'; }
{
  echo "EDMN SERVER DISCOVERY — $TS (root: $ROOT) — read-only, secrets redacted"
  echo "OS:        $(g os_pretty) | kernel $(g kernel) | $(g arch) | virt $(g virtualization)"
  echo "CPU/RAM:   $(g cpu_count) vCPU | RAM $(g mem_total_mb) MB (avail $(g mem_available_mb)) | swap $(g swap_total_mb) MB"
  echo "Disk /:    $(g root_fs_free_gb) GB free of $(g root_fs_size_gb) GB ($(g root_fs_used_pct)% used)"
  echo "Docker:    $(g docker_version) | compose $(g docker_compose_version)"
  echo "Web:       apache [$(g apache_version)] nginx [$(g nginx_version)] litespeed [$(g litespeed)] cPanel [$(g cpanel_version)]"
  echo "Ports:     80→[$(g port_80_owner)] 443→[$(g port_443_owner)] 3000→[$(g port_3000_owner)] 5432→[$(g port_5432_owner)] 25→[$(g port_25_owner)]"
  echo "DB:        postgres [$(g postgres_version)] mysql [$(g mysql_version)]"
  echo "Mail:      exim [$(g exim)] dovecot [$(g dovecot)] postfix [$(g postfix)]"
  echo "Security:  ufw [$(g firewall_ufw | cut -c1-40)] firewalld [$(g firewall_firewalld)] csf [$(g firewall_csf)] fail2ban [$(g fail2ban | cut -c1-40)] ssh port [$(g ssh_port)]"
  echo "TLS:       certbot [$(g certbot)] LE names [$(g letsencrypt_live_names)] autossl [$(g cpanel_autossl)]"
  echo "nginx default_server: $(g nginx_default_server)"
  echo "api.edmneg.com referenced in: $(g refs_api_edmneg_com)"
  echo "Disk pressure (≥80%): $(g disk_pressure)"
  echo
  echo "Next (offline, on your own machine): node deploy/scripts/evaluate-server.mjs $J"
} > "$T"
cat "$T"
echo "report: $J" >&2
