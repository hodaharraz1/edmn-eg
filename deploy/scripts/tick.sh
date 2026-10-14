#!/usr/bin/env bash
# EDMN — scheduler WATCHDOG tick (systemd edmn-tick.timer, every minute). OPTIONAL safety net.
# The `worker` container is the primary scheduler. This tick calls the same due-based endpoint through the loopback
# port: each job still runs only when its own interval has elapsed, under a database lease, so the worker and this
# tick together never run a job twice, and a tick after a worker outage recovers missed jobs. Jobs never move money.
# The secret is read by curl from a root-only header file (/etc/edmn/cron-header, 0600, one line:
# "Authorization: Bearer <CRON_SECRET>") — never on the command line, never logged.
set -euo pipefail
HDR="${EDMN_CRON_HEADER_FILE:-/etc/edmn/cron-header}"
PORT="${EDMN_WEB_PORT:-3000}"
HOST="${EDMN_PUBLIC_HOST:-www.edmneg.com}"
[ -r "$HDR" ] || { echo "✗ $HDR missing" >&2; exit 1; }
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 55 -X POST -H @"$HDR" -H "Host: $HOST" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/api/cron/tick" || echo 000)"
[ "$code" = 200 ] || { echo "✗ tick returned $code" >&2; exit 1; }
