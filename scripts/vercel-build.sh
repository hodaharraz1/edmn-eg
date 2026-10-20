#!/bin/sh
# Vercel build: apply migrations and idempotent seeds to the staging database, then build.
# Migrations use the direct (unpooled) connection when provided.
set -e
DIRECT_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
DATABASE_URL="$DIRECT_URL" npx tsx scripts/migrate.ts
DATABASE_URL="$DIRECT_URL" npx tsx scripts/seed.ts
if [ "$EDMN_ENVIRONMENT" = "staging" ] && [ "$SEED_DEMO" = "true" ]; then
  DATABASE_URL="$DIRECT_URL" npx tsx scripts/seed.ts --demo
fi
npx next build
