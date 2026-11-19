import { useEffect, useMemo, useState } from 'react';
import { Loading } from '../ui/Loading';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type Forecast, type Txt } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, currentWeek, date, m, planDays, repeatsMonths } from '../format';
import { Bars } from '../ui/charts';
import { CountUp } from '../ui/bgtCharts';
import { KhazeenPivot, type KhzCity } from '../ui/KhazeenPivot';
import type { RentBlock } from '../ui/RentBreakdown';

export function useForecast(planId: string | undefined, version: number | undefined) {
  const [f, setF] = useState<Forecast | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!planId) return;
    let live = true;
    setF(null);
    // ask for "this week and next" relative to today, so upcoming payments start now
    api<{ forecast: Forecast }>('GET', `/api/plans/${planId}/forecast?fromWeek=${Math.max(0, weekIndexToday())}`)
      .then((r) => { if (live) setF(r.forecast); })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.code : 'network'); });
    return () => { live = false; };
  }, [planId, version]);
  return { f, error };
}
let startHint = '';
const weekIndexToday = () => (startHint ? Math.floor((Date.now() + 3 * 3600e3 - Date.parse(startHint)) / 864e5 / 7) : 0);

interface PlanExtras {
  source?: { through?: string };
  opening?: { bankAccounts?: Array<{ name: string; balance: number }> };
  crossCheck?: { months: string[]; revenue: number[]; cogs: number[]; cashProfit: number[]; costs: Array<{ cat: string; en: string; ar: string; monthly: number[] }> } | null;
  khazeen?: { cities: KhzCity[] } | null;
  rent?: RentBlock | null;
  seasonality?: { applied: boolean; peak?: number; weekFactor?: number[]; uplift?: { receipts: number; gas: number; posFees: number; net: number } | null; ramadan: { start: string; end: string; effect: number }; index: Record<string, number> } | null;
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (x: number, d = 1) => (isFinite(x) ? x.toFixed(d) : '0.0') + '%';
const SLICES: Array<{ k: string; ids: string[]; en: string; ar: string; col: string; link: string }> = [
  { k: 'gas', ids: ['P_KHAZEEN'], en: 'Gas purchases', ar: 'مشتريات الغاز', col: 'var(--pay)', link: 'gas' },
  { k: 'people', ids: ['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS', 'P_STAFF'], en: 'People, maintenance, medical', ar: 'الموظفون والصيانة والطبي', col: '#8a5a9e', link: 'people' },
  { k: 'premises', ids: ['P_RENT', 'P_UTILITIES'], en: 'Rent and utilities', ar: 'الإيجار والمرافق', col: '#c28a2c', link: 'premises' },
  { k: 'suppliers', ids: ['P_SUPPLIERS', 'P_DIESEL'], en: 'Suppliers and fuel', ar: 'الموردون والوقود', col: '#2f8f83', link: 'suppliers' },
  { k: 'tax', ids: ['P_VAT', 'P_ZATCA', 'P_LOAN', 'P_ACQUISITION', 'P_RELATED'], en: 'VAT and loan', ar: 'الضريبة والقرض', col: '#5b6fb0', link: 'tax' },
  { k: 'capex', ids: ['P_CAPEX'], en: 'New vehicles', ar: 'مركبات جديدة', col: '#b0524f', link: 'capex' },
  { k: 'fees', ids: ['P_POS_FEES', 'P_BANK', 'P_GOV', 'P_OTHER', 'P_OWNER', 'P_OUTSIDE'], en: 'Fees and other', ar: 'رسوم وأخرى', col: '#8c8c8c', link: 'fees' }
];

function Donut({ parts, center, sub, onPick }: { parts: Array<{ k: string; v: number; col: string; label: string }>; center: string; sub: string; onPick: (k: string) => void }) {
  const tot = sum(parts.map((p) => p.v)) || 1, R = 70, C = 2 * Math.PI * R;
  let acc0 = 0;
  return (
    <svg viewBox="0 0 200 200" className="ov-donut" role="img" aria-label={sub}>
      <circle cx="100" cy="100" r={R} fill="none" stroke="var(--rule)" strokeWidth="26" />
      {parts.map((p) => {
        const len = (p.v / tot) * C, off = -acc0; acc0 += len;
        return <circle key={p.k} className="slice" cx="100" cy="100" r={R} fill="none" stroke={p.col} strokeWidth="26" strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`} strokeDashoffset={off} transform="rotate(-90 100 100)" tabIndex={0} role="button" aria-label={p.label}
          onClick={() => onPick(p.k)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(p.k); }}><title>{p.label + ' · ' + m(p.v) + ' · ' + pct((p.v / tot) * 100)}</title></circle>;
      })}
      <text x="100" y="97" textAnchor="middle" fontSize="19" fontWeight="650" fill="var(--ink)" className="num">{center}</text>
      <text x="100" y="117" textAnchor="middle" fontSize="10.5" fill="var(--ink2)">{sub}</text>
    </svg>
  );
}

/**
 * The hero chart: closing cash as a glowing line that draws itself, the safety buffer, the lowest point,
 * the current period, net cash as thin bars underneath, and a read-out that follows the pointer.
 */
function HeroRunway({ f, now, monthly, onOpen }: { f: Forecast; now: number; monthly: boolean; onOpen: () => void }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [tip, setTip] = useState<number | null>(null);
  const c = f.l1.closing, net = f.l1.net, N = c.length, buf = f.headline.minBuffer, low = f.headline.lowestWeek;
  const W = 1000, H = 300, L = 8, R = 8, T0 = 26, B = 206, NB = 262;
  const top = Math.max(...c, buf) * 1.08, bot = Math.min(0, Math.min(...c) * 0.9);
  const xr = (i: number) => (N > 1 ? L + ((W - L - R) * i) / (N - 1) : W / 2);
  const x = (i: number) => (lang === 'ar' ? W - xr(i) : xr(i));
  const y = (v: number) => T0 + ((top - v) / (top - bot || 1)) * (B - T0);
  const line = c.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const nm = Math.max(...net.map((v) => Math.abs(v)), 1), bw = Math.max(3, Math.min(26, ((W - L - R) / N) * 0.55));
  const every = Math.max(1, Math.ceil(N / 12));
  const lab = (i: number) => (monthly ? f.weeks[i].label : date(f.weeks[i].start, lang, { day: 'numeric', month: 'short' }));
  const step = (W - L - R) / Math.max(1, N - 1);
  return (
    <div className="ovh-chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={T('Closing cash and net cash by period', 'النقد الختامي وصافي النقد حسب الفترة')}>
        <defs>
          <linearGradient id="ovh-a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9CC8A0" stopOpacity=".32" /><stop offset="1" stopColor="#9CC8A0" stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((k) => <line key={k} x1={L} x2={W - R} y1={T0 + (B - T0) * k} y2={T0 + (B - T0) * k} className="ovh-grid" />)}
        {now >= 0 && <rect x={x(now) - step / 2} y={T0 - 10} width={step} height={NB - T0 + 18} rx="8" className="ovh-now" />}
        {buf > 0 && buf < top && <><line x1={L} x2={W - R} y1={y(buf)} y2={y(buf)} className="ovh-buf" /><text x={lang === 'ar' ? L + 4 : W - R - 4} y={y(buf) - 6} textAnchor={lang === 'ar' ? 'start' : 'end'} className="ovh-buf-t">{T('safety buffer ', 'هامش الأمان ')}{m(buf)}</text></>}
        <path d={`${line} L${x(N - 1)} ${B} L${x(0)} ${B}Z`} fill="url(#ovh-a)" className="ovh-area" />
        <path d={line} className="ovh-line" pathLength={1} />
        <line x1={L} x2={W - R} y1={(B + NB) / 2 + 12} y2={(B + NB) / 2 + 12} className="ovh-zero" />
        {net.map((v, i) => { const h = (Math.abs(v) / nm) * 26, mid = (B + NB) / 2 + 12; return <rect key={i} x={x(i) - bw / 2} y={v >= 0 ? mid - h : mid} width={bw} height={Math.max(1.5, h)} rx="2" className={'ovh-net ' + (v >= 0 ? 'up' : 'down')} style={{ animationDelay: 600 + i * 25 + 'ms' }} />; })}
        <circle cx={x(low)} cy={y(c[low])} r="6" className="ovh-low" />
        <text x={x(low)} y={y(c[low]) + 22} textAnchor="middle" className="ovh-low-t">{T('lowest ', 'الأدنى ')}{m(c[low])}</text>
        {c.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={tip === i ? 6 : 0} className="ovh-pt" />)}
        {tip !== null && <line x1={x(tip)} x2={x(tip)} y1={T0 - 6} y2={NB + 8} className="ovh-cross" />}
        {f.weeks.map((_, i) => (i % every === 0 || i === N - 1) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className={'ovh-x' + (i === now ? ' on' : '')}>{lab(i)}</text>)}
        {f.weeks.map((_, i) => <rect key={'h' + i} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setTip(i)} onFocus={() => setTip(i)} onClick={onOpen} tabIndex={0} aria-label={`${f.weeks[i].label} ${m(c[i])}`} />)}
      </svg>
      {tip !== null && <div className="ovh-tip" style={{ left: `${(x(tip) / W) * 100}%`, top: `${(y(c[tip]) / H) * 100}%` }}>
        <b>{f.weeks[tip].label}</b><span>{date(f.weeks[tip].start, lang, { day: 'numeric', month: 'short' })} – {date(f.weeks[tip].end, lang, { day: 'numeric', month: 'short' })}</span>
        <span>{T('Closing ', 'الختامي ')}<b className="num">{m(c[tip])}</b></span>
        <span className={net[tip] >= 0 ? 'up' : 'down'}>{T('Net ', 'الصافي ')}<b className="num">{net[tip] >= 0 ? '+' : '−'}{m(Math.abs(net[tip]))}</b></span>
      </div>}
    </div>
  );
}

export function Overview() {
  const s = useSession();
  const nav = useNavigate();
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  startHint = s.plan?.startDate || '';
  const { f, error } = useForecast(s.plan?.id, s.plan?.version);
  const [x, setX] = useState<PlanExtras>({});
  const [hov, setHov] = useState<string | null>(null);
  // weekly or monthly view of the charts; remembered on this browser
  const [per, setPer] = useState<'w' | 'm'>(() => { try { return localStorage.getItem('cf13.ovPeriod') === 'm' ? 'm' : 'w'; } catch { return 'w'; } });
  const pickPer = (v: 'w' | 'm') => { setPer(v); try { localStorage.setItem('cf13.ovPeriod', v); } catch { /* private window */ } };

  useEffect(() => {
    if (!s.plan?.id) return;
    let live = true;
    api<{ model: PlanExtras }>('GET', `/api/plans/${s.plan.id}`).then((r) => { if (live) setX(r.model || {}); }).catch(() => { if (live) setX({}); });
    return () => { live = false; };
  }, [s.plan?.id, s.plan?.version]);

  const go = (focus?: string, hash?: string) => nav('/analysis' + (focus ? '?focus=' + encodeURIComponent(focus) : '') + (hash ? '#' + hash : ''));

  const D = useMemo(() => {
    if (!f) return null;
    const N = f.weeks.length, L = (id: string) => f.l2[id] || new Array(N).fill(0);
    const grp = (ids: string[]) => Array.from({ length: N }, (_, i) => ids.reduce((t, id) => t + (L(id)[i] || 0), 0));
    const rec = f.l1.receipts, pay = f.l1.payments, net = f.l1.net, close = f.l1.closing;
    const R = sum(rec), P = sum(pay), days = planDays(f.weeks), mo = days / 30.4375, withYear = repeatsMonths(f.weeks);
    const gas = sum(grp(['P_KHAZEEN']));
    const months = new Map<string, { label: string; w: number[] }>();
    f.weeks.forEach((w, i) => { const k = w.start.slice(0, 7); if (!months.has(k)) months.set(k, { label: date(w.start, lang, withYear ? { month: 'short', year: '2-digit' } : { month: 'long' }), w: [] }); /* a plan longer than a year shows each month with its year */ months.get(k)!.w.push(i); });
    const parts = SLICES.map((sl) => ({ k: sl.k, v: sum(grp(sl.ids)), col: sl.col, label: lang === 'ar' ? sl.ar : sl.en, link: sl.link })).filter((p) => p.v > 0.5);
    // the same forecast rolled up to calendar months, for the monthly view of the charts
    const mk = [...months.values()], lastOf = (g: { w: number[] }) => g.w[g.w.length - 1];
    const mClose = mk.map((g) => close[lastOf(g)]);
    const monthly: Forecast = {
      ...f,
      weeks: mk.map((g) => ({ ...f.weeks[g.w[0]], label: g.label, end: f.weeks[lastOf(g)].end })),
      l1: { ...f.l1, receipts: mk.map((g) => sum(g.w.map((i) => rec[i]))), payments: mk.map((g) => sum(g.w.map((i) => pay[i]))), net: mk.map((g) => sum(g.w.map((i) => net[i]))), closing: mClose, opening: mk.map((g) => f.l1.opening[g.w[0]]) },
      headline: { ...f.headline, lowestWeek: mClose.indexOf(Math.min(...mClose)) }
    };
    const monthOfWeek = (wi: number) => mk.findIndex((g) => g.w.includes(wi));
    return { N, L, grp, rec, pay, net, close, R, P, mo, gas, months, parts, monthly, monthOfWeek };
  }, [f, lang]);

  if (error) return <p className="msg err">{error}</p>;
  if (!f || !D) return <Loading />;
  const { N, L, rec, pay, net, close, R, P, mo, gas, months, parts, monthly, monthOfWeek } = D;
  const h = f.headline, now = currentWeek(f.weeks), cc = x.crossCheck, sea = x.seasonality;
  const bad = f.checks.filter((c) => !c.ok).length;
  const open = f.l1.opening[0], end = close[N - 1], lowW = h.lowestWeek;
  const asOf = new Date(Date.parse(f.weeks[0].start) - 864e5).toISOString().slice(0, 10);
  const opM = R - gas - sum(['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS', 'P_STAFF', 'P_RENT', 'P_UTILITIES', 'P_SUPPLIERS', 'P_DIESEL', 'P_GOV', 'P_POS_FEES', 'P_BANK'].map((id) => sum(L(id))));
  const heavy = pay.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0])[0][1];
  const wf = sea?.weekFactor && sea.weekFactor.length === N ? sea.weekFactor : null;
  const avg3 = (v: number[]) => (v.length >= 3 ? (v[v.length - 1] + v[v.length - 2] + v[v.length - 3]) / 3 : 0);
  const plRevDay = cc ? (avg3(cc.revenue) * 1.15) / 30.4 : 0, planDay = R / planDays(f.weeks);
  const plCogs = cc ? avg3(cc.cogs) / Math.max(1, avg3(cc.revenue)) : 0;
  const gasGap = cc ? (plCogs - gas / R) * (R / mo) : 0;
  const outVat = (R * 0.15) / 1.15, inVat = ((gas + sum(L('P_SUPPLIERS')) + sum(L('P_RENT')) + sum(L('P_UTILITIES'))) * 0.15) / 1.15, netVat = (outVat - inVat) / mo;
  const vatEntered = sum(L('P_VAT')) / mo;
  const branch = x.opening?.bankAccounts?.find((a) => /فرع|branch/i.test(a.name));
  const dev = (w: number) => f.categories.filter((c) => c.section === 'payments').flatMap((c) => (f.l3[c.id] || []).map((r) => ({ label: r.label, d: (r.values[w] || 0) - sum(r.values) / N, v: r.values[w] || 0 }))).filter((r) => r.d > 5000).sort((a, b) => b.d - a.d).slice(0, 3);
  const peakWeeks = wf ? wf.map((v, i) => [v, i] as const).filter(([v]) => v >= Math.max(...wf) - 0.04).map(([, i]) => i) : [];

  type Dec = { pri: 'high' | 'med' | 'info'; t: string; b: string; go: () => void };
  const decisions: Dec[] = [];
  if (Math.abs(netVat - vatEntered) > 100000) decisions.push({ pri: 'high', t: T('Check the monthly VAT payment', 'راجع دفعة ضريبة القيمة المضافة الشهرية'), b: T(`The plan pays ${m(vatEntered)} a month. Taking its own sales and gas as VAT-inclusive, the net VAT would be about ${m(netVat)} a month. Compare with the last VAT return.`, `تدفع الخطة ${m(vatEntered)} شهريًا. وباعتبار المبيعات والغاز شاملة الضريبة فإن صافي الضريبة حوالي ${m(netVat)} شهريًا. قارنه بآخر إقرار ضريبي.`), go: () => go('cat:P_VAT') });
  if (cc && gasGap > 300000) decisions.push({ pri: 'high', t: T('Gas cost looks light against the P&L', 'تكلفة الغاز تبدو أخف من الأرباح والخسائر'), b: T(`The plan buys gas at ${pct((gas / R) * 100)} of receipts; the P&L shows ${pct(plCogs * 100)} of revenue. That is about ${m(gasGap)} a month. Confirm purchase prices and volumes with the suppliers.`, `تشتري الخطة الغاز بنسبة ${pct((gas / R) * 100)} من المقبوضات بينما تُظهر الأرباح والخسائر ${pct(plCogs * 100)} من الإيراد. الفرق حوالي ${m(gasGap)} شهريًا. أكد الأسعار والكميات مع الموردين.`), go: () => go('gas', 'pl') });
  if (cc && planDay > plRevDay * 1.08) decisions.push({ pri: 'high', t: T('Sales base is above the last three months', 'أساس المبيعات أعلى من آخر ثلاثة أشهر'), b: T(`The plan assumes ${m(planDay)} a day; the P&L averages about ${m(plRevDay)} a day including VAT. If October’s level is right, the plan overstates sales by ${pct((planDay / plRevDay - 1) * 100, 0)}.`, `تفترض الخطة ${m(planDay)} يوميًا بينما متوسط الأرباح والخسائر حوالي ${m(plRevDay)} يوميًا شاملة الضريبة. إذا كان مستوى أكتوبر هو الصحيح فإن الخطة تبالغ في المبيعات بنسبة ${pct((planDay / plRevDay - 1) * 100, 0)}.`), go: () => go('rec', 'season') });
  decisions.push({ pri: 'med', t: T(`Fund the heavy week: ${f.weeks[heavy].label}`, `جهّز الأسبوع الأثقل: ${f.weeks[heavy].label}`), b: T(`${f.weeks[heavy].label} (from ${date(f.weeks[heavy].start, lang)}) pays out ${m(pay[heavy])}. Biggest items: ${dev(heavy).map((r) => `${txt(r.label)} ${m(r.v)}`).join(', ') || '-'}. Cash stays ${m(close[heavy])} at its end.`, `${f.weeks[heavy].label} (من ${date(f.weeks[heavy].start, lang)}) تخرج فيه مدفوعات ${m(pay[heavy])}. أكبر البنود: ${dev(heavy).map((r) => `${txt(r.label)} ${m(r.v)}`).join('، ') || '-'}. يبقى النقد ${m(close[heavy])} في نهايته.`), go: () => go() });
  if (sea?.applied && peakWeeks.length) decisions.push({ pri: 'med', t: T('Get ready for the gas-season peak', 'استعد لذروة موسم الغاز'), b: T(`Sales peak at ×${Math.max(...(wf || [1])).toFixed(2)} around ${date(f.weeks[peakWeeks[0]].start, lang)}–${date(f.weeks[peakWeeks[peakWeeks.length - 1]].end, lang)}. Have stock, drivers and the new trucks (paid 26 Nov) ready; Ramadan starts ${date(sea.ramadan.start, lang, { day: 'numeric', month: 'long' })} and trims about ${pct(Math.abs(sea.ramadan.effect) * 100, 0)}.`, `تبلغ المبيعات ذروتها ×${Math.max(...(wf || [1])).toFixed(2)} حوالي ${date(f.weeks[peakWeeks[0]].start, lang)}–${date(f.weeks[peakWeeks[peakWeeks.length - 1]].end, lang)}. جهّز المخزون والسائقين والشاحنات الجديدة (تُدفع في 26 نوفمبر)؛ يبدأ رمضان ${date(sea.ramadan.start, lang, { day: 'numeric', month: 'long' })} ويخفض حوالي ${pct(Math.abs(sea.ramadan.effect) * 100, 0)}.`), go: () => go('rec', 'season') });
  if (branch) decisions.push({ pri: 'med', t: T('Confirm the branch-account balance', 'أكد رصيد حساب الفرع'), b: T(`${m(branch.balance)} of the opening cash sits in the branch account, a round figure with no bank statement behind it in the folder. Check it in the bank app.`, `${m(branch.balance)} من النقد الافتتاحي في حساب الفرع، رقم مدوّر دون كشف بنكي في المجلد. تحقق منه في تطبيق البنك.`), go: () => nav('/balances') });
  if (x.rent && x.rent.gaps.length) decisions.push({ pri: 'high', t: T('Review the rent schedule: it may be missing payments', 'راجع جدول الإيجارات: قد تغيب عنه دفعات'), b: T(`${x.rent.gaps.length} items: three new Arar contracts with no payments scheduled, two expired contracts with no renewal, one contract missing from the contracts list. About ${m(x.rent.potential)} more could fall inside the study and ${m(x.rent.potentialOverdue)} may be overdue.`, `${x.rent.gaps.length} بنود: ثلاثة عقود جديدة في عرعر بلا دفعات مجدولة وعقدان منتهيان بلا تجديد وعقد غير موجود في قائمة العقود. قد يضاف حوالي ${m(x.rent.potential)} داخل الدراسة وقد تكون ${m(x.rent.potentialOverdue)} متأخرة.`), go: () => go('cat:P_RENT') });
  decisions.push({ pri: 'info', t: T('No borrowing needed', 'لا حاجة للاقتراض'), b: T(`Cash never falls below ${m(h.lowestCash)} (${f.weeks[lowW].label}), so no facility is used. Closing cash is ${m(end)}.`, `لا ينخفض النقد عن ${m(h.lowestCash)} (${f.weeks[lowW].label}) فلا حاجة لتسهيلات. النقد الختامي ${m(end)}.`), go: () => go('close') });

  const kpis: Array<{ l: string; v: string; s: string; tone: string; go: () => void }> = [
    { l: T(`Opening, ${date(asOf, lang)}`, `الافتتاحي، ${date(asOf, lang)}`), v: m(open), s: T('bank balances', 'أرصدة البنوك'), tone: 'brand', go: () => go('open') },
    { l: T('Closing cash', 'النقد الختامي'), v: m(end), s: T(`${end >= open ? '+' : '-'}${m(Math.abs(end - open))} over ${N} weeks`, `${end >= open ? '+' : '-'}${m(Math.abs(end - open))} خلال ${N} أسبوعًا`), tone: end >= open ? 'rec' : 'pay', go: () => go('close') },
    { l: T('Lowest cash', 'أدنى نقد'), v: m(h.lowestCash), s: f.weeks[lowW].label + ' · ' + date(f.weeks[lowW].start, lang), tone: h.lowestCash < 0 ? 'pay' : 'brand', go: () => go('close') },
    { l: T('Sales a day', 'المبيعات يوميًا'), v: m(R / planDays(f.weeks)), s: T('incl. VAT, plan average', 'شامل الضريبة، متوسط الخطة'), tone: 'rec', go: () => go('rec') },
    { l: T('Gas cost ratio', 'نسبة تكلفة الغاز'), v: pct((gas / R) * 100), s: T(`${m(gas / mo)} a month`, `${m(gas / mo)} شهريًا`), tone: 'pay', go: () => go('gas') },
    { l: T('Cash margin', 'الهامش النقدي'), v: pct((opM / R) * 100), s: T('after gas and running costs', 'بعد الغاز والمصاريف'), tone: 'rec', go: () => go('opex') }
  ];

  const vf = per === 'm' ? monthly : f, vNow = per === 'm' ? (now >= 0 ? monthOfWeek(now) : -1) : now, vNet = vf.l1.net;
  const wnMax = Math.max(...vNet.map((v) => Math.abs(v)), 1);
  const wfPath = (() => {
    if (!wf) return null;
    const W = 520, H = 120, P = 10, lo = 0.9, hi = Math.max(...wf, 1.05) + 0.03;
    const xx = (i: number) => P + (W - 2 * P) * (i / (N - 1)), yy = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
    const d = wf.map((v, i) => (i ? 'L' : 'M') + xx(i).toFixed(1) + ' ' + yy(v).toFixed(1)).join(' ');
    const ri = f.weeks.findIndex((w) => sea && w.start >= sea.ramadan.start);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="ov-sea" role="img" aria-label={T('Sales factor by week', 'عامل المبيعات حسب الأسبوع')}>
        <line x1={P} x2={W - P} y1={yy(1)} y2={yy(1)} stroke="var(--ink2)" strokeOpacity=".4" strokeDasharray="3 5" />
        {ri >= 0 && <rect x={xx(ri) - 6} y={P} width={W - P - xx(ri) + 6} height={H - 2 * P} fill="var(--warn)" opacity=".15" rx="6" />}
        <path d={`${d} L${xx(N - 1)} ${H - P} L${xx(0)} ${H - P}Z`} fill="var(--brand-soft)" />
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="an-draw" />
        {wf.map((v, i) => <circle key={i} cx={xx(i)} cy={yy(v)} r={i === now ? 5.5 : 2.8} fill={i === now ? 'var(--ink)' : 'var(--brand)'}><title>{f.weeks[i].label + ' · ×' + v.toFixed(2)}</title></circle>)}
      </svg>
    );
  })();

  return (
    <div className="ov">
      <div className="head">
        <div><h1>{T('Command center', 'مركز القيادة')}</h1>
          <p className="sub">{T(`${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long', year: 'numeric' })} to ${date(f.weeks[N - 1].end, lang, { day: 'numeric', month: 'long', year: 'numeric' })}`, `من ${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long', year: 'numeric' })} إلى ${date(f.weeks[N - 1].end, lang, { day: 'numeric', month: 'long', year: 'numeric' })}`)}{now >= 0 ? ' · ' + T(`today is week ${now + 1}`, `اليوم هو الأسبوع ${now + 1}`) : ''} · {T('every card opens its detail', 'كل بطاقة تفتح تفاصيلها')}</p></div>
        <div className="pills">
          <span className={'pill ' + (bad ? 'bad' : 'ok')}>{bad ? '⚠ ' + bad + ' ' + T('checks fail', 'فحوصات فاشلة') : '✓ ' + T(`All ${f.checks.length} checks pass`, `نجحت كل الفحوصات (${f.checks.length})`)}</span>
          {s.plans.length > 1
            ? <select className="pill" aria-label="Plan" value={s.plan?.id} onChange={(e) => s.pickPlan(e.target.value)} style={{ border: 0, cursor: 'pointer' }}>{s.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            : <span className="pill">{s.plan?.name}</span>}
        </div>
      </div>

      <section className="ov-hero">
        <div className="ovh-top">
          <div>
            <span className="ovh-eyebrow">{T('Closing cash', 'النقد الختامي')} · {date(vf.weeks[vf.weeks.length - 1].end, lang, { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <div className="ovh-big num"><CountUp value={end} format={(v) => m(v)} /><small>SAR</small></div>
            <span className={'ovh-delta ' + (end >= open ? 'up' : 'down')}>{end >= open ? '▲' : '▼'} {m(Math.abs(end - open))} {T(`since ${date(asOf, lang)}`, `منذ ${date(asOf, lang)}`)}</span>
          </div>
          <div className="seg ovh-seg" role="group" aria-label={T('Show by', 'العرض حسب')}>
            <button type="button" aria-pressed={per === 'w'} onClick={() => pickPer('w')}>{T('Weekly', 'أسبوعي')}</button>
            <button type="button" aria-pressed={per === 'm'} onClick={() => pickPer('m')}>{T('Monthly', 'شهري')}</button>
          </div>
        </div>
        <HeroRunway f={vf} now={vNow} monthly={per === 'm'} onOpen={() => go('close')} key={per} />
        <div className="ovh-stats">
          {kpis.filter((_, k) => k !== 1).map((c) => (
            <button type="button" key={c.l} className={'ovh-stat t-' + c.tone} onClick={c.go}><span className="l">{c.l}</span><b className="num">{c.v}</b><span className="s">{c.s}</span></button>
          ))}
        </div>
      </section>

      <div className="grid ov-main" style={{ marginTop: 20 }}>
        <section className="card an-in">
          <h2>{T('Receipts and payments', 'المقبوضات والمدفوعات')}</h2>
          <div className="legend"><span><i style={{ background: 'var(--rec)' }} />{T('Receipts', 'المقبوضات')}</span><span><i style={{ background: 'var(--pay)' }} />{T('Payments', 'المدفوعات')}</span></div>
          <p className="sub">{per === 'm' ? T('Totals for each month.', 'مجموع كل شهر.') : T('Totals for each week.', 'مجموع كل أسبوع.')}</p>
          <div style={{ marginTop: 8 }} key={per}><Bars f={vf} /></div>
          <div className="ov-mini">
            <div><span>{T('Total receipts', 'إجمالي المقبوضات')}</span><b className="num">{m(R)}</b></div>
            <div><span>{T('Total payments', 'إجمالي المدفوعات')}</span><b className="num">{m(P)}</b></div>
            <div><span>{T('Net', 'الصافي')}</span><b className={'num ' + (R - P >= 0 ? 'up' : 'down')}>{m(R - P)}</b></div>
          </div>
        </section>

        <section className="card an-in ov-dec">
          <h2>{T('Recommended decisions', 'القرارات الموصى بها')}</h2>
          <p className="sub">{T('Worked out from the numbers on this plan.', 'مستخلصة من أرقام هذه الخطة.')}</p>
          <ul className="ov-decs">
            {decisions.map((d, i) => (
              <li key={i} style={{ animationDelay: i * 60 + 'ms' }} className="an-in">
                <button type="button" onClick={d.go}><span className={'pri ' + d.pri}>{d.pri === 'high' ? T('act', 'عاجل') : d.pri === 'med' ? T('plan', 'خطط') : T('ok', 'جيد')}</span><b>{d.t}</b><span className="bd">{d.b}</span></button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid ov-two" style={{ marginTop: 20 }}>
        <section className="card an-in">
          <h2>{T('Where each riyal goes', 'أين يذهب كل ريال')}</h2>
          <p className="sub">{T('Payments over the whole study. Click a slice.', 'المدفوعات على كامل الدراسة. اضغط على شريحة.')}</p>
          <Donut parts={parts} center={m(P)} sub={T('total payments', 'إجمالي المدفوعات')} onPick={(k) => go(SLICES.find((sl) => sl.k === k)?.link)} />
          <ul className="ov-leg">
            {parts.map((p) => <li key={p.k}><button type="button" onClick={() => go(p.link)}><i style={{ background: p.col }} /><span>{p.label}</span><b className="num">{pct((p.v / P) * 100)}</b></button></li>)}
          </ul>
        </section>

        <section className="card an-in">
          <h2>{T('Biggest payments, this week and next', 'أكبر المدفوعات، هذا الأسبوع والتالي')}</h2>
          <ul className="list">
            {f.upcoming.map((u) => {
              const cat = f.categories.find((c) => c.id === u.cat);
              return <li key={u.cat + u.l3 + u.week}><button type="button" className="ov-up" onClick={() => go('cat:' + u.cat)}><span className="w">{txt(u.label)}</span><span className="a num">{m(u.amount)}</span>
                <span className="s">{txt(cat as Txt)} · {f.weeks[u.week].label}{u.date ? ' (' + date(u.date, lang) + ')' : ''}</span></button></li>;
            })}
          </ul>
        </section>
      </div>

      {x.khazeen?.cities?.length ? (
        <section className="card an-in" style={{ marginTop: 20 }}>
          <h2>{T('Gas purchases by city (KHAZEEN)', 'مشتريات الغاز حسب المدينة (خزين)')}</h2>
          <KhazeenPivot cities={x.khazeen.cities} weeks={f.weeks} onOpen={() => go('gas')} />
        </section>
      ) : null}

      <div className="grid ov-two" style={{ marginTop: 20 }}>
        <section className="ov-seasoncard an-in">
          <div className="top"><div><span className="an-eyebrow light">{T('Gas season · October to end of February', 'موسم الغاز · من أكتوبر حتى نهاية فبراير')}</span><h2>{T('Winter demand', 'طلب الشتاء')}</h2></div>
            <button type="button" className="ov-go" onClick={() => go('rec', 'season')}>{T('Open the season study', 'افتح دراسة الموسم')} →</button></div>
          {sea?.applied && wfPath ? <>
            {wfPath}
            <div className="ov-sea-n">
              <div><span>{T('Peak', 'الذروة')}</span><b className="num">×{Math.max(...(wf || [1])).toFixed(2)}</b></div>
              <div><span>{T('This week', 'هذا الأسبوع')}</span><b className="num">{now >= 0 && wf ? '×' + wf[now].toFixed(2) : '-'}</b></div>
              <div><span>{T('Extra cash from the season', 'نقد إضافي من الموسم')}</span><b className="num">{sea.uplift ? m(sea.uplift.net) : '-'}</b></div>
              <div><span>Ramadan</span><b>{date(sea.ramadan.start, lang, { day: 'numeric', month: 'short' })}</b></div>
            </div>
          </> : <p className="empty" style={{ color: 'inherit' }}>{T('This plan does not apply the gas season. Pick “vendor schedule + gas season”.', 'هذه الخطة لا تطبق موسم الغاز. اختر «جدول الموردين + موسم الغاز».')}</p>}
        </section>

        <section className="card an-in">
          <h2>{T('Month by month', 'شهرًا بشهر')}</h2>
          <div className="ov-months">
            {[...months.entries()].map(([mk, mo]) => {
              const r = sum(mo.w.map((i) => rec[i])), p = sum(mo.w.map((i) => pay[i])), n = r - p, e = close[mo.w[mo.w.length - 1]];
              return (
                <button type="button" key={mk} className="mc" onClick={() => go()}>
                  <span className="mn">{mo.label}</span><span className="e num">{m(e)}</span>
                  <span className={'n num ' + (n >= 0 ? 'up' : 'down')}>{n >= 0 ? '+' : '-'}{m(Math.abs(n))}</span>
                  <span className="bar"><i style={{ width: Math.min(100, (r / Math.max(r, p)) * 100) + '%', background: 'var(--rec)' }} /><i style={{ width: Math.min(100, (p / Math.max(r, p)) * 100) + '%', background: 'var(--pay)' }} /></span>
                </button>
              );
            })}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>{T('Cash at month end, and net for the month.', 'النقد في نهاية الشهر وصافي الشهر.')}</p>
        </section>
      </div>

      <div className="grid ov-two" style={{ marginTop: 20 }}>
        <section className="card an-in">
          <h2>{T('Data health', 'سلامة البيانات')}</h2>
          <ul className="ov-health">
            <li className={bad ? 'bad' : 'ok'}><b>{bad ? '⚠' : '✓'}</b><span>{T(`Engine checks: ${f.checks.length - bad} of ${f.checks.length} pass (levels tie, cash rolls forward).`, `فحوصات المحرك: ${f.checks.length - bad} من ${f.checks.length} ناجحة (المستويات متطابقة والنقد يُرحَّل).`)}</span></li>
            <li className="ok"><b>✓</b><span>{T(`Bank data through ${x.source?.through ? date(x.source.through, lang, { day: 'numeric', month: 'long' }) : '-'}; opening cash ${m(open)} ties to the bank balances.`, `بيانات البنك حتى ${x.source?.through ? date(x.source.through, lang, { day: 'numeric', month: 'long' }) : '-'}؛ النقد الافتتاحي ${m(open)} يتطابق مع أرصدة البنك.`)}</span></li>
            <li className={cc ? 'ok' : 'bad'}><b>{cc ? '✓' : '⚠'}</b><span>{cc ? T('10-month P&L attached: cost lines cross-checked.', 'قائمة الأرباح والخسائر لعشرة أشهر مرفقة: بنود التكلفة مراجعة.') : T('No P&L attached to this plan.', 'لا توجد قائمة أرباح وخسائر مرفقة.')}</span></li>
            {cc && cc.costs.filter((c) => c.cat === 'P_DIESEL').map((c) => <li key={c.cat} className="ok"><b>✓</b><span>{T(`Fuel is in the plan (SAR 30,000 a week), against about ${m(avg3(c.monthly))} a month in the P&L.`, `الوقود ضمن الخطة (30,000 أسبوعيًا) مقابل حوالي ${m(avg3(c.monthly))} شهريًا في الأرباح والخسائر.`)}</span></li>)}
            <li className="warn"><b>!</b><span>{T('Still assumptions: Dyna and truck dates (26 each month), medical at month end, overdue rent paid in week 1, sales VAT-inclusive.', 'ما زالت افتراضات: تواريخ ديانا والشاحنات (26 من كل شهر)، الطبي في نهاية الشهر، الإيجار المتأخر يُدفع في الأسبوع 1، المبيعات شاملة الضريبة.')}</span></li>
          </ul>
        </section>

        <section className="card an-in">
          <h2>{T('Go deeper', 'تعمّق أكثر')}</h2>
          <div className="ov-links">
            <button type="button" onClick={() => nav('/analysis')}><b>{T('Why the cash moves', 'لماذا يتحرك النقد')}</b><span>{T('Bridge, every line, what-if sliders, heat map, P&L check', 'الجسر وكل بند ومؤشرات ماذا لو وخريطة حرارية ومقارنة الأرباح والخسائر')}</span></button>
            <button type="button" onClick={() => nav('/cash-flow')}><b>{T('Cash flow ledger', 'سجل التدفق النقدي')}</b><span>{T('Weekly lines down to each payment', 'بنود أسبوعية حتى كل دفعة')}</span></button>
            <button type="button" onClick={() => nav('/balances')}><b>{T('Opening balances', 'الأرصدة الافتتاحية')}</b><span>{T('Bank accounts, receivables, VAT', 'الحسابات البنكية والذمم والضريبة')}</span></button>
            <button type="button" onClick={() => go('gas', 'season')}><b>{T('Gas season study', 'دراسة موسم الغاز')}</b><span>{T('22 months of sales, Ramadan, the season peak', '22 شهرًا من المبيعات ورمضان وذروة الموسم')}</span></button>
          </div>
        </section>
      </div>
    </div>
  );
}
