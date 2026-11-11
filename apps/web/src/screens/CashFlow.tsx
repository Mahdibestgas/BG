import { Fragment, useEffect, useState } from 'react';
import { api, type Forecast, type Item } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { currentWeek, date, k, m } from '../format';
import { useForecast } from './Overview';

type Units = 'k' | 'full';
type View = 'week' | 'month' | 'compare';
type Basis = 'amount' | 'pct';
interface PlanLine { cat: string; l3: string; values: number[]; monthly?: number[] }
interface PlanMonth { key: string; from: string; to: string; days: number }
interface PlanModel { months?: PlanMonth[]; lines: PlanLine[]; financing?: { openingCash: number } }

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pcs = (p: number | null) => (p === null ? '–' : p < 0 ? '(' + Math.abs(p).toFixed(1) + '%)' : p.toFixed(1) + '%');
const pc = (a: number, b: number) => (Math.abs(a) > 0.5 ? ((b - a) / Math.abs(a)) * 100 : null);
const OPEX = ['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS', 'P_STAFF', 'P_RENT', 'P_UTILITIES', 'P_SUPPLIERS', 'P_DIESEL', 'P_GOV', 'P_POS_FEES', 'P_BANK'];

export function CashFlow() {
  const s = useSession();
  const { t, err, txt, lang } = useI18n();
  const { f, error } = useForecast(s.plan?.id, s.plan?.version);
  const [units, setUnits] = useState<Units>(() => (localStorage.getItem('cf13_units') === 'k' ? 'k' : 'full'));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<Record<string, Item[] | 'loading'>>({});
  const [view, setView] = useState<View>(() => { try { const v = localStorage.getItem('cf13_view'); return v === 'month' || v === 'compare' ? v : 'week'; } catch { return 'week'; } });
  const [basis, setBasis] = useState<Basis>(() => { try { return localStorage.getItem('cf13_basis') === 'pct' ? 'pct' : 'amount'; } catch { return 'amount'; } });
  const [pm, setPm] = useState<PlanModel | null>(null);
  const [showRatios, setShowRatios] = useState(true);

  useEffect(() => {
    if (!s.plan?.id) return;
    let live = true;
    api<{ model: PlanModel }>('GET', `/api/plans/${s.plan.id}`).then((r) => { if (live) setPm(r.model); }).catch(() => { if (live) setPm(null); });
    return () => { live = false; };
  }, [s.plan?.id, s.plan?.version]);

  if (error) return <p className="msg err">{err(error)}</p>;
  if (!f) return <p className="sub">{t('loading')}</p>;
  const N = f.weeks.length, now = currentWeek(f.weeks);
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  // ---- months: exact calendar months from the plan (every payment on its own date); weeks only as a fallback
  const exact = !!(pm?.months?.length && pm.lines.every((l) => Array.isArray(l.monthly)));
  type MC = { key: string; label: string; short: string; sub: string; w: number[]; days: number };
  const mcols: MC[] = [];
  if (exact && pm?.months) {
    pm.months.forEach((mo) => {
      const first = Number(mo.from.slice(8, 10)) === 1, eom = new Date(Date.UTC(Number(mo.to.slice(0, 4)), Number(mo.to.slice(5, 7)), 0)).getUTCDate() === Number(mo.to.slice(8, 10));
      mcols.push({ key: mo.key, label: date(mo.from, lang, { month: 'long', year: 'numeric' }), short: date(mo.from, lang, { month: 'short' }), days: mo.days, w: [],
        sub: first && eom ? L(`${mo.days} days`, `${mo.days} يومًا`) : `${date(mo.from, lang, { day: 'numeric', month: 'short' })} – ${date(mo.to, lang, { day: 'numeric', month: 'short' })} · ${L(`${mo.days} days`, `${mo.days} يومًا`)}` });
    });
  } else {
    f.weeks.forEach((w, i) => {
      const key = w.start.slice(0, 7); let c = mcols.find((x) => x.key === key);
      if (!c) { c = { key, label: date(w.start, lang, { month: 'long', year: 'numeric' }), short: date(w.start, lang, { month: 'short' }), sub: '', days: 0, w: [] }; mcols.push(c); }
      c.w.push(i); c.days += 7; c.sub = L(`${c.w.length} weeks`, `${c.w.length} أسابيع`);
    });
  }
  const M = mcols.length;
  const nCols = view === 'week' ? N + 1 : view === 'month' ? M + 1 : M + 2 * (M - 1) + 1;
  const agg = (vals: number[], kind: 'flow' | 'first' | 'last') => mcols.map((c) => (kind === 'flow' ? sum(c.w.map((i) => vals[i])) : kind === 'first' ? vals[c.w[0]] : vals[c.w[c.w.length - 1]]));
  const lineM = (pred: (l: PlanLine) => boolean): number[] => mcols.map((_, j) => sum((pm?.lines || []).filter(pred).map((l) => (l.monthly || [])[j] || 0)));
  const recM = exact ? lineM((l) => l.cat.startsWith('R_')) : agg(f.l1.receipts, 'flow');
  const payM = exact ? lineM((l) => l.cat.startsWith('P_')) : agg(f.l1.payments, 'flow');
  const netM = recM.map((v, j) => v - payM[j]);
  const open0 = f.l1.opening[0];
  const closeM = exact ? netM.reduce<number[]>((a, v, j) => [...a, (j ? a[j - 1] : open0) + v], []) : agg(f.l1.closing, 'last');
  const openM = exact ? closeM.map((_, j) => (j ? closeM[j - 1] : open0)) : agg(f.l1.opening, 'first');
  const catMv = (id: string) => (exact ? lineM((l) => l.cat === id) : undefined);
  const l3Mv = (cat: string, l3: string) => (exact ? lineM((l) => l.cat === cat && l.l3 === l3) : undefined);
  const recW = f.l1.receipts;

  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  async function toggleL3(cat: string, l3: string) {
    if (view !== 'week') return;                       // L4 items are weekly; open them in the weekly view
    const key = cat + '|' + l3;
    toggle('i:' + key);
    if (items[key]) return;
    setItems((x) => ({ ...x, [key]: 'loading' }));
    const r = await api<{ items: Item[] }>('GET', `/api/plans/${s.plan!.id}/items?cat=${encodeURIComponent(cat)}&l3=${encodeURIComponent(l3)}`);
    setItems((x) => ({ ...x, [key]: r.items }));
  }

  /** One row of cells in the current view. mv = exact monthly values when the plan carries them. Vertical analysis shows % of receipts. */
  const cells = (vals: number[], total = true, kind: 'flow' | 'first' | 'last' = 'flow', dir = 1, mv?: number[]) => {
    const pct = basis === 'pct';
    if (view === 'week') {
      const tot = sum(vals), totDen = sum(recW);
      return <>
        {vals.map((v, i) => <td key={i} className={'num' + (i === now ? ' now' : '') + (v < -0.5 && !pct ? ' neg' : '')}>{pct ? (kind === 'flow' && recW[i] ? pcs((v / recW[i]) * 100) : '') : k(v, units)}</td>)}
        <td className="num">{total ? (pct ? (totDen ? pcs((tot / totDen) * 100) : '') : k(tot, units)) : ''}</td>
      </>;
    }
    const cv = mv ?? agg(vals, kind), den = recM;
    const shown = (v: number, j: number) => (pct ? (kind === 'flow' && den[j] ? pcs((v / den[j]) * 100) : '') : k(v, units));
    return <>
      {cv.map((v, j) => <td key={'m' + j} className={'num' + (v < -0.5 && !pct ? ' neg' : '')}>{shown(v, j)}</td>)}
      {view === 'compare' && cv.slice(1).map((v, j) => {
        let d: number, p: number | null, txtD: string;
        if (pct) { const a = den[j] ? (cv[j] / den[j]) * 100 : 0, b = den[j + 1] ? (v / den[j + 1]) * 100 : 0; d = b - a; p = null; txtD = kind === 'flow' ? (d === 0 ? '-' : (d > 0 ? '+' : '') + d.toFixed(1) + ' pp') : ''; }
        else { d = v - cv[j]; p = pc(cv[j], v); txtD = d === 0 ? '-' : (d > 0 ? '+' : '') + k(d, units); }
        const good = d === 0 ? '' : (d > 0) === (dir > 0) ? ' up' : ' down';
        return <Fragment key={'c' + j}><td className={'num chg' + good}>{txtD}</td><td className={'num chg' + good}>{pct ? '' : pcs(p)}</td></Fragment>;
      })}
      <td className="num">{total ? (pct ? (sum(den) ? pcs((sum(cv) / sum(den)) * 100) : '') : k(sum(cv), units)) : ''}</td>
    </>;
  };
  const anyOpen = Object.values(open).some(Boolean);

  const section = (sec: 'receipts' | 'payments') => f.categories.filter((c) => c.section === sec).map((c) => {
    const vals = f.l2[c.id], rows = f.l3[c.id] || [];
    if (!rows.length) return null;
    const isOpen = !!open[c.id], dir = sec === 'receipts' ? 1 : -1;
    return (
      <Fragment key={c.id}>
        <tr>
          <td className="lab"><button type="button" className="tg" aria-expanded={isOpen} onClick={() => toggle(c.id)}>
            <span className="ch">›</span><span>{txt(c)} <span className="cnt">{rows.length === 1 ? t('line1') : t('lines', { n: rows.length })}</span></span></button></td>
          {cells(vals, true, 'flow', dir, catMv(c.id))}
        </tr>
        {isOpen && rows.map((r) => {
          const key = c.id + '|' + r.l3, l4 = items[key], l4Open = view === 'week' && !!open['i:' + key];
          return (
            <Fragment key={key}>
              <tr className="l3">
                <td className="lab"><button type="button" className="tg" aria-expanded={l4Open} onClick={() => toggleL3(c.id, r.l3)} disabled={view !== 'week'} title={view !== 'week' ? L('Individual items are shown in the weekly view', 'البنود الفردية تظهر في العرض الأسبوعي') : undefined}>
                  <span className="ch">›</span><span>{txt(r.label)} <span className="cnt">{r.items === 1 ? t('item1') : t('items', { n: r.items })}</span></span></button></td>
                {cells(r.values, true, 'flow', dir, l3Mv(c.id, r.l3))}
              </tr>
              {l4Open && (l4 === 'loading' || !l4 ? <tr className="l4"><td className="lab">{t('loading')}</td><td colSpan={nCols} /></tr>
                : groupItems(l4, N).map((g, gi) => (
                  <tr className="l4" key={gi}><td className="lab">{g.label(txt, lang)}</td>{cells(g.values, true, 'flow', dir)}</tr>
                )))}
            </Fragment>
          );
        })}
      </Fragment>
    );
  });

  // ---- ratios, by month and for the whole plan
  const cat = (id: string) => (exact ? lineM((l) => l.cat === id) : agg(f.l2[id] || new Array(N).fill(0), 'flow'));
  const gasM = cat('P_KHAZEEN'), payrollM = cat('P_PAYROLL'), rentM = cat('P_RENT'), loanM = cat('P_LOAN'), vatM = cat('P_VAT'), capexM = cat('P_CAPEX');
  const opexM = mcols.map((_, j) => sum(OPEX.map((id) => cat(id)[j])));
  const cols = [...mcols.map((c, j) => ({ label: c.short, days: c.days || 30, rec: recM[j], pay: payM[j], gas: gasM[j], payroll: payrollM[j], rent: rentM[j], opex: opexM[j], loan: loanM[j], vat: vatM[j], capex: capexM[j], net: netM[j], close: closeM[j] })),
    { label: L('Plan', 'الخطة'), days: sum(mcols.map((c) => c.days || 30)), rec: sum(recM), pay: sum(payM), gas: sum(gasM), payroll: sum(payrollM), rent: sum(rentM), opex: sum(opexM), loan: sum(loanM), vat: sum(vatM), capex: sum(capexM), net: sum(netM), close: closeM[M - 1] }];
  type Col = (typeof cols)[number];
  const opc = (c: Col) => c.rec - c.gas - c.opex;
  const ratios: Array<{ id: string; label: string; v: (c: Col) => number | null; fmt: 'pct' | 'x' | 'sar'; good: 1 | -1 }> = [
    { id: 'gas', label: L('Gas purchases % of receipts', 'مشتريات الغاز % من المقبوضات'), v: (c) => (c.rec ? (c.gas / c.rec) * 100 : null), fmt: 'pct', good: -1 },
    { id: 'spread', label: L('Left after gas % of receipts', 'المتبقي بعد الغاز % من المقبوضات'), v: (c) => (c.rec ? ((c.rec - c.gas) / c.rec) * 100 : null), fmt: 'pct', good: 1 },
    { id: 'opex', label: L('Running costs % of receipts', 'المصاريف التشغيلية % من المقبوضات'), v: (c) => (c.rec ? (c.opex / c.rec) * 100 : null), fmt: 'pct', good: -1 },
    { id: 'payroll', label: L('Payroll % of receipts', 'الرواتب % من المقبوضات'), v: (c) => (c.rec ? (c.payroll / c.rec) * 100 : null), fmt: 'pct', good: -1 },
    { id: 'rent', label: L('Rent % of receipts', 'الإيجار % من المقبوضات'), v: (c) => (c.rec ? (c.rent / c.rec) * 100 : null), fmt: 'pct', good: -1 },
    { id: 'opm', label: L('Operating cash margin', 'هامش النقد التشغيلي'), v: (c) => (c.rec ? (opc(c) / c.rec) * 100 : null), fmt: 'pct', good: 1 },
    { id: 'net', label: L('Net cash margin', 'هامش صافي النقد'), v: (c) => (c.rec ? (c.net / c.rec) * 100 : null), fmt: 'pct', good: 1 },
    { id: 'dscr', label: L('Loan cover (operating cash ÷ loan instalments)', 'تغطية القرض (النقد التشغيلي ÷ الأقساط)'), v: (c) => (c.loan ? opc(c) / c.loan : null), fmt: 'x', good: 1 },
    { id: 'tax', label: L('VAT and loan % of operating cash', 'الضريبة والقرض % من النقد التشغيلي'), v: (c) => (opc(c) ? ((c.vat + c.loan) / opc(c)) * 100 : null), fmt: 'pct', good: -1 },
    { id: 'capex', label: L('New vehicles % of operating cash', 'المركبات الجديدة % من النقد التشغيلي'), v: (c) => (opc(c) ? (c.capex / opc(c)) * 100 : null), fmt: 'pct', good: -1 },
    { id: 'rday', label: L('Receipts a day', 'المقبوضات يوميًا'), v: (c) => c.rec / c.days, fmt: 'sar', good: 1 },
    { id: 'pday', label: L('Payments a day', 'المدفوعات يوميًا'), v: (c) => c.pay / c.days, fmt: 'sar', good: -1 },
    { id: 'cover', label: L('Cash cover: days of payments held at period end', 'تغطية النقد: أيام المدفوعات في نهاية الفترة'), v: (c) => (c.pay ? c.close / (c.pay / c.days) : null), fmt: 'x', good: 1 }
  ];
  const fv = (x: number | null, f2: 'pct' | 'x' | 'sar') => (x === null ? '–' : f2 === 'pct' ? x.toFixed(1) + '%' : f2 === 'x' ? x.toFixed(1) + (f2 === 'x' ? '×' : '') : m(x));

  return (
    <>
      <div className="head"><div><h1>{t('cashTitle')}</h1><p className="sub">{t('cashSub')}</p></div></div>
      <div className="tools">
        <div className="seg" role="group" aria-label={L('View', 'العرض')}>
          {(['week', 'month', 'compare'] as View[]).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); try { localStorage.setItem('cf13_view', v); } catch { /* private mode */ } }}>{v === 'week' ? L('Weekly', 'أسبوعي') : v === 'month' ? L('Monthly', 'شهري') : L('Compare months', 'مقارنة الأشهر')}</button>)}
        </div>
        <div className="seg" role="group" aria-label={L('Analysis', 'التحليل')}>
          {(['amount', 'pct'] as Basis[]).map((b) => <button key={b} type="button" aria-pressed={basis === b} onClick={() => { setBasis(b); try { localStorage.setItem('cf13_basis', b); } catch { /* private mode */ } }}>{b === 'amount' ? L('Amounts', 'المبالغ') : L('Vertical: % of receipts', 'رأسي: % من المقبوضات')}</button>)}
        </div>
        <div className="seg" role="group">
          {(['k', 'full'] as Units[]).map((u) => <button key={u} type="button" aria-pressed={units === u} onClick={() => { setUnits(u); localStorage.setItem('cf13_units', u); }}>{u === 'k' ? t('unitsK') : t('unitsFull')}</button>)}
        </div>
        <button type="button" className="btn ghost" onClick={() => setOpen(anyOpen ? {} : Object.fromEntries(f.categories.map((c) => [c.id, true])))}>{anyOpen ? t('closeAll') : t('openAll')}</button>
      </div>

      {view !== 'week' && (
        <div className="cf-strip" aria-label={L('Month summary', 'ملخص الأشهر')}>
          {mcols.map((c, j) => (
            <div key={c.key} className="cf-m an-in" style={{ animationDelay: j * 60 + 'ms' }}>
              <span className="mn">{c.label} <small>{c.sub}</small></span>
              <b className="num">{k(closeM[j], units)}</b><em>{L('cash at month end', 'النقد في نهاية الشهر')}</em>
              <div className="r"><span>{L('Receipts', 'مقبوضات')}</span><span className="num">{k(recM[j], units)}{j > 0 && <small className={recM[j] >= recM[j - 1] ? 'up' : 'down'}> {pcs(pc(recM[j - 1], recM[j]))}</small>}</span></div>
              <div className="r"><span>{L('Payments', 'مدفوعات')}</span><span className="num">{k(payM[j], units)}{j > 0 && <small className={payM[j] <= payM[j - 1] ? 'up' : 'down'}> {pcs(pc(payM[j - 1], payM[j]))}</small>}</span></div>
              <div className="r"><span>{L('Net', 'الصافي')}</span><span className={'num ' + (netM[j] >= 0 ? 'up' : 'down')}>{k(netM[j], units)}{j > 0 && <small> {pcs(pc(netM[j - 1], netM[j]))}</small>}</span></div>
            </div>
          ))}
        </div>
      )}
      {view !== 'week' && exact && mcols.some((c) => c.days < 28) && <p className="sub" style={{ margin: '0 0 10px' }}>{L('The first month is partial (the study starts on 9 November), so its totals cover fewer days: compare the per-day ratios below for a like-for-like view.', 'الشهر الأول جزئي (تبدأ الدراسة في 9 نوفمبر) فإجمالياته لأيام أقل: قارن النسب اليومية أدناه للحصول على مقارنة متكافئة.')}</p>}

      <div className="ledger-wrap">
        <table className="ledger">
          <thead><tr>
            <th className="lab">{basis === 'pct' ? L('% of receipts', '% من المقبوضات') : units === 'k' ? t('unitsK') : t('unitsFull')}</th>
            {view === 'week' ? f.weeks.map((w, i) => <th key={i} className={i === now ? 'now' : ''}><b>{w.label}</b>{date(w.start, lang)}</th>)
              : mcols.map((c) => <th key={c.key}><b>{c.label}</b>{c.sub}</th>)}
            {view === 'compare' && mcols.slice(1).map((c, j) => <Fragment key={'h' + c.key}><th className="chg"><b>{c.short} vs {mcols[j].short}</b>{basis === 'pct' ? L('points', 'نقاط') : L('change', 'التغيّر')}</th><th className="chg"><b>{c.short} vs {mcols[j].short}</b>%</th></Fragment>)}
            <th><b>{view === 'week' ? t('total') : L(`${N} weeks`, `${N} أسبوعًا`)}</b></th>
          </tr></thead>
          <tbody>
            <tr className="key"><td className="lab">{t('opening')}</td>{cells(f.l1.opening, false, 'first', 1, openM)}</tr>
            <tr className="sec"><td className="lab">{t('sec_receipts')}</td><td colSpan={nCols} /></tr>
            {section('receipts')}
            <tr className="tot"><td className="lab">{t('receipts')}</td>{cells(f.l1.receipts, true, 'flow', 1, recM)}</tr>
            <tr className="sec"><td className="lab">{t('sec_payments')}</td><td colSpan={nCols} /></tr>
            {section('payments')}
            <tr className="tot"><td className="lab">{t('payments')}</td>{cells(f.l1.payments, true, 'flow', -1, payM)}</tr>
            <tr className="tot"><td className="lab">{t('net')}</td>{cells(f.l1.net, true, 'flow', 1, netM)}</tr>
            {f.l1.interest.some((v) => v) && <tr><td className="lab">{t('interest')}</td>{cells(f.l1.interest, true, 'flow', -1)}</tr>}
            <tr className="key"><td className="lab">{t('closing')}</td>{cells(f.l1.closing, false, 'last', 1, closeM)}</tr>
            <tr><td className="lab">{t('facility')}</td>{cells(f.l1.facility, false, 'last', -1)}</tr>
            <tr><td className="lab">{t('vsBuffer')}</td>{cells(f.l1.buffer, false, 'last', 1)}</tr>
          </tbody>
        </table>
      </div>

      <section className="card an-in" style={{ marginTop: 20 }}>
        <div className="khz-head"><h2 style={{ margin: 0 }}>{L('Ratios', 'النسب')}</h2>
          <button type="button" className="btn ghost" onClick={() => setShowRatios(!showRatios)}>{showRatios ? L('Hide', 'إخفاء') : L('Show', 'إظهار')}</button></div>
        <p className="sub">{L('Vertical analysis (each cost against receipts) and horizontal analysis (the move from the first to the last month), on exact calendar months.', 'التحليل الرأسي (كل بند مقابل المقبوضات) والتحليل الأفقي (التغير من أول شهر إلى آخر شهر)، على أشهر تقويمية دقيقة.')}</p>
        {showRatios && (
          <div className="khz-scroll">
            <table className="an-tbl">
              <thead><tr><th>{L('Ratio', 'النسبة')}</th>{cols.map((c) => <th key={c.label}>{c.label}</th>)}<th>{L('Change, first to last month', 'التغير من أول شهر إلى آخر شهر')}</th></tr></thead>
              <tbody>{ratios.map((r) => {
                const vs = cols.map((c) => r.v(c)), a = vs[0], b = vs[M - 1];
                const ch = a === null || b === null ? null : r.fmt === 'pct' ? b - a : a ? ((b - a) / Math.abs(a)) * 100 : null;
                const good = ch === null || ch === 0 ? '' : (ch > 0) === (r.good > 0) ? ' up' : ' down';
                return <tr key={r.id}><td>{r.label}</td>{vs.map((x, j) => <td key={j} className={'num' + (j === cols.length - 1 ? ' tot' : '')}>{r.fmt === 'x' ? (x === null ? '–' : x.toFixed(1) + '×') : fv(x, r.fmt)}</td>)}
                  <td className={'num' + good}>{ch === null ? '–' : (ch > 0 ? '+' : '') + ch.toFixed(1) + (r.fmt === 'pct' ? ' pp' : '%')}</td></tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** L4 lines: one row per distinct note (e.g. "PO W3, 30% on delivery"), weeks across. */
function groupItems(items: Item[], N: number) {
  const by = new Map<string, { note: Item['note']; date: string | null; values: number[] }>();
  for (const it of items) {
    const key = (it.note?.en || '') + '|' + (it.date || '');
    const g = by.get(key) || { note: it.note, date: it.date, values: new Array(N).fill(0) };
    g.values[it.w] += it.amount;
    by.set(key, g);
  }
  return [...by.values()].slice(0, 120).map((g) => ({
    values: g.values,
    label: (txt: (o: any) => string, lang: string) => (txt(g.note) || '—') + (g.date ? ' · ' + date(g.date, lang) : '')
  }));
}
export type { Forecast };
