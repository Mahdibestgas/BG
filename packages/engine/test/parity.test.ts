// The TypeScript engine must give exactly what the reference engine gives
// (app/Forecast.gs, itself tested against the Excel models), and exactly what
// Excel gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { forecast, rollupL3, EngineError, type LpgModel, type ForecastResult } from '../src';

const DEMO: LpgModel = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/demo-lpg.json'), 'utf8'));
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

// the reference engine, unmodified
const ref = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../../../app/Forecast.gs'), 'utf8'), ref);
// copied out of the sandbox, so its arrays compare like ours (deepEqual checks prototypes)
const runRef = (m: unknown) => JSON.parse(JSON.stringify((ref as any).runForecast_(JSON.parse(JSON.stringify(m)))));

const maxDiff = (a: number[], b: number[]) => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i])), 0);

function sameAsReference(m: LpgModel, label: string) {
  const r = forecast(m), x = runRef(m);
  for (const k of ['receipts', 'payments', 'net', 'opening', 'interest', 'closing', 'facility', 'headroom', 'buffer'] as const) {
    assert.ok(maxDiff(r.l1[k], x.l1[k]) < 1e-6, `${label}: L1 ${k}`);
  }
  assert.deepEqual(r.l1.alert, x.l1.alert, `${label}: alerts`);
  for (const c of r.categories) assert.ok(maxDiff(r.l2[c.id], x.l2[c.id]) < 1e-6, `${label}: L2 ${c.id}`);
  assert.equal(r.items.length, x.items.length, `${label}: same number of L4 items`);
  assert.deepEqual(r.vat.map((p) => [p.key, p.due, p.week, +p.total.toFixed(6)]), x.vat.map((p: any) => [p.key, p.due, p.week, +p.total.toFixed(6)]), `${label}: VAT returns`);
  assert.ok(r.checks.every((c) => c.ok), `${label}: checks ${r.checks.filter((c) => !c.ok).map((c) => c.id)}`);
  assert.deepEqual(r.checks.map((c) => c.id).sort(), x.checks.map((c: any) => c.id).sort(), `${label}: same checks`);
  return r;
}

test('same as the reference engine, base demo plan', () => { sameAsReference(clone(DEMO), 'base'); });

test('same as the reference engine across scenarios, filings, schedules and an overdraft', () => {
  const cases: Array<[string, (m: LpgModel) => void]> = [
    ['upside', (m) => { m.scenarios.active = 'upside'; }],
    ['downside', (m) => { m.scenarios.active = 'downside'; }],
    ['quarterly VAT', (m) => { m.tax.vatFiling = 2; }],
    ['overdrawn opening', (m) => { m.financing.openingCash = -3000000; }],
    ['pay day 31', (m) => { m.payroll.payDay = 31; }],
    ['branch basis 2, drivers in HR file', (m) => { m.payroll.branchBasis = 2; m.payroll.driversSeparate = false; }],
    ['credit 0 weeks, no advance', (m) => { m.gasko.creditWeeks = 0; m.gasko.advancePct = 0; }],
    ['two branches closed', (m) => { m.branches[0].active = false; m.branches[5].active = false; }],
    ['start mid-month', (m) => { m.meta.startDate = '2026-11-15'; }],
    ['schedules', (m) => { m.schedules = [
      { id: 'S1', cat: 'P_CAPEX', date: '2026-11-15', amount: 250000, counterparty: 'Truck dealer' },
      { id: 'S2', cat: 'P_OTHER', date: '2026-10-20', amount: 40000, counterparty: 'Law firm' },
      { id: 'S3', cat: 'P_OTHER', date: '2026-11-10', amount: 12000, counterparty: 'Security co.', recurrence: { freq: 'monthly' } },
      { id: 'S4', cat: 'R_OTHER', date: '2026-12-05', amount: 90000, counterparty: 'Insurance claim' },
      { id: 'S5', cat: 'P_OTHER', date: '2026-11-03', amount: 5000, counterparty: 'Cleaning', recurrence: { freq: 'weekly', until: '2026-12-31' } }]; }],
    ['v2 compatibility', (m) => { m.compat = { v2: true }; m.scenarios.active = 'downside'; }]
  ];
  for (const [label, change] of cases) { const m = clone(DEMO); change(m); sameAsReference(m, label); }
});

