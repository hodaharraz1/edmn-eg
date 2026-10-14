#!/usr/bin/env bash
# EDMN — controlled production deployment.
#
#   deploy.sh first  --tag <40-hex commit SHA> [--image-archive edmn-<sha>.tar]   # first production deploy
#   deploy.sh normal --tag <40-hex commit SHA> [--image-archive edmn-<sha>.tar]   # every later release
#
# Sequence (each step must succeed; any failure prints "✗ STOP" and exits non-zero):
#   1 PRECHECK → 2 BACKUP → 3 VERIFY BACKUP → 4 LOAD/SELECT IMAGE → 5 MIGRATION PREFLIGHT → 6 EXPLICIT MIGRATION
#   → 7 REFERENCE SEED → 8 START WEB/WORKER → 9 /api/health → 10 /api/ready → 11 SMOKE → 12 FINANCIAL INVARIANTS
#   (read-only acceptance) → SUCCESS
#
# ROLLBACK POLICY (never pretended):
#   • APP IMAGE rollback is automatic ONLY for failures in steps 8–12 and ONLY when a previous release exists:
#     web/worker go back to the previous image tag. Migrations are expand-only (the preflight refuses destructive
#     statements), so the previous image keeps working on the newer schema.
#   • The DATABASE is NEVER rolled back automatically. A schema/data restore is a separate, manual, approved
#     operation (rollback.sh database → restore into a NEW database from the verified pre-deploy backup).
#   • A failure in steps 1–7 leaves the running release untouched (web/worker are not restarted before step 8).
#
# This script never stops, edits or restarts anything outside the `edmn` compose project.
source "$(dirname "$0")/lib.sh"

MODE="${1:-}"; shift || true
TAG=""; ARCHIVE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift 2;;
    --image-archive) ARCHIVE="$2"; shift 2;;
    *) stop "unknown argument: $1";;
  esac
done
[ "$MODE" = "first" ] || [ "$MODE" = "normal" ] || stop "usage: deploy.sh first|normal --tag <sha> [--image-archive file]"
is_sha "$TAG" || stop "--tag must be the full 40-character commit SHA of the release"

APP_ENV="$EDMN_ETC/production.env"
IMAGE="${EDMN_IMAGE:-$( [ -f "$COMPOSE_ENV" ] && env_value "$COMPOSE_ENV" EDMN_IMAGE || true )}"; IMAGE="${IMAGE:-edmn-app}"
PREVIOUS="$(state_get current_tag)"
STARTED=0
mkdir -p "$EDMN_STATE"
LOCK="$EDMN_STATE/deploy.lock"
exec 9>"$LOCK"; flock -n 9 || stop "another deployment is running"

