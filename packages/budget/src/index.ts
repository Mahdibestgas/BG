/**
 * Department budgets: what a department submits, how the HR calculator turns
 * positions into cost lines, and how approved submissions add up into one
 * company budget. Pure functions, shared by the API (which is authoritative)
 * and the web app (which previews the same numbers as people type).
 */
import { KIND_NAMES, KSA_HR_DEFAULTS, KSA_LPG, PACKS, type HrParams, type Item, type Kind, type Pack, type Txt } from './catalog';
export * from './catalog';
import { cleanPlan, cleanStudy, type DeptPlan, type Study } from './cycle';
export * from './cycle';

export class BudgetError extends Error {
  constructor(public code: string) { super(code); }
}

/** One budget line: an item, a city, and an amount for each month of the cycle (SAR, excluding VAT). */
export interface Line {
  id: string;
  item: string;
  region: string;
  desc: string;
  amounts: number[];
  note?: string;
  basis?: { qty: number[]; price: number };   // quantity x unit price; the amounts follow from it
  posId?: string;                             // written by the HR calculator; never accepted from a client
}
/** One HR position: a grade or role, not a named person. */
export interface Position {
  id: string;
  title: string;
  forDept: string;          // the department the headcount works in
  region: string;
  saudi: boolean;
  headcount: number;
  basic: number; housing: number; transport: number; other: number;   // monthly, per person
  from: number; to: number; // month indexes in the cycle, inclusive
  eosbFullMonth: boolean;   // more than five years of service on average: a full month per year
  medicalAnnual?: number;   // per head; empty uses the company parameter
  ticketAnnual?: number;    // per head
  ticketMonth?: number;     // month index the tickets are bought; empty spreads them
}
export interface SubmissionBody { lines: Line[]; positions: Position[]; study?: Study; plan?: DeptPlan }

export const MAX_LINES = 600, MAX_POSITIONS = 300, MAX_MONTHS = 24;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const round2 = (x: number) => Math.round(x * 100) / 100;

export function packOf(id: string | null | undefined): Pack { return (id && PACKS[id]) || KSA_LPG; }
export function itemOf(pack: Pack, id: string): Item | undefined { return pack.items.find((i) => i.id === id); }
export function deptOf(pack: Pack, id: string) { return pack.departments.find((d) => d.id === id); }

/** Month keys 'YYYY-MM' of a cycle. */
export function monthKeys(startMonth: string, months: number): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new BudgetError('invalid_start_month');
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) throw new BudgetError('invalid_months');
  const y = Number(startMonth.slice(0, 4)), m = Number(startMonth.slice(5, 7)) - 1;
  return Array.from({ length: months }, (_, i) => { const d = new Date(Date.UTC(y, m + i, 1)); return d.toISOString().slice(0, 7); });
}

function num(v: unknown, code: string, { min = 0, max = 1e10 } = {}): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) throw new BudgetError('invalid_number:' + code);
  if (n < min || n > max) throw new BudgetError('out_of_range:' + code);
  return round2(n);
}
function text(v: unknown, code: string, max: number, required = false): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new BudgetError('required:' + code);
  if (s.length > max) throw new BudgetError('too_long:' + code);
  return s;
}

