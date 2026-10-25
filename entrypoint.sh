#!/bin/sh
set -e

echo "[entrypoint] Waiting for database to be available..."
node dist/scripts/waitForDb.js

# Legacy drizzle migrations only run when explicitly enabled. The new
# Wymlink schema (db/migrations) is applied separately.
if [ "$DB_MIGRATE_ON_START" = "true" ]; then
  echo "[entrypoint] Running database migrations (npm run migrate:prod)..."
  npm run migrate:prod
fi

echo "[entrypoint] Starting backend server (node dist/index.js)..."
exec node dist/index.js
