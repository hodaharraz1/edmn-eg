#!/usr/bin/env bash
# EDMN — rollback. Two DIFFERENT operations, never combined:
#
#   rollback.sh app [<sha>]     Switch web + worker back to a previous IMAGE (default: the recorded previous tag).
#                               Safe because migrations are expand-only (destructive statements are refused by the
#                               migration preflight). The database is NOT touched.
#
#   rollback.sh database        Prints the documented manual procedure and STOPS. A database rollback loses every
#                               transaction since the backup (orders, payments evidence, ledger entries, messages),
#                               so it is never automated: it needs the owner's written approval, a restore drill of
#                               the chosen backup, a restore into a NEW database, and a DATABASE_URL switch.
source "$(dirname "$0")/lib.sh"

case "${1:-}" in
  app)
    TARGET="${2:-$(state_get previous_tag)}"
    is_sha "$TARGET" || stop "no previous release recorded; pass the release sha explicitly"
    IMAGE="${EDMN_IMAGE:-$( [ -f "$COMPOSE_ENV" ] && env_value "$COMPOSE_ENV" EDMN_IMAGE || true )}"; IMAGE="${IMAGE:-edmn-app}"
    docker image inspect "$IMAGE:$TARGET" >/dev/null 2>&1 || stop "image $IMAGE:$TARGET is not on this host"
    CURRENT="$(state_get current_tag)"
    step "APP rollback: $CURRENT → $TARGET (database unchanged)"
    EDMN_IMAGE_TAG="$TARGET" EDMN_IMAGE="$IMAGE" dc up -d --no-deps --no-build web worker
    wait_http "$PUBLIC_HOST" /api/ready 200 180 || stop "/api/ready is not 200 after the app rollback — investigate (deploy/scripts/watch.sh)"
    state_set previous_tag "$CURRENT"
    state_set current_tag "$TARGET"
    state_set last_deploy_result "APP-ROLLBACK $TARGET $(date -u +%FT%TZ)"
    ok "web/worker now run $TARGET; /api/ready 200. The database schema was NOT rolled back."
    ;;
  database)
    cat <<'TXT'
DATABASE ROLLBACK IS A MANUAL, APPROVED OPERATION — nothing was changed.
  1. Owner approves in writing, knowing all data after the backup time is lost (incl. ledger entries).
  2. Put the site in maintenance (Admin → global kill switch; stop the worker: docker compose … stop worker).
  3. Take a FINAL backup of the current database (backup.sh --reason pre-restore) — never skip.
  4. restore-drill.sh <chosen backup> --identity <offline key> --tag <sha>   → must PASS.
  5. deploy/scripts/restore-database.sh <backup> --identity <key> --target-db edmn_restored_<date> --confirm-owner-approved
     (creates a NEW database, restores, re-grants, verifies). Never restore over the live database.
  6. Point DATABASE_URL (production.env + migrate.env) at the new database, run the APP image that matches the
     backup's migration count (rollback.sh app <sha>), then prod-acceptance (--db-only) must PASS.
  7. Keep the old database untouched for forensics until the owner releases it.
TXT
    exit 2
    ;;
  *) stop "usage: rollback.sh app [<sha>] | rollback.sh database";;
esac
