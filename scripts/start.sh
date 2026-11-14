#!/bin/sh
# Container entrypoint: background worker + web server. Only a LOCAL container bootstraps its own database first.
set -e

# PRODUCTION never migrates or seeds implicitly on a (re)start: migrations are an explicit, backed-up deployment step
# (deploy/scripts/deploy.sh). Production containers run web / worker directly (deploy/compose/docker-compose.prod.yml).
if [ "$(printf %s "$EDMN_ENVIRONMENT" | tr "[:upper:]" "[:lower:]")" = "production" ]; then
  echo "✗ scripts/start.sh is not used in PRODUCTION (it would run migrations on every start)." >&2
  echo "  Use deploy/compose/docker-compose.prod.yml (web/worker commands) and deploy/scripts/deploy.sh (explicit migration)." >&2
  exit 64
fi

# Database changes are separate, deliberate steps (src/server/core/deploy-policy.ts): a container START never
# migrates or seeds a shared database. Only a LOCAL single-container setup (EDMN_ENVIRONMENT unset / development /
# local, no VERCEL) bootstraps its own database here. STAGING runs migrations through the authorized workflow
# (.github/workflows/migrate-staging.yml) BEFORE the new image starts.
KIND="$(printf %s "$EDMN_ENVIRONMENT" | tr "[:upper:]" "[:lower:]")"
if [ -z "$KIND" ] || [ "$KIND" = "development" ] || [ "$KIND" = "local" ]; then
  echo "▶ LOCAL: migrations + reference data"
  npx tsx scripts/migrate.ts
  npx tsx scripts/seed.ts
  if [ "$SEED_DEMO" = "true" ]; then
    echo "▶ LOCAL: demo data"
    npx tsx scripts/seed.ts --demo
  fi
else
  echo "▶ $KIND: no database changes at start (migrations are an explicit, authorized step)"
fi

# Background worker (outbox delivery, order expiry, follow-ups, settlements). Restarts if it exits.
# Run node directly (no npm/npx wrapper processes) to fit small instances (e.g. 512 MB free tiers).
( while true; do node --max-old-space-size=128 --import tsx scripts/worker.ts || true; echo "worker exited — restarting in 5s"; sleep 5; done ) &

echo "▶ web on port ${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
