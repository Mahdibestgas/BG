/**
 * The generic forecast core. A template creates the industry's L4 items; the
 * core adds what every company has (opening receivables, other capex, loan
 * instalments, VAT returns, finance-entered schedules), rolls everything up to
 * L3/L2/L1, runs the bank balance week by week and proves the levels tie.
 */
import { buildCalendar, dayNum, EngineError, isoOf, monthEnd, monthStart, pct, r0, sum, weekOf, ymOf, zeros } from './calendar';
import type { AddItem, Calendar, Category, Check, CoreModel, ForecastResult, Item, L1, Schedule, Template, VatPeriodResult } from './types';

/** v2 = reproduce the Excel model v2 exactly, faults included (tests only). */
export const COMPAT_NOTES = {
  openingCash: "v2 opened each week from the previous week's facility utilisation instead of its closing cash.",
  openingVat: "v2 added the opening VAT payable to the first period's return; it now has its own due date.",
  accessoryCostFactor: 'v2 applied the scenario purchase-cost factor to the shell line only.',
  payDayClamp: 'v2 let a pay day past the month end roll into the next month; it is now held at the last day.',
  vatQuarterly: 'v2 ignored the quarterly VAT switch; quarterly filing is now supported.'
};

export function runForecast<M extends CoreModel>(model: M, template: Template<M>): ForecastResult {
  if (template.id !== model.template) throw new EngineError('template_mismatch');
  const v2 = !!(model.compat && model.compat.v2);
  const N = model.meta.weeks || 13;
  const cal = buildCalendar(model.meta.startDate, N, !!model.meta.anyStartDay);
  const categories = template.categories;
  const catIds = new Set(categories.map((c) => c.id));
  const items: Item[] = [];

  const add: AddItem = (cat, w, amount, l3, label, dims, extra) => {
    if (w < 0 || w >= N || !amount) return;
    if (!catIds.has(cat)) throw new EngineError('unknown_category:' + cat);
    items.push({ cat, w, amount, l3, label, dims: dims || {}, ...(extra || {}) });
  };

  // opening receivables (generic)
  model.openingReceivable.schedule.forEach((p, w) => {
    add('R_OPEN_AR', w, model.openingReceivable.amount * p, 'opening:ar', { en: 'Opening receivables', ar: 'الذمم المدينة الافتتاحية' }, {}, { ref: 'opening' });
  });

  const out = template.run(model, cal, add, { v2 });

  // other capex, weekly; loan instalments on the 1st
  const otherCapex = model.financing.otherCapexMonthly * 12 / 52;
  for (const wk of cal.weeks) add('P_CAPEX', wk.i, otherCapex, 'capex:other', { en: 'Other capex', ar: 'نفقات رأسمالية أخرى' }, {});
  for (const mo of cal.months) {
    add('P_LOAN', weekOf(cal, mo.start), model.financing.loanMonthly, 'loan', { en: 'Term loan', ar: 'القرض لأجل' },
      { counterparty: 'Bank' }, { date: isoOf(mo.start), note: { en: 'Instalment ' + mo.key, ar: 'قسط ' + mo.key } });
  }

  // VAT returns
  const vat = model.tax.vatRate;
  const vatOut: VatPeriodResult[] = [];
  vatPeriods(cal, model, v2).forEach((p, k) => {
    let o = 0, inP = 0, inO = 0;
    for (const wk of cal.weeks) {
      o += out.vat.output[wk.i] * p.weights[wk.i];
      inP += out.vat.inputPurchases[wk.i] * p.weights[wk.i];
      inO += out.vat.opexBase[wk.i] * p.weights[wk.i] * (model.tax.opexVatShare || 0) * vat;
    }
    const net = o - inP - inO, bf = (v2 && k === 0) ? model.financing.openingVatPayable : 0, w = weekOf(cal, p.due);
    vatOut.push({ key: p.key, output: o, inputPurchases: inP, inputOpex: inO, net, broughtForward: bf, total: net + bf, due: isoOf(p.due), week: w });
    add('P_VAT', w, net + bf, 'vat:' + p.key, { en: 'VAT period ' + p.key, ar: 'فترة الضريبة ' + p.key }, { counterparty: 'ZATCA' },
      { date: isoOf(p.due), note: { en: 'Output ' + r0(o) + ' less input ' + r0(inP + inO), ar: 'المخرجات ' + r0(o) + ' ناقص المدخلات ' + r0(inP + inO) } });
  });
  if (!v2 && model.financing.openingVatPayable) {
    // default: the return for the month before W1's month (W1's own month is a period computed above)
    const f = ymOf(cal.start);
    const od = model.financing.openingVatDueDate ? dayNum(model.financing.openingVatDueDate) : monthStart(f.y, f.m) - 1 + model.tax.vatDueDays;
    add('P_VAT', od < cal.start ? 0 : weekOf(cal, od), model.financing.openingVatPayable, 'vat:opening',
      { en: 'Opening VAT payable', ar: 'ضريبة القيمة المضافة المستحقة الافتتاحية' }, { counterparty: 'ZATCA' },
      { ref: 'opening', date: isoOf(od), overdue: od < cal.start });
  }

  for (const s of model.schedules || []) expandSchedule(s, cal, add);

  // roll up and run the bank balance
  const l2: Record<string, number[]> = {};
  for (const c of categories) l2[c.id] = zeros(N);
  for (const it of items) l2[it.cat][it.w] += it.amount;
  const L1: L1 = { receipts: zeros(N), payments: zeros(N), net: zeros(N), opening: zeros(N), interest: zeros(N),
    closing: zeros(N), facility: zeros(N), headroom: zeros(N), buffer: zeros(N), alert: [] };
  for (const c of categories) {
    if (c.section === 'receipts') l2[c.id].forEach((x, w) => { L1.receipts[w] += x; });
    if (c.section === 'payments') l2[c.id].forEach((x, w) => { L1.payments[w] += x; });
  }
  const fin = model.financing;
  for (let w = 0; w < N; w++) {
    L1.net[w] = L1.receipts[w] - L1.payments[w];
    L1.opening[w] = w === 0 ? fin.openingCash : (v2 ? L1.facility[w - 1] : L1.closing[w - 1]);
    L1.interest[w] = L1.opening[w] < 0 ? -L1.opening[w] * fin.facilityRate / 52 : 0;
    if (L1.interest[w]) {
      add('F_INTEREST', w, L1.interest[w], 'facility', { en: 'Overdraft / facility', ar: 'التسهيلات البنكية' }, { counterparty: 'Bank' });
      l2.F_INTEREST[w] += L1.interest[w];
    }
    L1.closing[w] = L1.opening[w] + L1.net[w] - L1.interest[w];
    L1.facility[w] = Math.max(0, -L1.closing[w]);
    L1.headroom[w] = fin.facilityLimit - L1.facility[w];
    L1.buffer[w] = L1.closing[w] - fin.minBuffer;
    L1.alert.push(L1.closing[w] < 0 ? (L1.facility[w] > fin.facilityLimit ? 'LIMIT_BREACHED' : 'FACILITY_DRAWN') : (L1.buffer[w] < 0 ? 'BELOW_BUFFER' : 'OK'));
  }

  const result: ForecastResult = { calendar: cal, categories, items, l2, l1: L1, drivers: out.drivers, vat: vatOut, checks: [], compat: v2 ? 'v2' : null, demo: !!model.meta.demo };
  result.checks = coreChecks(result, !!v2).concat(out.checks || []);
  if (out.salesConservation) {
    const sc = out.salesConservation;
    const received = sc.categories.reduce((t, c) => t + sum(l2[c]), 0);
    const diff = sc.sold - received - sc.afterWindow;
    result.checks.splice(4, 0, { id: 'sales_to_cash', en: 'Sales = receipts + settlements after W' + N, ar: 'المبيعات = المقبوضات + التسويات بعد الأسبوع ' + N, diff, ok: Math.abs(diff) < 0.005 });
  }
  return result;
}

