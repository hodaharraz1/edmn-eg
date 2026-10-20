#!/usr/bin/env bash
# EDMN — local monitoring (zero-cost-first). systemd edmn-watch.timer runs it every 5 minutes.
#
#   watch.sh [--json]
#
# Checks (each needs EVIDENCE; a check that cannot be measured is UNKNOWN, and UNKNOWN is never reported HEALTHY):
#   containers   Docker health of web, worker (+ postgres / clamd / scanner when their profile runs)
#   host         disk usage (/, Docker root, backups), available RAM, load vs CPUs
#   app          /api/ready through the loopback port
#   worker       heartbeat age, failing schedules, latest ledger-health status, dead letters (worker-health.mjs)
#   backups      latest backup age ≤ 26 h AND off-server copy; restore drill ≤ 35 days old
#   legacy       api.edmneg.com config files unchanged since the preflight baseline (sha256)
# Overall: HEALTHY (all OK) | DEGRADED (warnings) | UNKNOWN (missing evidence) | CRITICAL (failures).
# External integration points (optional, /etc/edmn/monitor.env, all free tiers suffice):
#   WATCH_HEARTBEAT_URL   pinged ONLY when HEALTHY (dead-man's switch, e.g. healthchecks.io) → silence = alert
#   WATCH_ALERT_URL       JSON POST on CRITICAL/UNKNOWN (generic webhook: Slack/Discord/ntfy relay)
#   Uptime monitor        external HTTP check of https://www.edmneg.com/api/ready (UptimeRobot / Better Stack)
#   Error tracking        ERROR_TRACKING_DSN in production.env (Sentry free tier)
source "$(dirname "$0")/lib.sh"
set +e
[ -f "$EDMN_ETC/monitor.env" ] && { set -a; source "$EDMN_ETC/monitor.env"; set +a; }

declare -a LINES=()
WORST=0   # 0 OK, 1 WARN, 2 UNKNOWN, 3 CRIT (a failure outranks missing evidence)
res() { # level name detail
  local lv="$1"; LINES+=("$(printf '%-7s %-22s %s' "$1" "$2" "$3")")
  case "$lv" in WARN) [ $WORST -lt 1 ] && WORST=1;; UNKNOWN) [ $WORST -lt 2 ] && WORST=2;; CRIT) WORST=3;; esac
}

# containers
for svc in web worker postgres clamd scanner; do
  cid="$(dc ps -q "$svc" 2>/dev/null)"
  if [ -z "$cid" ]; then
    case "$svc" in web|worker) res CRIT "container:$svc" "not running";; esac
    continue
  fi
  h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null)"
  case "$h" in healthy) res OK "container:$svc" healthy;; starting) res WARN "container:$svc" starting;; *) res CRIT "container:$svc" "${h:-unknown}";; esac
done

# host
for m in / "$(docker info -f '{{.DockerRootDir}}' 2>/dev/null)" "$EDMN_BACKUP_DIR"; do
  [ -n "$m" ] && [ -d "$m" ] || continue
  pct="$(df -P "$m" | awk 'NR==2{gsub("%","",$5); print $5}')"
  if [ -z "$pct" ]; then res UNKNOWN "disk:$m" "unmeasured"; elif [ "$pct" -ge 90 ]; then res CRIT "disk:$m" "${pct}% used"; elif [ "$pct" -ge 80 ]; then res WARN "disk:$m" "${pct}% used"; else res OK "disk:$m" "${pct}% used"; fi
done
avail="$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
if [ -z "$avail" ]; then res UNKNOWN memory unmeasured; elif [ "$avail" -lt 256 ]; then res CRIT memory "${avail} MB available"; elif [ "$avail" -lt 512 ]; then res WARN memory "${avail} MB available"; else res OK memory "${avail} MB available"; fi
load="$(cut -d' ' -f1 /proc/loadavg)"; cpus="$(nproc)"
if awk -v l="$load" -v c="$cpus" 'BEGIN{exit !(l > c*2)}'; then res WARN cpu "load $load on $cpus CPUs"; else res OK cpu "load $load on $cpus CPUs"; fi

# app
s="$(http_status "$PUBLIC_HOST" /api/ready)"
case "$s" in 200) res OK app:ready 200;; 000) res CRIT app:ready "unreachable";; *) res CRIT app:ready "$s";; esac

