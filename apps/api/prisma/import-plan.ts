// Loads a plan file into one company, as that company (row-level security on).
//   npx tsx prisma/import-plan.ts <company-slug> <plan.json> [--dry-run] [--archive "<name prefix>"]... [--keep "<name prefix>"]...
// - The plan must run through the engine with every check passing, or nothing is saved.
// - A plan with the SAME NAME is updated in place (new version), so a daily refresh never piles up copies.
// - --archive hides older plans whose name starts with the prefix (never deletes), except those starting with a --keep prefix.
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
// CF13_NO_DOTENV=1 when loading into a hosted database: the local settings file must never mix in (it points at this PC's database)
if (!process.env.CF13_NO_DOTENV) dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { PrismaClient } from '@prisma/client';
import { forecast, type CoreModel } from '@cf13/engine';

function flag(name: string): string[] {
  const out: string[] = [], a = process.argv;
  for (let i = 0; i < a.length - 1; i++) if (a[i] === name) out.push(a[i + 1]);
  return out;
}

async function main() {
  const positional = process.argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--') && arr[i - 1] !== '--dry-run'));
  const [slug, file] = positional;
  const dry = process.argv.includes('--dry-run');
  if (!slug || !file) throw new Error('usage: import-plan.ts <company-slug> <plan.json> [--dry-run]');
  const model = JSON.parse(fs.readFileSync(file, 'utf8')) as CoreModel & { meta: { name?: string } };
  const name = model.meta.name || 'Imported plan';
  const r = forecast(model);
  const failed = r.checks.filter((c) => !c.ok);
  console.log('checks:', r.checks.length - failed.length, '/', r.checks.length, 'pass; items', r.items.length);
  console.log('closing by week:', r.l1.closing.map((x) => Math.round(x).toLocaleString('en-US')).join(' | '));
  if (failed.length) throw new Error('checks failed: ' + failed.map((c) => c.id).join(', '));
  if (dry) return;

  const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });     // only to find the company by slug
  // the write goes through RLS as cf13_app when its URL is known; on a hosted database the owner writes, scoped to the company
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const appUrl = process.env.DATABASE_APP_URL || process.env.DATABASE_URL;
  if (new URL(appUrl).host !== new URL(process.env.DATABASE_URL).host) throw new Error('DATABASE_URL and DATABASE_APP_URL point at different servers');
  const app = new PrismaClient({ datasourceUrl: appUrl });
  try {
    const [t] = await owner.$queryRaw<Array<{ id: string }>>`SELECT id FROM tenants WHERE slug = ${slug}`;
    if (!t) throw new Error('no company with slug ' + slug);
    const result = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t.id}, true)`;
      const owners = await tx.membership.findMany({ where: { tenantId: t.id, role: 'owner' }, select: { accountId: true } });
      const actor = owners[0]?.accountId ?? null;
      const existing = await tx.plan.findFirst({ where: { tenantId: t.id, name, status: { not: 'archived' } } });
      let id: string, action: string;
      if (existing) {
        if (existing.status === 'locked') throw new Error('the plan "' + name + '" is locked');
        const u = await tx.plan.update({ where: { id: existing.id }, data: { model: model as any, version: { increment: 1 } } });
        id = u.id; action = 'plan_refreshed';
      } else {
        const c = await tx.plan.create({ data: { tenantId: t.id, name, model: model as any, createdBy: actor ?? undefined } });
        id = c.id; action = 'plan_imported';
      }
      await tx.auditEntry.create({ data: { tenantId: t.id, actorId: actor, action, entity: 'plan', entityId: id,
        changes: { file: path.basename(file), template: model.template, start: model.meta.startDate, name } } });
      let archived = 0;
      const keep = flag('--keep'), arch = flag('--archive');
      if (arch.length) {
        const all = await tx.plan.findMany({ where: { tenantId: t.id, status: { notIn: ['archived', 'locked'] } }, select: { id: true, name: true } });
        for (const p of all) {
          if (p.id === id) continue;
          if (arch.some((x) => p.name.startsWith(x)) && !keep.some((x) => p.name.startsWith(x))) {
            await tx.plan.update({ where: { id: p.id }, data: { status: 'archived' } });
            await tx.auditEntry.create({ data: { tenantId: t.id, actorId: actor, action: 'plan_archived', entity: 'plan', entityId: p.id, changes: { name: p.name } } });
            archived++;
          }
        }
      }
      return { id, action, archived };
    });
    console.log(result.action + ' ' + result.id + ' ("' + name + '") in ' + slug + (result.archived ? '; archived ' + result.archived + ' older plans' : ''));
  } finally {
    await owner.$disconnect(); await app.$disconnect();
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
