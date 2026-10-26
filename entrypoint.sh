#!/bin/sh
set -e

echo "[entrypoint] Waiting for database to be available..."
node dist/scripts/waitForDb.js

# Applies db/migrations/*.sql not yet recorded in public.wymlink_migrations.
echo "[entrypoint] Applying database migrations..."
node dist/scripts/migrate.js

echo "[entrypoint] Starting backend server (node dist/index.js)..."
exec node dist/index.js