# worker / database / ledger (read-only probe inside the worker container)
# Same probe from the web container when the worker is down (then the heartbeat is reported stale, not unknown).
wj="$(dc exec -T worker node scripts/worker-health.mjs --json 2>/dev/null)"; wrc=$?
[ -z "$wj" ] && { wj="$(dc exec -T web node scripts/worker-health.mjs --json 2>/dev/null)"; wrc=$?; }
if [ -z "$wj" ]; then res UNKNOWN worker "probe did not run"
else
  age="$(printf '%s' "$wj" | sed -n 's/.*"heartbeatAgeSec":\([0-9null]*\).*/\1/p')"
  fails="$(printf '%s' "$wj" | sed -n 's/.*"failingSchedules":\[\([^]]*\)\].*/\1/p')"
  lstat="$(printf '%s' "$wj" | sed -n 's/.*"ledgerHealth":{"status":"\([A-Z]*\)".*/\1/p')"
  dead="$(printf '%s' "$wj" | sed -n 's/.*"deadLetters":\([0-9]*\).*/\1/p')"
  case $wrc in 0) res OK worker:heartbeat "${age}s";; 2) res CRIT database "unreachable from worker";; *) res CRIT worker:heartbeat "stale (${age:-none}s)";; esac
  [ -n "$fails" ] && res WARN schedules "failing: $fails" || { [ $wrc -ne 2 ] && res OK schedules "none failing"; }
  case "$lstat" in OK) res OK ledger-health OK;; WARNING) res WARN ledger-health WARNING;; CRITICAL) res CRIT ledger-health CRITICAL;; *) [ $wrc -ne 2 ] && res UNKNOWN ledger-health "no recent check";; esac
  [ -n "$dead" ] && { [ "$dead" -gt 0 ] && res WARN outbox "dead letters: $dead" || res OK outbox "no dead letters"; }
fi

# backups
bs="$(state_get backup-status.json)"
if [ -z "$bs" ]; then res UNKNOWN backup "no backup recorded"
else
  bt="$(printf '%s' "$bs" | sed -n 's/.*"time":"\([0-9TZ]*\)".*/\1/p')"
  bage=$(( ( $(date +%s) - $(date -d "$(echo "$bt" | sed -E 's/(....)(..)(..)T(..)(..)(..)Z/\1-\2-\3 \4:\5:\6 UTC/')" +%s 2>/dev/null || echo 0) ) / 3600 ))
  if [ "$bage" -gt 26 ]; then res CRIT backup "latest backup ${bage} h old"
  elif printf '%s' "$bs" | grep -q 'OFF-SERVER COPY UPLOADED'; then res OK backup "${bage} h old, off-server copy"
  else res WARN backup "${bage} h old — LOCAL COPY — NOT DISASTER-RECOVERY BACKUP"; fi
fi
ds="$(state_get restore-drill-status.json)"
if [ -z "$ds" ]; then res WARN restore-drill "never run"
elif printf '%s' "$ds" | grep -q '"result":"PASS"'; then
  dt="$(printf '%s' "$ds" | sed -n 's/.*"time":"\([^"]*\)".*/\1/p')"; dage=$(( ( $(date +%s) - $(date -d "$dt" +%s 2>/dev/null || echo 0) ) / 86400 ))
  [ "$dage" -gt 35 ] && res WARN restore-drill "last PASS ${dage} days ago" || res OK restore-drill "PASS ${dage} days ago"
else res CRIT restore-drill "last drill FAILED"; fi

# legacy untouched
if [ -s "$EDMN_STATE/legacy-baseline.sha256" ]; then
  if sha256sum -c --quiet "$EDMN_STATE/legacy-baseline.sha256" >/dev/null 2>&1; then res OK legacy:api "api.edmneg.com config unchanged"; else res CRIT legacy:api "api.edmneg.com config CHANGED since baseline"; fi
fi

OVERALL=(HEALTHY DEGRADED UNKNOWN CRITICAL); O="${OVERALL[$WORST]}"
if [ "${1:-}" = "--json" ]; then
  printf '{"time":"%s","overall":"%s","checks":[' "$(date -u +%FT%TZ)" "$O"; first=1
  for l in "${LINES[@]}"; do [ $first = 1 ] || printf ','; first=0; printf '"%s"' "$(printf '%s' "$l" | sed 's/"/\\"/g;s/  */ /g')"; done; printf ']}\n'
else
  printf '%s\n' "${LINES[@]}"; echo "OVERALL: $O"
fi
state_set watch-status "$O $(date -u +%FT%TZ)"
[ "$O" = HEALTHY ] && [ -n "${WATCH_HEARTBEAT_URL:-}" ] && curl -fsS -m 10 "$WATCH_HEARTBEAT_URL" >/dev/null 2>&1
if [ $WORST -ge 2 ] && [ -n "${WATCH_ALERT_URL:-}" ]; then
  curl -fsS -m 10 -H 'content-type: application/json' -d "{\"text\":\"EDMN $O on $(hostname): $(printf '%s; ' "${LINES[@]}" | grep -oE '(CRIT|UNKNOWN)[^;]*' | tr '\n' ' ' | sed 's/"//g')\"}" "$WATCH_ALERT_URL" >/dev/null 2>&1
fi
[ $WORST -le 1 ]
