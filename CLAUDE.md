# Cash Flow 13 (SaaS) — working notes

Multi-company 13-week cash flow SaaS. Plan and phases: `../DESIGN-SAAS.md`. The
Apps Script app in `../app/` is the **reference copy**: its engine and Excel
parity fixtures are the truth this one must match. All figures are DEMO data.

## Layout
```
saas/
├── packages/engine   TypeScript forecast engine: generic core + industry templates
│   ├── src/core.ts            calendar, L4 items → L3/L2/L1, bank balance, VAT, schedules, checks
│   ├── src/templates/lpg.ts   LPG distribution (Best Gas) — ported line for line
│   ├── src/templates/generic.ts   any company: opening balances + scheduled items
│   └── test/parity.test.ts    = reference engine on 12 varied plans, = Excel v2 and v3 cell by cell
├── packages/theme    logo → theme (OKLCH) and the server's contrast check, shared by web and API
├── apps/web          React 18 + Vite 5 (:5180, proxies /api to :8990). Design A shell + C ledger + B Arabic/RTL.
│                     screens/: Auth, Overview, CashFlow (L1→L4), Balances, Branding, Activity. i18n.tsx holds EN+AR.
├── apps/api          NestJS 11 + Prisma 6 + PostgreSQL 16
│   ├── prisma/schema.prisma, prisma/sql/01_security.sql, prisma/harden.ts
│   ├── src/  db.ts (RLS client) · http.ts (guard, errors) · security.ts (scrypt, sessions) · *controller.ts
│   └── test/api.test.ts       end-to-end against the real local database
└── docker-compose.yml   cf13_db on 127.0.0.1:5442 (best-books owns 5432)
```

## Commands (from saas/)
```bash
docker compose up -d                       # database
npm test                                   # engine + API (needs the database)
npm run typecheck
cd apps/api && set -a && . ../../.env && set +a && npx prisma migrate deploy && npx tsx prisma/harden.ts
cd apps/api && npx tsx src/main.ts         # API on 127.0.0.1:8990
```
`.env` (git-ignored) holds generated secrets: OWNER_DB_PW, APP_DB_PW, DATABASE_URL (owner,
migrations/tests only), DATABASE_APP_URL (what the API uses), SESSION_KEY. Never print it.

## Company separation — the rule everything rests on
- The API connects as `cf13_app` (no superuser, no BYPASSRLS). `Db.onModuleInit` refuses to boot otherwise.
- Every company table has FORCE ROW LEVEL SECURITY on `tenant_id = current_tenant_id()`
  (`tenants` on `id`). `current_tenant_id()` **raises** when unset, so a forgotten scope fails loudly.
- Company data is reached only through `db.inTenant(tenantId, tx => …)`, which sets
  `app.tenant_id` for that transaction only.
- Before a company is known (sign-in, sign-up) two SECURITY DEFINER functions are the only way
  across: `account_memberships(account)` and `slug_taken(slug)`.
- `accounts` has no RLS (a person may belong to several companies); only the auth controller reads it.
- `audit` is append-only (trigger). Every change writes an entry with before/after.
- After changing the schema: migrate, then **re-run harden.ts** (new tables need `apply_tenant_rls`),
  then add the table to the isolation test.

## Sessions and sign-in
HS256 cookie `cf13` (httpOnly, SameSite=Strict, 8h). The guard re-checks the account's
`session_epoch` and the membership on every request, so a password change or a removed
member ends sessions at once. Every write needs header `x-cf13: 1` (CSRF). Passwords: scrypt
N=2^15, ≥12 characters; 8 failures lock the account for 15 minutes; unknown emails cost the
same time as wrong passwords.

## Branding
The browser derives the theme from the logo (canvas → OKLCH; prototype in
`../app/design/common.js`). The server only checks it: hex values, white text on brand ≥ 4.5:1,
ink on paper ≥ 7:1. Logos are PNG/JPEG/WebP checked by magic bytes (no SVG: script risk),
≤ 512 KB, served only to members. Data and alert colours are fixed and never stored.

## Open items (each belongs to a phase; none is done yet)
- **Before anything is public (phase 6):** per-IP throttling and Firebase sign-in are DONE (see `FIREBASE.md`; env `CF13_RATE_*`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_CONFIG`; Firebase links by verified email to an existing account only). Still open: decide whether sign-up may say `email_taken` (reveals registered emails); set `trust proxy` behind a proxy.
- **Real data:** `python -I ../bank/build_forecast.py` writes `../bank/out/bestgas_plan_<date>.json`
  (template `bank-history`, one line per original bank label); load it with
  `cd apps/api && npx tsx prisma/import-plan.ts best-gas <file> [--dry-run]`. The import refuses a plan
  whose checks fail. Restart the API after engine changes (it loads the engine at start).
- A new company's starter plan begins on the current Sunday; let sign-up or plan settings choose
  the start date.
- Dev run: `.claude/launch.json` (project root) has `cf13-api` and `cf13-web`. Dev login for the
  local Best Gas company is `owner.dev@example.com`; its local-only test password is in the developer's own notes, not in this repo.
- **Tests:** they write `test-…` companies into the dev database `cf13`; move them to a
  separate `cf13_test` (migrate + harden in setup).

## Traps
- `tsx` (esbuild) does not emit decorator metadata: every Nest constructor parameter needs
  an explicit `@Inject(...)`, or DI silently gets `undefined`.
- `multer` is pinned to 2.5.0 through root `overrides` (Nest 11.2.8 asks for 2.4.0, which has
  a DoS advisory). `npm ls` reports it "invalid": that is the override, not a fault. The app
  never accepts multipart uploads anyway.
- Ports 8931/8941 belong to the cash-collection mock servers; this project's preview is 8977.