/** The lines the HR calculator writes for one position. Monthly amounts; zero outside the position's months. */
export function positionLines(p: Position, months: number, params: HrParams): Line[] {
  const on = (i: number) => i >= p.from && i <= p.to;
  const each = (perMonth: number) => Array.from({ length: months }, (_, i) => (on(i) ? round2(perMonth * p.headcount) : 0));
  const wage = p.basic + p.housing + p.transport + p.other;
  const gosiBase = Math.min(Math.max(p.basic + p.housing, params.gosiFloor), params.gosiCap);
  const eosbWage = p.basic + p.housing + p.transport;
  const tag = (item: string, amounts: number[], desc: string): Line => ({ id: p.id + ':' + item, item, region: p.region, desc, amounts, posId: p.id });
  const label = `${p.title} × ${p.headcount}`;
  const out: Line[] = [
    tag('hr_salaries', each(wage), label),
    tag('hr_gosi', each(gosiBase * (p.saudi ? params.gosiSaudiEmployer : params.gosiNonSaudiEmployer)), label),
    tag('hr_eosb', each((eosbWage * (p.eosbFullMonth ? 1 : 0.5)) / 12), label)
  ];
  if (!p.saudi) {
    out.push(tag('hr_levy', each(params.expatLevyMonthly), label));
    out.push(tag('hr_iqama', each((params.iqamaAnnual + params.workPermitAnnual) / 12), label));
  }
  const med = p.medicalAnnual ?? params.medicalAnnual;
  if (med > 0) out.push(tag('hr_medical', each(med / 12), label));
  if (p.ticketAnnual && p.ticketAnnual > 0) {
    const tm = p.ticketMonth;
    out.push(tag('hr_tickets', tm !== undefined && tm >= 0 && tm < months
      ? Array.from({ length: months }, (_, i) => (i === tm && on(i) ? round2(p.ticketAnnual! * p.headcount) : 0))
      : each(p.ticketAnnual / 12), label));
  }
  return out.filter((l) => l.amounts.some((x) => x !== 0));
}

export interface CleanCtx { pack: Pack; dept: string; months: number; regions: string[]; params: HrParams }

/**
 * Checks and normalises what a department sends. Lines must use the department's own items and the
 * company's cities; quantities x price are recomputed; HR lines are regenerated from the positions,
 * so a client can never write a salary line the calculator did not produce.
 */
export function cleanSubmission(input: unknown, c: CleanCtx): SubmissionBody {
  const b = (input && typeof input === 'object' ? input : {}) as { lines?: unknown; positions?: unknown; study?: unknown; plan?: unknown };
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  const rawPos = Array.isArray(b.positions) ? b.positions : [];
  if (rawLines.length > MAX_LINES) throw new BudgetError('too_many_lines');
  if (rawPos.length > MAX_POSITIONS) throw new BudgetError('too_many_positions');
  if (rawPos.length && c.dept !== 'hr') throw new BudgetError('positions_hr_only');
  const regionOk = (r: string, at: string) => { if (!c.regions.includes(r)) throw new BudgetError('unknown_region:' + at); return r; };
  const seen = new Set<string>();
  const uid = (v: unknown, at: string) => {
    const s = typeof v === 'string' && ID.test(v) ? v : '';
    if (!s) throw new BudgetError('invalid_id:' + at);
    if (seen.has(s)) throw new BudgetError('duplicate_id:' + at);
    seen.add(s); return s;
  };
  const positions: Position[] = rawPos.map((r: any, i) => {
    const at = 'positions.' + i;
    const from = num(r?.from, at + '.from', { max: c.months - 1 }), to = num(r?.to, at + '.to', { max: c.months - 1 });
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) throw new BudgetError('invalid_months:' + at);
    const forDept = text(r?.forDept, at + '.forDept', 40, true);
    if (!deptOf(c.pack, forDept)) throw new BudgetError('unknown_department:' + at);
    const tm = r?.ticketMonth === undefined || r?.ticketMonth === null || r?.ticketMonth === '' ? undefined : num(r.ticketMonth, at + '.ticketMonth', { max: c.months - 1 });
    const hc = num(r?.headcount, at + '.headcount', { max: 100000 });
    if (!Number.isInteger(hc)) throw new BudgetError('invalid_number:' + at + '.headcount');
    return {
      id: uid(r?.id, at), title: text(r?.title, at + '.title', 120, true), forDept, region: regionOk(text(r?.region, at + '.region', 40, true), at),
      saudi: r?.saudi === true, headcount: hc,
      basic: num(r?.basic, at + '.basic', { max: 1e7 }), housing: num(r?.housing ?? 0, at + '.housing', { max: 1e7 }),
      transport: num(r?.transport ?? 0, at + '.transport', { max: 1e7 }), other: num(r?.other ?? 0, at + '.other', { max: 1e7 }),
      from, to, eosbFullMonth: r?.eosbFullMonth === true,
      medicalAnnual: r?.medicalAnnual === undefined || r?.medicalAnnual === null || r?.medicalAnnual === '' ? undefined : num(r.medicalAnnual, at + '.medicalAnnual', { max: 1e7 }),
      ticketAnnual: r?.ticketAnnual === undefined || r?.ticketAnnual === null || r?.ticketAnnual === '' ? undefined : num(r.ticketAnnual, at + '.ticketAnnual', { max: 1e7 }),
      ticketMonth: tm
    };
  });
  const lines: Line[] = [];
  rawLines.forEach((r: any, i) => {
    if (r?.posId) return;   // calculator output is rebuilt below
    const at = 'lines.' + i;
    const item = itemOf(c.pack, text(r?.item, at + '.item', 40, true));
    if (!item || item.dept !== c.dept) throw new BudgetError('item_not_in_department:' + at);
    let amounts: number[];
    let basis: Line['basis'];
    if (r?.basis && typeof r.basis === 'object') {
      const q = Array.isArray(r.basis.qty) ? r.basis.qty : [];
      if (q.length !== c.months) throw new BudgetError('wrong_month_count:' + at);
      const price = num(r.basis.price, at + '.price', { max: 1e9 });
      const qty = q.map((x: unknown, m: number) => num(x, at + '.qty.' + m, { max: 1e9 }));
      basis = { qty, price };
      amounts = qty.map((x: number) => round2(x * price));
    } else {
      const a = Array.isArray(r?.amounts) ? r.amounts : [];
      if (a.length !== c.months) throw new BudgetError('wrong_month_count:' + at);
      amounts = a.map((x: unknown, m: number) => num(x, at + '.amounts.' + m, { min: item.kind === 'revenue' || item.kind === 'opex' ? -1e10 : 0 }));
    }
    const note = text(r?.note, at + '.note', 500);
    lines.push({ id: uid(r?.id, at), item: item.id, region: regionOk(text(r?.region, at + '.region', 40, true), at), desc: text(r?.desc, at + '.desc', 200), amounts, ...(note ? { note } : {}), ...(basis ? { basis } : {}) });
  });
  for (const p of positions) lines.push(...positionLines(p, c.months, c.params));
  return { lines, positions, study: cleanStudy(b.study), plan: cleanPlan(b.plan, c.months) };
}

