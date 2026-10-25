#!/bin/sh
set -e

echo "[entrypoint] Waiting for database to be available..."
node dist/scripts/waitForDb.js

echo "[entrypoint] Running database migrations (npm run migrate:prod)..."
npm run migrate:prod

echo "[entrypoint] Starting backend server (node dist/index.js)..."
exec node dist/index.js
