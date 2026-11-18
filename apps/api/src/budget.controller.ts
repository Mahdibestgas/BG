import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  BudgetError, cleanParams, cleanRegions, cleanSubmission, consolidate, DEFAULT_PARAMS, deptOf, itemOf, monthKeys, packOf, sum,
  type HrParams, type Pack, type SubmissionBody
} from '@cf13/budget';
import { Db } from './db';
import { AppError, Context, isUuid, Roles, str, type Ctx } from './http';

type Tx = Parameters<Parameters<Db['inTenant']>[1]>[0];
const asApp = (e: unknown): never => { if (e instanceof BudgetError) throw new AppError(e.code); throw e; };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Totals of one submission by kind, for status boards and the audit trail. */
function totals(pack: Pack, body: SubmissionBody) {
  const t = { revenue: 0, costs: 0, capex: 0, lines: body.lines.length, headcount: body.positions.reduce((n, p) => n + p.headcount, 0) };
  for (const l of body.lines) {
    const k = itemOf(pack, l.item)?.kind;
    const s = sum(l.amounts);
    if (k === 'revenue') t.revenue += s; else if (k === 'capex') t.capex += s; else if (k) t.costs += s;
  }
  t.revenue = Math.round(t.revenue); t.costs = Math.round(t.costs); t.capex = Math.round(t.capex);
  return t;
}

/**
 * Department budgets. A department head (role contributor) prepares their own department's budget and sees
 * nothing else; the owner approves or returns it; finance helps prepare and review. Approved revisions never
 * change: a later change is a new revision. Every step is in the audit trail.
 */
