#!/bin/sh
# On every start: apply database migrations, re-apply the row-level security rules, then run the API.
set -e
cd /app/apps/api
npx prisma migrate deploy
npx tsx prisma/harden.ts
exec npx tsx src/main.ts
