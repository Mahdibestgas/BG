/**
 * The rest of the cycle around the numbers: each department's study and plan, the actuals that
 * come in month by month, the budget-versus-actual report, and the bridge from an approved budget
 * (monthly, excluding VAT) to a cash plan (weekly, VAT included) that the forecast screens read.
 */
import type { Item, Pack, Txt } from './catalog';
import { BudgetError, itemOf, type SubmissionBody } from './index';

const round2 = (x: number) => Math.round(x * 100) / 100;
function text(v: unknown, code: string, max: number): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw new BudgetError('too_long:' + code);
  return s;
}
function optNum(v: unknown, code: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new BudgetError('invalid_number:' + code);
  return round2(n);
}
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const id = (v: unknown, at: string) => { if (typeof v !== 'string' || !ID.test(v)) throw new BudgetError('invalid_id:' + at); return v; };

// ---------------------------------------------------------------- study and plan
/** Step 1, the study: where the department stands before it plans. */
export interface Study { situation: string; market: string; capacity: string; assumptions: string; evidence: string }
/** Step 2, the plan: where it wants to go, how, how it will be measured, and what could go wrong. */
export interface DeptPlan {
  vision: string;
  objectives: Array<{ id: string; text: string; kpi: string; unit: string; baseline: number | null; target: number | null }>;
  initiatives: Array<{ id: string; title: string; owner: string; month: number | null; objective: string }>;
  risks: Array<{ id: string; risk: string; impact: 'low' | 'medium' | 'high'; mitigation: string }>;
}
export const STUDY_FIELDS: Array<{ key: keyof Study; name: Txt; hint: Txt }> = [
  { key: 'situation', name: { en: 'Where we are today', ar: 'أين نحن اليوم' }, hint: { en: 'This year’s results, what worked, what did not. Volumes, costs, people, by city.', ar: 'نتائج هذا العام وما نجح وما لم ينجح. الكميات والتكاليف والموظفون حسب المدينة.' } },
  { key: 'market', name: { en: 'Market and customers', ar: 'السوق والعملاء' }, hint: { en: 'Demand, competitors, prices, seasons, regulation (Aramco prices, SASO, municipality, civil defence).', ar: 'الطلب والمنافسون والأسعار والمواسم والأنظمة (أسعار أرامكو، المواصفات، البلدية، الدفاع المدني).' } },
  { key: 'capacity', name: { en: 'Resources and constraints', ar: 'الموارد والقيود' }, hint: { en: 'Fleet, branches, systems, headcount, Saudization (Nitaqat) band, licences that expire.', ar: 'الأسطول والفروع والأنظمة والعدد ونطاق التوطين والتراخيص التي تنتهي.' } },
  { key: 'assumptions', name: { en: 'Key assumptions for the budget', ar: 'الافتراضات الرئيسية للميزانية' }, hint: { en: 'Growth, prices, costs, hires, openings: the numbers the budget rests on.', ar: 'النمو والأسعار والتكاليف والتعيينات والافتتاحات: الأرقام التي تقوم عليها الميزانية.' } },
  { key: 'evidence', name: { en: 'Data and sources', ar: 'البيانات والمصادر' }, hint: { en: 'Where the figures come from: ERP reports, bank, contracts, quotations, studies.', ar: 'مصادر الأرقام: تقارير النظام، البنك، العقود، عروض الأسعار، الدراسات.' } }
];
export const EMPTY_STUDY: Study = { situation: '', market: '', capacity: '', assumptions: '', evidence: '' };
export const EMPTY_PLAN: DeptPlan = { vision: '', objectives: [], initiatives: [], risks: [] };