// ---- consolidation
export type KindRow = Record<Kind, number[]>;
const zeros = (n: number) => new Array<number>(n).fill(0);
const kinds = (n: number): KindRow => ({ revenue: zeros(n), cogs: zeros(n), opex: zeros(n), capex: zeros(n), financing: zeros(n), noncash: zeros(n) });
const add = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) a[i] = round2(a[i] + (b[i] || 0)); };
export const sum = (a: number[]) => round2(a.reduce((t, x) => t + x, 0));

export interface Consolidated {
  months: string[];
  total: KindRow;
  ebitdaNoncash: number[];                       // non-cash charges that count in EBITDA (end of service)
  byDept: Record<string, KindRow>;
  byRegion: Record<string, { revenue: number[]; costs: number[]; capex: number[] }>;
  byItem: Array<{ item: string; dept: string; kind: Kind; amounts: number[]; total: number }>;
  headcount: Array<{ forDept: string; region: string; saudi: number; nonSaudi: number }>;
  kpi: { revenue: number; grossProfit: number; ebitda: number; capex: number; financing: number; netAfterCapex: number; saudiShare: number | null };
}

/** Adds up approved department submissions into one company budget (excluding VAT). */
export function consolidate(pack: Pack, monthsList: string[], entries: Array<{ dept: string; body: SubmissionBody }>): Consolidated {
  const n = monthsList.length;
  const total = kinds(n), ebitdaNoncash = zeros(n), byDept: Record<string, KindRow> = {}, byRegion: Consolidated['byRegion'] = {};
  const byItem = new Map<string, Consolidated['byItem'][number]>();
  const hc = new Map<string, { forDept: string; region: string; saudi: number; nonSaudi: number }>();
  for (const e of entries) {
    const d = (byDept[e.dept] ||= kinds(n));
    for (const l of e.body.lines) {
      const it = itemOf(pack, l.item);
      if (!it) continue;
      add(total[it.kind], l.amounts); add(d[it.kind], l.amounts);
      if (it.kind === 'noncash' && it.ebitda) add(ebitdaNoncash, l.amounts);
      const r = (byRegion[l.region] ||= { revenue: zeros(n), costs: zeros(n), capex: zeros(n) });
      add(it.kind === 'revenue' ? r.revenue : it.kind === 'capex' ? r.capex : r.costs, l.amounts);
      const bi = byItem.get(it.id) || { item: it.id, dept: it.dept, kind: it.kind, amounts: zeros(n), total: 0 };
      add(bi.amounts, l.amounts); bi.total = sum(bi.amounts); byItem.set(it.id, bi);
    }
    for (const p of e.body.positions) {
      const k = p.forDept + '|' + p.region;
      const h = hc.get(k) || { forDept: p.forDept, region: p.region, saudi: 0, nonSaudi: 0 };
      if (p.saudi) h.saudi += p.headcount; else h.nonSaudi += p.headcount;
      hc.set(k, h);
    }
  }
  const revenue = sum(total.revenue), cogs = sum(total.cogs), opex = sum(total.opex), capex = sum(total.capex), financing = sum(total.financing);
  const heads = [...hc.values()], sa = heads.reduce((t, h) => t + h.saudi, 0), all = heads.reduce((t, h) => t + h.saudi + h.nonSaudi, 0);
  const ebitda = round2(revenue - cogs - opex - sum(ebitdaNoncash));
  return {
    months: monthsList, total, ebitdaNoncash, byDept, byRegion,
    byItem: [...byItem.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    headcount: heads,
    kpi: { revenue, grossProfit: round2(revenue - cogs), ebitda, capex, financing, netAfterCapex: round2(ebitda - capex - financing), saudiShare: all ? sa / all : null }
  };
}

export const kindName = (k: Kind): Txt => KIND_NAMES[k];
export const DEFAULT_PARAMS = KSA_HR_DEFAULTS;

/** Company parameters as stored, checked; anything missing falls back to the pack default. */
export function cleanParams(v: unknown): HrParams {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const d = KSA_HR_DEFAULTS;
  const rate = (k: keyof HrParams) => (o[k] === undefined ? (d[k] as number) : num(o[k], 'params.' + k, { max: 1 }));
  const sar = (k: keyof HrParams) => (o[k] === undefined ? (d[k] as number) : num(o[k], 'params.' + k, { max: 1e7 }));
  const asOf = o.asOf === undefined ? d.asOf : text(o.asOf, 'params.asOf', 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BudgetError('invalid_date:params.asOf');
  return {
    asOf, confirmed: o.confirmed === undefined ? d.confirmed : o.confirmed === true,
    gosiSaudiEmployer: rate('gosiSaudiEmployer'), gosiNonSaudiEmployer: rate('gosiNonSaudiEmployer'),
    gosiFloor: sar('gosiFloor'), gosiCap: sar('gosiCap'), expatLevyMonthly: sar('expatLevyMonthly'),
    iqamaAnnual: sar('iqamaAnnual'), workPermitAnnual: sar('workPermitAnnual'), medicalAnnual: sar('medicalAnnual')
  };
}
/** The company's cities. */
export function cleanRegions(v: unknown): Array<{ id: string; name: Txt }> {
  const a = Array.isArray(v) ? v : [];
  if (!a.length || a.length > 60) throw new BudgetError('regions_required');
  const seen = new Set<string>();
  return a.map((r: any, i) => {
    const id = typeof r?.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(r.id) ? r.id : '';
    if (!id || seen.has(id)) throw new BudgetError('invalid_id:regions.' + i);
    seen.add(id);
    return { id, name: { en: text(r?.name?.en, 'regions.' + i + '.en', 60, true), ar: text(r?.name?.ar, 'regions.' + i + '.ar', 60, true) } };
  });
}