function excel(fixture: string) {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8'));
  const m = clone(DEMO); m.meta.startDate = fx.startDate; m.compat = { v2: true };
  const r = forecast(m), CF = fx.sheets.Cashflow_13W;
  const map: Record<string, string> = { 8: 'R_ONLINE', 9: 'R_POS', 10: 'R_CASH', 11: 'R_OPEN_AR', 15: 'P_GASKO_ADV', 16: 'P_GASKO_DEF', 17: 'P_GASKO_OPEN', 18: 'P_DRIVER_FEE', 19: 'P_PAYROLL', 20: 'P_DIESEL', 21: 'P_FLEET', 22: 'P_RENT', 23: 'P_UTIL', 24: 'P_GA', 25: 'P_VAT', 26: 'P_LOAN', 27: 'P_CAPEX' };
  for (const row of Object.keys(map)) assert.ok(maxDiff(r.l2[map[row]], CF[row].values) <= 0.01, `${fixture} Cashflow r${row}`);
  const l1: Record<string, keyof ForecastResult['l1']> = { 12: 'receipts', 28: 'payments', 31: 'net', 32: 'opening', 33: 'interest', 34: 'closing', 35: 'facility', 36: 'headroom', 37: 'buffer' };
  for (const row of Object.keys(l1)) assert.ok(maxDiff(r.l1[l1[row]] as number[], CF[row].values) <= 0.01, `${fixture} Cashflow r${row}`);
  const D = r.drivers as any;
  assert.ok(maxDiff(D.grossTotal, fx.sheets.Revenue['16'].values) <= 0.01, 'Revenue r16');
  assert.ok(maxDiff(D.purchasesExVat, fx.sheets.COGS_Inventory['41'].values) <= 0.01, 'COGS r41');
}
test('matches Excel model v2 (start 30-Aug-2026), cell by cell', () => excel('v2_2026-08-30.json'));
test('matches Excel model v3 (start 1-Nov-2026), cell by cell', () => excel('v3_2026-11-01.json'));

test('levels tie: L4 items sum to L3 rows sum to L2', () => {
  const r = forecast(clone(DEMO));
  for (const c of r.categories) {
    const rows = rollupL3(r, c.id);
    for (let w = 0; w < 13; w++) assert.ok(Math.abs(rows.reduce((t, x) => t + x.values[w], 0) - r.l2[c.id][w]) < 1e-6);
  }
});

test('refuses what it cannot plan', () => {
  const m = clone(DEMO);
  m.meta.startDate = '2026-11-02';
  assert.throws(() => forecast(m), (e: unknown) => e instanceof EngineError && e.code === 'start_not_sunday');
  m.meta.startDate = '2026-02-30';
  assert.throws(() => forecast(m), (e: unknown) => e instanceof EngineError && e.code === 'invalid_start_date');
  const m2 = clone(DEMO) as any; m2.template = 'casino';
  assert.throws(() => forecast(m2), (e: unknown) => e instanceof EngineError && e.code === 'unknown_template');
  const m3 = clone(DEMO); m3.schedules = [{ id: 'X', cat: 'P_NOPE', date: '2026-11-10', amount: 1 }];
  assert.throws(() => forecast(m3), (e: unknown) => e instanceof EngineError && e.code === 'unknown_category:P_NOPE');
});

test('generic template: any company, schedules only', () => {
  const m: any = { template: 'generic', meta: { startDate: '2026-11-01' }, tax: { vatRate: 0.15, vatFiling: 1, vatDueDays: 30 },
    financing: { openingCash: 1000000, openingVatPayable: 0, facilityLimit: 500000, facilityRate: 0.08, loanMonthly: 0, otherCapexMonthly: 0, minBuffer: 200000 },
    openingReceivable: { amount: 300000, schedule: [0.5, 0.5] },
    schedules: [{ id: 'C1', cat: 'R_CUSTOMERS', date: '2026-11-12', amount: 400000, counterparty: 'Client A', recurrence: { freq: 'monthly' } },
      { id: 'P1', cat: 'P_PAYROLL', date: '2026-11-27', amount: 900000, counterparty: 'Payroll', recurrence: { freq: 'monthly' } }] };
  const r = forecast(m);
  assert.equal(r.l1.opening[0], 1000000);
  assert.equal(Math.round(r.l1.receipts.reduce((a, b) => a + b, 0)), 300000 + 3 * 400000);
  assert.equal(Math.round(r.l1.payments.reduce((a, b) => a + b, 0)), 3 * 900000);
  assert.ok(r.l1.alert.includes('FACILITY_DRAWN') || r.l1.alert.includes('LIMIT_BREACHED'), 'payroll drives this company into the facility');
  assert.ok(r.checks.every((c) => c.ok));
});
