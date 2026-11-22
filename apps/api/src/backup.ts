// Backups of every company, for the system owner. Two ways out, neither through GitHub:
//   - GET /api/platform/backup: the owner downloads one .json.gz file now (Companies page button).
//   - Every day after 02:00 Riyadh time the server emails the same file to the system owner(s), when RESEND_API_KEY
//     is set. CF13_BACKUP_EMAIL=off switches the email off.
// What is in it: every company the owner belongs to, with its settings, logo, plans, budget rounds, department
// submissions, actuals, members (names, emails, roles; never passwords or keys) and the last 5,000 audit entries.
import { Controller, Get, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Res } from '@nestjs/common';
import type { Response } from 'express';
import { gzipSync } from 'node:zlib';
import { Db } from './db';
import { AppError, Context, type Ctx } from './http';
import { mailReady, sendMail } from './mail';

/** Platform owners: the first account ever created, plus any email listed in CF13_PLATFORM_OWNERS. */
async function platformOwners(db: Db) {
  const listed = (process.env.CF13_PLATFORM_OWNERS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const first = await db.account.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, email: true, name: true } });
  const others = listed.length ? await db.account.findMany({ where: { email: { in: listed } }, select: { id: true, email: true, name: true } }) : [];
  return [...(first ? [first] : []), ...others.filter((o) => o.id !== first?.id)];
}

/** Every company this account belongs to, read one company at a time inside its own row-level-security scope. */
export async function buildBackup(db: Db, accountId: string) {
  const companies = await db.$queryRaw<Array<{ tenant_id: string; slug: string; name: string }>>`SELECT * FROM account_memberships(${accountId}::uuid)`;
  const out: unknown[] = [];
  for (const c of companies) {
    out.push(await db.inTenant(c.tenant_id, async (tx) => {
      const members = await tx.membership.findMany({ include: { account: { select: { name: true, email: true, language: true } } } });
      return {
        company: { id: c.tenant_id, slug: c.slug, name: c.name },
        branding: await tx.branding.findFirst(),
        plans: await tx.plan.findMany(),
        budgetSettings: await tx.budgetSettings.findFirst(),
        budgetCycles: await tx.budgetCycle.findMany(),
        budgetSubmissions: await tx.budgetSubmission.findMany(),
        budgetActuals: await tx.budgetActual.findMany(),
        members: members.map((m) => ({ role: m.role, department: m.department, since: m.createdAt, name: m.account.name, email: m.account.email, language: m.account.language })),
        audit: await tx.auditEntry.findMany({ orderBy: { at: 'desc' }, take: 5000 })
      };
    }));
  }
  const doc = { format: 'khitta-backup', version: 1, createdAt: new Date().toISOString(), companies: out };
  // logos are bytes: write them as base64 so the file stays plain JSON
  const json = JSON.stringify(doc, (_k, v) => (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data) ? { base64: Buffer.from(v.data).toString('base64') } : typeof v === 'bigint' ? v.toString() : v));
  return { gz: gzipSync(Buffer.from(json, 'utf8'), { level: 9 }), companies: out.length, bytes: json.length };
}

const fileName = (d = new Date()) => `khitta-backup-${d.toISOString().slice(0, 10)}.json.gz`;

@Controller('api/platform')
export class PlatformController {
  constructor(@Inject(Db) private readonly db: Db) {}

  /** Whether the daily email copy is running (it needs the mail service). */
  @Get('backup-status')
  async status(@Context() ctx: Ctx) {
    const owners = await platformOwners(this.db);
    if (!owners.some((o) => o.id === ctx.accountId)) throw new AppError('forbidden', 403);
    // storage used by the whole database, against the free plan's limit (CF13_DB_LIMIT_MB, default 512)
    let usedBytes: number | null = null;
    try { usedBytes = Number((await this.db.$queryRaw<Array<{ b: bigint }>>`SELECT pg_database_size(current_database()) AS b`)[0].b); } catch { usedBytes = null; }
    return { ok: true, dailyEmail: mailReady() && process.env.CF13_BACKUP_EMAIL !== 'off', to: owners.map((o) => o.email), usedBytes, limitBytes: Number(process.env.CF13_DB_LIMIT_MB || 512) * 1024 * 1024 };
  }

  /** The system owner downloads a full backup now. Members and finance users of a company cannot. */
  @Get('backup')
  async backup(@Context() ctx: Ctx, @Res() res: Response) {
    const owners = await platformOwners(this.db);
    if (!owners.some((o) => o.id === ctx.accountId)) throw new AppError('forbidden', 403);
    const b = await buildBackup(this.db, ctx.accountId);
    res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${fileName()}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(b.gz);
  }
}

/** Emails the backup to the system owner(s) once a day, after 02:00 Riyadh time. */
@Injectable()
export class BackupMailer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private timer: NodeJS.Timeout | null = null;
  private lastDay = '';
  constructor(@Inject(Db) private readonly db: Db) {}

  onModuleInit() {
    if (process.env.CF13_BACKUP_EMAIL === 'off' || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { this.tick().catch((e) => this.log.warn('backup email failed: ' + (e as Error).message)); }, 30 * 60 * 1000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (!mailReady()) return;
    const riyadh = new Date(Date.now() + 3 * 3600_000);
    const day = riyadh.toISOString().slice(0, 10);
    if (riyadh.getUTCHours() < 2 || this.lastDay === day) return;
    this.lastDay = day;
    for (const o of await platformOwners(this.db)) {
      const b = await buildBackup(this.db, o.id);
      if (b.gz.length > 35 * 1024 * 1024) { this.log.warn('backup too large to email; download it from the Companies page'); continue; }
      await sendMail(o.email, `Khitta daily backup ${day}`,
        `Hello ${o.name},\n\nAttached is the daily backup of ${b.companies} compan${b.companies === 1 ? 'y' : 'ies'} (${Math.round(b.gz.length / 1024)} KB compressed).\nKeep it somewhere safe; it holds your companies' budgets, plans and members. Passwords and keys are not in it.\n\nKhitta · خطة`,
        undefined, [{ filename: fileName(), content: b.gz.toString('base64') }]);
      this.log.log(`backup emailed to the system owner (${b.companies} companies, ${b.gz.length} bytes)`);
    }
  }
}