export function cleanStudy(v: unknown): Study {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = { ...EMPTY_STUDY };
  for (const f of STUDY_FIELDS) out[f.key] = text(o[f.key], 'study.' + f.key, 4000);
  return out;
}
export function cleanPlan(v: unknown, months: number): DeptPlan {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>;
  const arr = (x: unknown, max: number, code: string) => { const a = Array.isArray(x) ? x : []; if (a.length > max) throw new BudgetError('too_many:' + code); return a; };
  const objectives = arr(o.objectives, 20, 'objectives').map((r: any, i: number) => ({
    id: id(r?.id, 'objectives.' + i), text: text(r?.text, 'objectives.' + i, 300), kpi: text(r?.kpi, 'objectives.' + i + '.kpi', 120), unit: text(r?.unit, 'objectives.' + i + '.unit', 30),
    baseline: optNum(r?.baseline, 'objectives.' + i + '.baseline'), target: optNum(r?.target, 'objectives.' + i + '.target')
  }));
  const ids = new Set(objectives.map((x) => x.id));
  const initiatives = arr(o.initiatives, 40, 'initiatives').map((r: any, i: number) => {
    const m = optNum(r?.month, 'initiatives.' + i + '.month');
    if (m !== null && (!Number.isInteger(m) || m < 0 || m >= months)) throw new BudgetError('invalid_months:initiatives.' + i);
    const obj = typeof r?.objective === 'string' && ids.has(r.objective) ? r.objective : '';
    return { id: id(r?.id, 'initiatives.' + i), title: text(r?.title, 'initiatives.' + i, 200), owner: text(r?.owner, 'initiatives.' + i + '.owner', 80), month: m, objective: obj };
  });
  const risks = arr(o.risks, 30, 'risks').map((r: any, i: number) => ({
    id: id(r?.id, 'risks.' + i), risk: text(r?.risk, 'risks.' + i, 300), impact: (['low', 'medium', 'high'].includes(r?.impact) ? r.impact : 'medium') as DeptPlan['risks'][number]['impact'],
    mitigation: text(r?.mitigation, 'risks.' + i + '.mitigation', 300)
  }));
  return { vision: text(o.vision, 'plan.vision', 2000), objectives, initiatives, risks };
}
/** How complete the study and plan are, for the status board. */
export function readiness(b: { study?: Study; plan?: DeptPlan; lines: unknown[] }) {
  const s = b.study ? Object.values(b.study).filter((x) => x.trim().length > 0).length : 0;
  return { study: s, studyOf: STUDY_FIELDS.length, vision: !!b.plan?.vision, objectives: b.plan?.objectives.length ?? 0, initiatives: b.plan?.initiatives.length ?? 0, risks: b.plan?.risks.length ?? 0, lines: b.lines.length };
}

// ---------------------------------------------------------------- actuals and variance
export interface ActualRow { month: string; item: string; region: string; amount: number }
export function cleanActuals(rows: unknown, pack: Pack, monthKeys: string[], regions: string[]): ActualRow[] {
  const a = Array.isArray(rows) ? rows : [];
  if (a.length > 20000) throw new BudgetError('too_many_rows');
  return a.map((r: any, i) => {
    const at = 'rows.' + i;
    const month = typeof r?.month === 'string' ? r.month.trim().slice(0, 7) : '';
    if (!monthKeys.includes(month)) throw new BudgetError('month_outside_cycle:' + at);
    const item = itemOf(pack, typeof r?.item === 'string' ? r.item.trim() : '');
    if (!item) throw new BudgetError('unknown_item:' + at);
    const region = typeof r?.region === 'string' ? r.region.trim() : '';
    // 'company' matches budget lines kept for the whole company
    if (region !== 'company' && !regions.includes(region)) throw new BudgetError('unknown_region:' + at);
    const n = optNum(r?.amount, at + '.amount');
    if (n === null) throw new BudgetError('invalid_number:' + at + '.amount');
    return { month, item: item.id, region, amount: n };
  });
}

export interface VarianceRow { item: string; dept: string; kind: Item['kind']; region: string; budget: number[]; actual: number[] }
/** Budget (approved departments) against actual, by item and city, month by month. */
export function varianceRows(pack: Pack, monthKeys: string[], budgets: Array<{ body: SubmissionBody }>, actuals: ActualRow[]): { rows: VarianceRow[]; actualMonths: string[] } {
  const n = monthKeys.length, map = new Map<string, VarianceRow>();
  const get = (item: string, region: string) => {
    const k = item + '|' + region;
    let r = map.get(k);
    if (!r) { const it = itemOf(pack, item); if (!it) return null; r = { item, dept: it.dept, kind: it.kind, region, budget: new Array(n).fill(0), actual: new Array(n).fill(0) }; map.set(k, r); }
    return r;
  };
  for (const b of budgets) for (const l of b.body.lines) { const r = get(l.item, l.region); if (r) l.amounts.forEach((v, i) => { r.budget[i] = round2(r.budget[i] + v); }); }
  const seen = new Set<string>();
  for (const a of actuals) { const r = get(a.item, a.region); const i = monthKeys.indexOf(a.month); if (r && i >= 0) { r.actual[i] = round2(r.actual[i] + a.amount); seen.add(a.month); } }
  return { rows: [...map.values()], actualMonths: monthKeys.filter((k) => seen.has(k)) };
}
/** Favourable to the company: more revenue than budget, or less cost. */
export const favourable = (kind: Item['kind'], budget: number, actual: number) => (kind === 'revenue' ? actual - budget : budget - actual);

// ---------------------------------------------------------------- budget to cash plan
const dayNum = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +(iso.slice(8, 10) || '1')) / 86400000);
const isoOf = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);
const daysIn = (key: string) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();

/**
 * Turns approved budgets into a plan the cash engine reads (template bank-history): every item becomes a
 * line, VAT is added where it applies and spread evenly over the days of each month, and the net VAT of
 * each month is paid to ZATCA on the last day of the next month. Non-cash items (end of service accrual,
 * depreciation) stay out. Opening cash is what the forecast expects on the day before the budget starts.
 */
