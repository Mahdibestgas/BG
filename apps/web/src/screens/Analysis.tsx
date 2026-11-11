import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { api, type Forecast, type Txt } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';
import { useForecast } from './Overview';
import { KhazeenPivot, type KhzCity } from '../ui/KhazeenPivot';
import { RentBreakdown, type RentBlock, type PlanMonthInfo } from '../ui/RentBreakdown';

interface CrossCheck {
  source: string; months: string[]; revenue: number[]; cogs: number[]; netProfit: number[]; cashProfit: number[];
  costs: Array<{ cat: string; en: string; ar: string; monthly: number[] }>;
  nonCash: Array<{ en: string; ar: string; monthly: number[] }>;
  compare?: Compare;
}
interface CmpMonth { label: string; days: number; plRevenue: number; plRevenueInclVat: number; bankReceipts: number; plCogs: number; plCogsInclVat: number; bankGas: number; bankSuppliers: number;
  plPayroll: number; bankPayroll: number; plRent: number; bankRent: number; plInterest: number; bankLoan: number; bankOtherPayments: number; bankOperatingCash: number; plCashProfit: number; salesPerDay: number; gasPerDay: number }
interface Compare { months: CmpMonth[]; nov?: { label: string; days: number; salesPerDay: number; gasPerDay: number } }
interface Seasonality {
  method: string; growthYear: number; yoy: number[]; index: Record<string, number>; season: Record<string, number>;
  monthly: { '2025': number[]; '2026': number[] };
  ramadan: { start: string; end: string; eid: string; effect: number; basis: string };
  external: string[]; step: string; applied: boolean; peak?: number; calibration?: number; dataPeak?: number;
  weekFactor?: number[]; uplift?: { receipts: number; gas: number; posFees: number; net: number } | null;
}
type Focus = string;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const GAS = ['P_KHAZEEN'];
const OPEX = ['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS', 'P_STAFF', 'P_RENT', 'P_UTILITIES', 'P_SUPPLIERS', 'P_DIESEL', 'P_GOV', 'P_POS_FEES', 'P_BANK'];
const OBLIG = ['P_VAT', 'P_ZATCA', 'P_LOAN', 'P_ACQUISITION', 'P_RELATED'];
const CAPEX = ['P_CAPEX'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const pct = (x: number, d = 1) => (isFinite(x) ? x.toFixed(d) : '0.0') + '%';

/** Counts up to a number once, so the headline figures arrive instead of appearing. */
function useCount(target: number, ms = 900) {
  const [v, setV] = useState(0), prev = useRef(0);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    const from = prev.current, t0 = performance.now(); let id = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); setV(from + (target - from) * e); if (p < 1) id = requestAnimationFrame(tick); else prev.current = target; };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, ms]);
  return v;
}

/** A number that counts up when it changes (its own component, so the hook order never depends on loading). */
function Count({ v }: { v: number }) { const x = useCount(v, 650); return <>{acc(x, false)}</>; }

