import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';
import { useForecast } from './Overview';

interface Acct { code: string; name: string; section: 'revenue' | 'cogs' | 'opex' | 'other'; monthly: number[] }
interface Model {
  months?: Array<{ key: string; from: string; to: string; days: number }>;
  lines: Array<{ cat: string; l3: string; monthly?: number[] }>;
  crossCheck?: { months: string[]; revenue: number[]; cogs: number[]; cashProfit: number[]; netProfit: number[]; accounts?: Acct[] } | null;
}
type View = 'week' | 'month' | 'compare';
type Basis = 'amount' | 'pct';
type CogsBasis = 'plan' | 'pl3' | 'pl10';
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const med3 = (v: number[]) => [...v.slice(-3)].sort((a, b) => a - b)[1];
const avg3 = (v: number[]) => sum(v.slice(-3)) / 3;
const pcs = (p: number | null) => (p === null ? '–' : p < 0 ? '(' + Math.abs(p).toFixed(1) + '%)' : p.toFixed(1) + '%');
const pc = (a: number, b: number) => (Math.abs(a) > 0.5 ? ((b - a) / Math.abs(a)) * 100 : null);

/** Display groups; the cash categories they are compared with in the bridge from profit to cash. */
const GROUPS: Array<{ id: string; en: string; ar: string; codes: string[]; cash: string[] }> = [
  { id: 'payroll', en: 'Payroll, allowances, incentives, commission', ar: 'الرواتب والبدلات والحوافز والعمولات', codes: ['600005', '600015', '600020', '600025', '600026', '600040', '600045', '610005', '610015', '610020', '610025', '610040', '610045'], cash: ['P_PAYROLL'] },
  { id: 'gosi', en: 'GOSI', ar: 'التأمينات الاجتماعية', codes: ['600010', '610010'], cash: ['P_GOSI'] },
  { id: 'iqama', en: 'Iqama and residency', ar: 'الإقامات', codes: ['600030', '610030'], cash: ['P_RESIDENTS'] },
  { id: 'maint', en: 'Maintenance and medical insurance', ar: 'الصيانة والتأمين الطبي', codes: ['600060', '610060', '610105', '600035', '610035'], cash: ['P_STAFF'] },
  { id: 'rent', en: 'Rent', ar: 'الإيجارات', codes: ['600055', '610055'], cash: ['P_RENT'] },
  { id: 'util', en: 'Electricity, water, telecom', ar: 'الكهرباء والمياه والاتصالات', codes: ['600115', '610160', '600075', '610075'], cash: ['P_UTILITIES'] },
  { id: 'fleet', en: 'Fleet and fuel', ar: 'الأسطول والوقود', codes: ['600110', '600100', '610175', '600165', '600105'], cash: ['P_SUPPLIERS', 'P_DIESEL'] },
  { id: 'gov', en: 'Government fees and violations', ar: 'الرسوم الحكومية والمخالفات', codes: ['600090', '610085', '610115', '600140', '600145', '600155', '600170', '610165', '610220', '600130', '600160', '600135'], cash: ['P_GOV'] },
  { id: 'bank', en: 'Bank charges and POS fees', ar: 'الرسوم البنكية ورسوم نقاط البيع', codes: ['610130'], cash: ['P_BANK', 'P_POS_FEES'] },
  { id: 'oneoff', en: 'Write-offs, capital gains and losses, other income', ar: 'شطب وأرباح وخسائر رأسمالية ودخل آخر', codes: ['610185', '610195', '610135'], cash: [] },
  { id: 'admin', en: 'Administration and other', ar: 'الإدارة وأخرى', codes: ['600070', '610070', '600095', '610090', '610170', '610180', '600125', '610145', '610100', '610110', '400013', '400046', '610120'], cash: [] }
];
const PROV = ['610111'], INTEREST = ['610125'], ZAKAT = ['610140'], DA = ['610095', '600065', '610065'], DROP = ['610185', '610195', '610135'];   // one-offs: in the actuals, never forecast
const VARIABLE = ['600026', '610130', '600165'];                                   // move with sales
const SALES_CATS = ['R_CASH', 'R_POS', 'R_CUSTOMERS', 'R_TRANSFERS'];

