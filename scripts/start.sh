#!/bin/sh
# Container entrypoint: apply migrations, seed reference data (idempotent), optionally seed STAGING
# demo data, then run the background worker and the web server.
set -e

echo "▶ migrations"
npm run -s db:migrate
echo "▶ reference data"
npm run -s db:seed

if [ "$EDMN_ENVIRONMENT" = "staging" ] && [ "$SEED_DEMO" = "true" ]; then
  echo "▶ staging demo data (idempotent)"
  npm run -s db:seed:demo
fi

# Background worker (outbox delivery, order expiry, follow-ups, settlements). Restarts if it exits.
# Run node directly (no npm/npx wrapper processes) to fit small instances (e.g. 512 MB free tiers).
( while true; do node --max-old-space-size=128 --import tsx scripts/worker.ts || true; echo "worker exited — restarting in 5s"; sleep 5; done ) &

echo "▶ web on port ${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "${PORT:-3000}"