on_fail() {
  local rc=$?
  [ $rc -eq 0 ] && return
  if [ "$STARTED" = 1 ] && [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then
    printf '\n✗ deployment of %s failed after the new release started — rolling the APP IMAGE back to %s\n' "$TAG" "$PREVIOUS" >&2
    EDMN_IMAGE_TAG="$PREVIOUS" dc up -d --no-deps --no-build web worker >&2 || true
    if wait_http "$PUBLIC_HOST" /api/ready 200 180; then
      printf '  ✓ previous release %s is serving again (/api/ready 200)\n' "$PREVIOUS" >&2
    else
      printf '  ✗ previous release is NOT ready — incident: run deploy/scripts/watch.sh and escalate\n' >&2
    fi
    printf '  The DATABASE was NOT rolled back (migrations are expand-only). Verify with: deploy/scripts/watch.sh\n' >&2
  elif [ "$STARTED" = 1 ]; then
    printf '\n✗ first deployment failed after start — stopping web/worker of the new release (no previous release)\n' >&2
    EDMN_IMAGE_TAG="$TAG" dc stop web worker >&2 || true
  else
    printf '\n✗ deployment stopped before web/worker were touched — the running release is unchanged\n' >&2
  fi
  state_set last_deploy_result "FAILED $TAG $(date -u +%FT%TZ)"
}
trap on_fail EXIT

export EDMN_IMAGE_TAG="$TAG" EDMN_IMAGE="$IMAGE"

# ── 1. PRECHECK ─────────────────────────────────────────────────────────────────────────────────────────────────
step "1/12 PRECHECK ($MODE deploy of $TAG)"
require_cmd docker curl flock sha256sum
docker compose version >/dev/null 2>&1 || stop "docker compose v2 plugin is required"
require_secret_file "$APP_ENV"
[ "$(env_value "$APP_ENV" EDMN_ENVIRONMENT | tr '[:upper:]' '[:lower:]')" = "production" ] || stop "EDMN_ENVIRONMENT must be production in $APP_ENV"
[ "$(env_value "$APP_ENV" ENFORCE_ADMIN_HOST)" = "true" ] || [ "$(env_value "$APP_ENV" ENFORCE_HOSTS)" = "true" ] || stop "admin-host enforcement is off (ENFORCE_ADMIN_HOST=true required)"
[ "$(env_value "$APP_ENV" ADMIN_HOST)" = "$ADMIN_HOST_NAME" ] || stop "ADMIN_HOST must be $ADMIN_HOST_NAME"
for v in STAGING_DEMO_PASSWORD STAGING_ADMIN_PASSWORD STAGING_TOTP_SECRET SEED_DEMO E2E_DATABASE_URL E2E_BASE_URL TEST_DATABASE_URL PUSH_ALLOW_ANY_ENDPOINT; do
  env_has "$APP_ENV" "$v" && stop "$v must not be set in $APP_ENV (demo / E2E / staging credential)"
done
grep -Ev '^[[:space:]]*#' "$APP_ENV" | grep -Eq '<[A-Z0-9_+]+>' && stop "$APP_ENV still contains template placeholders (<...>)"
avail_kb="$(df -Pk "$EDMN_BACKUP_DIR" 2>/dev/null | awk 'NR==2{print $4}')"; avail_kb="${avail_kb:-0}"
[ "$avail_kb" -ge 3145728 ] || stop "less than 3 GB free for backups/images under $EDMN_BACKUP_DIR"
if [ "$MODE" = "first" ]; then
  # Legacy services must provably not conflict (read-only discovery; it never stops anything).
  "$EDMN_HOME/deploy/scripts/preflight-legacy.sh" || stop "legacy preflight did not prove a conflict-free install"
  [ -z "$PREVIOUS" ] || stop "a release ($PREVIOUS) is already recorded — use: deploy.sh normal"
else
  [ -n "$PREVIOUS" ] || stop "no current release recorded — the first deployment must use: deploy.sh first"
fi
ok "precheck passed (secrets were not printed)"

# ── 4 (early). LOAD / SELECT IMAGE — needed to run the in-image environment validation ───────────────────────
step "4/12 LOAD / SELECT IMAGE $IMAGE:$TAG"
if [ -n "$ARCHIVE" ]; then
  [ -f "$ARCHIVE" ] || stop "image archive not found: $ARCHIVE"
  [ -f "$ARCHIVE.sha256" ] && (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null) || { [ -f "$ARCHIVE.sha256" ] && stop "image archive checksum mismatch"; }
  docker load -i "$ARCHIVE" >/dev/null
fi
docker image inspect "$IMAGE:$TAG" >/dev/null 2>&1 || stop "image $IMAGE:$TAG is not present (build or load it first)"
rev="$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE:$TAG")"
[ "$rev" = "$TAG" ] || stop "image revision label ($rev) does not match the tag $TAG — refusing an ambiguous image"
ok "image $IMAGE:$TAG present, revision label matches"

step "1b/12 PRECHECK — production environment policy inside the release image"
# The application's own validator: refuses staging/test secrets (fingerprints), staging/local DBs, http URLs,
# placeholder senders, missing admin host … Prints reasons only, never values.
dc run --rm --no-deps -T web node --import tsx scripts/check-env.ts || stop "environment policy refused the configuration"
if [ "$MODE" = "first" ]; then
  # Self-hosted database (profile postgres-local): start it once here; normal deploys never restart it.
  if dc config --services 2>/dev/null | grep -qx postgres; then dc up -d --wait postgres || stop "postgres did not become healthy"; fi
  # The production database must be EMPTY (or carry no tables): a first deploy never adopts an existing DB.
  tables="$(dc run --rm --no-deps -T web node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\"select count(*)::int n from information_schema.tables where table_schema='public'\")).then(r=>{console.log(r.rows[0].n);return c.end()}).catch(()=>{console.log('ERR');process.exit(1)})")" || stop "cannot reach the production database"
  [ "$tables" = "0" ] || stop "first deploy requires an EMPTY, separate production database (found $tables tables)"
  ok "production database is empty and separate"
fi

# ── 2. BACKUP ───────────────────────────────────────────────────────────────────────────────────────────────────
step "2/12 BACKUP"
if [ "$MODE" = "first" ]; then
  log "first deploy on an empty database — nothing to back up (recorded)"
  BACKUP_FILE=""
else
  BACKUP_FILE="$("$EDMN_HOME/deploy/scripts/backup.sh" --reason "pre-deploy-$TAG" --print-path)" || stop "pre-deploy backup failed"
  ok "backup written: $(basename "$BACKUP_FILE")"
fi

