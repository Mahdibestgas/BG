import { Body, Controller, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { dayNum, forecast, isoOf, isRealDate, rollupL3, TEMPLATES, type CoreModel, type ForecastResult } from '@cf13/engine';
import { Db } from './db';
import { amount, AppError, Context, isUuid, KeyOk, Roles, str, type Ctx } from './http';

const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);

/** The forecast as the screens use it: L1, L2, every L3 row; L4 items on request. */
function forecastView(r: ForecastResult, model: CoreModel, fromWeek: number) {
  const N = r.calendar.weeks.length;
  const l3: Record<string, Array<{ l3: string; label: unknown; values: number[]; items: number }>> = {};
  for (const c of r.categories) l3[c.id] = rollupL3(r, c.id).map((row) => ({ l3: row.l3, label: row.label, values: row.values, items: row.items.length }));
  let lowest = 0;
  for (let w = 1; w < N; w++) if (r.l1.closing[w] < r.l1.closing[lowest]) lowest = w;
  const from = Math.max(0, Math.min(N - 1, fromWeek | 0));
  const up: Record<string, { cat: string; l3: string; label: unknown; week: number; date: string | null; amount: number }> = {};
  const section: Record<string, string> = {};
  r.categories.forEach((c) => { section[c.id] = c.section; });
  for (const it of r.items) {
    if (it.w < from || it.w >= from + 2 || section[it.cat] !== 'payments') continue;
    const k = it.cat + '|' + it.l3 + '|' + it.w;
    (up[k] ||= { cat: it.cat, l3: it.l3, label: it.label, week: it.w, date: it.date || null, amount: 0 }).amount += it.amount;
  }
  return {
    weeks: r.calendar.weeks.map((w) => ({ label: w.label, start: w.startIso, end: w.endIso })),
    categories: r.categories, l1: r.l1, l2: r.l2, l3, vat: r.vat, checks: r.checks,
    upcoming: Object.values(up).sort((a, b) => b.amount - a.amount).slice(0, 6),
    headline: {
      openingCash: r.l1.opening[0], closingCash: r.l1.closing[N - 1], lowestCash: r.l1.closing[lowest], lowestWeek: lowest,
      peakFacility: Math.max(...r.l1.facility), facilityLimit: model.financing.facilityLimit, minBuffer: model.financing.minBuffer,
      totalReceipts: sum(r.l1.receipts), totalPayments: sum(r.l1.payments), items: r.items.length, checksOk: r.checks.every((c) => c.ok)
    },
    demo: r.demo
  };
}

function schedule(arr: unknown, field: string, n: number): number[] {
  if (!Array.isArray(arr) || !arr.length || arr.length > n) throw new AppError('invalid_schedule:' + field);
  const out = arr.map((x, i) => { const v = amount(x, field + '.' + i); if (v > 1) throw new AppError('invalid_schedule:' + field); return v; });
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  if (Math.abs(sum(out) - 1) > 0.0005) throw new AppError('schedule_not_100:' + field);
  return out;
}

@Controller('api/plans')
export class PlansController {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async plan(ctx: Ctx, id: string) {
    if (!isUuid(id)) throw new AppError('not_found', 404);
    // row-level security already limits this to the company; a plan of another company is simply not found
    const p = await this.db.inTenant(ctx.tenantId, (tx) => tx.plan.findUnique({ where: { id } }));
    if (!p) throw new AppError('not_found', 404);
    return p;
  }

