// npm run db:harden — applies sql/01_security.sql with the owner connection and
// gives cf13_app the password from .env. Idempotent.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

async function main() {
  const pw = process.env.APP_DB_PW || '';
  // generated as hex: refuse anything else rather than quote it into SQL
  if (!/^[0-9a-f]{32,}$/.test(pw)) throw new Error('APP_DB_PW must be the generated hex value in .env');
  const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'sql', '01_security.sql'), 'utf8');
    for (const stmt of statements(sql)) await db.$executeRawUnsafe(stmt);
    // only a superuser may name SUPERUSER/BYPASSRLS at all; a hosted owner (Render) has CREATEROLE only,
    // and a role it creates can never hold those attributes. The API checks both again when it starts.
    const [me] = await db.$queryRawUnsafe<Array<{ rolsuper: boolean }>>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
    await db.$executeRawUnsafe(`ALTER ROLE cf13_app WITH LOGIN PASSWORD '${pw}'${me?.rolsuper ? ' NOSUPERUSER NOBYPASSRLS' : ''}`);
    const rls = await db.$queryRawUnsafe<Array<{ relname: string; forced: boolean }>>(
      `SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname IN ('tenants','memberships','branding','plans','audit','api_keys','invitations','budget_settings','budget_cycles','budget_submissions','budget_actuals') ORDER BY relname`);
    console.log('row-level security forced on:', rls.filter((r) => r.forced).map((r) => r.relname).join(', '));
  } finally {
    await db.$disconnect();
  }
}
/** Splits on `;` outside $$-quoted bodies; drops comment-only lines. */
function statements(sql: string): string[] {
  const out: string[] = [];
  let cur = '', inDollar = false;
  for (const line of sql.split('\n')) {
    if (!inDollar && /^\s*--/.test(line)) continue;
    cur += line + '\n';
    inDollar = ((line.match(/\$\$/g) || []).length % 2 === 1) ? !inDollar : inDollar;
    if (!inDollar && /;\s*$/.test(line)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
