// Department budgets end to end: deny by default for department heads, one department each,
// owner-only approval, immutable approved revisions, and company separation for the new tables.
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.CF13_QUIET = '1';
process.env.CF13_RATE = 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';

let app: INestApplication, base = '';
const asApp = new PrismaClient({ datasourceUrl: process.env.DATABASE_APP_URL });
const run = 'b' + Date.now().toString(36);
const PW = 'test-correct-horse-1';

class Client {
  cookie = '';
  async call(method: string, url: string, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-cf13': '1' };
    if (this.cookie) headers.cookie = this.cookie;
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : null } as { status: number; body: any };
  }
}
const O = new Client(), HR = new Client(), OPS = new Client(), X = new Client();
let tenant = '', tenantX = '', cycle = '';

async function join(owner: Client, who: Client, email: string, role: string, department?: string) {
  const inv = await owner.call('POST', '/api/members/invites', { email, role, department });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const acc = await who.call('POST', '/api/auth/invite/accept', { token: inv.body.token, name: 'Head ' + role, password: PW });
  assert.equal(acc.status, 201, JSON.stringify(acc.body));
}
const twelve = (x: number) => new Array(12).fill(x);

before(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + (app.getHttpServer().address() as any).port;
  let r = await O.call('POST', '/api/auth/signup', { company: 'Budget Gas ' + run, name: 'Owner', email: `test-o-${run}@example.com`, password: PW, template: 'lpg-distribution' });
  assert.equal(r.status, 201); tenant = r.body.tenant.id;
  r = await X.call('POST', '/api/auth/signup', { company: 'Other Co ' + run, name: 'Other', email: `test-x-${run}@example.com`, password: PW, template: 'generic' });
  assert.equal(r.status, 201); tenantX = r.body.tenant.id;
  await join(O, HR, `test-hr-${run}@example.com`, 'contributor', 'hr');
  await join(O, OPS, `test-ops-${run}@example.com`, 'contributor', 'operations');
});
after(async () => { await app.close(); await asApp.$disconnect(); });

test('a department head without a department cannot be invited', async () => {
  const r = await O.call('POST', '/api/members/invites', { email: `test-nodept-${run}@example.com`, role: 'contributor' });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_department');
});

test('a department head is denied everything except their own account, the company look and their budget', async () => {
  const me = await HR.call('GET', '/api/auth/me');
  assert.equal(me.status, 200); assert.equal(me.body.role, 'contributor'); assert.equal(me.body.department, 'hr');
  assert.equal((await HR.call('GET', '/api/tenant')).status, 200);
  for (const [m, u] of [['GET', '/api/plans'], ['GET', '/api/audit'], ['GET', '/api/members'], ['GET', '/api/keys'], ['PUT', '/api/tenant/branding'], ['POST', '/api/budget/cycles']] as const)
    assert.equal((await HR.call(m, u, m === 'GET' ? undefined : {})).status, 403, `${m} ${u}`);
  const plans = await O.call('GET', '/api/plans');
  assert.equal((await HR.call('GET', `/api/plans/${plans.body.plans[0].id}/forecast`)).status, 403, 'no cash plan for a department head');
});

test('the owner opens a 2027 cycle; each head sees only their own department and items', async () => {
  const c = await O.call('POST', '/api/budget/cycles', { name: 'Budget 2027', startMonth: '2027-01', months: 12, deadline: '2026-12-15' });
  assert.equal(c.status, 201, JSON.stringify(c.body)); cycle = c.body.id;
  const meta = await HR.call('GET', '/api/budget/meta');
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.pack.departments.map((d: any) => d.id), ['hr']);
  assert.ok(meta.body.pack.items.every((i: any) => i.dept === 'hr'));
  assert.equal(meta.body.cycles[0].monthKeys[11], '2027-12');
  assert.equal((await HR.call('GET', `/api/budget/cycles/${cycle}/departments/operations`)).status, 403);
  assert.equal((await HR.call('PUT', `/api/budget/cycles/${cycle}/departments/operations`, { version: 0, body: { lines: [] } })).status, 403);
  assert.equal((await HR.call('GET', `/api/budget/cycles/${cycle}/status`)).status, 403);
  assert.equal((await HR.call('GET', `/api/budget/cycles/${cycle}/consolidated`)).status, 403);
});