interface VatPeriod { key: string; weights: number[]; due: number }
function vatPeriods(cal: Calendar, model: CoreModel, v2: boolean): VatPeriod[] {
  if (v2 || model.tax.vatFiling !== 2) return cal.months.map((mo) => ({ key: mo.key, weights: mo.weights, due: mo.end + model.tax.vatDueDays }));
  const byQ: Record<string, VatPeriod> = {}, list: VatPeriod[] = [];
  for (const mo of cal.months) {
    const q = mo.y + '-Q' + (Math.floor(mo.m / 3) + 1);
    if (!byQ[q]) { byQ[q] = { key: q, weights: zeros(cal.weeks.length), due: monthEnd(mo.y, Math.floor(mo.m / 3) * 3 + 2) + model.tax.vatDueDays }; list.push(byQ[q]); }
    mo.weights.forEach((x, i) => { byQ[q].weights[i] += x; });
  }
  return list;
}

/** A finance-entered L4 line. Dated before W1 = overdue, paid in W1. */
export function expandSchedule(s: Schedule, cal: Calendar, add: AddItem): void {
  const first = dayNum(s.date);
  const freq = (s.recurrence && s.recurrence.freq) || 'once';
  const until = s.recurrence && s.recurrence.until ? dayNum(s.recurrence.until) : cal.end;
  const dates: number[] = [];
  if (freq === 'once') dates.push(first);
  else if (freq === 'weekly') for (let d = first; d <= Math.min(until, cal.end); d += 7) dates.push(d);
  else {
    const step = freq === 'quarterly' ? 3 : 1, ym = ymOf(first), dom = new Date(first * 86400000).getUTCDate();
    for (let k = 0; k < 60; k++) {
      const y = ym.y + Math.floor((ym.m + k * step) / 12), m = (ym.m + k * step) % 12;
      const dn = monthStart(y, m) + Math.min(dom, monthEnd(y, m) - monthStart(y, m) + 1) - 1;
      if (dn > Math.min(until, cal.end)) break;
      dates.push(dn);
    }
  }
  const cat = s.cat || (s.amount >= 0 ? 'P_OTHER' : 'R_OTHER');
  for (const dn of dates) {
    if (dn > cal.end) continue;
    const overdue = dn < cal.start;
    add(cat, overdue ? 0 : weekOf(cal, dn), Math.abs(s.amount), 'sched:' + (s.counterparty || s.id),
      { en: s.counterparty || s.labelEn || s.id, ar: s.counterparty || s.labelAr || s.id },
      { counterparty: s.counterparty, branchId: s.branchId },
      { ref: 'schedule', scheduleId: s.id, date: isoOf(dn), overdue, status: s.status || 'forecast', note: { en: s.labelEn || '', ar: s.labelAr || s.labelEn || '' } });
  }
}

