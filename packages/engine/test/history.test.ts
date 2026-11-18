import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast, rollupL3, EngineError, type HistoryModel } from '../src';

const base = (lines: HistoryModel['lines']): HistoryModel => ({
  template: 'bank-history', source: { en: 'test', ar: 'test', through: '2026-11-08' },
  meta: { startDate: '2026-11-01', weeks: 13, demo: false },
  tax: { vatRate: 0.15, vatFiling: 1, vatDueDays: 30 },
  financing: { openingCash: 11978, openingVatPayable: 0, openingVatDueDate: null, facilityLimit: 0, facilityRate: 0, loanMonthly: 0, otherCapexMonthly: 0, minBuffer: 0 },
  openingReceivable: { amount: 0, schedule: [1] }, lines
});
const w = (first: number, rest: number) => [first, ...new Array(12).fill(rest)];

test('a history plan runs, ties at every level and keeps actual vs forecast apart', () => {
  const m = base([
    { cat: 'R_CASH', l3: 'cash', label: { en: 'Cash', ar: 'نقد' }, values: w(3225000, 3200000), actualWeeks: 1, method: { en: 'avg', ar: 'متوسط' }, confidence: 'High' },
    { cat: 'R_OWNER', l3: 'owner', label: { en: 'Owner', ar: 'المالك' }, values: w(7600000, 0), actualWeeks: 1, method: { en: '-', ar: '-' }, confidence: 'Actual' },
    { cat: 'P_KHAZEEN', l3: 'KHAZEEN 1023249-الرياض', label: { en: 'Riyadh', ar: 'الرياض' }, values: w(5000000, 2900000), actualWeeks: 1, method: { en: '92%', ar: '92%' }, confidence: 'Medium' },
    { cat: 'P_OUTSIDE', l3: 'outside', label: { en: 'Outside', ar: 'خارج' }, values: w(4050000, 0), actualWeeks: 1, method: { en: '-', ar: '-' }, confidence: 'Actual' }
  ]);
  const r = forecast(m);
  assert.ok(r.checks.every((c) => c.ok), r.checks.filter((c) => !c.ok).map((c) => c.id).join());
  assert.equal(Math.round(r.l1.closing[0]), 11978 + 3225000 + 7600000 - 5000000 - 4050000);
  const k = rollupL3(r, 'P_KHAZEEN')[0];
  assert.equal(k.items.filter((i) => i.ref === 'actual').length, 1);
  assert.equal(k.items.filter((i) => i.ref === 'forecast').length, 12);
  assert.equal(k.items[0].note?.en, 'Actual, from the bank statement');
});

test('a history plan may start on any day (a Monday), weeks run from there', () => {
  const m = base([{ cat: 'R_CASH', l3: 'cash', label: { en: 'Cash', ar: 'نقد' }, values: w(100, 100), actualWeeks: 0, method: { en: '', ar: '' }, confidence: 'High' }]);
  m.meta.startDate = '2026-11-09';
  assert.throws(() => forecast(m), (e: unknown) => e instanceof EngineError && e.code === 'start_not_sunday', 'refused unless asked for');
  m.meta.anyStartDay = true;
  const r = forecast(m);
  assert.equal(r.calendar.weeks[0].startIso, '2026-11-09');
  assert.equal(r.calendar.weeks[12].endIso, '2027-02-07');
  assert.ok(r.checks.every((c) => c.ok));
});

test('a history plan refuses malformed lines and unknown categories', () => {
  assert.throws(() => forecast(base([{ cat: 'R_CASH', l3: 'x', label: { en: 'x', ar: 'x' }, values: [1, 2], actualWeeks: 0, method: { en: '', ar: '' }, confidence: 'High' }])), /history_line_length/);
  assert.throws(() => forecast(base([{ cat: 'R_NOPE', l3: 'x', label: { en: 'x', ar: 'x' }, values: w(1, 1), actualWeeks: 0, method: { en: '', ar: '' }, confidence: 'High' }])),
    (e: unknown) => e instanceof EngineError && e.code === 'unknown_category:R_NOPE');
  assert.throws(() => forecast(base([{ cat: 'R_CASH', l3: 'x', label: { en: 'x', ar: 'x' }, values: w(1, NaN), actualWeeks: 0, method: { en: '', ar: '' }, confidence: 'High' }])), /history_line_value/);
});

test('an end date inside the last week makes it a short week, and nothing is planned after it', () => {
  const m = base([{ cat: 'R_CASH', l3: 'cash', label: { en: 'Cash', ar: 'نقد' }, values: w(700, 700), actualWeeks: 0, method: { en: '-', ar: '-' }, confidence: 'High' }]);
  m.meta.endDate = '2027-01-28';                       // week 13 runs 24-30 Jan 2027: stop on Thursday 28th
  const r = forecast(m);
  assert.ok(r.checks.every((c) => c.ok));
  assert.equal(r.calendar.weeks[12].endIso, '2027-01-28');
  assert.equal(r.calendar.months[r.calendar.months.length - 1].key, '2027-01');
  assert.equal(r.calendar.months[r.calendar.months.length - 1].weights[12], 1);   // the short week sits wholly in January
  m.meta.endDate = '2027-02-05';
  assert.throws(() => forecast(m), (e: unknown) => e instanceof EngineError && e.code === 'end_date_outside_last_week');
  const g = { template: 'generic', meta: { startDate: '2026-11-01', weeks: 13, endDate: '2027-01-28' }, tax: m.tax, financing: m.financing, openingReceivable: m.openingReceivable, schedules: [] } as any;
  assert.throws(() => forecast(g), (e: unknown) => e instanceof EngineError && e.code === 'end_date_bank_history_only');
  m.meta.endDate = '2027-02-05';
  assert.throws(() => forecast(m), (e: unknown) => e instanceof EngineError && e.code === 'end_date_outside_last_week');
});