export function budgetToCashPlan(pack: Pack, monthKeys: string[], budgets: Array<{ body: SubmissionBody }>, o: { openingCash: number; vatRate?: number; name: string }) {
  const vat = o.vatRate ?? 0.15;
  const start = dayNum(monthKeys[0] + '-01');
  const end = dayNum(monthKeys[monthKeys.length - 1] + '-' + String(daysIn(monthKeys[monthKeys.length - 1])).padStart(2, '0'));
  const N = Math.ceil((end - start + 1) / 7);
  const byItem = new Map<string, { it: Item; monthly: number[] }>();
  for (const b of budgets) for (const l of b.body.lines) {
    const it = itemOf(pack, l.item);
    if (!it || it.kind === 'noncash' || !it.cash) continue;
    const e = byItem.get(it.id) || { it, monthly: new Array(monthKeys.length).fill(0) };
    l.amounts.forEach((v, i) => { e.monthly[i] += v; });
    byItem.set(it.id, e);
  }
  const weekly = (monthlyCash: number[], onLastDayOf?: boolean) => {
    const w = new Array(N).fill(0);
    monthlyCash.forEach((v, i) => {
      if (!v) return;
      const m0 = dayNum(monthKeys[i] + '-01'), days = daysIn(monthKeys[i]);
      if (onLastDayOf) { const d = m0 + days - 1; if (d <= end) w[Math.floor((d - start) / 7)] += v; return; }
      for (let d = 0; d < days; d++) w[Math.floor((m0 + d - start) / 7)] += v / days;
    });
    return w.map(round2);
  };
  const vatOut = new Array(monthKeys.length).fill(0), vatIn = new Array(monthKeys.length).fill(0);
  const lines: any[] = [];
  for (const { it, monthly } of byItem.values()) {
    const gross = it.vat && it.kind !== 'financing' ? 1 + vat : 1;
    monthly.forEach((v, i) => { if (it.vat && it.kind !== 'financing') { if (it.kind === 'revenue') vatOut[i] += v * vat; else vatIn[i] += v * vat; } });
    const cash = monthly.map((v) => round2(v * gross));
    lines.push({
      cat: it.cash, l3: 'budget:' + it.id, label: it.name, values: weekly(cash), monthly: cash, actualWeeks: 0, confidence: 'Medium',
      method: { en: `From the approved ${it.dept} budget${gross > 1 ? ', with ' + Math.round(vat * 100) + '% VAT' : ''}, spread evenly over the days of each month.`, ar: `من الميزانية المعتمدة${gross > 1 ? ' مع ضريبة القيمة المضافة' : ''}، موزعة بالتساوي على أيام كل شهر.` }
    });
  }
  // net VAT of month i is paid on the last day of month i+1 (a refund month pays nothing)
  const vatPaid = monthKeys.map((_, i) => (i === 0 ? 0 : Math.max(0, round2(vatOut[i - 1] - vatIn[i - 1]))));
  if (vatPaid.some((x) => x > 0)) lines.push({
    cat: 'P_VAT', l3: 'budget:vat', label: { en: 'Net VAT to ZATCA', ar: 'صافي ضريبة القيمة المضافة لهيئة الزكاة' }, values: weekly(vatPaid, true), monthly: vatPaid, actualWeeks: 0, confidence: 'Medium',
    method: { en: 'Output VAT on sales less input VAT on costs and capex, each month, paid at the end of the next month. The last month’s VAT falls after the budget.', ar: 'ضريبة المخرجات ناقص ضريبة المدخلات شهريًا، تُدفع في نهاية الشهر التالي.' }
  });
  const startIso = isoOf(start), endIso = isoOf(end);
  return {
    template: 'bank-history',
    months: monthKeys.map((k) => ({ key: k, from: k + '-01', to: k + '-' + String(daysIn(k)).padStart(2, '0'), days: daysIn(k) })),
    meta: { name: o.name, demo: false, currency: 'SAR', startDate: startIso, weeks: N, anyStartDay: true, endDate: endIso },
    source: { en: 'Approved department budgets', ar: 'ميزانيات الإدارات المعتمدة', through: isoOf(start - 1) },
    tax: { vatRate: vat, vatFiling: 1, vatDueDays: 30, opexVatShare: 0 },
    financing: { openingCash: round2(o.openingCash), openingVatPayable: 0, openingVatDueDate: null, facilityLimit: 0, facilityRate: 0, loanMonthly: 0, otherCapexMonthly: 0, minBuffer: 0 },
    openingReceivable: { amount: 0, schedule: [1] }, schedules: [], lines,
    opening: { asOf: isoOf(start - 1), bankAccounts: [{ id: 'OPEN', name: 'Opening cash (expected by the forecast)', bank: '', balance: round2(o.openingCash) }], receivables: { amount: 0, schedule: [1] }, vat: { payable: 0, dueDate: null }, confirmed: false }
  };
}
