import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetError, cleanSubmission, consolidate, KSA_HR_DEFAULTS, KSA_LPG, monthKeys, positionLines, type Position } from '../src';

const params = { ...KSA_HR_DEFAULTS, medicalAnnual: 1200 };
const regions = KSA_LPG.regions.map((r) => r.id);
const pos = (o: Partial<Position> = {}): Position => ({ id: 'p1', title: 'Driver', forDept: 'operations', region: 'riyadh', saudi: false, headcount: 10,
  basic: 2000, housing: 500, transport: 300, other: 0, from: 0, to: 11, eosbFullMonth: false, ...o });

test('every item belongs to a known department, and ids are unique', () => {
  const depts = new Set(KSA_LPG.departments.map((d) => d.id));
  assert.ok(KSA_LPG.items.every((i) => depts.has(i.dept)));
  assert.equal(new Set(KSA_LPG.items.map((i) => i.id)).size, KSA_LPG.items.length);
  for (const d of ['hr', 'operations', 'procurement', 'sales', 'sales_team', 'marketing', 'finance_admin']) assert.ok(depts.has(d), d);
});

test('month keys run across the year end', () => {
  assert.deepEqual(monthKeys('2026-11', 4), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.throws(() => monthKeys('2026-13', 2), BudgetError);
});

test('HR calculator: non-Saudi driver, KSA costs per month', () => {
  const ls = positionLines(pos(), 12, params);
  const get = (item: string) => ls.find((l) => l.item === item)!.amounts[0];
  assert.equal(get('hr_salaries'), 28000);                 // (2000+500+300) x 10
  assert.equal(get('hr_gosi'), 500);                       // 2% of (2000+500) x 10
  assert.equal(get('hr_eosb'), 1166.67);                   // half a month a year of 2800, /12, x 10
  assert.equal(get('hr_levy'), 8000);                      // 800 x 10
  assert.equal(get('hr_iqama'), 625);                      // (650+100)/12 x 10
  assert.equal(get('hr_medical'), 1000);                   // 1200/12 x 10
});

test('HR calculator: Saudi employee pays GOSI at 11.75% within the cap, no levy, and only in their months', () => {
  const ls = positionLines(pos({ saudi: true, headcount: 1, basic: 50000, housing: 10000, transport: 0, from: 3, to: 5 }), 12, params);
  const gosi = ls.find((l) => l.item === 'hr_gosi')!;
  assert.equal(gosi.amounts[3], 5287.5);                   // 11.75% of the 45,000 cap
  assert.equal(gosi.amounts[2], 0); assert.equal(gosi.amounts[6], 0);
  assert.ok(!ls.some((l) => l.item === 'hr_levy' || l.item === 'hr_iqama'));
});

test('a submission keeps to its own department, its cities and its months, and HR lines are always recalculated', () => {
  const c = { pack: KSA_LPG, dept: 'hr', months: 12, regions, params };
  const forged = { id: 'x', item: 'hr_salaries', region: 'riyadh', desc: 'forged', amounts: new Array(12).fill(1), posId: 'p1' };
  const body = cleanSubmission({ positions: [pos()], lines: [forged] }, c);
  assert.ok(body.lines.every((l) => l.posId === 'p1'));
  assert.equal(body.lines.find((l) => l.item === 'hr_salaries')!.amounts[0], 28000, 'the forged salary line is replaced by the calculator');
  assert.throws(() => cleanSubmission({ lines: [{ id: 'a', item: 'op_fuel', region: 'riyadh', amounts: new Array(12).fill(1) }] }, c), /item_not_in_department/);
  assert.throws(() => cleanSubmission({ lines: [{ id: 'a', item: 'hr_overtime', region: 'mars', amounts: new Array(12).fill(1) }] }, c), /unknown_region/);
  assert.throws(() => cleanSubmission({ lines: [{ id: 'a', item: 'hr_overtime', region: 'riyadh', amounts: [1] }] }, c), /wrong_month_count/);
  assert.throws(() => cleanSubmission({ positions: [pos()] }, { ...c, dept: 'sales' }), /positions_hr_only/);
  const sales = cleanSubmission({ lines: [{ id: 's1', item: 'sa_branch_cash', region: 'jeddah', basis: { qty: new Array(12).fill(1000), price: 21.5 } }] }, { ...c, dept: 'sales' });
  assert.equal(sales.lines[0].amounts[0], 21500, 'quantity x price');
});

test('consolidation adds departments into revenue, gross profit, EBITDA and capex, by city', () => {
  const m = monthKeys('2027-01', 12), c = { pack: KSA_LPG, months: 12, regions, params };
  const twelve = (x: number) => new Array(12).fill(x);
  const sales = cleanSubmission({ lines: [{ id: 's', item: 'sa_branch_cash', region: 'riyadh', amounts: twelve(100000) }] }, { ...c, dept: 'sales' });
  const proc = cleanSubmission({ lines: [{ id: 'g', item: 'pr_gas', region: 'riyadh', amounts: twelve(80000) }, { id: 'cy', item: 'pr_cylinders', region: 'qassim', amounts: twelve(5000) }] }, { ...c, dept: 'procurement' });
  const hr = cleanSubmission({ positions: [pos({ headcount: 1, medicalAnnual: 0 })] }, { ...c, dept: 'hr' });
  const r = consolidate(KSA_LPG, m, [{ dept: 'sales', body: sales }, { dept: 'procurement', body: proc }, { dept: 'hr', body: hr }]);
  assert.equal(r.kpi.revenue, 1200000);
  assert.equal(r.kpi.grossProfit, 240000);
  const hrMonth = 2800 + 50 + 116.67 + 800 + 62.5;          // salary, GOSI 2%, end of service, levy, iqama+permit
  assert.equal(Math.round(r.kpi.ebitda), Math.round(240000 - hrMonth * 12));
  assert.equal(r.kpi.capex, 60000);
  assert.equal(r.byRegion.qassim.capex[0], 5000);
  assert.equal(r.headcount[0].nonSaudi, 1);
});

import { budgetToCashPlan, cleanActuals, cleanPlan, cleanStudy, favourable, varianceRows } from '../src';

test('study and plan are kept, trimmed and bounded', () => {
  const s = cleanStudy({ situation: '  Riyadh grew 40%  ', market: 'x'.repeat(10) });
  assert.equal(s.situation, 'Riyadh grew 40%'); assert.equal(s.capacity, '');
  assert.throws(() => cleanStudy({ market: 'x'.repeat(4001) }), /too_long:study.market/);
  const p = cleanPlan({ vision: 'Market leader in Qassim', objectives: [{ id: 'o1', text: 'More delivery', kpi: 'Orders a month', unit: 'orders', baseline: '1,200', target: 3000 }],
    initiatives: [{ id: 'i1', title: 'Launch app', month: 2, objective: 'o1' }, { id: 'i2', title: 'Ghost', objective: 'nope' }], risks: [{ id: 'r1', risk: 'Aramco price', impact: 'high' }] }, 12);
  assert.equal(p.objectives[0].baseline, 1200); assert.equal(p.initiatives[1].objective, '', 'an unknown objective link is dropped');
  assert.throws(() => cleanPlan({ initiatives: [{ id: 'x', title: 't', month: 12 }] }, 12), /invalid_months/);
});

test('budget against actual: rows by item and city, favourable sign per kind', () => {
  const m = monthKeys('2027-01', 3), c = { pack: KSA_LPG, months: 3, regions, params };
  const sales = cleanSubmission({ lines: [{ id: 's', item: 'sa_branch_cash', region: 'riyadh', amounts: [100, 100, 100] }] }, { ...c, dept: 'sales' });
  const acts = cleanActuals([{ month: '2027-01', item: 'sa_branch_cash', region: 'riyadh', amount: 120 }, { month: '2027-01', item: 'op_fuel', region: 'jeddah', amount: 50 }], KSA_LPG, m, regions);
  assert.throws(() => cleanActuals([{ month: '2026-12', item: 'op_fuel', region: 'riyadh', amount: 1 }], KSA_LPG, m, regions), /month_outside_cycle/);
  const v = varianceRows(KSA_LPG, m, [{ body: sales }], acts);
  assert.deepEqual(v.actualMonths, ['2027-01']);
  const rs = v.rows.find((r) => r.item === 'sa_branch_cash')!, fuel = v.rows.find((r) => r.item === 'op_fuel')!;
  assert.equal(favourable(rs.kind, rs.budget[0], rs.actual[0]), 20, 'more sales than budget is favourable');
  assert.equal(favourable(fuel.kind, fuel.budget[0], fuel.actual[0]), -50, 'unbudgeted fuel is unfavourable');
});

test('an approved budget becomes a cash plan: VAT added, spread by day, net VAT paid the month after', () => {
  const m = monthKeys('2027-01', 2), c = { pack: KSA_LPG, months: 2, regions, params };
  const sales = cleanSubmission({ lines: [{ id: 's', item: 'sa_branch_cash', region: 'riyadh', amounts: [31000, 28000] }] }, { ...c, dept: 'sales' });
  const hr = cleanSubmission({ positions: [pos({ headcount: 1, medicalAnnual: 0, from: 0, to: 1 })] }, { ...c, dept: 'hr' });
  const plan = budgetToCashPlan(KSA_LPG, m, [{ body: sales }, { body: hr }], { openingCash: 500000, name: 'Budget cash view' });
  assert.equal(plan.meta.startDate, '2027-01-01'); assert.equal(plan.meta.endDate, '2027-02-28'); assert.equal(plan.meta.weeks, 9);
  const s = plan.lines.find((l: any) => l.l3 === 'budget:sa_branch_cash');
  assert.equal(s.monthly[0], 35650, '31,000 + 15% VAT');
  assert.equal(Math.round(s.values.reduce((a: number, b: number) => a + b, 0)), Math.round(35650 + 32200));
  assert.ok(!plan.lines.some((l: any) => l.l3 === 'budget:hr_eosb'), 'end of service accrual is not cash');
  const v = plan.lines.find((l: any) => l.l3 === 'budget:vat');
  assert.equal(v.monthly[1], 4650, 'January output VAT on sales, paid end of February (salaries carry none)');
  assert.equal(v.monthly[0], 0);
});

test('whole-company lines and the full catalogue: every department has its items, ids are unique, cash categories are known', () => {
  const regions = KSA_LPG.regions.map((r) => r.id);
  const c = { pack: KSA_LPG, dept: 'operations', months: 12, regions, params: KSA_HR_DEFAULTS };
  const body = cleanSubmission({ lines: [{ id: 'w', item: 'op_tga', region: 'company', amounts: new Array(12).fill(5000) }] }, c);
  assert.equal(body.lines[0].region, 'company', 'a line for the whole company is accepted');
  for (const d of KSA_LPG.departments) assert.ok(KSA_LPG.items.filter((i) => i.dept === d.id).length >= 9, d.id + ' has a full list');
  assert.equal(new Set(KSA_LPG.items.map((i) => i.id)).size, KSA_LPG.items.length);
  const known = /^(|R_(CASH|POS|CUSTOMERS|TRANSFERS|OTHER)|P_(KHAZEEN|SUPPLIERS|PAYROLL|GOSI|RESIDENTS|RENT|UTILITIES|DIESEL|STAFF|GOV|BANK|ZATCA|LOAN|CAPEX|POS_FEES))$/;
  for (const i of KSA_LPG.items) assert.match(i.cash, known, i.id + ' maps to a known cash category');
  for (const i of KSA_LPG.items.filter((x) => x.kind !== 'noncash' && !x.cash)) assert.ok(['op_cylinder_loss', 'pr_gas_loss'].includes(i.id), i.id + ' has no cash effect on purpose');
});

test('variance commentary: the tolerance is 5% and 5,000 SAR, year to date runs to the last month with actuals', async () => {
  const { needsExplanation, lineToDate, cleanCommentary } = await import('../src/index');
  assert.equal(needsExplanation(100000, -4999), false, 'under 5,000 never needs one');
  assert.equal(needsExplanation(200000, -9000), false, '4.5% is inside the tolerance');
  assert.equal(needsExplanation(100000, 5000), true, 'favourable gaps are explained too');
  assert.equal(needsExplanation(0, -6000), true, 'spend with no budget');
  const row = { item: 'op_fuel', dept: 'operations', kind: 'opex' as const, region: 'riyadh', budget: [10000, 10000, 10000], actual: [12000, 13000, 0] };
  const t = lineToDate(row, ['2027-01', '2027-02', '2027-03'], ['2027-01', '2027-02']);
  assert.deepEqual(t, { budget: 20000, actual: 25000, fav: -5000, asOf: '2027-02', needs: true });
  assert.equal(lineToDate(row, ['2027-01', '2027-02', '2027-03'], []).needs, false, 'no actuals, nothing to explain');
  assert.equal(cleanCommentary({ cause: 'weird', explanation: ' x ' }).cause, 'other');
  assert.throws(() => cleanCommentary({ explanation: '' }));
});