interface Col { label: string; sub: string; kind: 'actual' | 'plan'; rev: number; cogs: number; a: Record<string, number>; extraDa: number }

export function Pnl() {
  const s = useSession();
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { f, error } = useForecast(s.plan?.id, s.plan?.version);
  const [mdl, setMdl] = useState<Model | null>(null);
  const [view, setView] = useState<View>('month'), [basis, setBasis] = useState<Basis>('amount'), [cogsBasis, setCogsBasis] = useState<CogsBasis>('plan'), [units, setUnits] = useState<'k' | 'full'>('full');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!s.plan?.id) return;
    let live = true;
    api<{ model: Model }>('GET', `/api/plans/${s.plan.id}`).then((r) => { if (live) setMdl(r.model); }).catch(() => { if (live) setMdl(null); });
    return () => { live = false; };
  }, [s.plan?.id, s.plan?.version]);

  const D = useMemo(() => {
    if (!f || !mdl?.crossCheck?.accounts || !mdl.months) return null;
    const cc = mdl.crossCheck, accts = cc.accounts!, N = f.weeks.length;
    const byCode: Record<string, Acct> = Object.fromEntries(accts.map((a) => [a.code, a]));
    const L2 = (id: string) => f.l2[id] || new Array(N).fill(0);
    const salesW = Array.from({ length: N }, (_, i) => sum(SALES_CATS.map((id) => L2(id)[i] || 0)));
    const gasTotal = sum(L2('P_KHAZEEN')), salesTotal = sum(salesW);
    const ratio = cogsBasis === 'plan' ? gasTotal / salesTotal : cogsBasis === 'pl3' ? avg3(cc.cogs) / avg3(cc.revenue) : sum(cc.cogs) / sum(cc.revenue);
    const revBase = avg3(cc.revenue);                                    // P&L revenue a month, last three months
    // daily fixed amount of an account: median of the last three months spread over the days of the month; some are management figures
    const monthDays = (iso: string) => { const [y, mo] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
    const isoOf = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(f.weeks[0].start + 'T00:00:00Z');
    const days: Array<{ iso: string; w: number; mi: number }> = [];
    for (let i = 0; i < N * 7; i++) {
      const d = new Date(start.getTime() + i * 864e5), iso = isoOf(d);
      const mi = mdl.months!.findIndex((mo) => iso >= mo.from && iso <= mo.to);
      if (mi >= 0) days.push({ iso, w: Math.floor(i / 7), mi });
    }
    const fixedDaily = (code: string, iso: string): number => {
      const a = byCode[code]; if (!a) return 0;
      if (code === '600110') return 30000 / 7;                          // fuel: management figure, SAR 30,000 a week
      if (code === '600060') return 15000 / 7;                          // maintenance: SAR 15,000 a week
      if (code === '610060' || code === '610105' || code === '600035') return 0;
      if (code === '610035') return iso.slice(8, 10) === '15' ? 11000 : 0;   // medical policy SAR 11,000 a month
      if (DROP.includes(code)) return 0;
      const v = VARIABLE.includes(code) ? avg3(a.monthly) : med3(a.monthly);
      return v / monthDays(iso);
    };
    const codes = accts.filter((a) => a.section === 'opex' || a.section === 'other').map((a) => a.code);
    const newDaily = (iso: string) => (iso >= '2026-12-01' ? (400000 + 1125000) / 60 / monthDays(iso) : 0);   // 5-year straight line on the new vehicles, from December
    const mk = (idxOf: (d: { w: number; mi: number }) => number, n: number, labels: Array<[string, string]>, revs: number[], dayCount: number[]): Col[] => {
      const cols: Col[] = labels.map(([label, sub], i) => ({ label, sub, kind: 'plan', rev: revs[i], cogs: revs[i] * ratio, a: {}, extraDa: 0 }));
      days.forEach((d) => {
        const i = idxOf(d), c = cols[i], vf = revs[i] / ((revBase * dayCount[i]) / 30.4375);
        codes.forEach((code) => { c.a[code] = (c.a[code] || 0) + fixedDaily(code, d.iso) * (VARIABLE.includes(code) ? vf : 1); });
        c.extraDa += newDaily(d.iso);
      });
      return cols;
    };
    const weekCols = mk((d) => d.w, N, f.weeks.map((w) => [w.label, date(w.start, lang)] as [string, string]), salesW.map((v) => v / 1.15), new Array(N).fill(7));
    const lines = mdl.lines;
    const monthRev = mdl.months!.map((_, j) => sum(lines.filter((l) => SALES_CATS.includes(l.cat)).map((l) => (l.monthly || [])[j] || 0)) / 1.15);
    const monthCols = mk((d) => d.mi, mdl.months!.length, mdl.months!.map((mo) => [date(mo.from, lang, { month: 'long', year: 'numeric' }), `${mo.days} ${T('days', 'يومًا')}`] as [string, string]), monthRev, mdl.months!.map((mo) => mo.days));
    const nAct = 3, am = cc.months.length;
    const actCols: Col[] = Array.from({ length: nAct }, (_, k) => {
      const i = am - nAct + k, a: Record<string, number> = {};
      accts.forEach((x) => { if (x.section === 'opex' || x.section === 'other') a[x.code] = x.monthly[i] || 0; });
      return { label: cc.months[i] + ' 2026', sub: T('actual', 'فعلي'), kind: 'actual', rev: cc.revenue[i], cogs: cc.cogs[i] + (byCode['400001']?.monthly[i] || 0), a, extraDa: 0 };
    });
    // cash side, for the bridge from profit to cash
    const cash = (ids: string[]) => sum(ids.map((id) => sum(L2(id))));
    return { cc, N, weekCols, monthCols, actCols, ratio, salesTotal, gasTotal, cash, L2, codes, byCode, revBase };
  }, [f, mdl, cogsBasis, lang]);

  if (error) return <p className="msg err">{error}</p>;
  if (!f || !D) return <p className="sub">…</p>;
  const { cc, ratio, salesTotal, gasTotal, cash, weekCols, monthCols, actCols, byCode } = D;
  const cols: Col[] = view === 'week' ? weekCols : view === 'month' ? [...actCols, ...monthCols] : [...actCols.slice(-1), ...monthCols];
  const nPlan = monthCols.length;
  const sumOf = (c: Col, codes: string[]) => sum(codes.map((x) => c.a[x] || 0));
  const gross = (c: Col) => c.rev - c.cogs;
  const grpV = (c: Col, g: (typeof GROUPS)[number]) => sumOf(c, g.codes);
  const opexV = (c: Col) => sum(GROUPS.map((g) => grpV(c, g)));
  const provV = (c: Col) => sumOf(c, PROV);
  const daV = (c: Col) => sumOf(c, DA) + c.extraDa;
  const intV = (c: Col) => sumOf(c, INTEREST), zakV = (c: Col) => sumOf(c, ZAKAT);
  const ebitda = (c: Col) => gross(c) - opexV(c) - provV(c);
  const net = (c: Col) => ebitda(c) - daV(c) - intV(c) - zakV(c);
  const cashProfit = (c: Col) => net(c) + daV(c) + provV(c);
  const nCols = view === 'compare' ? cols.length + 2 * (cols.length - 1) + 1 : cols.length + 1;

  const fmt = (v: number, c: Col, share = true) => (basis === 'pct' ? (share && c.rev ? pcs((v / c.rev) * 100) : '') : (units === 'k' ? acc(v / 1000) : acc(v)));
  const totalOf = (fn: (c: Col) => number) => (view === 'week' ? weekCols : monthCols).reduce((t, c) => t + fn(c), 0);
  const totalRev = (view === 'week' ? weekCols : monthCols).reduce((t, c) => t + c.rev, 0);
  const row = (key: string, label: string, fn: (c: Col) => number, o: { cls?: string; neg?: boolean; sub?: boolean; toggle?: string; share?: boolean } = {}) => {
    const vals = cols.map(fn), dir = o.neg ? -1 : 1;
    return (
      <tr key={key} className={o.cls || ''}>
        <td className="lab">{o.toggle ? <button type="button" className="tg" aria-expanded={!!open[o.toggle]} onClick={() => setOpen({ ...open, [o.toggle!]: !open[o.toggle!] })}><span className="ch">›</span><span>{label}</span></button> : <span style={{ paddingInlineStart: o.sub ? 26 : 0 }}>{label}</span>}</td>
        {vals.map((v, i) => <td key={i} className={'num' + (cols[i].kind === 'actual' ? ' act' : '') + (v < -0.5 && basis === 'amount' ? ' neg' : '')}>{fmt(v, cols[i], o.share !== false)}</td>)}
        {view === 'compare' && vals.slice(1).map((v, i) => {
          let d: number, p: number | null, t: string;
          if (basis === 'pct') { const a = cols[i].rev ? (vals[i] / cols[i].rev) * 100 : 0, b2 = cols[i + 1].rev ? (v / cols[i + 1].rev) * 100 : 0; d = b2 - a; p = null; t = d === 0 ? '-' : (d > 0 ? '+' : '') + d.toFixed(1) + ' pp'; }
          else { d = v - vals[i]; p = pc(vals[i], v); t = d === 0 ? '-' : (d > 0 ? '+' : '') + (units === 'k' ? acc(d / 1000) : acc(d)); }
          const good = d === 0 ? '' : (d > 0) === (dir > 0) ? ' up' : ' down';
          return <Fragment key={'c' + i}><td className={'num chg' + good}>{t}</td><td className={'num chg' + good}>{basis === 'pct' ? '' : pcs(p)}</td></Fragment>;
        })}
        <td className="num">{view === 'week' || view === 'month' || view === 'compare' ? (basis === 'pct' ? (totalRev ? pcs((cols.filter((c) => c.kind === 'plan').reduce((t, c) => t + fn(c), 0) / (cols.filter((c) => c.kind === 'plan').reduce((t, c) => t + c.rev, 0) || 1)) * 100) : '') : '') : ''}{basis === 'amount' ? (units === 'k' ? acc(cols.filter((c) => c.kind === 'plan').reduce((t, c) => t + fn(c), 0) / 1000) : acc(cols.filter((c) => c.kind === 'plan').reduce((t, c) => t + fn(c), 0))) : ''}</td>
      </tr>
    );
  };
  void totalOf;

  // ---- from profit to cash (plan totals)
  const planCols = monthCols;
  const NP = sum(planCols.map(net)), DAP = sum(planCols.map(daV)) + sum(planCols.map(provV)), ZAK = sum(planCols.map(zakV)), REV = sum(planCols.map((c) => c.rev)), COGS = sum(planCols.map((c) => c.cogs));
  const loanPaid = cash(['P_LOAN']), interest = sum(planCols.map(intV)), vatPaid = cash(['P_VAT']), capex = cash(['P_CAPEX']);
  const otherReceipts = cash(['R_OTHER', 'R_OPEN_AR', 'R_OWNER']), otherPay = cash(['P_ACQUISITION', 'P_RELATED', 'P_OTHER', 'P_OWNER', 'P_OUTSIDE', 'P_ZATCA']);
  const runExpense = sum(GROUPS.map((g) => sum(planCols.map((c) => grpV(c, g))))), runCash = sum(GROUPS.map((g) => cash(g.cash)));
  const items = [
    { en: 'Net profit (accrual)', ar: 'صافي الربح (محاسبي)', v: NP, tot: true },
    { en: 'Depreciation, amortization and provisions: expensed, not paid', ar: 'الإهلاك والإطفاء والمخصصات: مصروفة وغير مدفوعة', v: DAP },
    { en: 'Zakat: expensed monthly, paid once a year after the plan', ar: 'الزكاة: تُحمَّل شهريًا وتُدفع سنويًا بعد الخطة', v: ZAK },
    { en: 'Loan: the instalment paid less the interest already expensed (principal)', ar: 'القرض: القسط المدفوع ناقص الفائدة المحمّلة (الأصل)', v: -(loanPaid - interest) },
    { en: 'VAT collected on sales (receipts include it, revenue does not)', ar: 'ضريبة المبيعات المحصّلة (المقبوضات تشملها والإيراد لا)', v: salesTotal - REV },
    { en: 'VAT paid to ZATCA', ar: 'ضريبة القيمة المضافة المدفوعة لهيئة الزكاة', v: -vatPaid },
    { en: 'Gas: cost of sales expensed less gas paid (incl. VAT and instalments)', ar: 'الغاز: تكلفة المبيعات المحمّلة ناقص الغاز المدفوع (شامل الضريبة والأقساط)', v: COGS - gasTotal },
    { en: 'Running costs: expensed (P&L run-rate) less paid (cash schedules)', ar: 'المصاريف التشغيلية: المحمّلة (معدل الأرباح والخسائر) ناقص المدفوعة (الجداول النقدية)', v: runExpense - runCash },
    { en: 'New vehicles paid (capital, not an expense)', ar: 'المركبات الجديدة المدفوعة (رأسمالي وليس مصروفًا)', v: -capex },
    { en: 'Other receipts and payments', ar: 'مقبوضات ومدفوعات أخرى', v: otherReceipts - otherPay }
  ];
  const cashChange = f.l1.closing[f.l1.closing.length - 1] - f.l1.opening[0];
  const explained = sum(items.map((i) => i.v));
  const unexplained = cashChange - explained;

  const histNet = cc.netProfit, histMonths = cc.months;
  const chartVals = [...histNet.map((v, i) => ({ l: histMonths[i], v, act: true })), ...monthCols.map((c, i) => ({ l: (mdlLabel(i)), v: net(c), act: false }))];
  function mdlLabel(i: number) { return date(mdl!.months![i].from, lang, { month: 'short' }); }
  const cmax = Math.max(...chartVals.map((x) => Math.abs(x.v)), 1);

  return (
    <div className="pnl">
      <div className="head">
        <div><h1>{T('Expected P&L', 'الأرباح والخسائر المتوقعة')}</h1>
          <p className="sub">{T('Accrual basis: revenue and cost of sales without VAT, every cost on the P&L’s own run-rate, depreciation and provisions included. Built from the cash plan and your 10-month P&L (72 accounts).', 'الأساس المحاسبي: الإيراد وتكلفة المبيعات بدون ضريبة، وكل تكلفة بمعدلها في الأرباح والخسائر مع الإهلاك والمخصصات. مبني على خطة النقد وقائمة الأرباح والخسائر لعشرة أشهر (72 حسابًا).')}</p></div>
        {s.plans.length > 1 && <select className="pill" aria-label="Plan" value={s.plan?.id} onChange={(e) => s.pickPlan(e.target.value)} style={{ border: 0, cursor: 'pointer' }}>{s.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      </div>

      <div className="an-kpis">
        {[
          { l: T('Revenue (ex VAT)', 'الإيراد (بدون ضريبة)'), v: m(REV), s: T(`${m(REV / (f.weeks.length * 7))} a day`, `${m(REV / (f.weeks.length * 7))} يوميًا`), t: 'rec' },
          { l: T('Gross profit', 'مجمل الربح'), v: m(REV - COGS), s: T(`${((1 - COGS / REV) * 100).toFixed(1)}% margin`, `هامش ${((1 - COGS / REV) * 100).toFixed(1)}%`), t: 'brand' },
          { l: T('Net profit', 'صافي الربح'), v: m(NP), s: T(`${((NP / REV) * 100).toFixed(1)}% of revenue`, `${((NP / REV) * 100).toFixed(1)}% من الإيراد`), t: NP >= 0 ? 'rec' : 'pay' },
          { l: T('Cash profit (non-cash added back)', 'الربح النقدي (بعد إضافة غير النقدي)'), v: m(NP + DAP), s: T(`${(((NP + DAP) / REV) * 100).toFixed(1)}% of revenue`, `${(((NP + DAP) / REV) * 100).toFixed(1)}% من الإيراد`), t: 'rec' },
          { l: T('P&L, last 3 months', 'الأرباح والخسائر، آخر 3 أشهر'), v: ((avg3(cc.cashProfit) / avg3(cc.revenue)) * 100).toFixed(1) + '%', s: T('cash profit margin', 'هامش الربح النقدي'), t: 'brand' }
        ].map((c) => <div key={c.l} className={'an-kpi t-' + c.t}><span className="l">{c.l}</span><span className="v num">{c.v}</span><span className="s">{c.s}</span></div>)}
      </div>

      <div className="tools" style={{ marginTop: 14 }}>
        <div className="seg" role="group">{(['week', 'month', 'compare'] as View[]).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v === 'week' ? T('Weekly', 'أسبوعي') : v === 'month' ? T('Monthly', 'شهري') : T('Compare months', 'مقارنة الأشهر')}</button>)}</div>
        <div className="seg" role="group">{(['amount', 'pct'] as Basis[]).map((b) => <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)}>{b === 'amount' ? T('Amounts', 'المبالغ') : T('Vertical: % of revenue', 'رأسي: % من الإيراد')}</button>)}</div>
        <div className="seg" role="group">{(['k', 'full'] as const).map((u) => <button key={u} type="button" aria-pressed={units === u} onClick={() => setUnits(u)}>{u === 'k' ? "SAR '000" : 'SAR'}</button>)}</div>
        <div className="seg" role="group" aria-label={T('Cost of sales basis', 'أساس تكلفة المبيعات')}>
          <button type="button" aria-pressed={cogsBasis === 'plan'} onClick={() => setCogsBasis('plan')}>{T(`Cost of sales: plan ${(gasTotal / salesTotal * 100).toFixed(1)}%`, `تكلفة المبيعات: الخطة ${(gasTotal / salesTotal * 100).toFixed(1)}%`)}</button>
          <button type="button" aria-pressed={cogsBasis === 'pl3'} onClick={() => setCogsBasis('pl3')}>{T(`P&L last 3 months ${(avg3(cc.cogs) / avg3(cc.revenue) * 100).toFixed(1)}%`, `الأرباح والخسائر آخر 3 أشهر ${(avg3(cc.cogs) / avg3(cc.revenue) * 100).toFixed(1)}%`)}</button>
          <button type="button" aria-pressed={cogsBasis === 'pl10'} onClick={() => setCogsBasis('pl10')}>{T(`10-month ${(sum(cc.cogs) / sum(cc.revenue) * 100).toFixed(1)}%`, `10 أشهر ${(sum(cc.cogs) / sum(cc.revenue) * 100).toFixed(1)}%`)}</button>
        </div>
      </div>

      <div className="ledger-wrap">
        <table className="ledger">
          <thead><tr>
            <th className="lab">{basis === 'pct' ? T('% of revenue', '% من الإيراد') : units === 'k' ? "SAR '000" : 'SAR'}</th>
            {cols.map((c, i) => <th key={i} className={c.kind === 'actual' ? 'act' : ''}><b>{c.label}</b>{c.sub}</th>)}
            {view === 'compare' && cols.slice(1).map((c, i) => <Fragment key={'h' + i}><th className="chg"><b>{cols[i + 1].label.split(' ')[0].slice(0, 3)} vs {cols[i].label.split(' ')[0].slice(0, 3)}</b>{basis === 'pct' ? T('points', 'نقاط') : T('change', 'التغيّر')}</th><th className="chg"><b>{cols[i + 1].label.split(' ')[0].slice(0, 3)} vs {cols[i].label.split(' ')[0].slice(0, 3)}</b>%</th></Fragment>)}
            <th><b>{view === 'week' ? T('Total', 'الإجمالي') : T('Plan total', 'إجمالي الخطة')}</b></th>
          </tr></thead>
          <tbody>
            {row('rev', T('Revenue (sales excluding VAT)', 'الإيراد (المبيعات بدون ضريبة)'), (c) => c.rev, { cls: 'tot' })}
            {row('cogs', T('Cost of sales (gas)', 'تكلفة المبيعات (الغاز)'), (c) => c.cogs, { neg: true })}
            {row('gp', T('Gross profit', 'مجمل الربح'), gross, { cls: 'tot' })}
            <tr className="sec"><td className="lab">{T('Operating expenses', 'المصاريف التشغيلية')}</td><td colSpan={nCols} /></tr>
            {GROUPS.map((g) => (
              <Fragment key={g.id}>
                {row(g.id, lang === 'ar' ? g.ar : g.en, (c) => grpV(c, g), { neg: true, toggle: g.id })}
                {open[g.id] && g.codes.filter((code) => byCode[code] && (byCode[code].monthly.some((x) => Math.abs(x) > 0.5) || ['600110', '600060', '610035'].includes(code))).map((code) => row(g.id + code, `${code} ${byCode[code].name}`, (c) => c.a[code] || 0, { neg: true, sub: true, cls: 'l3' }))}
              </Fragment>
            ))}
            {row('opex', T('Total operating expenses', 'إجمالي المصاريف التشغيلية'), opexV, { cls: 'tot', neg: true })}
            {row('prov', T('Provisions (non-cash)', 'مخصصات (غير نقدية)'), provV, { neg: true })}
            {row('ebitda', T('Operating profit before depreciation and financing', 'الربح التشغيلي قبل الإهلاك والتمويل'), ebitda, { cls: 'tot' })}
            {row('da', T('Depreciation and amortization (incl. new vehicles)', 'الإهلاك والإطفاء (شامل المركبات الجديدة)'), daV, { neg: true })}
            {row('int', T('Loan interest', 'فوائد القرض'), intV, { neg: true })}
            {row('zak', T('Zakat (accrued)', 'الزكاة (مستحقة)'), zakV, { neg: true })}
            {row('np', T('Net profit', 'صافي الربح'), net, { cls: 'key' })}
            {row('cp', T('Cash profit (net profit + non-cash)', 'الربح النقدي (صافي الربح + غير النقدي)'), cashProfit, { cls: 'tot' })}
          </tbody>
        </table>
      </div>
      <p className="sub" style={{ marginTop: 6 }}>{T('Shaded columns are actuals from the P&L. Plan columns: revenue is the plan’s sales receipts less 15% VAT; cost of sales is the chosen ratio times revenue; fuel, maintenance and medical use the management figures; sales commission and bank charges move with sales; every other account is its median of the last three months, spread by day; zakat and provisions accrue monthly; new vehicles are depreciated over five years from December.', 'الأعمدة المظللة فعلية من الأرباح والخسائر. أعمدة الخطة: الإيراد هو مقبوضات المبيعات في الخطة ناقص ضريبة 15%؛ وتكلفة المبيعات هي النسبة المختارة × الإيراد؛ والوقود والصيانة والتأمين الطبي بأرقام الإدارة؛ وعمولة المبيعات والرسوم البنكية تتبع المبيعات؛ وكل حساب آخر هو وسيط آخر ثلاثة أشهر موزعًا على الأيام؛ والزكاة والمخصصات تُحمَّل شهريًا؛ وتُهلك المركبات الجديدة على خمس سنوات من ديسمبر.')}</p>

      <section className="card an-in" style={{ marginTop: 20 }}>
        <h2>{T('Net profit by month: actual and expected', 'صافي الربح شهريًا: فعلي ومتوقع')}</h2>
        <svg viewBox="0 0 900 200" className="pnl-chart" role="img" aria-label={T('Net profit by month', 'صافي الربح شهريًا')}>
          <line x1="20" x2="880" y1="110" y2="110" stroke="var(--ink2)" strokeOpacity=".4" />
          {chartVals.map((x, i) => {
            const w = 860 / chartVals.length, h = (Math.abs(x.v) / cmax) * 86, y = x.v >= 0 ? 110 - h : 110;
            return <g key={i}><rect x={20 + i * w + w * 0.18} y={y} width={w * 0.64} height={Math.max(2, h)} rx="5" fill={x.act ? 'var(--ink2)' : x.v >= 0 ? 'var(--rec)' : 'var(--pay)'} opacity={x.act ? 0.55 : 0.95}><title>{x.l + ' · ' + m(x.v)}</title></rect>
              <text x={20 + i * w + w / 2} y={x.v >= 0 ? y - 5 : y + h + 13} textAnchor="middle" fontSize="10.5" className="num" fill="var(--ink)">{acc(x.v / 1000)}</text>
              <text x={20 + i * w + w / 2} y={190} textAnchor="middle" fontSize="11" fill="var(--ink2)">{x.l}</text></g>;
          })}
        </svg>
        <p className="sub">{T("Grey: actual net profit Jan–Oct 2026 (SAR '000). Colour: expected, using the cost-of-sales basis chosen above.", 'الرمادي: صافي الربح الفعلي يناير–أكتوبر 2026 (آلاف الريالات). الملون: المتوقع حسب أساس تكلفة المبيعات المختار أعلاه.')}</p>
      </section>

      <section className="card an-in" style={{ marginTop: 20 }}>
        <h2>{T('From net profit to the cash plan', 'من صافي الربح إلى خطة النقد')}</h2>
        <p className="sub">{T('Why cash is not profit. Every step is a number from the two statements; the steps add up to the change in cash over the plan.', 'لماذا النقد ليس الربح. كل خطوة رقم من القائمتين؛ ومجموع الخطوات يساوي التغير في النقد خلال الخطة.')}</p>
        <table className="an-tbl"><tbody>
          {items.map((it, i) => <tr key={i} className={it.tot ? 'tot' : ''}><td>{i > 0 ? (it.v >= 0 ? '+ ' : '− ') : ''}{lang === 'ar' ? it.ar : it.en}</td><td className={'num ' + (it.v >= 0 ? 'up' : 'down')}>{acc(it.v)}</td></tr>)}
          <tr className="tot"><td>{T('= change in cash in the plan', '= التغير في النقد في الخطة')}</td><td className="num"><b>{acc(explained)}</b></td></tr>
          <tr><td className="sub">{T('Cash plan: closing less opening', 'خطة النقد: الختامي ناقص الافتتاحي')}</td><td className="num">{acc(cashChange)}</td></tr>
          <tr><td className="sub">{T('Difference', 'الفرق')}</td><td className={'num ' + (Math.abs(unexplained) < 2 ? 'up' : 'down')}>{acc(unexplained)}</td></tr>
        </tbody></table>
        <p className="an-p">{T(`Cost of sales uses ${(ratio * 100).toFixed(1)}% of revenue. Revenue ex VAT is ${m(REV)}; the plan’s receipts are ${m(salesTotal)}.`, `تستخدم تكلفة المبيعات ${(ratio * 100).toFixed(1)}% من الإيراد. الإيراد بدون ضريبة ${m(REV)}؛ ومقبوضات الخطة ${m(salesTotal)}.`)}</p>
      </section>
    </div>
  );
}
