#!/bin/sh
# Migrations, then the idempotent seed (demo cast, Bullet, areas), then the server.
set -e

echo "Applying migrations"
node dist/db/migrate.js

echo "Seeding"
node dist/db/seed.js

echo "Starting the API"
exec node dist/index.js
