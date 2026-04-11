#!/bin/bash
# Run Prisma migrations
set -e
cd "$(dirname "$0")/../backend"

echo "Running database migrations..."
npx prisma migrate deploy
echo "✓ Migrations applied"

echo "Generating Prisma client..."
npx prisma generate
echo "✓ Done"