test('HR budgets positions; the server writes every HR line and keeps to versions', async () => {
  const pos = { id: 'drv', title: 'Driver', forDept: 'operations', region: 'riyadh', saudi: false, headcount: 10, basic: 2000, housing: 500, transport: 300, other: 0, from: 0, to: 11 };
  const forged = { id: 'f', item: 'hr_salaries', region: 'riyadh', desc: 'x', amounts: twelve(1), posId: 'drv' };
  let r = await HR.call('PUT', `/api/budget/cycles/${cycle}/departments/hr`, { version: 0, body: { positions: [pos], lines: [forged] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.body.lines.find((l: any) => l.item === 'hr_salaries').amounts[0], 28000);
  assert.equal((await HR.call('PUT', `/api/budget/cycles/${cycle}/departments/hr`, { version: 0, body: { positions: [pos] } })).status, 409, 'a stale save is refused');
  r = await HR.call('PUT', `/api/budget/cycles/${cycle}/departments/hr`, { version: 1, body: { positions: [pos], lines: [{ id: 'ot', item: 'op_fuel', region: 'riyadh', amounts: twelve(1) }] } });
  assert.equal(r.body.error, 'item_not_in_department:lines.0', 'HR cannot budget fuel');
});

test('submit, return with a comment, resubmit, approve: owner only, and an approved budget never changes', async () => {
  const dept = `/api/budget/cycles/${cycle}/departments/hr`;
  let r = await HR.call('POST', dept + '/submit', { version: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.status, 'submitted');
  assert.equal((await HR.call('PUT', dept, { version: 2, body: { positions: [] } })).status, 409, 'locked while waiting');
  assert.equal((await HR.call('POST', dept + '/approve', { version: 2 })).status, 403, 'a head cannot approve');
  assert.equal((await O.call('POST', dept + '/return', { version: 2 })).status, 400, 'a return needs a comment');
  r = await O.call('POST', dept + '/return', { version: 2, comment: 'Add the medical policy' });
  assert.equal(r.body.status, 'returned');
  const back = await HR.call('GET', dept);
  assert.equal(back.body.submission.reviewComment, 'Add the medical policy');
  const pos = { ...back.body.submission.body.positions[0], medicalAnnual: 1200 };
  r = await HR.call('PUT', dept, { version: 3, body: { positions: [pos] } });
  assert.equal(r.status, 200); assert.ok(r.body.body.lines.some((l: any) => l.item === 'hr_medical'));
  r = await HR.call('POST', dept + '/submit', { version: 4 }); assert.equal(r.body.status, 'submitted');
  r = await O.call('POST', dept + '/approve', { version: 5 }); assert.equal(r.status, 201); assert.equal(r.body.status, 'approved');
  r = await HR.call('PUT', dept, { version: 6, body: { positions: [] } });
  assert.equal(r.body.error, 'budget_approved_start_revision');
  r = await HR.call('POST', dept + '/revise', { version: 6 });
  assert.equal(r.body.revision, 2);
  const now = await HR.call('GET', dept);
  assert.equal(now.body.submission.revision, 2); assert.equal(now.body.approvedRevision, 1);
});

test('the company budget adds up the approved departments; the status board shows every department', async () => {
  const ops = `/api/budget/cycles/${cycle}/departments/operations`;
  let r = await OPS.call('PUT', ops, { version: 0, body: { lines: [
    { id: 'fuel', item: 'op_fuel', region: 'riyadh', desc: 'Trucks', amounts: twelve(30000) },
    { id: 'dyna', item: 'op_capex_vehicles', region: 'qassim', desc: '2 Dyna', basis: { qty: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0], price: 75000 } }] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await OPS.call('POST', ops + '/submit', { version: 1 });
  let c = await O.call('GET', `/api/budget/cycles/${cycle}/consolidated`);
  assert.deepEqual(c.body.included.map((x: any) => x.department), ['hr'], 'only approved counts');
  c = await O.call('GET', `/api/budget/cycles/${cycle}/consolidated?include=submitted`);
  assert.deepEqual(c.body.included.map((x: any) => x.department).sort(), ['hr', 'operations']);
  await O.call('POST', ops + '/approve', { version: 2 });
  c = await O.call('GET', `/api/budget/cycles/${cycle}/consolidated`);
  assert.equal(c.body.budget.kpi.capex, 150000);
  assert.equal(c.body.budget.byRegion.qassim.capex[2], 150000);
  assert.equal(c.body.budget.total.opex[0] > 30000, true);
  assert.equal(c.body.budget.headcount[0].nonSaudi, 10);
  const st = await O.call('GET', `/api/budget/cycles/${cycle}/status`);
  assert.equal(st.body.departments.length, 7);
  assert.equal(st.body.departments.find((d: any) => d.department === 'sales').status, 'not_started');
  assert.equal(st.body.departments.find((d: any) => d.department === 'hr').approvedRevision, 1);
  const audit = await O.call('GET', '/api/audit');
  assert.ok(audit.body.audit.some((a: any) => a.action === 'budget_approved'), 'approvals are in the audit trail');
});

test('another company cannot see this cycle, and the database refuses it too', async () => {
  assert.equal((await X.call('GET', `/api/budget/cycles/${cycle}/status`)).status, 404);
  assert.equal((await X.call('GET', `/api/budget/cycles/${cycle}/departments/hr`)).status, 404);
  const n = await asApp.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantX}, true)`;
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM budget_submissions WHERE tenant_id = ${tenant}::uuid`;
    return Number(rows[0].n);
  });
  assert.equal(n, 0, 'row-level security hides the other company');
  await assert.rejects(asApp.$queryRawUnsafe('SELECT count(*) FROM budget_cycles'), /app.tenant_id is not set/);
});

test('settings: owner only, version-checked, HR confirmation kept, and a city in use cannot be removed', async () => {
  const meta = await O.call('GET', '/api/budget/meta');
  const regions = meta.body.regions.map((r: any) => (r.id === 'arar' ? { ...r, name: { en: "Ar'ar city", ar: 'مدينة عرعر' } } : r));
  const params = { ...meta.body.params, medicalAnnual: 1500, confirmed: true };
  assert.equal((await HR.call('PUT', '/api/budget/settings', { version: meta.body.settingsVersion, regions, params })).status, 403, 'a head cannot change rates');
  let r = await O.call('PUT', '/api/budget/settings', { version: meta.body.settingsVersion, regions, params });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await O.call('PUT', '/api/budget/settings', { version: meta.body.settingsVersion, regions, params })).status, 409, 'a stale save is refused');
  const after = await HR.call('GET', '/api/budget/meta');
  assert.equal(after.body.params.confirmed, true); assert.equal(after.body.params.medicalAnnual, 1500);
  assert.equal(after.body.regions.find((x: any) => x.id === 'arar').name.en, "Ar'ar city", 'renamed, same id');
  r = await O.call('PUT', '/api/budget/settings', { version: r.body.version, regions: regions.filter((x: any) => x.id !== 'riyadh'), params });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'region_in_use:riyadh');
  const hr = await O.call('GET', `/api/budget/cycles/${cycle}/departments/hr`);
  assert.equal(hr.body.submission.body.lines.find((l: any) => l.item === 'hr_medical').amounts[0], 1000, 'a saved budget is not redrawn when the company rates change (1,200 a head, 10 people, /12)');
});