  /**
   * Loads a plan file (as written by bank/build_forecast.py) into this company. The engine must run it with every
   * check passing, or nothing is saved. A plan with the same name becomes a new version; demo plans can be hidden.
   */
  @Post('import') @Roles('owner', 'finance')
  async importPlan(@Context() ctx: Ctx, @Body() b: any) {
    const model = b?.model as CoreModel & { meta: { name?: string; demo?: boolean } };
    if (!model || typeof model !== 'object' || !model.meta || typeof model.template !== 'string') throw new AppError('invalid_plan_file');
    if (!Object.prototype.hasOwnProperty.call(TEMPLATES, model.template)) throw new AppError('unknown_template');
    const name = str(b?.name || model.meta.name || 'Imported plan', 'name', 120);
    let r: ForecastResult;
    try { r = forecast(model); } catch (e) { throw new AppError('invalid_plan_file:' + ((e as Error).message || 'engine').slice(0, 80), 422); }
    const failed = r.checks.filter((c) => !c.ok);
    if (failed.length) throw new AppError('plan_checks_failed:' + failed.map((c) => c.id).join(',').slice(0, 120), 422);
    const hideDemo = b?.hideDemo !== false;
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.plan.findFirst({ where: { name, status: { not: 'archived' } } });
      if (existing?.status === 'locked') throw new AppError('plan_locked', 409);
      const saved = existing
        ? await tx.plan.update({ where: { id: existing.id }, data: { model: model as any, version: { increment: 1 } } })
        : await tx.plan.create({ data: { tenantId: ctx.tenantId, name, model: model as any, createdBy: ctx.accountId } });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: existing ? 'plan_refreshed' : 'plan_imported', entity: 'plan', entityId: saved.id,
        changes: { name, template: model.template, start: model.meta.startDate, weeks: r.l1.closing.length, from: 'upload' } } });
      let hidden = 0;
      if (hideDemo && !model.meta.demo) {
        const all = await tx.plan.findMany({ where: { status: { notIn: ['archived', 'locked'] } }, select: { id: true, name: true, model: true } });
        for (const p of all) {
          if (p.id === saved.id || !(p.model as any)?.meta?.demo) continue;
          await tx.plan.update({ where: { id: p.id }, data: { status: 'archived' } });
          await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'plan_archived', entity: 'plan', entityId: p.id, changes: { name: p.name, reason: 'demo hidden after import' } } });
          hidden++;
        }
      }
      const N = r.l1.closing.length;
      return { ok: true, planId: saved.id, name, version: saved.version, weeks: N, closing: r.l1.closing[N - 1], hiddenDemo: hidden };
    });
  }

  @Get() @KeyOk()
  async list(@Context() ctx: Ctx) {
    const rows = await this.db.inTenant(ctx.tenantId, (tx) => tx.plan.findMany({ where: { status: { not: 'archived' } }, orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, status: true, version: true, updatedAt: true, model: true } }));
    return { ok: true, plans: rows.map((p) => { const m = p.model as any; return { id: p.id, name: p.name, status: p.status, version: p.version, updatedAt: p.updatedAt,
      startDate: m.meta.startDate, weeks: m.meta.weeks || 13, template: m.template, demo: !!m.meta.demo }; }) };
  }

  @Get(':id') @KeyOk()
  async get(@Context() ctx: Ctx, @Param('id') id: string) {
    const p = await this.plan(ctx, id);
    return { ok: true, plan: { id: p.id, name: p.name, status: p.status, version: p.version, updatedAt: p.updatedAt }, model: p.model };
  }

  @Get(':id/forecast') @KeyOk()
  async forecast(@Context() ctx: Ctx, @Param('id') id: string, @Query('fromWeek') fromWeek?: string) {
    const p = await this.plan(ctx, id);
    const model = p.model as unknown as CoreModel;
    return { ok: true, plan: { id: p.id, name: p.name, status: p.status, version: p.version }, forecast: forecastView(forecast(model), model, Number(fromWeek) || 0) };
  }

  /** L4: the individual items behind one L3 row of one L2 line, week by week. */
  @Get(':id/items') @KeyOk()
  async items(@Context() ctx: Ctx, @Param('id') id: string, @Query('cat') cat?: string, @Query('l3') l3?: string) {
    const p = await this.plan(ctx, id);
    if (typeof cat !== 'string' || !/^[A-Z_]{2,30}$/.test(cat) || typeof l3 !== 'string' || l3.length > 120) throw new AppError('bad_request');
    const r = forecast(p.model as unknown as CoreModel);
    const rows = r.items.filter((it) => it.cat === cat && it.l3 === l3)
      .map((it) => ({ w: it.w, amount: it.amount, note: it.note || null, date: it.date || null, ref: it.ref || null, dims: it.dims, overdue: !!it.overdue }));
    if (rows.length > 2000) throw new AppError('too_many_items');
    return { ok: true, items: rows };
  }

  /** Board approvals recorded against this plan, newest first (each is a permanent audit entry). */
  @Get(':id/approvals') @KeyOk()
  async approvals(@Context() ctx: Ctx, @Param('id') id: string) {
    if (!isUuid(id)) throw new AppError('not_found', 404);
    const rows = await this.db.inTenant(ctx.tenantId, (tx) => tx.auditEntry.findMany({ where: { entity: 'plan', entityId: id, action: 'plan_approved' }, orderBy: { at: 'desc' }, take: 20 }));
    return { ok: true, approvals: rows.map((r) => ({ id: r.id, at: r.at, changes: r.changes })) };
  }

  /** The board has approved this version of the plan. Records who, when, which resolution, and the numbers approved. Never changes the plan itself. */
  @Post(':id/approve') @Roles('owner')
  async approve(@Context() ctx: Ctx, @Param('id') id: string, @Body() b: any) {
    if (!isUuid(id)) throw new AppError('not_found', 404);
    if (b?.confirm !== true) throw new AppError('confirm_required');
    const approvedBy = str(b?.approvedBy, 'approvedBy', 300), meeting = str(b?.meeting, 'meeting', 10), resolution = str(b?.resolution, 'resolution', 80), notes = str(b?.notes, 'notes', 1000, false);
    if (!isRealDate(meeting)) throw new AppError('invalid_date:meeting');
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      const p = await tx.plan.findUnique({ where: { id } });
      if (!p) throw new AppError('not_found', 404);
      if (b?.version !== p.version) throw new AppError('stale_plan', 409);          // the board approves exactly the version it saw
      const model = p.model as unknown as CoreModel;
      const r = forecast(model);
      if (!r.checks.every((c) => c.ok)) throw new AppError('checks_failed', 409);   // a plan whose levels do not tie is never approved
      const N = r.l1.closing.length;
      const entry = await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'plan_approved', entity: 'plan', entityId: id,
        changes: { planName: p.name, version: p.version, approvedBy, meeting, resolution, notes, numbers: { opening: r.l1.opening[0], closing: r.l1.closing[N - 1], lowest: Math.min(...r.l1.closing), receipts: sum(r.l1.receipts), payments: sum(r.l1.payments), weeks: N, start: (model as any).meta?.startDate } } } });
      return { ok: true, id: entry.id };
    });
  }

  /** Opening balances: bank accounts, receivables, supplier payable, VAT. Writes a new plan version. */
  @Put(':id/opening') @Roles('owner', 'finance')
  async opening(@Context() ctx: Ctx, @Param('id') id: string, @Body() b: any) {
    return this.db.inTenant(ctx.tenantId, async (tx) => {
      if (!isUuid(id)) throw new AppError('not_found', 404);
      const p = await tx.plan.findUnique({ where: { id } });
      if (!p) throw new AppError('not_found', 404);
      if (p.status === 'locked') throw new AppError('plan_locked', 409);
      if (b?.version !== p.version) throw new AppError('stale_plan', 409);
      const m = JSON.parse(JSON.stringify(p.model)) as any;
      const N = m.meta.weeks || 13, d = b?.data || {};
      const accounts = Array.isArray(d.bankAccounts) ? d.bankAccounts : [];
      if (!accounts.length || accounts.length > 50) throw new AppError('bank_accounts_required');
      const vatDue = d.vat?.dueDate ? str(d.vat.dueDate, 'vatDueDate', 10) : null;
      if (vatDue && !isRealDate(vatDue)) throw new AppError('invalid_date:vatDueDate');
      const opening = {
        asOf: isoOf(dayNum(m.meta.startDate) - 1),
        bankAccounts: accounts.map((a: any, i: number) => ({ id: str(a?.id, 'id', 24, false) || 'BA' + (i + 1), name: str(a?.name, 'account_name.' + i), bank: str(a?.bank, 'bank.' + i, 60, false), balance: amount(a?.balance, 'balance.' + i, true) })),
        receivables: { amount: amount(d.receivables?.amount, 'receivables'), schedule: schedule(d.receivables?.schedule, 'receivables', N) },
        payables: m.template === 'lpg-distribution' ? { amount: amount(d.payables?.amount, 'payables'), schedule: schedule(d.payables?.schedule, 'payables', N) } : undefined,
        vat: { payable: amount(d.vat?.payable, 'vat'), dueDate: vatDue },
        confirmed: d.confirmed === true
      };
      const before = m.opening || null;
      m.opening = opening;
      m.financing.openingCash = opening.bankAccounts.reduce((t: number, a: any) => t + a.balance, 0);
      m.openingReceivable = { amount: opening.receivables.amount, schedule: opening.receivables.schedule };
      if (opening.payables) { m.gasko.openingPayable = opening.payables.amount; m.gasko.openingSchedule = opening.payables.schedule; }
      m.financing.openingVatPayable = opening.vat.payable;
      m.financing.openingVatDueDate = opening.vat.dueDate;
      forecast(m); // a plan the engine cannot run is never saved
      const saved = await tx.plan.update({ where: { id }, data: { model: m, version: { increment: 1 } } });
      await tx.auditEntry.create({ data: { tenantId: ctx.tenantId, actorId: ctx.accountId, action: 'opening_balances_saved', entity: 'plan', entityId: id,
        changes: { before, after: opening, version: saved.version } } });
      return { ok: true, version: saved.version };
    });
  }
}