@Controller('api/budget')
export class BudgetController {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async settings(tx: Tx) {
    const s = await tx.budgetSettings.findFirst();
    const pack = packOf(s?.pack);
    return {
      pack, version: s?.version ?? 0,
      regions: (s?.regions as Array<{ id: string; name: { en: string; ar: string } }> | undefined) ?? pack.regions,
      params: s ? cleanParams(s.params) : DEFAULT_PARAMS
    };
  }
  private dept(ctx: Ctx, pack: Pack, dept: string) {
    if (!deptOf(pack, dept)) throw new AppError('not_found', 404);
    if (ctx.role === 'contributor' && ctx.department !== dept) throw new AppError('forbidden', 403);
  }
  private async cycle(tx: Tx, id: string) {
    if (!isUuid(id)) throw new AppError('not_found', 404);
    const c = await tx.budgetCycle.findUnique({ where: { id } });
    if (!c) throw new AppError('not_found', 404);
    return c;
  }
  private latest(tx: Tx, cycleId: string, department: string) {
    return tx.budgetSubmission.findFirst({ where: { cycleId, department }, orderBy: { revision: 'desc' } });
  }
  private audit(tx: Tx, ctx: Ctx, action: string, entityId: string, changes: object) {
    return tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action, entity: 'budget', entityId, changes: changes as any } });
  }

  /** What the screens need: the catalogue, the company's cities and HR parameters, the cycles, and who is asking. */
  @Get('meta') @Roles('owner', 'finance', 'contributor')
  async meta(@Context() ctx: Ctx) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const s = await this.settings(tx);
      const cycles = await tx.budgetCycle.findMany({ orderBy: { createdAt: 'desc' } });
      const departments = ctx.role === 'contributor' ? s.pack.departments.filter((d) => d.id === ctx.department) : s.pack.departments;
      const items = ctx.role === 'contributor' ? s.pack.items.filter((i) => i.dept === ctx.department) : s.pack.items;
      return {
        ok: true, you: { role: ctx.role, department: ctx.department ?? null },
        pack: { id: s.pack.id, name: s.pack.name, departments, allDepartments: s.pack.departments.map((d) => ({ id: d.id, name: d.name })), items },
        regions: s.regions, params: s.params, settingsVersion: s.version,
        cycles: cycles.map((c) => ({ id: c.id, name: c.name, startMonth: c.startMonth, months: c.months, monthKeys: monthKeys(c.startMonth, c.months), status: c.status, deadline: c.deadline, version: c.version }))
      };
    });
  }

  @Put('settings') @Roles('owner')
  async saveSettings(@Context() ctx: Ctx, @Body() b: any) {
    let regions, params: HrParams;
    try { regions = cleanRegions(b?.regions); params = cleanParams(b?.params); } catch (e) { return asApp(e); }
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const cur = await tx.budgetSettings.findFirst();
      if ((cur?.version ?? 0) !== b?.version) throw new AppError('stale_settings', 409);
      // a city still used by a budget line or position cannot disappear (rename it instead: its id stays)
      const keep = new Set(regions.map((r) => r.id));
      for (const sub of await tx.budgetSubmission.findMany({ select: { body: true } })) {
        const body = sub.body as unknown as SubmissionBody;
        const used = [...(body?.lines || []).map((l) => l.region), ...(body?.positions || []).map((p) => p.region)].find((r) => !keep.has(r));
        if (used) throw new AppError('region_in_use:' + used, 409);
      }
      const saved = cur
        ? await tx.budgetSettings.update({ where: { tenantId: ctx.tenantId }, data: { regions: regions as any, params: params as any, version: { increment: 1 } } })
        : await tx.budgetSettings.create({ data: { tenantId: ctx.tenantId, regions: regions as any, params: params as any, version: 1 } });
      await this.audit(tx, ctx, 'budget_settings_saved', ctx.tenantId, { regions: regions.map((r) => r.id), params });
      return { ok: true, version: saved.version };
    });
  }

  @Post('cycles') @Roles('owner')
  async createCycle(@Context() ctx: Ctx, @Body() b: any) {
    const name = str(b?.name, 'name', 80);
    const startMonth = str(b?.startMonth, 'startMonth', 7);
    const months = Number(b?.months);
    try { monthKeys(startMonth, months); } catch (e) { asApp(e); }
    const deadline = b?.deadline ? str(b.deadline, 'deadline', 10) : null;
    if (deadline && !DATE.test(deadline)) throw new AppError('invalid_date:deadline');
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const c = await tx.budgetCycle.create({ data: { tenantId: ctx.tenantId, name, startMonth, months, deadline, createdBy: ctx.accountId } });
      await this.audit(tx, ctx, 'budget_cycle_created', c.id, { name, startMonth, months, deadline });
      return { ok: true, id: c.id };
    });
  }

  @Patch('cycles/:id') @Roles('owner')
  async updateCycle(@Context() ctx: Ctx, @Param('id') id: string, @Body() b: any) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const c = await this.cycle(tx, id);
      if (b?.version !== c.version) throw new AppError('stale_cycle', 409);
      const data: { status?: string; deadline?: string | null; name?: string } = {};
      if (b?.status !== undefined) { if (!['open', 'closed'].includes(b.status)) throw new AppError('invalid_status'); data.status = b.status; }
      if (b?.deadline !== undefined) { const d = b.deadline ? str(b.deadline, 'deadline', 10) : null; if (d && !DATE.test(d)) throw new AppError('invalid_date:deadline'); data.deadline = d; }
      if (b?.name !== undefined) data.name = str(b.name, 'name', 80);
      const u = await tx.budgetCycle.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.audit(tx, ctx, 'budget_cycle_updated', id, data);
      return { ok: true, version: u.version };
    });
  }

  /** Where every department stands in a cycle: the owner's approval inbox. */
  @Get('cycles/:id/status') @Roles('owner', 'finance')
  async status(@Context() ctx: Ctx, @Param('id') id: string) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const c = await this.cycle(tx, id);
      const s = await this.settings(tx);
      const subs = await tx.budgetSubmission.findMany({ where: { cycleId: id }, orderBy: { revision: 'desc' } });
      const departments = s.pack.departments.map((d) => {
        const mine = subs.filter((x) => x.department === d.id);
        const last = mine[0], approved = mine.find((x) => x.status === 'approved');
        return {
          department: d.id, name: d.name, status: last?.status ?? 'not_started', revision: last?.revision ?? 0, version: last?.version ?? 0,
          updatedAt: last?.updatedAt ?? null, submittedAt: last?.submittedAt ?? null, reviewComment: last?.reviewComment ?? null,
          approvedRevision: approved?.revision ?? null, totals: last ? totals(s.pack, last.body as unknown as SubmissionBody) : null
        };
      });
      return { ok: true, cycle: { id: c.id, name: c.name, status: c.status, deadline: c.deadline, monthKeys: monthKeys(c.startMonth, c.months) }, departments };
    });
  }

  @Get('cycles/:id/departments/:dept') @Roles('owner', 'finance', 'contributor')
  async getDept(@Context() ctx: Ctx, @Param('id') id: string, @Param('dept') dept: string) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const s = await this.settings(tx);
      this.dept(ctx, s.pack, dept);
      const c = await this.cycle(tx, id);
      const all = await tx.budgetSubmission.findMany({ where: { cycleId: id, department: dept }, orderBy: { revision: 'desc' } });
      const last = all[0];
      return {
        ok: true, cycle: { id: c.id, name: c.name, status: c.status, deadline: c.deadline, monthKeys: monthKeys(c.startMonth, c.months) },
        department: dept,
        submission: last ? { id: last.id, revision: last.revision, status: last.status, version: last.version, body: last.body, submittedAt: last.submittedAt, reviewedAt: last.reviewedAt, reviewComment: last.reviewComment, updatedAt: last.updatedAt } : null,
        approvedRevision: all.find((x) => x.status === 'approved')?.revision ?? null,
        revisions: all.map((x) => ({ revision: x.revision, status: x.status, updatedAt: x.updatedAt }))
      };
    });
  }

  /** Saves a draft. Only a draft or a returned budget can change; the server recalculates every HR line. */
  @Put('cycles/:id/departments/:dept') @Roles('owner', 'finance', 'contributor')
  async saveDept(@Context() ctx: Ctx, @Param('id') id: string, @Param('dept') dept: string, @Body() b: any) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const s = await this.settings(tx);
      this.dept(ctx, s.pack, dept);
      const c = await this.cycle(tx, id);
      if (c.status !== 'open') throw new AppError('cycle_closed', 409);
      let body: SubmissionBody;
      try { body = cleanSubmission(b?.body, { pack: s.pack, dept, months: c.months, regions: s.regions.map((r) => r.id), params: s.params }); } catch (e) { return asApp(e); }
      const last = await this.latest(tx, id, dept);
      if ((last?.version ?? 0) !== b?.version) throw new AppError('stale_budget', 409);
      if (last && last.status === 'submitted') throw new AppError('budget_submitted', 409);
      if (last && last.status === 'approved') throw new AppError('budget_approved_start_revision', 409);
      const saved = last
        ? await tx.budgetSubmission.update({ where: { id: last.id }, data: { body: body as any, status: 'draft', version: { increment: 1 } } })
        : await tx.budgetSubmission.create({ data: { tenantId: ctx.tenantId, cycleId: id, department: dept, body: body as any, createdBy: ctx.accountId } });
      await this.audit(tx, ctx, 'budget_saved', saved.id, { cycle: id, department: dept, revision: saved.revision, ...totals(s.pack, body) });
      return { ok: true, version: saved.version, revision: saved.revision, body };
    });
  }

  private async move(ctx: Ctx, id: string, dept: string, b: any, from: string[], to: string, action: string, extra: (last: { body: unknown }) => object = () => ({})) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const s = await this.settings(tx);
      this.dept(ctx, s.pack, dept);
      const c = await this.cycle(tx, id);
      if (c.status !== 'open') throw new AppError('cycle_closed', 409);
      const last = await this.latest(tx, id, dept);
      if (!last) throw new AppError('not_found', 404);
      if (last.version !== b?.version) throw new AppError('stale_budget', 409);
      if (!from.includes(last.status)) throw new AppError('wrong_status:' + last.status, 409);
      const data = extra(last);
      const u = await tx.budgetSubmission.update({ where: { id: last.id }, data: { status: to, version: { increment: 1 }, ...data } });
      await this.audit(tx, ctx, action, last.id, { cycle: id, department: dept, revision: last.revision, ...totals(s.pack, last.body as unknown as SubmissionBody), ...('reviewComment' in data ? { comment: (data as any).reviewComment } : {}) });
      return { ok: true, status: u.status, version: u.version };
    });
  }

  @Post('cycles/:id/departments/:dept/submit') @Roles('owner', 'finance', 'contributor')
  submit(@Context() ctx: Ctx, @Param('id') id: string, @Param('dept') dept: string, @Body() b: any) {
    return this.move(ctx, id, dept, b, ['draft', 'returned'], 'submitted', 'budget_submitted', (last) => {
      if (!((last.body as SubmissionBody)?.lines?.length)) throw new AppError('empty_budget');
      return { submittedBy: ctx.accountId, submittedAt: new Date(), reviewComment: null };
    });
  }

  @Post('cycles/:id/departments/:dept/approve') @Roles('owner')
  approve(@Context() ctx: Ctx, @Param('id') id: string, @Param('dept') dept: string, @Body() b: any) {
    return this.move(ctx, id, dept, b, ['submitted'], 'approved', 'budget_approved', () => ({ reviewedBy: ctx.accountId, reviewedAt: new Date() }));
  }

  @Post('cycles/:id/departments/:dept/return') @Roles('owner', 'finance')
  sendBack(@Context() ctx: Ctx, @Param('id') id: string, @Param('dept') dept: string, @Body() b: any) {
    const comment = str(b?.comment, 'comment', 1000);
    return this.move(ctx, id, dept, b, ['submitted'], 'returned', 'budget_returned', () => ({ reviewedBy: ctx.accountId, reviewedAt: new Date(), reviewComment: comment }));
  }

  /** After approval, a change starts a new revision: a draft copy. The approved one stays as it was. */
  @Post('cycles/:id/departments/:dept/revise') @Roles('owner', 'finance', 'contributor')
  async revise(@Context() ctx: Ctx, @Param('id') id: string, @Param('dept') dept: string, @Body() b: any) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const s = await this.settings(tx);
      this.dept(ctx, s.pack, dept);
      const c = await this.cycle(tx, id);
      if (c.status !== 'open') throw new AppError('cycle_closed', 409);
      const last = await this.latest(tx, id, dept);
      if (!last || last.status !== 'approved') throw new AppError('not_approved', 409);
      if (last.version !== b?.version) throw new AppError('stale_budget', 409);
      const n = await tx.budgetSubmission.create({ data: { tenantId: ctx.tenantId, cycleId: id, department: dept, revision: last.revision + 1, body: last.body as any, createdBy: ctx.accountId } });
      await this.audit(tx, ctx, 'budget_revision_started', n.id, { cycle: id, department: dept, revision: n.revision });
      return { ok: true, revision: n.revision, version: n.version };
    });
  }

  /** The company budget: the latest approved revision of every department, added up. `include=submitted` previews what waits for approval. */
  @Get('cycles/:id/consolidated') @Roles('owner', 'finance')
  async consolidated(@Context() ctx: Ctx, @Param('id') id: string, @Query('include') include?: string) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const c = await this.cycle(tx, id);
      const s = await this.settings(tx);
      const subs = await tx.budgetSubmission.findMany({ where: { cycleId: id }, orderBy: { revision: 'desc' } });
      const use: Array<{ dept: string; body: SubmissionBody; status: string; revision: number }> = [];
      for (const d of s.pack.departments) {
        const mine = subs.filter((x) => x.department === d.id);
        const pick = (include === 'submitted' && mine[0]?.status === 'submitted') ? mine[0] : mine.find((x) => x.status === 'approved');
        if (pick) use.push({ dept: d.id, body: pick.body as unknown as SubmissionBody, status: pick.status, revision: pick.revision });
      }
      const keys = monthKeys(c.startMonth, c.months);
      const r = consolidate(s.pack, keys, use.map((u) => ({ dept: u.dept, body: u.body })));
      return { ok: true, cycle: { id: c.id, name: c.name, status: c.status, monthKeys: keys }, included: use.map((u) => ({ department: u.dept, status: u.status, revision: u.revision })), budget: r };
    });
  }
}
