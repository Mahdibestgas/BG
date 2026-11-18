#!/bin/sh
# On every start: apply database migrations, re-apply the row-level security rules, then run the API.
set -e
# hosts that give one database URL and random secrets (Render): derive the app login and hex keys
if [ -z "$DATABASE_APP_URL" ] || [ -z "$APP_DB_PW" ]; then
  eval "$(node /app/deploy/render-env.mjs)"
fi
cd /app/apps/api
npx prisma migrate deploy
npx tsx prisma/harden.ts
exec npx tsx src/main.ts