# ── 3. VERIFY BACKUP ────────────────────────────────────────────────────────────────────────────────────────────
step "3/12 VERIFY BACKUP"
if [ -n "$BACKUP_FILE" ]; then
  "$EDMN_HOME/deploy/scripts/verify-backup.sh" "$BACKUP_FILE" || stop "backup verification failed — not migrating"
  ok "backup verified"
else
  log "skipped (first deploy, empty database)"
fi

# ── 5. MIGRATION PREFLIGHT ──────────────────────────────────────────────────────────────────────────────────────
step "5/12 MIGRATION PREFLIGHT (environment marker, destructive-statement scan; applies nothing)"
dc --profile ops run --rm --no-deps -T migrate-preflight || stop "migration preflight refused"

# ── 6. EXPLICIT MIGRATION ───────────────────────────────────────────────────────────────────────────────────────
step "6/12 EXPLICIT MIGRATION (advisory-locked; schema owner role)"
dc --profile ops run --rm --no-deps -T migrate || stop "migration failed — the previous release is still running; DB NOT rolled back (see backup ${BACKUP_FILE:-n/a})"

# ── 7. REFERENCE SEED ───────────────────────────────────────────────────────────────────────────────────────────
step "7/12 REFERENCE SEED (idempotent reference data only — never demo data)"
dc --profile ops run --rm --no-deps -T seed || stop "reference seed failed"

# ── 8. START WEB / WORKER ───────────────────────────────────────────────────────────────────────────────────────
step "8/12 START WEB / WORKER on $TAG"
STARTED=1
dc up -d --no-deps --no-build web worker

# ── 9. /api/health ──────────────────────────────────────────────────────────────────────────────────────────────
step "9/12 /api/health"
wait_http "$PUBLIC_HOST" /api/health 200 180 || stop "/api/health did not return 200"
ok "/api/health 200"

# ── 10. /api/ready ──────────────────────────────────────────────────────────────────────────────────────────────
step "10/12 /api/ready"
wait_http "$PUBLIC_HOST" /api/ready 200 180 || stop "/api/ready did not return 200 (database / migrations / environment / storage)"
ok "/api/ready 200"

# ── 11. SMOKE ───────────────────────────────────────────────────────────────────────────────────────────────────
step "11/12 SMOKE (read-only, through the loopback port with the real Host headers)"
[ "$(http_status "$PUBLIC_HOST" /)" = "200" ] || stop "storefront / is not 200"
case "$(http_status "$PUBLIC_HOST" /admin)" in 307|308) ;; *) stop "/admin on $PUBLIC_HOST is not redirected to the admin host";; esac
[ "$(http_status "$PUBLIC_HOST" /api/cron/tick)" = "404" ] || stop "/api/cron/tick must be 404 without the secret"
log "waiting for the worker's first scheduled runs (heartbeat)…"
for _ in $(seq 1 40); do dc exec -T worker node scripts/worker-health.mjs >/dev/null 2>&1 && break; sleep 6; done
dc exec -T worker node scripts/worker-health.mjs >/dev/null 2>&1 || stop "worker heartbeat not healthy within 4 minutes"
ok "smoke passed; worker heartbeat healthy"

# ── 12. FINANCIAL INVARIANTS (read-only acceptance) ─────────────────────────────────────────────────────────────
step "12/12 FINANCIAL INVARIANTS + ACCEPTANCE (READ ONLY transaction)"
EXPECT_PRICING="${EDMN_EXPECT_PRICING:-$( [ -f "$COMPOSE_ENV" ] && env_value "$COMPOSE_ENV" EDMN_EXPECT_PRICING || true )}"
[ -n "$EXPECT_PRICING" ] || stop "EDMN_EXPECT_PRICING is not set in $COMPOSE_ENV (expected active Fee Engine versions, or 'none')"
dc --profile ops run --rm --no-deps -T acceptance node --import tsx scripts/prod-acceptance.ts --db-only --expect-pricing="$EXPECT_PRICING" || stop "acceptance / financial invariants failed"
# HTTP part from the host network (it must reach 127.0.0.1:$WEB_PORT); needs no secrets.
docker run --rm --network host -e APP_URL="https://$PUBLIC_HOST" -e ADMIN_HOST="$ADMIN_HOST_NAME" -e EDMN_WEB_PORT="$WEB_PORT" \
  "$IMAGE:$TAG" node --import tsx scripts/prod-acceptance.ts --http-only --local || stop "HTTP acceptance failed"

state_set previous_tag "${PREVIOUS:-}"
state_set current_tag "$TAG"
state_set last_deploy_result "SUCCESS $TAG $(date -u +%FT%TZ)"
trap - EXIT
step "SUCCESS — $TAG is live (previous: ${PREVIOUS:-none}). Real money remains OFF."
