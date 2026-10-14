# EDMN deployment — shared helpers (sourced, never executed directly).
# Conventions: every step prints "▶ STEP", every failure prints "✗ STOP: <reason>" and exits non-zero.
# Nothing here prints secret values: env files are read by docker compose, never echoed.

set -Eeuo pipefail
umask 077

EDMN_HOME="${EDMN_HOME:-/opt/edmn}"                         # release checkout (contains deploy/ and drizzle/)
EDMN_ETC="${EDMN_ETC:-/etc/edmn}"                            # production.env, migrate.env, postgres.env, scanner.env, backup.env, compose.env
EDMN_STATE="${EDMN_STATE:-/var/lib/edmn}"                    # current/previous release tags, backup + watch status
EDMN_BACKUP_DIR="${EDMN_BACKUP_DIR:-/var/backups/edmn}"
COMPOSE_FILE="${COMPOSE_FILE:-$EDMN_HOME/deploy/compose/docker-compose.prod.yml}"
COMPOSE_ENV="${COMPOSE_ENV:-$EDMN_ETC/compose.env}"         # non-secret: EDMN_IMAGE, EDMN_WEB_PORT, profiles…
WEB_PORT="${EDMN_WEB_PORT:-3000}"
PUBLIC_HOST="${EDMN_PUBLIC_HOST:-www.edmneg.com}"
ADMIN_HOST_NAME="${EDMN_ADMIN_HOST:-admin.edmneg.com}"

log()  { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*"; }
step() { printf '\n%s  ▶ %s\n' "$(date -u +%FT%TZ)" "$*"; }
ok()   { printf '%s  ✓ %s\n' "$(date -u +%FT%TZ)" "$*"; }
stop() { printf '%s  ✗ STOP: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; exit 1; }

# docker compose with the production file, the non-secret compose env and the release tag.
dc() {
  local args=(-f "$COMPOSE_FILE")
  [ -f "$COMPOSE_ENV" ] && args+=(--env-file "$COMPOSE_ENV")
  docker compose "${args[@]}" "$@"
}

require_cmd() { for c in "$@"; do command -v "$c" >/dev/null 2>&1 || stop "required command not found: $c"; done; }

# A secret file must exist, be a regular file, and not be readable by group/other (0600 or 0640 root:edmn).
require_secret_file() {
  local f="$1" mode
  [ -f "$f" ] || stop "missing $f"
  mode="$(stat -c '%a' "$f")"
  case "$mode" in 600|640|400|440) ;; *) stop "$f has mode $mode (expected 600 or 640)";; esac
}

# Value of NAME in an env file WITHOUT printing it (used only for non-secret checks such as EDMN_ENVIRONMENT).
env_value() { sed -n "s/^$2=//p" "$1" | tail -n1 | sed 's/^"\(.*\)"$/\1/'; }
env_has()   { grep -Eq "^$2=.+" "$1"; }

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

state_get() { cat "$EDMN_STATE/$1" 2>/dev/null || true; }
state_set() { mkdir -p "$EDMN_STATE"; printf '%s\n' "$2" > "$EDMN_STATE/$1.tmp" && mv "$EDMN_STATE/$1.tmp" "$EDMN_STATE/$1"; }

# GET through the loopback port with the real Host header; prints the HTTP status only.
http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: $1" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$WEB_PORT$2" || echo 000; }

wait_http() { # host path expected-status timeout-seconds
  local deadline=$(( $(date +%s) + $4 )) s
  while :; do
    s="$(http_status "$1" "$2")"
    [ "$s" = "$3" ] && return 0
    [ "$(date +%s)" -ge "$deadline" ] && { log "last status for $2: $s"; return 1; }
    sleep 3
  done
}