test('actuals: owner and finance only, a month is replaced as a whole, and bad rows are refused with their line', async () => {
  const a = `/api/budget/cycles/${cycle}/actuals`;
  assert.equal((await HR.call('GET', a)).status, 403, 'a department head cannot read actuals');
  assert.equal((await HR.call('PUT', a, { rows: [] })).status, 403);
  let r = await O.call('PUT', a, { rows: [{ month: '2027-01', item: 'op_fuel', region: 'riyadh', amount: 5000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.rows, 1);
  r = await O.call('PUT', a, { rows: [{ month: '2027-01', item: 'op_fuel', region: 'riyadh', amount: 7000 }], source: 'csv' });
  assert.equal(r.status, 200);
  r = await O.call('GET', a);
  assert.equal(r.body.rows.length, 1, 're-importing a month never doubles it'); assert.equal(r.body.rows[0].amount, 7000);
  r = await O.call('PUT', a, { rows: [{ month: '2026-12', item: 'op_fuel', region: 'riyadh', amount: 1 }] });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'month_outside_cycle:rows.0');
  r = await O.call('PUT', a, { rows: [{ month: '2027-01', item: 'nope', region: 'riyadh', amount: 1 }] });
  assert.equal(r.body.error, 'unknown_item:rows.0');
  const other = await X.call('GET', a);
  assert.ok([403, 404].includes(other.status), 'another company cannot reach this round');
  const n = await asApp.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantX}, true)`;
    return tx.$queryRawUnsafe<Array<{ c: bigint }>>('SELECT count(*)::bigint AS c FROM budget_actuals');
  });
  assert.equal(Number(n[0].c), 0, 'the database hides the actuals from another company');
});

test('budget against actual uses only approved departments and the months that have actuals', async () => {
  assert.equal((await HR.call('GET', `/api/budget/cycles/${cycle}/variance`)).status, 403);
  const r = await O.call('GET', `/api/budget/cycles/${cycle}/variance`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.actualMonths, ['2027-01']);
  assert.ok(r.body.included.length >= 1 && r.body.included.every((x: any) => typeof x.revision === 'number'));
  const fuel = r.body.rows.find((x: any) => x.item === 'op_fuel' && x.region === 'riyadh');
  assert.ok(fuel, 'an actual with no budget still shows'); assert.equal(fuel.actual[0], 7000);
});

test('the approved budget becomes a cash plan: owner only, checked by the engine, a second run is a new version', async () => {
  const p = `/api/budget/cycles/${cycle}/to-plan`;
  assert.equal((await HR.call('POST', p, { openingCash: 100000 })).status, 403);
  assert.equal((await O.call('POST', p, { openingCash: 'lots' })).status, 400);
  let r = await O.call('POST', p, { openingCash: 100000 });
  assert.equal(r.status, 201, JSON.stringify(r.body)); const id = r.body.planId;
  assert.ok(Number.isFinite(r.body.closing) && Number.isFinite(r.body.lowest));
  r = await O.call('POST', p, { openingCash: 150000 });
  assert.equal(r.body.planId, id, 'same plan'); assert.equal(r.body.version, 2, 'new version');
  const plans = await O.call('GET', '/api/plans');
  const plan = plans.body.plans.find((x: any) => x.id === id);
  assert.equal(plan.template, 'bank-history'); assert.ok(plan.name.endsWith('budget cash view'));
  const f = await O.call('GET', `/api/plans/${id}/forecast`);
  assert.equal(f.status, 200); assert.ok(f.body.forecast.checks.every((c: any) => c.ok), 'the engine checks pass');
});

test('only the system owner adds companies; each new company is its own space with them as owner', async () => {
  const body = { company: 'Second Co ' + run, companyAr: 'شركة ثانية', template: 'generic' };
  process.env.CF13_PLATFORM_OWNERS = `test-o-${run}@example.com`;
  try {
    assert.equal((await X.call('POST', '/api/auth/companies', body)).status, 403, 'another company owner is not the system owner');
    assert.equal((await HR.call('POST', '/api/auth/companies', body)).status, 403, 'a department head cannot');
    const me = await O.call('GET', '/api/auth/me'); assert.equal(me.body.platformOwner, true);
    const r = await O.call('POST', '/api/auth/companies', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const now = await O.call('GET', '/api/auth/me');
    assert.equal(now.body.tenantId, r.body.tenant.id, 'the session moves to the new company'); assert.equal(now.body.role, 'owner');
    assert.equal(now.body.companies.length, 2);
    assert.equal((await O.call('GET', `/api/budget/cycles/${cycle}/variance`)).status, 404, 'the first company data is not visible from the new one');
    await O.call('POST', '/api/auth/switch', { tenantId: tenant });
  } finally { delete process.env.CF13_PLATFORM_OWNERS; }
});

test('a plan file uploads only when every engine check passes, and then hides the demo plan', async () => {
  const fs = await import('node:fs');
  const file = path.resolve(__dirname, '../../../../bank/out/bestgas_plan_unitcost_to2027_2026-11-18.json');
  if (!fs.existsSync(file)) return;   // the bank output lives beside the repository, not in it
  const model = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal((await HR.call('POST', '/api/plans/import', { model })).status, 403, 'a department head cannot load plans');
  assert.equal((await O.call('POST', '/api/plans/import', { model: { meta: {} } })).status, 400);
  const broken = JSON.parse(JSON.stringify(model)); broken.template = 'nope';
  assert.equal((await O.call('POST', '/api/plans/import', { model: broken })).body.error, 'unknown_template');
  let r = await O.call('POST', '/api/plans/import', { model });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.version, 1); assert.equal(r.body.weeks, 60);
  const plans = await O.call('GET', '/api/plans');
  assert.ok(!plans.body.plans.some((p: any) => p.demo), 'the demo plan is hidden');
  r = await O.call('POST', '/api/plans/import', { model });
  assert.equal(r.body.version, 2, 'same name: a new version, not a copy');
});

test('my account: change email needs the password, a taken email is refused, email codes need a mail service', async () => {
  const D = new Client();
  await join(O, D, `test-acct-${run}@example.com`, 'finance');
  const sec = await D.call('GET', '/api/auth/security');
  assert.equal(sec.status, 200); assert.equal(sec.body.emailOtp, false); assert.equal(sec.body.totp, false);
  assert.equal((await D.call('POST', '/api/auth/email', { current: 'wrong-password-123', email: `test-new-${run}@example.com` })).status, 403);
  assert.equal((await D.call('POST', '/api/auth/email', { current: PW, email: `test-o-${run}@example.com` })).status, 409, 'someone else has that email');
  const ok = await D.call('POST', '/api/auth/email', { current: PW, email: `test-new-${run}@example.com` });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await D.call('GET', '/api/auth/me')).body.account.email, `test-new-${run}@example.com`, 'the session carries on');
  const fresh = new Client();
  assert.equal((await fresh.call('POST', '/api/auth/login', { email: `test-acct-${run}@example.com`, password: PW })).status, 401, 'the old email no longer signs in');
  assert.equal((await fresh.call('POST', '/api/auth/login', { email: `test-new-${run}@example.com`, password: PW })).status, 201);
  const saved = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  try { assert.equal((await D.call('POST', '/api/auth/email-otp', { password: PW, enabled: true })).body.error, 'email_not_configured'); }
  finally { if (saved) process.env.RESEND_API_KEY = saved; }
  assert.equal((await D.call('POST', '/api/auth/email-otp', { password: PW, enabled: false })).status, 201, 'turning it off always works');
});

test('guidance: owner and finance load it, each head sees only their own items, settings saves keep it, it can be removed', async () => {
  const body = { source: 'Bank cash flow', period: 'Sep to Nov 2026', items: { hr_salaries: 585775.5, op_rent: 254987, pr_gas: 17945596 } };
  assert.equal((await HR.call('PUT', '/api/budget/guidance', body)).status, 403, 'a head cannot load guidance');
  assert.equal((await O.call('PUT', '/api/budget/guidance', { ...body, items: { no_such_item: 1 } })).status, 400, 'unknown items are refused');
  assert.equal((await O.call('PUT', '/api/budget/guidance', { ...body, items: { op_rent: -5 } })).status, 400, 'negative amounts are refused');
  let r = await O.call('PUT', '/api/budget/guidance', body);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.items, 3);
  assert.deepEqual((await HR.call('GET', '/api/budget/meta')).body.guidance.items, { hr_salaries: 585775.5 }, 'HR sees only HR items');
  assert.deepEqual((await OPS.call('GET', '/api/budget/meta')).body.guidance.items, { op_rent: 254987 });
  const meta = (await O.call('GET', '/api/budget/meta')).body;
  assert.equal(Object.keys(meta.guidance.items).length, 3); assert.equal(meta.guidance.source, 'Bank cash flow');
  r = await O.call('PUT', '/api/budget/settings', { version: meta.settingsVersion, regions: meta.regions, params: meta.params });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(Object.keys((await O.call('GET', '/api/budget/meta')).body.guidance.items).length, 3, 'a settings save keeps the guidance');
  assert.equal((await X.call('GET', '/api/budget/meta')).body.guidance, null, 'another company sees none');
  r = await O.call('PUT', '/api/budget/guidance', { source: 'x', items: {} });
  assert.equal(r.status, 200); assert.equal((await O.call('GET', '/api/budget/meta')).body.guidance, null, 'removed');
});