/** A tiny line for one row of numbers; draws itself in. */
function Spark({ v, color = 'var(--brand)', w = 132, h = 30 }: { v: number[]; color?: string; w?: number; h?: number }) {
  const hi = Math.max(...v, 1), lo = Math.min(...v, 0), span = hi - lo || 1;
  const pts = v.map((x, i) => [4 + (w - 8) * (v.length > 1 ? i / (v.length - 1) : 0), 3 + (h - 6) * (1 - (x - lo) / span)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return <svg className="an-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} /></svg>;
}

export function Analysis() {
  const s = useSession();
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const MN = (i: number) => (lang === 'ar' ? MONTHS_AR : MONTHS_EN)[i];
  const { f, error } = useForecast(s.plan?.id, s.plan?.version);
  const [cc, setCc] = useState<CrossCheck | null>(null);
  const [sea, setSea] = useState<Seasonality | null>(null);
  const [khz, setKhz] = useState<KhzCity[] | null>(null);
  const [rentB, setRentB] = useState<{ rent: RentBlock; months: PlanMonthInfo[] } | null>(null);
  const [params] = useSearchParams(), loc = useLocation();
  const [focus, setFocus] = useState<Focus>(params.get('focus') || 'gas');
  const [seaFocus, setSeaFocus] = useState<string>('Jan');
  const [dGas, setDGas] = useState(0), [dSales, setDSales] = useState(0), [dSeason, setDSeason] = useState(100), [noCapex, setNoCapex] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [mbOpen, setMbOpen] = useState(false), [cmpOpen, setCmpOpen] = useState(false);   // long explanations start collapsed

  useEffect(() => {
    if (!s.plan?.id) return;
    let live = true;
    api<{ model: { crossCheck?: CrossCheck | null; seasonality?: Seasonality | null; khazeen?: { cities: KhzCity[] } | null; rent?: RentBlock | null; months?: PlanMonthInfo[] } }>('GET', `/api/plans/${s.plan.id}`)
      .then((r) => { if (live) { setCc(r.model.crossCheck || null); setSea(r.model.seasonality || null); setKhz(r.model.khazeen?.cities || null); setRentB(r.model.rent && r.model.months ? { rent: r.model.rent, months: r.model.months } : null); } })
      .catch(() => { if (live) { setCc(null); setSea(null); setKhz(null); setRentB(null); } });
    return () => { live = false; };
  }, [s.plan?.id, s.plan?.version]);

  const A = useMemo(() => {
    if (!f) return null;
    const N = f.weeks.length, L = (id: string) => f.l2[id] || new Array(N).fill(0);
    const cat = (id: string) => f.categories.find((c) => c.id === id);
    const grp = (ids: string[]) => Array.from({ length: N }, (_, i) => ids.reduce((t, id) => t + (L(id)[i] || 0), 0));
    const rec = f.l1.receipts, gas = grp(GAS), opex = grp(OPEX), oblig = grp(OBLIG), capex = grp(CAPEX);
    const known = new Set([...GAS, ...OPEX, ...OBLIG, ...CAPEX]);
    const otherIds = f.categories.filter((c) => c.section === 'payments' && !known.has(c.id)).map((c) => c.id);
    const other = grp(otherIds);
    const opening = f.l1.opening[0], closing = f.l1.closing[N - 1];
    const R = sum(rec), G = sum(gas), O = sum(opex), B = sum(oblig), C = sum(capex), X = sum(other);
    const months = new Map<string, { label: string; idx: number; w: number[] }>();
    f.weeks.forEach((w, i) => {
      const key = w.start.slice(0, 7);
      if (!months.has(key)) months.set(key, { label: date(w.start, lang, { month: 'long', year: 'numeric' }), idx: Number(key.slice(5, 7)) - 1, w: [] });
      months.get(key)!.w.push(i);
    });
    const monthsPerPlan = (N * 7) / 30.4375;
    let cum = 0, rMax = Infinity;
    const r0 = G / R;
    f.l1.closing.forEach((c, i) => { cum += rec[i]; const r = r0 + c / cum; if (r < rMax) rMax = r; });
    return { N, L, cat, grp, rec, gas, opex, oblig, capex, other, otherIds, opening, closing, R, G, O, B, C, X, months, monthsPerPlan, r0, rMax };
  }, [f, lang]);

  useEffect(() => {
    if (!f || !loc.hash) return;
    const id = loc.hash.slice(1), el = document.getElementById(id);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
  }, [f, loc.hash]);
  useEffect(() => { const q = params.get('focus'); if (q) setFocus(q); }, [params]);

  const heroTarget = A ? A.closing - A.opening : 0;
  const heroNum = useCount(heroTarget);

  if (error) return <p className="msg err">{error}</p>;
  if (!f || !A) return <p className="sub">…</p>;
  const { N, L, cat, grp, rec, gas, opex, oblig, capex, other, otherIds, opening, closing, R, G, O, B, C, X, months, monthsPerPlan, r0, rMax } = A;
  const net = f.l1.net, lowW = f.headline.lowestWeek, lowV = f.headline.lowestCash;
  const opM = R - G - O;
  const stepN = closing - opening;
  const worst = net.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const avgNet = sum(net) / N;
  const sel0 = sel ?? worst[0][1];
  const wf = sea?.weekFactor && sea.weekFactor.length === N ? sea.weekFactor : null;

  // ---- what-if: gas-cost shift, sales shift, season strength (only when the plan carries the season)
  const scen = (() => {
    let bal = opening; const out: number[] = [];
    for (let i = 0; i < N; i++) {
      const adj = wf && sea?.applied ? 1 + ((dSeason / 100 - 1) * (wf[i] - 1)) / wf[i] : 1;
      const r = rec[i] * adj * (1 + dSales / 100), g = gas[i] * adj * (1 + dSales / 100) + (dGas / 100) * r;
      bal += r - g - opex[i] - oblig[i] - other[i] - (noCapex ? 0 : capex[i]);
      out.push(bal);
    }
    return out;
  })();
  const scLow = Math.min(...scen), scLowW = scen.indexOf(scLow), scEnd = scen[N - 1];

  // ---- waterfall
  const steps: Array<{ k: Focus; label: string; v: number; kind: 'total' | 'up' | 'down' }> = [
    { k: 'open', label: T('Opening cash', 'الرصيد الافتتاحي'), v: opening, kind: 'total' },
    { k: 'spread', label: T('Collected less gas', 'المحصّل بعد الغاز'), v: R - G, kind: 'up' },
    { k: 'opex', label: T('Running costs', 'المصاريف التشغيلية'), v: -O, kind: 'down' },
    { k: 'oblig', label: T('VAT and loan', 'الضريبة والقرض'), v: -(B + X), kind: 'down' },
    { k: 'capex', label: T('Trucks and Dyna', 'الشاحنات وديانا'), v: -C, kind: 'down' },
    { k: 'close', label: T('Closing cash', 'الرصيد الختامي'), v: closing, kind: 'total' }
  ];
  let run = 0; const bars = steps.map((st) => { const from = st.kind === 'total' ? 0 : run; const to = st.kind === 'total' ? st.v : run + st.v; run = st.kind === 'total' ? st.v : to; return { ...st, from, to }; });
  const wfMax = Math.max(...bars.map((b) => Math.max(b.from, b.to)), 1);
  const WF = { W: 980, H: 300, L: 10, T: 34, B: 252 };
  const bw = (WF.W - 2 * WF.L) / bars.length;
  const yv = (v: number) => WF.T + (1 - v / (wfMax * 1.08)) * (WF.B - WF.T);

  // ---- what each card opens
  const groups: Record<string, { ids: string[]; neg?: string[]; title: string; kind: 'rec' | 'pay' | 'cash' }> = {
    open: { ids: [], title: T('Where we start', 'نقطة البداية'), kind: 'cash' },
    rec: { ids: f.categories.filter((c) => c.section === 'receipts').map((c) => c.id), title: T('Where the money comes from', 'مصادر النقد'), kind: 'rec' },
    gas: { ids: GAS, title: T('What we pay the gas suppliers', 'ما ندفعه لموردي الغاز'), kind: 'pay' },
    opex: { ids: OPEX, title: T('What it costs to run the company', 'تكلفة تشغيل الشركة'), kind: 'pay' },
    oblig: { ids: [...OBLIG, ...otherIds], title: T('Tax, loan and other commitments', 'الضريبة والقرض والالتزامات'), kind: 'pay' },
    capex: { ids: CAPEX, title: T('New vehicles', 'المركبات الجديدة'), kind: 'pay' },
    close: { ids: [], title: T('Where we end', 'نقطة النهاية'), kind: 'cash' },
    spread: { ids: f.categories.filter((c) => c.section === 'receipts').map((c) => c.id), neg: GAS, title: T('What is left after gas: receipts less gas purchases', 'ما يتبقى بعد الغاز: المقبوضات ناقص مشتريات الغاز'), kind: 'rec' },
    people: { ids: ['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS', 'P_STAFF'], title: T('People, maintenance and medical', 'الموظفون والصيانة والطبي'), kind: 'pay' },
    premises: { ids: ['P_RENT', 'P_UTILITIES'], title: T('Rent and utilities', 'الإيجار والمرافق'), kind: 'pay' },
    suppliers: { ids: ['P_SUPPLIERS', 'P_DIESEL'], title: T('Suppliers and fuel', 'الموردون والوقود'), kind: 'pay' },
    tax: { ids: OBLIG, title: T('VAT and loan', 'الضريبة والقرض'), kind: 'pay' },
    fees: { ids: ['P_POS_FEES', 'P_BANK', 'P_GOV', ...otherIds], title: T('Fees and other', 'رسوم وأخرى'), kind: 'pay' }
  };
  const gdef = (k: Focus) => {
    if (groups[k]) return groups[k];
    const id = k.replace('cat:', ''), c = cat(id);
    return { ids: [id], title: c ? txt(c as Txt) : id, kind: (c?.section === 'receipts' ? 'rec' : 'pay') as 'rec' | 'pay' };
  };
  const G0 = gdef(focus);
  const rowsOf = (ids: string[]) => ids.flatMap((id) => (f.l3[id] || []).map((r) => ({ cat: id, ...r, total: sum(r.values) }))).filter((r) => Math.abs(r.total) > 0.5).sort((a, b) => b.total - a.total);
  const detail = [...rowsOf(G0.ids), ...(G0.neg ? rowsOf(G0.neg).map((r) => ({ ...r, total: -r.total, values: r.values.map((v) => -v) })) : [])];
  const detailTotal = sum(detail.map((r) => r.total));
  const detailAbs = Math.max(1, ...detail.map((r) => Math.abs(r.total)));
  const detailAbsSum = Math.max(1, sum(detail.map((r) => Math.abs(r.total))));
  const series = G0.kind === 'cash' ? (focus === 'open' ? f.l1.opening : f.l1.closing) : G0.neg ? grp(G0.ids).map((v, i) => v - grp(G0.neg!)[i]) : grp(G0.ids);
  const serTotal = G0.kind === 'cash' ? series[focus === 'open' ? 0 : N - 1] : sum(series);
  const hiW = series.indexOf(Math.max(...series)), loW = series.indexOf(Math.min(...series));
  const col = G0.kind === 'rec' ? 'var(--rec)' : G0.kind === 'pay' ? 'var(--pay)' : 'var(--brand)';
  const monthRows = [...months.values()].map((mo) => ({ label: mo.label, v: G0.kind === 'cash' ? series[mo.w[mo.w.length - 1]] : sum(mo.w.map((i) => series[i])) }));
  const insight = (() => {
    if (G0.kind === 'cash') return focus === 'open'
      ? T(`The study starts on ${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long' })} with ${m(opening)} in the bank accounts: the balance after the last statement in the shared bank sheet. Everything after that is forecast.`, `تبدأ الدراسة في ${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long' })} برصيد ${m(opening)} في الحسابات البنكية: الرصيد بعد آخر كشف في ملف البنك المشترك. وكل ما بعد ذلك توقعات.`)
      : T(`After ${N} weeks cash is ${m(closing)}. It never goes below ${m(lowV)} (${f.weeks[lowW].label}). The bars show the balance at the end of each week.`, `بعد ${N} أسبوعًا يصبح النقد ${m(closing)}. ولا ينخفض عن ${m(lowV)} (${f.weeks[lowW].label}). تُظهر الأعمدة الرصيد في نهاية كل أسبوع.`);
    if (focus === 'spread') return T(`Receipts of ${m(R)} less gas purchases of ${m(G)} leave ${m(R - G)}: ${pct(((R - G) / R) * 100)} of every riyal collected. Below, receipts are the positive lines and each gas line is shown in brackets; the lines add up to the card.`, `مقبوضات ${m(R)} ناقص مشتريات الغاز ${m(G)} يتبقى ${m(R - G)}: ${pct(((R - G) / R) * 100)} من كل ريال يُحصَّل. بالأسفل المقبوضات بنود موجبة وكل بند غاز بين قوسين؛ وتجميع البنود يساوي البطاقة.`);
    const top = detail[0], share = serTotal / R * 100;
    let t = T(`${m(serTotal)} over ${N} weeks: ${m(serTotal / N)} a week, ${m(serTotal / monthsPerPlan)} a month, ${pct(share)} of receipts. `, `${m(serTotal)} خلال ${N} أسبوعًا: ${m(serTotal / N)} أسبوعيًا و${m(serTotal / monthsPerPlan)} شهريًا، أي ${pct(share)} من المقبوضات. `);
    t += T(`Heaviest week is ${f.weeks[hiW].label} (${m(series[hiW])}), lightest ${f.weeks[loW].label} (${m(series[loW])}). `, `أثقل أسبوع هو ${f.weeks[hiW].label} (${m(series[hiW])}) وأخفها ${f.weeks[loW].label} (${m(series[loW])}). `);
    if (top && detail.length > 1) t += T(`The biggest line is “${txt(top.label)}” at ${pct((Math.abs(top.total) / detailAbsSum) * 100, 0)} of it. `, `أكبر بند هو «${txt(top.label)}» بنسبة ${pct((Math.abs(top.total) / detailAbsSum) * 100, 0)}. `);
    if (focus === 'gas' && sea?.applied && sea.uplift) t += T(`The gas season adds ${m(sea.uplift.gas)} of purchases over the period, because gas is bought for the extra sales.`, `يضيف موسم الغاز ${m(sea.uplift.gas)} من المشتريات خلال الفترة لأن الغاز يُشترى مقابل المبيعات الإضافية.`);
    if (focus === 'rec' && sea?.applied && sea.uplift) t += T(`The gas season adds ${m(sea.uplift.receipts)} of receipts over the period.`, `يضيف موسم الغاز ${m(sea.uplift.receipts)} من المقبوضات خلال الفترة.`);
    const chk = cc?.costs.find((c) => c.cat === focus.replace('cat:', ''));
    if (chk) t += T(` The P&L shows about ${m((chk.monthly[chk.monthly.length - 1] + chk.monthly[chk.monthly.length - 2] + chk.monthly[chk.monthly.length - 3]) / 3)} a month for this cost (last 3 months).`, ` تُظهر الأرباح والخسائر حوالي ${m((chk.monthly[chk.monthly.length - 1] + chk.monthly[chk.monthly.length - 2] + chk.monthly[chk.monthly.length - 3]) / 3)} شهريًا لهذا البند (آخر 3 أشهر).`);
    return t;
  })();

  // ---- why a week moved
  const dev = (w: number) => {
    const rows = f.categories.filter((c) => c.section === 'payments').flatMap((c) => (f.l3[c.id] || []).map((r) => ({ cat: c.id, label: r.label, d: (r.values[w] || 0) - sum(r.values) / N, v: r.values[w] || 0 })));
    return { up: rows.filter((r) => r.d > 5000).sort((a, b) => b.d - a.d).slice(0, 4) };
  };
  const dv = dev(sel0);
  const why = (w: number) => {
    const d = dev(w), n = net[w], sep = lang === 'ar' ? '، ' : ', ';
    const lead = n < 0 ? T(`Cash falls by ${m(-n)} in ${f.weeks[w].label} (${date(f.weeks[w].start, lang)}).`, `ينخفض النقد بمقدار ${m(-n)} في ${f.weeks[w].label} (${date(f.weeks[w].start, lang)}).`)
      : T(`Cash rises by ${m(n)} in ${f.weeks[w].label} (${date(f.weeks[w].start, lang)}).`, `يرتفع النقد بمقدار ${m(n)} في ${f.weeks[w].label} (${date(f.weeks[w].start, lang)}).`);
    const sf = wf ? T(` Sales are running at ${wf[w].toFixed(2)}× the early-November level (gas season).`, ` المبيعات بمعدل ${wf[w].toFixed(2)}× مستوى بداية نوفمبر (موسم الغاز).`) : '';
    return lead + sf + ' ' + (d.up.length ? T('Payments heavier than a normal week: ', 'مدفوعات أثقل من الأسبوع المعتاد: ') + d.up.map((r) => `${txt(r.label)} ${m(r.v)}`).join(sep) + '.' : T('No unusual payments; the week is close to normal.', 'لا مدفوعات غير معتادة؛ الأسبوع قريب من المعتاد.'));
  };
  const heatRows = f.categories.filter((c) => c.section === 'payments').map((c) => ({ id: c.id, label: txt(c as Txt), v: L(c.id) })).filter((r) => sum(r.v) > 0).sort((a, b) => sum(b.v) - sum(a.v)).slice(0, 9);

  // ---- P&L cross-check
  const idx3 = cc ? [cc.months.length - 3, cc.months.length - 2, cc.months.length - 1] : [];
  const avg3 = (v: number[]) => (cc ? (v[idx3[0]] + v[idx3[1]] + v[idx3[2]]) / 3 : 0);
  const fuelTotal = sum((f.l3.P_SUPPLIERS || []).filter((r) => r.l3 === 'vendor:fuel').flatMap((r) => r.values));
  const planMonthly = (id: string) => (id === 'P_BANK' ? sum(L('P_BANK')) + sum(L('P_POS_FEES')) : id === 'P_DIESEL' ? sum(L('P_DIESEL')) + fuelTotal : id === 'P_SUPPLIERS' ? sum(L(id)) - fuelTotal : sum(L(id))) / monthsPerPlan;
  const checkRows = cc ? cc.costs.map((c) => {
    const pl = avg3(c.monthly), plan = planMonthly(c.cat), gap = plan - pl;
    const status: 'ok' | 'missing' | 'low' | 'high' | 'note' = c.cat === 'P_LOAN' || c.cat === 'P_ZATCA' || c.cat === 'P_GOSI' ? 'note' : pl > 20000 && plan < pl * 0.15 ? 'missing' : plan < pl * 0.85 && pl - plan > 8000 ? 'low' : plan > pl * 1.25 && plan - pl > 8000 ? 'high' : 'ok';
    return { ...c, pl, plan, gap, status };
  }) : [];
  const plRevenueDay = cc ? (avg3(cc.revenue) * 1.15) / 30.4 : 0;
  const planRecDay = R / (N * 7);
  const plCogsRatio = cc ? (cc.cogs[cc.cogs.length - 1] + cc.cogs[cc.cogs.length - 2] + cc.cogs[cc.cogs.length - 3]) / (cc.revenue[cc.revenue.length - 1] + cc.revenue[cc.revenue.length - 2] + cc.revenue[cc.revenue.length - 3]) : 0;
  const plCashMargin = cc ? avg3(cc.cashProfit) / avg3(cc.revenue) : 0;
  const gasGapMonth = cc ? (plCogsRatio - r0) * (R / monthsPerPlan) : 0;

  // ---- why the plan's cash margin is not the P&L's: walk on one basis (percent of sales excluding VAT)
  const mb = (() => {
    if (!cc) return null;
    const rev = avg3(cc.revenue), cogs = avg3(cc.cogs), cash = avg3(cc.cashProfit);
    const cost = (id: string) => { const c = cc.costs.find((x) => x.cat === id); return c ? avg3(c.monthly) : 0; };
    const fin = cost('P_LOAN') + cost('P_ZATCA');
    const runPl = sum(cc.costs.filter((c) => c.cat !== 'P_LOAN' && c.cat !== 'P_ZATCA').map((c) => avg3(c.monthly)));
    const pl = { margin: (cash / rev) * 100, fin: (fin / rev) * 100, gas: (cogs / rev) * 100, run: (runPl / rev) * 100 };
    const plOpm = pl.margin + pl.fin;                                         // P&L cash margin before interest and zakat
    const plan = { gas: (G / R) * 100, run: ((1.15 * O) / R) * 100 };         // running costs carry no VAT, so on ex-VAT sales they weigh 1.15x
    const planOpm = 100 - plan.gas - plan.run;
    const gasStep = pl.gas - plan.gas, runStep = pl.run - plan.run;
    const other = planOpm - plOpm - gasStep - runStep;
    const reported = (opM / R) * 100;
    const days = N * 7;
    return { pl, plOpm, plan, planOpm, gasStep, runStep, other, reported, vatBasis: reported - planOpm,
      gasNeeded: 100 - pl.run - plOpm,                                         // gas % of receipts that gives the P&L margin, keeping the plan's running costs
      salesNeededDay: ((G + 1.15 * O) / (1 - plOpm / 100)) / days, salesDay: R / days, gasDayNeeded: (R * (100 - plOpm) / 100 - 1.15 * O) / days, gasDay: G / days };
  })();

  // ---- cards
  const kpis: Array<{ k: Focus; label: string; v: string; sub: string; tone: string }> = [
    { k: 'open', label: T('Opening cash', 'الرصيد الافتتاحي'), v: m(opening), sub: date(f.weeks[0].start, lang, { day: 'numeric', month: 'long' }), tone: 'brand' },
    { k: 'rec', label: T('Receipts', 'المقبوضات'), v: m(R), sub: T(`${m(R / (N * 7))} a day`, `${m(R / (N * 7))} يوميًا`), tone: 'rec' },
    { k: 'gas', label: T('Gas purchases', 'مشتريات الغاز'), v: m(G), sub: T(`${pct((G / R) * 100)} of receipts`, `${pct((G / R) * 100)} من المقبوضات`), tone: 'pay' },
    { k: 'opex', label: T('Running costs', 'المصاريف التشغيلية'), v: m(O), sub: T(`${pct((O / R) * 100)} of receipts`, `${pct((O / R) * 100)} من المقبوضات`), tone: 'pay' },
    { k: 'oblig', label: T('VAT, loan, other', 'ضريبة وقرض وأخرى'), v: m(B + X), sub: T(`${m((B + X) / monthsPerPlan)} a month`, `${m((B + X) / monthsPerPlan)} شهريًا`), tone: 'pay' },
    { k: 'capex', label: T('New vehicles', 'مركبات جديدة'), v: m(C), sub: T('one-off decisions', 'قرارات لمرة واحدة'), tone: 'pay' },
    { k: 'close', label: T('Closing cash', 'الرصيد الختامي'), v: m(closing), sub: T(`lowest ${m(lowV)} in ${f.weeks[lowW].label}`, `الأدنى ${m(lowV)} في ${f.weeks[lowW].label}`), tone: 'brand' }
  ];
  const catCards = f.categories.filter((c) => c.section !== 'financing').map((c) => ({ c, v: L(c.id), t: sum(L(c.id)) })).filter((x) => x.t > 0.5).sort((a, b) => (a.c.section === b.c.section ? b.t - a.t : a.c.section === 'receipts' ? -1 : 1));

  // ---- gas season
  const hm = sea && sea.monthly && !Array.isArray(sea.monthly) && Array.isArray(sea.monthly['2025']) ? sea.monthly : null;   // history of monthly sales; ignore anything else
  const hist = hm ? [...hm['2025'], ...hm['2026']] : [];
  const seaMonthsOrder = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
  const seaIdx = (mn: string) => MONTHS_EN.indexOf(mn);
  const planMonthRec = (mi: number) => { const mo = [...months.values()].find((x) => x.idx === mi); return mo ? { rec: sum(mo.w.map((i) => rec[i])), weeks: mo.w.length, wf: wf ? sum(mo.w.map((i) => wf[i])) / mo.w.length : 1, flat: wf ? sum(mo.w.map((i) => rec[i] / wf[i])) : sum(mo.w.map((i) => rec[i])) } : null; };
  const seasonCard = (mn: string) => {
    const i = seaIdx(mn), pm = planMonthRec(i);
    const h25 = hm ? hm['2025'][i] : 0, h26 = hm && i < 10 ? hm['2026'][i] : 0;
    return { mn, i, idx: sea ? sea.index[mn] : 1, pm, h25, h26 };
  };
  const lineHist = (() => {
    if (!sea || !hm) return null;
    const W = 980, H = 290, Lm = 56, Rm = 14, Tm = 18, Bm = 40;
    const fc: number[] = [];                                           // forecast months, ex-VAT monthly equivalent
    const fm = [10, 11, 0, 1].map((mi) => planMonthRec(mi));
    fm.forEach((p) => fc.push(p ? (p.rec / p.weeks) * 4.345 / 1.15 : NaN));
    const all = [...hist, ...fc.filter((x) => isFinite(x))], hi = Math.max(...all) * 1.08;
    const n = 26, x = (i: number) => Lm + (W - Lm - Rm) * (i / (n - 1)), y = (v: number) => Tm + (1 - v / hi) * (H - Tm - Bm);
    const path = (arr: number[], off: number) => arr.map((v, i) => (i ? 'L' : 'M') + x(i + off).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    const labels = [...MONTHS_EN.map((mm) => mm), ...MONTHS_EN, ...['Nov', 'Dec', 'Jan', 'Feb']];
    const seasonBand = (a: number, b: number) => <rect x={x(a) - 12} y={Tm} width={x(b) - x(a) + 24} height={H - Tm - Bm} rx="10" fill="var(--brand)" opacity=".08" />;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => hi * p);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="an-hist" role="img" aria-label={T('Monthly sales history and forecast', 'المبيعات الشهرية: التاريخ والتوقع')}>
        {ticks.map((v) => <g key={v}><line x1={Lm} x2={W - Rm} y1={y(v)} y2={y(v)} stroke="var(--rule)" /><text x={Lm - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink2)" className="num">{acc(v / 1e6)}M</text></g>)}
        {seasonBand(9, 13)}{seasonBand(21, 25)}
        <rect x={x(24.2)} y={Tm} width={x(25) - x(24.2) + 12} height={H - Tm - Bm} fill="var(--warn)" opacity=".16" rx="8" />
        <text x={x(11)} y={Tm + 12} textAnchor="middle" fontSize="11" fill="var(--brand)" fontWeight="600">{T('gas season 2025-26', 'موسم الغاز 2025-26')}</text>
        <text x={x(23)} y={Tm + 12} textAnchor="middle" fontSize="11" fill="var(--brand)" fontWeight="600">{T('gas season 2026-27', 'موسم الغاز 2026-27')}</text>
        <path d={path(hist, 0)} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="an-draw" />
        <path d={`M${x(21)} ${y(hist[21])} ` + fc.map((v, i) => 'L' + x(22 + i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')} fill="none" stroke="var(--pay)" strokeWidth="3" strokeDasharray="6 6" strokeLinecap="round" />
        {hist.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === 21 ? 5 : 3} fill="var(--brand)"><title>{(i < 12 ? MN(i) + ' 2025' : MN(i - 12) + ' 2026') + ' · ' + m(v)}</title></circle>)}
        {fc.map((v, i) => <circle key={'f' + i} cx={x(22 + i)} cy={y(v)} r="4" fill="var(--pay)"><title>{T('Forecast ', 'التوقع ') + MN([10, 11, 0, 1][i]) + ' · ' + m(v)}</title></circle>)}
        {labels.map((l, i) => (i % 2 === 0 || i >= 22) ? <text key={i} x={x(i)} y={H - 20} textAnchor="middle" fontSize="10.5" fill="var(--ink2)">{lang === 'ar' ? MONTHS_AR[MONTHS_EN.indexOf(l)].slice(0, 3) : l}</text> : null)}
        <text x={x(5.5)} y={H - 5} textAnchor="middle" fontSize="11" fill="var(--ink2)" fontWeight="600">2025</text>
        <text x={x(16.5)} y={H - 5} textAnchor="middle" fontSize="11" fill="var(--ink2)" fontWeight="600">2026</text>
        <text x={x(24)} y={H - 5} textAnchor="middle" fontSize="11" fill="var(--ink2)" fontWeight="600">2026-27</text>
      </svg>
    );
  })();

  const lineChart = (a: number[], b: number[]) => {
    const W = 560, H = 190, P = 14, hi = Math.max(...a, ...b, 1) * 1.08, lo = Math.min(0, ...a, ...b);
    const x = (i: number) => P + (W - 2 * P) * (i / (N - 1)), y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
    const path = (v: number[]) => v.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p).toFixed(1)).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="an-line" role="img" aria-label={T('Closing cash, plan and scenario', 'الرصيد الختامي، الخطة والسيناريو')}>
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--crit)" strokeDasharray="3 5" strokeOpacity=".6" />
        <path d={path(a)} fill="none" stroke="var(--ink2)" strokeOpacity=".5" strokeWidth="2" strokeDasharray="5 5" />
        <path d={path(b)} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="an-draw" key={dGas + '|' + dSales + '|' + dSeason + '|' + noCapex} />
        <circle cx={x(scLowW)} cy={y(scLow)} r="5.5" fill={scLow < 0 ? 'var(--crit)' : 'var(--brand)'} />
      </svg>
    );
  };
  const cellTone = (v: number, max: number) => ({ background: `color-mix(in oklab, var(--pay) ${Math.round(Math.min(1, v / max) * 70)}%, transparent)` });
  const wkBars = (() => {
    const W = 760, H = 190, P = 8, hi = Math.max(...series, 1) * 1.12, bwid = (W - 2 * P) / N;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="an-wk" role="img" aria-label={G0.title}>
        {[0.25, 0.5, 0.75].map((p) => <line key={p} x1={P} x2={W - P} y1={H - 22 - p * (H - 44)} y2={H - 22 - p * (H - 44)} stroke="var(--rule)" />)}
        {series.map((v, i) => {
          const h = Math.max(2, (v / hi) * (H - 44));
          return (
            <g key={focus + i} className="an-wb" style={{ ['--d' as string]: i * 35 + 'ms' }} onClick={() => setSel(i)} tabIndex={0} role="button" aria-label={f.weeks[i].label + ' ' + m(v)}>
              <rect x={P + i * bwid + bwid * 0.14} y={H - 22 - h} width={bwid * 0.72} height={h} rx="5" fill={col} opacity={i === sel0 ? 1 : 0.78}><title>{f.weeks[i].label + ' · ' + date(f.weeks[i].start, lang) + ' · ' + m(v)}</title></rect>
              {wf && (G0.kind !== 'cash') && <rect x={P + i * bwid + bwid * 0.14} y={H - 22 - h - 5} width={bwid * 0.72} height="3" rx="1.5" fill="var(--warn)" opacity={Math.min(1, Math.abs(wf[i] - 1) * 4)} />}
              <text x={P + i * bwid + bwid / 2} y={H - 6} textAnchor="middle" fontSize="10" fill={i === sel0 ? 'var(--ink)' : 'var(--ink2)'} fontWeight={i === sel0 ? 700 : 400}>{i + 1}</text>
            </g>
          );
        })}
      </svg>
    );
  })();

  const sc = seasonCard(sea && seaMonthsOrder.includes(seaFocus) ? seaFocus : 'Jan');
  const upl = sea?.uplift;

  return (
    <div className="an">
      <div className="head">
        <div><h1>{T('Why the cash moves', 'لماذا يتحرك النقد')}</h1>
          <p className="sub">{T(`${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long', year: 'numeric' })} to ${date(f.weeks[N - 1].end, lang, { day: 'numeric', month: 'long', year: 'numeric' })}, ${N} weeks. Click any card, bar, week or row.`, `من ${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long', year: 'numeric' })} إلى ${date(f.weeks[N - 1].end, lang, { day: 'numeric', month: 'long', year: 'numeric' })}، ${N} أسبوعًا. اضغط على أي بطاقة أو عمود أو أسبوع أو صف.`)}</p></div>
        {s.plans.length > 1 && <select className="pill" aria-label="Plan" value={s.plan?.id} onChange={(e) => s.pickPlan(e.target.value)} style={{ border: 0, cursor: 'pointer' }}>{s.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>

      <section className="an-hero an-in">
        <div className="an-hero-n num">{stepN >= 0 ? '+' : '-'}{acc(Math.abs(heroNum), false)}</div>
        <p className="an-hero-t">
          {stepN >= 0
            ? T(`Cash grows from ${m(opening)} to ${m(closing)}. The company keeps ${pct((opM / R) * 100)} of every riyal it collects after gas and running costs (${m(opM)} in total, ${m(opM / monthsPerPlan)} a month). ${m(B + X)} goes to VAT and the loan and ${m(C)} to new vehicles, which leaves ${m(stepN)}.`,
                `ينمو النقد من ${m(opening)} إلى ${m(closing)}. تحتفظ الشركة بـ ${pct((opM / R) * 100)} من كل ريال تحصّله بعد الغاز والمصاريف التشغيلية (${m(opM)} إجمالًا، ${m(opM / monthsPerPlan)} شهريًا). يذهب ${m(B + X)} للضريبة والقرض و${m(C)} للمركبات الجديدة فيبقى ${m(stepN)}.`)
            : T(`Cash falls from ${m(opening)} to ${m(closing)}: gas and costs absorb more than the company collects.`, `ينخفض النقد من ${m(opening)} إلى ${m(closing)}: الغاز والتكاليف تستهلك أكثر مما تحصّله الشركة.`)}
        </p>
        <div className="an-chips">
          <span className="an-chip">{T('Lowest', 'الأدنى')}: <b className="num">{m(lowV)}</b> · {f.weeks[lowW].label}</span>
          <span className="an-chip">{T('Average week', 'متوسط الأسبوع')}: <b className="num">{avgNet >= 0 ? '+' : '-'}{m(Math.abs(avgNet))}</b></span>
          <span className="an-chip">{T('Gas cost ratio', 'نسبة تكلفة الغاز')}: <b className="num">{pct(r0 * 100)}</b></span>
          {sea?.applied && <span className="an-chip warm">{T('Gas season peak', 'ذروة موسم الغاز')}: <b className="num">×{(sea.peak || 1).toFixed(2)}</b></span>}
        </div>
      </section>

      {mb && (
        <section className="card an-in mb-card" style={{ marginTop: 18 }}>
          <button type="button" className="fold" aria-expanded={mbOpen} onClick={() => setMbOpen(!mbOpen)}><h2>{T(`Why ${mb.reported.toFixed(1)}% and not the P&L's ${mb.pl.margin.toFixed(1)}%?`, `لماذا ${mb.reported.toFixed(1)}% وليس ${mb.pl.margin.toFixed(1)}% كما في الأرباح والخسائر؟`)}</h2><span className="ch">{mbOpen ? '⌄' : '›'}</span></button>
          {mbOpen && <>
          <p className="sub">{T('Your P&L shows a cash profit of about 2.4% of sales after interest and zakat (non-cash items removed). The plan’s “cash margin” is before VAT, loan and vehicles. Both on one basis (sales excluding VAT, P&L = average of the last three months):', 'تُظهر الأرباح والخسائر ربحًا نقديًا حوالي 2.4% من المبيعات بعد الفوائد والزكاة (بعد استبعاد البنود غير النقدية). أما «الهامش النقدي» في الخطة فهو قبل الضريبة والقرض والمركبات. على أساس واحد (المبيعات بدون ضريبة، والأرباح والخسائر متوسط آخر ثلاثة أشهر):')}</p>
          <table className="an-tbl mb-tbl"><tbody>
            <tr><td>{T('P&L cash profit margin (after interest and zakat)', 'هامش الربح النقدي في الأرباح والخسائر (بعد الفوائد والزكاة)')}</td><td className="num"><b>{mb.pl.margin.toFixed(1)}%</b></td><td /></tr>
            <tr><td>{T('+ interest and zakat, which the plan keeps below the margin', '+ الفوائد والزكاة التي تضعها الخطة تحت الهامش')}</td><td className="num">+{mb.pl.fin.toFixed(1)}</td><td /></tr>
            <tr className="sub2"><td>{T('= P&L cash margin before financing', '= هامش النقد في الأرباح والخسائر قبل التمويل')}</td><td className="num"><b>{mb.plOpm.toFixed(1)}%</b></td><td /></tr>
            <tr className="gap"><td>{T(`+ gas cost: plan ${mb.plan.gas.toFixed(1)}% of sales against the P&L's ${mb.pl.gas.toFixed(1)}%`, `+ تكلفة الغاز: الخطة ${mb.plan.gas.toFixed(1)}% من المبيعات مقابل ${mb.pl.gas.toFixed(1)}% في الأرباح والخسائر`)}</td><td className="num"><b>+{mb.gasStep.toFixed(1)}</b></td><td className="why">{T('The biggest piece: sales are set well above October while the gas purchased for them rises much less (see the comparison below).', 'الجزء الأكبر: المبيعات مضبوطة أعلى بكثير من أكتوبر بينما يرتفع الغاز المشترى لها بدرجة أقل (انظر المقارنة أدناه).')}</td></tr>
            <tr className="gap"><td>{T(`+ running costs: plan ${mb.plan.run.toFixed(1)}% against the P&L's ${mb.pl.run.toFixed(1)}%`, `+ المصاريف التشغيلية: الخطة ${mb.plan.run.toFixed(1)}% مقابل ${mb.pl.run.toFixed(1)}% في الأرباح والخسائر`)}</td><td className="num"><b>{mb.runStep >= 0 ? '+' : ''}{mb.runStep.toFixed(1)}</b></td><td className="why">{T('Rent, payroll and others at their cash schedules, which are lower than the accrual run-rate in the P&L.', 'الإيجار والرواتب وغيرها حسب جداولها النقدية وهي أقل من المعدل المحاسبي في الأرباح والخسائر.')}</td></tr>
            <tr><td>{T('+ other differences', '+ فروق أخرى')}</td><td className="num">{mb.other >= 0 ? '+' : ''}{mb.other.toFixed(1)}</td><td /></tr>
            <tr className="sub2"><td>{T('= the plan’s margin, sales excluding VAT', '= هامش الخطة، المبيعات بدون ضريبة')}</td><td className="num"><b>{mb.planOpm.toFixed(1)}%</b></td><td /></tr>
            <tr><td>{T('+ VAT basis (the plan’s receipts include VAT)', '+ أساس الضريبة (مقبوضات الخطة تشمل الضريبة)')}</td><td className="num">+{mb.vatBasis.toFixed(1)}</td><td /></tr>
            <tr className="sub2"><td>{T('= the plan’s cash margin as shown', '= الهامش النقدي للخطة كما يظهر')}</td><td className="num"><b>{mb.reported.toFixed(1)}%</b></td><td /></tr>
          </tbody></table>
          <div className="an-callouts" style={{ marginTop: 14 }}>
            <div className="bad"><span>{T('To match the P&L, with your sales', 'للتطابق مع الأرباح والخسائر بمبيعاتك')}</span><b className="num">{m(mb.gasDay)} → {m(mb.gasDayNeeded)}</b><em>{T(`gas purchases a day would have to rise from ${mb.plan.gas.toFixed(1)}% to about ${mb.gasNeeded.toFixed(1)}% of sales, about ${m((mb.gasDayNeeded - mb.gasDay) * N * 7)} more over the plan.`, `يجب أن ترتفع مشتريات الغاز اليومية من ${mb.plan.gas.toFixed(1)}% إلى حوالي ${mb.gasNeeded.toFixed(1)}% من المبيعات، أي حوالي ${m((mb.gasDayNeeded - mb.gasDay) * N * 7)} إضافية خلال الخطة.`)}</em></div>
            <div className="bad"><span>{T('Or, with your purchases', 'أو بمشترياتك')}</span><b className="num">{m(mb.salesDay)} → {m(mb.salesNeededDay)}</b><em>{T('sales a day would have to be lower, which is close to what the P&L and the bank show for recent months.', 'يجب أن تكون المبيعات اليومية أقل، وهو قريب مما تُظهره الأرباح والخسائر والبنك للأشهر الأخيرة.')}</em></div>
          </div>
          <div className="mb-act"><button type="button" className="btn" onClick={() => { setDGas(Math.min(10, Math.round((mb.gasNeeded - mb.plan.gas) * 4) / 4)); document.getElementById('whatif')?.scrollIntoView({ behavior: 'smooth' }); }}>{T('Show the cash if gas follows the P&L', 'اعرض النقد إذا تبع الغاز الأرباح والخسائر')}</button></div>
          </>}
        </section>
      )}

      {cc?.compare && cc.compare.months.length > 0 && (() => {
        const cm = cc.compare!.months, oct = cm[cm.length - 1], nv = cc.compare!.nov;
        const planSales = R / (N * 7), planGas = G / (N * 7);
        const pct1 = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
        const chg = (a: number, b: number) => (b ? ((a / b - 1) * 100 >= 0 ? '+' : '') + ((a / b - 1) * 100).toFixed(0) + '%' : '-');
        const row = (en: string, ar: string, vals: (c: CmpMonth) => [number, number, string?]) => (
          <tr><td>{T(en, ar)}</td>{cm.map((c) => { const [a, b2, note] = vals(c); return <td key={c.label} className="num">{m(a)} <small>{m(b2)}</small>{note && <em> {note}</em>}</td>; })}</tr>);
        return (
          <section className="card an-in" style={{ marginTop: 18 }}>
            <button type="button" className="fold" aria-expanded={cmpOpen} onClick={() => setCmpOpen(!cmpOpen)}><h2>{T('The P&L against the bank: do they agree?', 'الأرباح والخسائر مقابل البنك: هل تتفقان؟')}</h2><span className="ch">{cmpOpen ? '⌄' : '›'}</span></button>
            {cmpOpen && <>
            <p className="sub">{T('September and October, the two months where both exist. First figure: P&L (accrual). Second figure, smaller: the bank (cash).', 'سبتمبر وأكتوبر، الشهران اللذان يتوفر فيهما الاثنان. الرقم الأول: الأرباح والخسائر (محاسبي). الثاني الأصغر: البنك (نقدي).')}</p>
            <div className="khz-scroll"><table className="an-tbl cmp-tbl">
              <thead><tr><th />{cm.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
              <tbody>
                {row('Sales: P&L revenue plus 15% VAT, against bank receipts', 'المبيعات: إيراد الأرباح والخسائر مع ضريبة 15% مقابل مقبوضات البنك', (c) => [c.plRevenueInclVat, c.bankReceipts, pct1(c.bankReceipts, c.plRevenueInclVat)])}
                {row('Gas: P&L cost of sales plus VAT, against KHAZEEN paid', 'الغاز: تكلفة المبيعات مع الضريبة مقابل المدفوع لخزين', (c) => [c.plCogsInclVat, c.bankGas, pct1(c.bankGas, c.plCogsInclVat)])}
                {row('Payroll: P&L expense against cash paid', 'الرواتب: المصروف مقابل المدفوع', (c) => [c.plPayroll, c.bankPayroll])}
                {row('Rent: P&L expense against cash paid', 'الإيجار: المصروف مقابل المدفوع', (c) => [c.plRent, c.bankRent])}
                {row('Loan: P&L interest against the full instalment paid', 'القرض: فائدة الأرباح والخسائر مقابل القسط المدفوع', (c) => [c.plInterest, c.bankLoan])}
                <tr className="sub2"><td>{T('Other suppliers paid by the bank (the P&L has about 95,000 of supplier-type costs)', 'موردون آخرون يدفعهم البنك (في الأرباح والخسائر حوالي 95,000 من هذا النوع)')}</td>{cm.map((c) => <td key={c.label} className="num">{m(c.bankSuppliers)}</td>)}</tr>
                <tr className="tot"><td>{T('Cash profit: P&L (non-cash removed) against the bank’s operating cash', 'الربح النقدي: الأرباح والخسائر (بعد استبعاد غير النقدي) مقابل النقد التشغيلي في البنك')}</td>{cm.map((c) => <td key={c.label} className="num"><b>{m(c.plCashProfit)}</b> <small>{m(c.bankOperatingCash)}</small> <em>{pct1(c.plCashProfit, c.plRevenue)} / {pct1(c.bankOperatingCash, c.bankReceipts)}</em></td>)}</tr>
              </tbody></table></div>
            <h3 className="an-h3" style={{ marginTop: 14 }}>{T('What the two statements say, and what the plan does', 'ما تقوله القائمتان وما تفعله الخطة')}</h3>
            <div className="an-callouts">
              <div className="ok"><span>{T('They agree', 'تتفقان')}</span><b className="num">{pct1(oct.bankReceipts, oct.plRevenueInclVat)} · {pct1(oct.bankGas, oct.plCogsInclVat)}</b><em>{T('The bank’s receipts are 94-99% of the P&L revenue plus VAT, and the gas paid is 95-101% of cost of sales plus VAT. Sales include VAT, and the P&L’s cash profit (2.1-2.8%) is close to what the bank shows (−0.1% to 2.0%).', 'مقبوضات البنك 94-99% من إيراد الأرباح والخسائر مع الضريبة، والغاز المدفوع 95-101% من تكلفة المبيعات مع الضريبة. والمبيعات شاملة الضريبة، والربح النقدي في الأرباح والخسائر (2.1-2.8%) قريب مما يظهره البنك (−0.1% إلى 2.0%).')}</em></div>
              <div className="bad"><span>{T('Sales a day', 'المبيعات يوميًا')}</span><b className="num">{m(oct.salesPerDay)} → {m(planSales)}</b><em>{T(`October ${m(oct.salesPerDay)}${nv ? `, first week of November ${m(nv.salesPerDay)}` : ''}. The plan averages ${m(planSales)}: ${chg(planSales, oct.salesPerDay)} on October.`, `أكتوبر ${m(oct.salesPerDay)}${nv ? `، الأسبوع الأول من نوفمبر ${m(nv.salesPerDay)}` : ''}. تبلغ الخطة بالمتوسط ${m(planSales)}: ${chg(planSales, oct.salesPerDay)} عن أكتوبر.`)}</em></div>
              <div className="bad"><span>{T('Gas bought a day', 'الغاز المشترى يوميًا')}</span><b className="num">{m(oct.gasPerDay)} → {m(planGas)}</b><em>{T(`October ${m(oct.gasPerDay)}${nv ? `, first week of November ${m(nv.gasPerDay)}` : ''}. The plan: ${m(planGas)}, ${chg(planGas, oct.gasPerDay)}. Sales rise ${chg(planSales, oct.salesPerDay)} but the gas bought for them only ${chg(planGas, oct.gasPerDay)}, so the gas ratio falls from ${pct1(oct.gasPerDay, oct.salesPerDay)} to ${pct1(planGas, planSales)} and the margin balloons.`, `أكتوبر ${m(oct.gasPerDay)}${nv ? `، الأسبوع الأول من نوفمبر ${m(nv.gasPerDay)}` : ''}. الخطة: ${m(planGas)}، ${chg(planGas, oct.gasPerDay)}. ترتفع المبيعات ${chg(planSales, oct.salesPerDay)} بينما الغاز المشترى لها ${chg(planGas, oct.gasPerDay)} فقط، فتنخفض نسبة الغاز من ${pct1(oct.gasPerDay, oct.salesPerDay)} إلى ${pct1(planGas, planSales)} وينتفخ الهامش.`)}</em></div>
            </div>
            </>}
          </section>
        );
      })()}

      <h3 className="an-h3">{T('The story in seven cards', 'القصة في سبع بطاقات')}</h3>
      <div className="an-kpis">
        {kpis.map((c, i) => (
          <button type="button" key={c.k} className={'an-kpi an-in t-' + c.tone + (focus === c.k ? ' on' : '')} style={{ animationDelay: i * 55 + 'ms' }} onClick={() => setFocus(c.k)} aria-pressed={focus === c.k}>
            <span className="l">{c.label}</span><span className="v num">{c.v}</span><span className="s">{c.sub}</span>
          </button>
        ))}
      </div>

      <h3 className="an-h3">{T('Every line, one click away', 'كل بند بنقرة واحدة')}</h3>
      <div className="an-kpis sm">
        {catCards.map(({ c, v, t }, i) => {
          const k = 'cat:' + c.id, rc = c.section === 'receipts';
          return (
            <button type="button" key={c.id} className={'an-kpi sm an-in t-' + (rc ? 'rec' : 'pay') + (focus === k ? ' on' : '')} style={{ animationDelay: Math.min(i, 14) * 40 + 'ms' }} onClick={() => setFocus(k)} aria-pressed={focus === k}>
              <span className="l">{txt(c as Txt)}</span><span className="v num">{m(t)}</span>
              <span className="s">{pct((t / R) * 100)} {T('of receipts', 'من المقبوضات')}</span>
              <Spark v={v} color={rc ? 'var(--rec)' : 'var(--pay)'} w={120} h={24} />
            </button>
          );
        })}
      </div>

      <section className="card an-in" style={{ marginTop: 20 }}>
        <h2>{T('From opening to closing cash', 'من الرصيد الافتتاحي إلى الختامي')}</h2>
        <p className="sub">{T('Of every riyal collected, gas takes most; the first bar is what is left after gas. Click a bar to open it (receipts and gas have their own cards above).', 'من كل ريال يُحصَّل يأخذ الغاز معظمه؛ العمود الأول هو ما يتبقى بعد الغاز. اضغط على عمود لفتحه (للمقبوضات والغاز بطاقتان خاصتان أعلاه).')}</p>
        <svg viewBox={`0 0 ${WF.W} ${WF.H}`} className="an-wf" role="img" aria-label={T('Cash bridge', 'جسر النقد')}>
          {bars.map((b, i) => {
            const x0 = WF.L + i * bw + bw * 0.14, w = bw * 0.72, top = Math.min(yv(b.from), yv(b.to)), h = Math.max(3, Math.abs(yv(b.from) - yv(b.to)));
            const c2 = b.kind === 'total' ? 'var(--brand)' : b.kind === 'up' ? 'var(--rec)' : 'var(--pay)';
            return (
              <g key={b.k} className={'an-bar' + (focus === b.k ? ' on' : '')} style={{ ['--d' as string]: i * 90 + 'ms' }} tabIndex={0} role="button" aria-label={b.label + ' ' + m(b.v)} onClick={() => setFocus(b.k)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setFocus(b.k); }}>
                <rect x={WF.L + i * bw} y={WF.T - 8} width={bw} height={WF.B - WF.T + 50} fill="transparent" />
                <rect className="r" x={x0} y={top} width={w} height={h} rx="8" fill={c2} style={{ transformOrigin: `${x0 + w / 2}px ${WF.B}px` }} />
                <text x={x0 + w / 2} y={top - 9} textAnchor="middle" fontSize="13" fontWeight="650" fill="var(--ink)" className="num">{b.kind === 'down' ? '(' + acc(-b.v) + ')' : acc(b.v)}</text>
                <text x={x0 + w / 2} y={WF.B + 22} textAnchor="middle" fontSize="12.5" fill="var(--ink2)">{b.label}</text>
                {i < bars.length - 1 && <line x1={x0 + w} x2={x0 + bw * 1.28} y1={yv(b.to)} y2={yv(b.to)} stroke="var(--ink2)" strokeOpacity=".35" strokeDasharray="2 4" />}
              </g>
            );
          })}
        </svg>
      </section>

      <section className="card an-detail an-in" style={{ marginTop: 20, ['--accent' as string]: col }} key={focus}>
        <div className="an-dh">
          <div><span className="an-eyebrow">{G0.kind === 'rec' ? T('Receipts', 'مقبوضات') : G0.kind === 'pay' ? T('Payments', 'مدفوعات') : T('Cash', 'نقد')}</span><h2>{G0.title}</h2></div>
          <div className="an-big num"><Count v={serTotal} /></div>
        </div>
        <div className="an-dgrid">
          <div>
            <p className="sub" style={{ margin: '0 0 4px' }}>{G0.kind === 'cash' ? T('Cash at the end of each week', 'النقد في نهاية كل أسبوع') : T('By week (click a bar to read that week)', 'حسب الأسبوع (اضغط على عمود لقراءة ذلك الأسبوع)')}</p>
            {wkBars}
            <p className="an-p">{insight}</p>
          </div>
          <div className="an-stats">
            <div><span>{G0.kind === 'cash' ? T('Lowest week', 'أدنى أسبوع') : T('Heaviest week', 'أثقل أسبوع')}</span><b className="num">{G0.kind === 'cash' ? f.weeks[loW].label : f.weeks[hiW].label}</b><em className="num">{m(G0.kind === 'cash' ? Math.min(...series) : series[hiW])}</em></div>
            <div><span>{G0.kind === 'cash' ? T('Highest week', 'أعلى أسبوع') : T('Lightest week', 'أخف أسبوع')}</span><b className="num">{G0.kind === 'cash' ? f.weeks[hiW].label : f.weeks[loW].label}</b><em className="num">{m(G0.kind === 'cash' ? Math.max(...series) : series[loW])}</em></div>
            {G0.kind !== 'cash' && <div><span>{T('Average a week', 'المتوسط أسبوعيًا')}</span><b className="num">{m(serTotal / N)}</b><em className="num">{m(serTotal / monthsPerPlan)} {T('a month', 'شهريًا')}</em></div>}
            {monthRows.map((r) => <div key={r.label}><span>{r.label}</span><b className="num">{m(r.v)}</b></div>)}
          </div>
        </div>
        {(focus === 'cat:P_RENT' || focus === 'premises') && rentB && <div className="khz-wrap"><h3 className="an-h3" style={{ marginTop: 14 }}>{T('Rent by branch and landlord', 'الإيجارات حسب الفرع والمؤجر')}</h3><RentBreakdown rent={rentB.rent} months={rentB.months} /></div>}
        {(focus === 'gas' || focus === 'cat:P_KHAZEEN') && khz && khz.length > 0 && <div className="khz-wrap"><h3 className="an-h3" style={{ marginTop: 14 }}>{T('Pivot by city', 'جدول محوري حسب المدينة')}</h3><KhazeenPivot cities={khz} weeks={f.weeks} /></div>}
        {detail.length > 0 && (
          <ul className="an-rows">
            {detail.map((r, i) => (
              <li key={r.cat + r.l3} style={{ animationDelay: Math.min(i, 12) * 35 + 'ms' }} className="an-in">
                <div className="n"><b>{txt(r.label)}</b><span>{txt(cat(r.cat) as Txt)}</span></div>
                <Spark v={r.values} color={col} />
                <div className="a num">{m(r.total)}<span>{pct((Math.abs(r.total) / detailAbsSum) * 100, 0)}</span></div>
                <i style={{ width: Math.max(2, (Math.abs(r.total) / detailAbs) * 100) + '%', background: col }} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {sea && (
        <section id="season" className="an-season an-in" style={{ marginTop: 22 }}>
          <div className="an-season-head">
            <div><span className="an-eyebrow light">{T('Gas season · October to end of February', 'موسم الغاز · من أكتوبر حتى نهاية فبراير')}</span>
              <h2>{T('Winter lifts gas demand, and the plan now follows it', 'الشتاء يرفع الطلب على الغاز والخطة الآن تتبعه')}</h2></div>
            <div className="an-peak num">×{(sea.peak || sea.season.Jan).toFixed(2)}<span>{T('peak, mid-January', 'الذروة، منتصف يناير')}</span></div>
          </div>
          <p className="an-season-p">{T(`From 22 months of Best Gas sales: demand bottoms out in June (index ${sea.index.Jun.toFixed(2)}) and peaks in January (${sea.index.Jan.toFixed(2)}), a swing of ${pct((sea.index.Jan / sea.index.Jun - 1) * 100, 0)}. The company grows about ${pct((sea.growthYear - 1) * 100, 0)} a year, which was taken out before reading the season. The plan anchors the week of 9 Nov at your SAR 870K a day and lets sales rise to ×${(sea.peak || 1).toFixed(2)} by mid-January, then ease into February, with a ${pct(Math.abs(sea.ramadan.effect) * 100, 0)} dip from the start of Ramadan on ${date(sea.ramadan.start, lang, { day: 'numeric', month: 'long' })}.`,
            `من 22 شهرًا من مبيعات بست غاز: يبلغ الطلب أدناه في يونيو (المؤشر ${sea.index.Jun.toFixed(2)}) وذروته في يناير (${sea.index.Jan.toFixed(2)})، بفارق ${pct((sea.index.Jan / sea.index.Jun - 1) * 100, 0)}. تنمو الشركة حوالي ${pct((sea.growthYear - 1) * 100, 0)} سنويًا وقد أُزيل ذلك قبل قراءة الموسم. تثبّت الخطة أسبوع 9 نوفمبر عند 870 ألف ريال يوميًا وتترك المبيعات ترتفع إلى ×${(sea.peak || 1).toFixed(2)} بحلول منتصف يناير، ثم تتراجع في فبراير، مع انخفاض ${pct(Math.abs(sea.ramadan.effect) * 100, 0)} من بداية رمضان في ${date(sea.ramadan.start, lang, { day: 'numeric', month: 'long' })}.`)}</p>
          {upl && sea.applied && (
            <div className="an-upl">
              <div><span>{T('Extra receipts from the season', 'مقبوضات إضافية من الموسم')}</span><b className="num">{m(upl.receipts)}</b></div>
              <div><span>{T('Extra gas bought for them', 'غاز إضافي يُشترى لها')}</span><b className="num">({m(upl.gas)})</b></div>
              <div><span>{T('POS fees on the extra sales', 'رسوم نقاط البيع على المبيعات الإضافية')}</span><b className="num">({m(upl.posFees)})</b></div>
              <div className="net"><span>{T('Extra cash from the season', 'نقد إضافي من الموسم')}</span><b className="num">{m(upl.net)}</b></div>
            </div>
          )}
          <div className="an-mcards">
            {seaMonthsOrder.map((mn, i) => {
              const c = seasonCard(mn);
              return (
                <button type="button" key={mn} className={'an-mc an-in' + (seaFocus === mn ? ' on' : '')} style={{ animationDelay: i * 70 + 'ms' }} onClick={() => setSeaFocus(mn)} aria-pressed={seaFocus === mn}>
                  <span className="mn">{MN(c.i)}</span>
                  <span className="ix num">{c.idx.toFixed(2)}</span>
                  <span className="meter"><i style={{ width: Math.min(100, (c.idx / 1.3) * 100) + '%' }} /></span>
                  <span className="s">{c.pm ? T(`plan ×${c.pm.wf.toFixed(2)}`, `الخطة ×${c.pm.wf.toFixed(2)}`) : T('actual', 'فعلي')}</span>
                </button>
              );
            })}
          </div>
          <div className="an-mdetail an-in" key={sc.mn}>
            <div className="h"><b>{MN(sc.i)}</b><span>{T('seasonal index', 'المؤشر الموسمي')} <i className="num">{sc.idx.toFixed(3)}</i></span></div>
            <div className="g">
              <div><span>{MN(sc.i)} 2025 {T('sales (ex VAT)', 'المبيعات (بدون ضريبة)')}</span><b className="num">{m(sc.h25)}</b></div>
              {sc.i < 10 && sc.h26 > 0 && <div><span>{MN(sc.i)} 2026</span><b className="num">{m(sc.h26)}</b><em className={sc.h26 >= sc.h25 ? 'up' : 'down'}>{sc.h26 >= sc.h25 ? '+' : ''}{pct((sc.h26 / sc.h25 - 1) * 100, 0)} {T('vs last year', 'عن العام الماضي')}</em></div>}
              {sc.pm && <div><span>{T('In the plan', 'في الخطة')} · {sc.pm.weeks} {T('weeks', 'أسابيع')}</span><b className="num">{m(sc.pm.rec)}</b><em>{T('vs flat run-rate', 'مقابل معدل ثابت')} {m(sc.pm.flat)} → <b className={sc.pm.rec >= sc.pm.flat ? 'up' : 'down'}>{sc.pm.rec >= sc.pm.flat ? '+' : ''}{m(sc.pm.rec - sc.pm.flat)}</b></em></div>}
              {sc.pm && upl && sea.applied && <div><span>{T('Cash effect (after gas and fees)', 'الأثر النقدي (بعد الغاز والرسوم)')}</span><b className="num">{m(((sc.pm.rec - sc.pm.flat) / Math.max(1, upl.receipts)) * upl.net)}</b></div>}
            </div>
            <p className="an-p" style={{ marginTop: 8 }}>{sc.mn === 'Oct' ? T('October is the last actual month: sales were SAR 20.6M ex VAT, already well above a year earlier.', 'أكتوبر هو آخر شهر فعلي: المبيعات 20.6 مليون ريال بدون ضريبة، أعلى بكثير من العام السابق.')
              : sc.mn === 'Nov' ? T('Heating demand starts building as nights cool; the plan begins at your current SAR 870K a day and rises through the month.', 'يبدأ الطلب على التدفئة بالارتفاع مع برودة الليالي؛ تبدأ الخطة من 870 ألف ريال يوميًا وترتفع خلال الشهر.')
              : sc.mn === 'Dec' ? T('The coldest weeks begin: December 2025 sales were 15.0M against 13.1M in November (+14%).', 'تبدأ أبرد الأسابيع: مبيعات ديسمبر 2025 كانت 15.0 مليون مقابل 13.1 مليون في نوفمبر (+14%).')
              : sc.mn === 'Jan' ? T('The peak of the season. January 2026 sales were 16.0M, the highest of the first half, before falling every month to June.', 'ذروة الموسم. مبيعات يناير 2026 كانت 16.0 مليون وهي الأعلى في النصف الأول قبل أن تنخفض كل شهر حتى يونيو.')
              : T('Demand eases as the weather warms, and Ramadan begins on 8 February: the plan takes 3% off from that day. Last year February fell 13% against January.', 'يتراجع الطلب مع الدفء ويبدأ رمضان في 8 فبراير: تخصم الخطة 3% من ذلك اليوم. في العام الماضي انخفض فبراير 13% عن يناير.')}</p>
          </div>
          <div className="an-hist-card"><h3>{T('Monthly sales, Jan 2025 to Feb 2027', 'المبيعات الشهرية، من يناير 2025 إلى فبراير 2027')}</h3>
            <p className="sub">{T('Solid line: actual sales ex VAT (P&L). Dashed: the plan’s months as a monthly equivalent ex VAT. Shaded: the two gas seasons; the amber band is Ramadan.', 'الخط المتصل: المبيعات الفعلية بدون ضريبة. المتقطع: أشهر الخطة كمكافئ شهري بدون ضريبة. الظل: موسما الغاز؛ والشريط الكهرماني رمضان.')}</p>
            {lineHist}
            <p className="an-p">{T(`Notice the plan’s first month sits above October’s actual (20.6M): the SAR 870K a day you gave is about ${pct((planRecDay / Math.max(1, plRevenueDay) - 1) * 100, 0)} above the P&L’s last three months (about ${m(plRevenueDay)} a day including VAT). If October’s level is the true base, the whole season shifts down by that gap.`, `لاحظ أن الشهر الأول في الخطة أعلى من الفعلي لأكتوبر (20.6 مليون): 870 ألف ريال يوميًا أعلى بحوالي ${pct((planRecDay / Math.max(1, plRevenueDay) - 1) * 100, 0)} من آخر ثلاثة أشهر في الأرباح والخسائر (حوالي ${m(plRevenueDay)} يوميًا شامل الضريبة). إذا كان مستوى أكتوبر هو الأساس الحقيقي فإن الموسم كله ينخفض بهذا الفارق.`)}</p>
          </div>
          {wf && (
            <div className="an-strip" aria-label={T('Sales factor by week', 'عامل المبيعات حسب الأسبوع')}>
              {wf.map((v, i) => <div key={i} className="cell" style={{ ['--h' as string]: Math.min(100, Math.max(8, (v - 0.85) / 0.4 * 100)) + '%', animationDelay: i * 40 + 'ms' }} title={`${f.weeks[i].label} · ×${v.toFixed(2)}`}><i /><b className="num">{v.toFixed(2)}</b><small>{date(f.weeks[i].start, lang)}</small></div>)}
            </div>
          )}
          <div className="an-notes">
            <div><h4>{T('What backs it up', 'ما الذي يدعمه')}</h4>
              <ul>{sea.external.map((x, i) => <li key={i}>{x}</li>)}<li>{sea.step}</li></ul></div>
            <div><h4>{T('How sure are we', 'مدى التأكد')}</h4>
              <ul><li>{T('Direction: high. Two winters of company data and the trade press agree on a winter peak and a summer low.', 'الاتجاه: عالٍ. بيانات شتاءين للشركة والصحافة المتخصصة تتفق على ذروة شتوية وانخفاض صيفي.')}</li>
                <li>{T(`Size: medium. The data alone gave a peak of ×${(sea.dataPeak || 1).toFixed(2)}; you set it to ×${(sea.peak || 1).toFixed(2)}.`, `الحجم: متوسط. أعطت البيانات وحدها ذروة ×${(sea.dataPeak || 1).toFixed(2)}؛ وقد ضبطتها أنت على ×${(sea.peak || 1).toFixed(2)}.`)}</li>
                <li>{T('Ramadan starts on 8 February by the Umm al-Qura calendar, subject to moon sighting.', 'يبدأ رمضان في 8 فبراير حسب تقويم أم القرى، ويخضع لرؤية الهلال.')}</li>
                <li>{T('Watch the cost side: Aramco has raised propane and butane prices into winter in recent years, which would lift the gas ratio in December and January.', 'راقب جانب التكلفة: رفعت أرامكو أسعار البروبان والبيوتان مع دخول الشتاء في السنوات الأخيرة، مما قد يرفع نسبة الغاز في ديسمبر ويناير.')}</li></ul></div>
          </div>
        </section>
      )}

      <div className="grid an-two" style={{ marginTop: 20 }}>
        <section id="whatif" className="card an-in">
          <h2>{T('What if…', 'ماذا لو…')}</h2>
          <p className="sub">{T('Move the sliders: the dashed line is the plan, the solid line is your scenario.', 'حرّك المؤشرات: الخط المتقطع هو الخطة والخط المتصل هو السيناريو.')}</p>
          {lineChart(f.l1.closing, scen)}
          <div className="an-sliders">
            <label><span>{T('Gas cost vs plan', 'تكلفة الغاز مقابل الخطة')} <b className="num">{dGas > 0 ? '+' : ''}{dGas.toFixed(2)} {T('points', 'نقطة')}</b></span>
              <input type="range" min={-4} max={10} step={0.25} value={dGas} onChange={(e) => setDGas(Number(e.target.value))} /></label>
            <label><span>{T('Sales vs plan', 'المبيعات مقابل الخطة')} <b className="num">{dSales > 0 ? '+' : ''}{dSales}%</b></span>
              <input type="range" min={-15} max={15} step={1} value={dSales} onChange={(e) => setDSales(Number(e.target.value))} /></label>
            {wf && sea?.applied && <label><span>{T('Gas-season strength', 'قوة موسم الغاز')} <b className="num">{dSeason}%</b></span>
              <input type="range" min={0} max={150} step={10} value={dSeason} onChange={(e) => setDSeason(Number(e.target.value))} /></label>}
            <label className="chk"><input type="checkbox" checked={noCapex} onChange={(e) => setNoCapex(e.target.checked)} /> {T('Postpone the new trucks and Dyna', 'تأجيل الشاحنات الجديدة وديانا')}</label>
          </div>
          <div className="an-result">
            <div><span>{T('Lowest cash', 'أدنى نقد')}</span><b className={'num' + (scLow < 0 ? ' neg' : '')}>{m(scLow)}</b><em>{f.weeks[scLowW].label}</em></div>
            <div><span>{T('Closing cash', 'النقد الختامي')}</span><b className={'num' + (scEnd < 0 ? ' neg' : '')}>{m(scEnd)}</b><em className={scEnd >= closing ? 'up' : 'down'}>{scEnd >= closing ? '+' : '-'}{m(Math.abs(scEnd - closing))}</em></div>
          </div>
          <p className="an-p">{T(`Every 1 point of gas cost is worth ${m(R / 100)} over the period. Cash would reach zero if the gas ratio rose from ${pct(r0 * 100)} to ${pct(rMax * 100)}: a cushion of ${((rMax - r0) * 100).toFixed(1)} points.`, `كل نقطة واحدة في تكلفة الغاز تساوي ${m(R / 100)} خلال الفترة. يصل النقد إلى الصفر إذا ارتفعت نسبة الغاز من ${pct(r0 * 100)} إلى ${pct(rMax * 100)}: هامش أمان ${((rMax - r0) * 100).toFixed(1)} نقطة.`)}</p>
        </section>

        <section className="card an-in">
          <h2>{T('Month by month', 'شهرًا بشهر')}</h2>
          <table className="an-tbl"><thead><tr><th /><th>{T('Receipts', 'مقبوضات')}</th><th>{T('Payments', 'مدفوعات')}</th><th>{T('Net', 'الصافي')}</th><th>{T('Cash at end', 'النقد بنهاية الشهر')}</th></tr></thead>
            <tbody>{[...months.values()].map((mo) => {
              const r = sum(mo.w.map((i) => rec[i])), p = sum(mo.w.map((i) => f.l1.payments[i])), n = r - p, end = f.l1.closing[mo.w[mo.w.length - 1]];
              return <tr key={mo.label}><td>{mo.label} <small>{T(`${mo.w.length} wks`, `${mo.w.length} أسابيع`)}</small></td><td className="num">{acc(r)}</td><td className="num">{acc(p)}</td><td className={'num ' + (n >= 0 ? 'up' : 'down')}>{acc(n)}</td><td className="num"><b>{acc(end)}</b></td></tr>;
            })}</tbody></table>
          <p className="an-p">{T('Months follow the week start date. Weeks that carry month-end payments (VAT, instalments, payroll, rent) are the heavy ones.', 'تُنسب الأشهر حسب تاريخ بداية الأسبوع. الأسابيع التي تحمل مدفوعات نهاية الشهر (الضريبة والأقساط والرواتب والإيجار) هي الأثقل.')}</p>
        </section>
      </div>

      <section className="card an-in" style={{ marginTop: 20 }}>
        <h2>{T('Week by week: what moved it', 'أسبوعًا بأسبوع: ما الذي حرّكه')}</h2>
        <p className="sub">{T('Darker means more cash paid out in that line that week. Click a week to read why.', 'اللون الأغمق يعني نقدًا أكثر خرج في ذلك البند. اضغط على أسبوع لقراءة السبب.')}</p>
        <div className="an-heat" style={{ gridTemplateColumns: `minmax(120px,170px) repeat(${N}, minmax(30px,1fr))` }}>
          <span />
          {f.weeks.map((w, i) => <button type="button" key={i} className={'hd' + (i === sel0 ? ' on' : '')} onClick={() => setSel(i)} aria-label={w.label}>{i + 1}<small>{date(w.start, lang)}</small></button>)}
          {heatRows.map((r) => {
            const mx = Math.max(...r.v, 1);
            return [<span className="rl" key={r.id + 'l'}>{r.label}</span>, ...r.v.map((v, i) => <button type="button" key={r.id + i} className={'c' + (i === sel0 ? ' on' : '')} style={cellTone(v, mx)} onClick={() => setSel(i)} title={r.label + ' · ' + f.weeks[i].label + ' · ' + m(v)}><span className="num">{v > 0 ? acc(v / 1000) : ''}</span></button>)];
          })}
          <span className="rl net">{T('Net cash', 'صافي النقد')}</span>
          {net.map((v, i) => <button type="button" key={'n' + i} className={'c net ' + (v >= 0 ? 'up' : 'down') + (i === sel0 ? ' on' : '')} onClick={() => setSel(i)}><span className="num">{acc(v / 1000)}</span></button>)}
        </div>
        <p className="sub" style={{ marginTop: 6 }}>{T("Figures in SAR '000.", 'الأرقام بآلاف الريالات.')}</p>
        <div className="an-why"><b>{f.weeks[sel0].label}</b><p>{why(sel0)}</p>
          {dv.up.length > 0 && <ul>{dv.up.map((r) => <li key={r.cat + txt(r.label)}><span>{txt(r.label)}</span><b className="num">{m(r.v)}</b></li>)}</ul>}
        </div>
      </section>

      <section className="card an-in" style={{ marginTop: 20 }}>
        <h2 id="pl">{T('Checked against the 10-month P&L', 'مقارنة مع قائمة الأرباح والخسائر لعشرة أشهر')}</h2>
        {!cc ? <p className="empty">{T('No P&L attached to this plan yet. Run the refresh to add it.', 'لا توجد قائمة أرباح وخسائر مرفقة بهذه الخطة بعد. شغّل التحديث لإضافتها.')}</p> : <>
          <p className="sub">{T(`Cash costs only (no depreciation, amortization, provisions or write-offs). P&L = average of the last three months (${cc.months.slice(-3).join(', ')}); plan = per month over the study.`, `التكاليف النقدية فقط (بدون إهلاك أو إطفاء أو مخصصات أو شطب). الأرباح والخسائر = متوسط آخر ثلاثة أشهر (${cc.months.slice(-3).join('، ')})؛ الخطة = شهريًا خلال الدراسة.`)}</p>
          <div className="an-callouts">
            <div className={gasGapMonth > 100000 ? 'bad' : 'ok'}><span>{T('Gas cost ratio', 'نسبة تكلفة الغاز')}</span><b className="num">{pct(r0 * 100)}</b><em>{T(`P&L cost of sales is ${pct(plCogsRatio * 100)} of revenue. ${gasGapMonth > 0 ? 'Plan is about ' + m(gasGapMonth) + ' a month lighter.' : 'Plan is at or above it.'}`, `تكلفة المبيعات في الأرباح والخسائر ${pct(plCogsRatio * 100)} من الإيراد. ${gasGapMonth > 0 ? 'الخطة أخف بحوالي ' + m(gasGapMonth) + ' شهريًا.' : 'الخطة عند هذا المستوى أو أعلى.'}`)}</em></div>
            <div className={planRecDay > plRevenueDay * 1.05 ? 'bad' : 'ok'}><span>{T('Sales a day (incl. VAT)', 'المبيعات يوميًا (شامل الضريبة)')}</span><b className="num">{m(planRecDay)}</b><em>{T(`P&L last 3 months: about ${m(plRevenueDay)} a day.`, `الأرباح والخسائر لآخر 3 أشهر: حوالي ${m(plRevenueDay)} يوميًا.`)}</em></div>
            <div className="ok"><span>{T('Cash margin', 'الهامش النقدي')}</span><b className="num">{pct(plCashMargin * 100)} → {pct((opM / R) * 100)}</b><em>{T('P&L cash profit as % of revenue, then the plan after gas and running costs.', 'الربح النقدي في الأرباح والخسائر كنسبة من الإيراد، ثم الخطة بعد الغاز والمصاريف.')}</em></div>
          </div>
          <table className="an-tbl" style={{ marginTop: 14 }}><thead><tr><th>{T('Cost', 'البند')}</th><th>{T('P&L a month', 'الأرباح والخسائر شهريًا')}</th><th>{T('Plan a month', 'الخطة شهريًا')}</th><th>{T('Difference', 'الفرق')}</th><th /></tr></thead>
            <tbody>{checkRows.map((r) => (
              <tr key={r.cat}><td>{lang === 'ar' ? r.ar : r.en}</td><td className="num">{acc(r.pl)}</td><td className="num">{acc(r.plan)}</td><td className={'num ' + (r.gap < 0 ? 'down' : 'up')}>{acc(r.gap)}</td>
                <td><span className={'an-badge ' + r.status}>{{ ok: T('ties', 'متوافق'), missing: T('missing in plan', 'غير موجود في الخطة'), low: T('plan lower', 'الخطة أقل'), high: T('plan higher', 'الخطة أعلى'), note: T('see note', 'انظر الملاحظة') }[r.status]}</span></td></tr>
            ))}</tbody></table>
          <p className="an-p">{T('GOSI is netted inside the salary lines in the P&L; the plan takes it from the bank. Zakat is booked monthly in the P&L but paid once a year, after this plan ends. The loan line in the P&L is interest only; the plan pays the full instalment.', 'تُخصم التأمينات الاجتماعية داخل بنود الرواتب في الأرباح والخسائر بينما تأخذها الخطة من البنك. تُحمَّل الزكاة شهريًا في الأرباح والخسائر لكنها تُدفع مرة سنويًا بعد انتهاء هذه الخطة. بند القرض في الأرباح والخسائر فوائد فقط، بينما تدفع الخطة القسط كاملًا.')}</p>
        </>}
      </section>
    </div>
  );
}