export interface L3Row { l3: string; label: Item['label']; values: number[]; items: Item[] }
/** L3 rows of one category, in first-seen order. */
export function rollupL3(result: ForecastResult, catId: string): L3Row[] {
  const N = result.calendar.weeks.length, rows: L3Row[] = [], byKey: Record<string, L3Row> = {};
  for (const it of result.items) {
    if (it.cat !== catId) continue;
    let r = byKey[it.l3];
    if (!r) { r = byKey[it.l3] = { l3: it.l3, label: it.label, values: zeros(N), items: [] }; rows.push(r); }
    r.values[it.w] += it.amount;
    r.items.push(it);
  }
  return rows;
}

function coreChecks(r: ForecastResult, v2: boolean): Check[] {
  const N = r.calendar.weeks.length, checks: Check[] = [];
  const chk = (id: string, en: string, ar: string, diff: number) => checks.push({ id, en, ar, diff, ok: Math.abs(diff) < 0.005 });
  let d43 = 0, d32 = 0;
  for (const c of r.categories) {
    const rows = rollupL3(r, c.id);
    for (let w = 0; w < N; w++) {
      let l3 = 0;
      for (const row of rows) {
        l3 += row.values[w];
        let l4 = 0;
        for (const it of row.items) if (it.w === w) l4 += it.amount;
        d43 = Math.max(d43, Math.abs(l4 - row.values[w]));
      }
      d32 = Math.max(d32, Math.abs(l3 - r.l2[c.id][w]));
    }
  }
  chk('l4_l3', 'L4 items add up to L3', 'بنود المستوى ٤ تساوي المستوى ٣', d43);
  chk('l3_l2', 'L3 rows add up to L2', 'صفوف المستوى ٣ تساوي المستوى ٢', d32);
  let d21 = 0;
  for (let w = 0; w < N; w++) {
    let rec = 0, pay = 0;
    for (const c of r.categories) { if (c.section === 'receipts') rec += r.l2[c.id][w]; if (c.section === 'payments') pay += r.l2[c.id][w]; }
    d21 = Math.max(d21, Math.abs(rec - r.l1.receipts[w]), Math.abs(pay - r.l1.payments[w]));
  }
  chk('l2_l1', 'L2 categories add up to L1', 'فئات المستوى ٢ تساوي المستوى ١', d21);
  let roll = 0;
  for (let k = 0; k < N; k++) {
    roll = Math.max(roll, Math.abs(r.l1.opening[k] + r.l1.receipts[k] - r.l1.payments[k] - r.l1.interest[k] - r.l1.closing[k]));
    if (k > 0 && !v2) roll = Math.max(roll, Math.abs(r.l1.opening[k] - r.l1.closing[k - 1]));
  }
  chk('cash_roll', "Each week opens with last week's closing cash", 'كل أسبوع يبدأ برصيد إقفال الأسبوع السابق', roll);
  return checks;
}

export { pct };
export type { Category };
