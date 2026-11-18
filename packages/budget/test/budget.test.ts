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
