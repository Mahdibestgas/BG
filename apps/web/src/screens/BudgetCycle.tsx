import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { favourable, STUDY_FIELDS, type DeptPlan, type Kind, type Study } from '@cf13/budget';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';
import { useBudgetMeta } from './Budget';

const sum = (a: number[]) => a.reduce((t, x) => t + (x || 0), 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const monthLabel = (k: string, lang: string) => date(k + '-01', lang, { month: 'short', year: '2-digit' });
const useT = () => { const { lang } = useI18n(); return (en: string, ar: string) => (lang === 'ar' ? ar : en); };
const pct = (a: number, b: number) => (b ? ((a / Math.abs(b)) * 100).toFixed(1) + '%' : '–');
function download(name: string, rows: Array<Array<string | number>>) {
  const text = rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
/** "unknown_item:rows.4" → the message and the CSV line it points at (header is line 1). */
function codeText(code: string, T: (en: string, ar: string) => string, err: (c: string) => string) {
  const [base, where] = code.split(':');
  const row = where?.startsWith('rows.') ? Number(where.split('.')[1]) + 2 : null;
  const known: Record<string, [string, string]> = {
    unknown_item: ['Unknown item', 'بند غير معروف'], unknown_region: ['Unknown city', 'مدينة غير معروفة'], month_outside_cycle: ['Month outside the budget round', 'شهر خارج دورة الميزانية'],
    invalid_number: ['Amount is not a number', 'المبلغ ليس رقمًا'], too_many_rows: ['Too many rows (20,000 at most)', 'عدد الأسطر كبير (20,000 كحد أقصى)'], nothing_to_load: ['Nothing to load', 'لا يوجد ما يُحمّل'],
    nothing_approved: ['No department budget is approved yet', 'لا توجد ميزانية إدارة معتمدة بعد'], plan_checks_failed: ['The cash plan failed its checks; nothing was saved', 'فشلت فحوص خطة النقد ولم يُحفظ شيء'],
    plan_locked: ['That cash plan is approved and locked', 'خطة النقد معتمدة ومقفلة'], too_long: ['A text is too long', 'نص طويل جدًا'], invalid_months: ['A month is not valid', 'شهر غير صحيح']
  };
  const k = known[base];
  return (k ? T(k[0], k[1]) : err(code)) + (row ? T(` (line ${row})`, ` (السطر ${row})`) : '');
}

// ---------------------------------------------------------------- step 1 and 2: study and plan, inside the department workspace
export function StudyEditor({ study, editable, onChange }: { study: Study; editable: boolean; onChange: (s: Study) => void }) {
  const { txt } = useI18n(); const T = useT();
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Step 1 · Study', 'الخطوة 1 · الدراسة')}</h2>
      <p className="sub">{T('Before any number: where the department stands, what the market says and what the budget rests on. The owner reads this next to the figures.', 'قبل أي رقم: وضع الإدارة اليوم وما يقوله السوق وما تقوم عليه الميزانية. يقرأ المالك هذا بجانب الأرقام.')}</p>
      {STUDY_FIELDS.map((f) => (
        <label key={f.key} className="field bgt-text">
          <span><b>{txt(f.name)}</b> <small className="sub">{txt(f.hint)}</small></span>
          <textarea rows={4} maxLength={4000} disabled={!editable} value={study[f.key]} onChange={(e) => onChange({ ...study, [f.key]: e.target.value })} />
        </label>
      ))}
    </section>
  );
}

const numOrNull = (v: string) => { const t = v.replace(/,/g, '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
export function PlanEditor({ plan, months, editable, onChange }: { plan: DeptPlan; months: string[]; editable: boolean; onChange: (p: DeptPlan) => void }) {
  const { lang } = useI18n(); const T = useT();
  const set = <K extends keyof DeptPlan>(k: K, v: DeptPlan[K]) => onChange({ ...plan, [k]: v });
  const row = <K extends 'objectives' | 'initiatives' | 'risks'>(k: K, i: number, patch: Partial<DeptPlan[K][number]>) => set(k, plan[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) as DeptPlan[K]);
  const drop = (k: 'objectives' | 'initiatives' | 'risks', i: number) => set(k, plan[k].filter((_, j) => j !== i) as never);
  const rm = (k: 'objectives' | 'initiatives' | 'risks', i: number) => editable && <td><button type="button" className="link danger" onClick={() => drop(k, i)}>{T('Remove', 'حذف')}</button></td>;
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Step 2 · Plan', 'الخطوة 2 · الخطة')}</h2>
      <p className="sub">{T('Where the department wants to be at the end of the round, how it gets there, how it will be measured, and what could go wrong.', 'أين تريد الإدارة أن تكون في نهاية الدورة، وكيف تصل، وكيف يُقاس ذلك، وما الذي قد يعيقها.')}</p>
      <label className="field bgt-text"><span><b>{T('Vision for the year', 'رؤية العام')}</b></span>
        <textarea rows={3} maxLength={2000} disabled={!editable} value={plan.vision} onChange={(e) => set('vision', e.target.value)} /></label>

      <h3 className="an-h3">{T('Objectives and KPIs', 'الأهداف ومؤشرات الأداء')}</h3>
      {plan.objectives.length > 0 && <div className="khz-scroll"><table className="tbl bgt-plan"><thead><tr><th>{T('Objective', 'الهدف')}</th><th>{T('KPI', 'المؤشر')}</th><th>{T('Unit', 'الوحدة')}</th><th className="n">{T('Today', 'اليوم')}</th><th className="n">{T('Target', 'المستهدف')}</th>{editable && <th />}</tr></thead>
        <tbody>{plan.objectives.map((o, i) => <tr key={o.id}>
          <td><input disabled={!editable} maxLength={300} value={o.text} onChange={(e) => row('objectives', i, { text: e.target.value })} aria-label={T('Objective', 'الهدف')} /></td>
          <td><input disabled={!editable} maxLength={120} value={o.kpi} onChange={(e) => row('objectives', i, { kpi: e.target.value })} aria-label={T('KPI', 'المؤشر')} /></td>
          <td><input disabled={!editable} maxLength={30} style={{ width: 90 }} value={o.unit} onChange={(e) => row('objectives', i, { unit: e.target.value })} aria-label={T('Unit', 'الوحدة')} /></td>
          <td><input disabled={!editable} inputMode="decimal" className="num" style={{ width: 100 }} value={o.baseline ?? ''} onChange={(e) => row('objectives', i, { baseline: numOrNull(e.target.value) })} aria-label={T('Today', 'اليوم')} /></td>
          <td><input disabled={!editable} inputMode="decimal" className="num" style={{ width: 100 }} value={o.target ?? ''} onChange={(e) => row('objectives', i, { target: numOrNull(e.target.value) })} aria-label={T('Target', 'المستهدف')} /></td>
          {rm('objectives', i)}</tr>)}</tbody></table></div>}
      {editable && <button type="button" className="link" onClick={() => set('objectives', [...plan.objectives, { id: uid(), text: '', kpi: '', unit: '', baseline: null, target: null }])}>{T('+ Add an objective', '+ إضافة هدف')}</button>}

      <h3 className="an-h3">{T('Initiatives', 'المبادرات')}</h3>
      {plan.initiatives.length > 0 && <div className="khz-scroll"><table className="tbl bgt-plan"><thead><tr><th>{T('Initiative', 'المبادرة')}</th><th>{T('Owner', 'المسؤول')}</th><th>{T('Month', 'الشهر')}</th><th>{T('Serves objective', 'يخدم الهدف')}</th>{editable && <th />}</tr></thead>
        <tbody>{plan.initiatives.map((x, i) => <tr key={x.id}>
          <td><input disabled={!editable} maxLength={200} value={x.title} onChange={(e) => row('initiatives', i, { title: e.target.value })} aria-label={T('Initiative', 'المبادرة')} /></td>
          <td><input disabled={!editable} maxLength={80} value={x.owner} onChange={(e) => row('initiatives', i, { owner: e.target.value })} aria-label={T('Owner', 'المسؤول')} /></td>
          <td><select disabled={!editable} value={x.month ?? ''} onChange={(e) => row('initiatives', i, { month: e.target.value === '' ? null : Number(e.target.value) })} aria-label={T('Month', 'الشهر')}><option value="">–</option>{months.map((k, j) => <option key={k} value={j}>{monthLabel(k, lang)}</option>)}</select></td>
          <td><select disabled={!editable} value={x.objective} onChange={(e) => row('initiatives', i, { objective: e.target.value })} aria-label={T('Serves objective', 'يخدم الهدف')}><option value="">–</option>{plan.objectives.map((o, j) => <option key={o.id} value={o.id}>{o.text || T('Objective ', 'الهدف ') + (j + 1)}</option>)}</select></td>
          {rm('initiatives', i)}</tr>)}</tbody></table></div>}
      {editable && <button type="button" className="link" onClick={() => set('initiatives', [...plan.initiatives, { id: uid(), title: '', owner: '', month: null, objective: '' }])}>{T('+ Add an initiative', '+ إضافة مبادرة')}</button>}

      <h3 className="an-h3">{T('Risks', 'المخاطر')}</h3>
      {plan.risks.length > 0 && <div className="khz-scroll"><table className="tbl bgt-plan"><thead><tr><th>{T('Risk', 'الخطر')}</th><th>{T('Impact', 'الأثر')}</th><th>{T('What we do about it', 'ما نفعله حياله')}</th>{editable && <th />}</tr></thead>
        <tbody>{plan.risks.map((x, i) => <tr key={x.id}>
          <td><input disabled={!editable} maxLength={300} value={x.risk} onChange={(e) => row('risks', i, { risk: e.target.value })} aria-label={T('Risk', 'الخطر')} /></td>
          <td><select disabled={!editable} value={x.impact} onChange={(e) => row('risks', i, { impact: e.target.value as 'low' | 'medium' | 'high' })} aria-label={T('Impact', 'الأثر')}><option value="low">{T('Low', 'منخفض')}</option><option value="medium">{T('Medium', 'متوسط')}</option><option value="high">{T('High', 'مرتفع')}</option></select></td>
          <td><input disabled={!editable} maxLength={300} value={x.mitigation} onChange={(e) => row('risks', i, { mitigation: e.target.value })} aria-label={T('What we do about it', 'ما نفعله حياله')} /></td>
          {rm('risks', i)}</tr>)}</tbody></table></div>}
      {editable && <button type="button" className="link" onClick={() => set('risks', [...plan.risks, { id: uid(), risk: '', impact: 'medium', mitigation: '' }])}>{T('+ Add a risk', '+ إضافة خطر')}</button>}
    </section>
  );
}

// ---------------------------------------------------------------- actuals: load what really happened, month by month
interface ActualsData { cycle: { id: string; name: string; monthKeys: string[] }; rows: Array<{ month: string; item: string; region: string; amount: number; source: string }> }
export function BudgetActuals() {
  const { cycle: cycleId = '' } = useParams();
  const { lang, txt, err } = useI18n(); const T = useT();
  const { meta } = useBudgetMeta();
  const [d, setD] = useState<ActualsData | null>(null), [text, setText] = useState(''), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [busy, setBusy] = useState(false);
  const load = () => api<ActualsData>('GET', `/api/budget/cycles/${cycleId}/actuals`).then(setD).catch((e) => setMsg({ ok: false, t: err(e instanceof ApiError ? e.code : 'network') }));
  useEffect(() => { load(); }, [cycleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the item and the city can be given by id or by name, in English or Arabic
  const parsed = useMemo(() => {
    if (!meta || !text.trim()) return null;
    const norm = (s: string) => s.trim().toLowerCase();
    const itemBy = new Map<string, string>(), regBy = new Map<string, string>();
    for (const i of meta.pack.items) { itemBy.set(norm(i.id), i.id); itemBy.set(norm(i.name.en), i.id); itemBy.set(norm(i.name.ar), i.id); }
    for (const r of meta.regions) { regBy.set(norm(r.id), r.id); regBy.set(norm(r.name.en), r.id); regBy.set(norm(r.name.ar), r.id); }
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const cells = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()); };
    const body = /^month$/i.test(cells(lines[0])[0]) ? lines.slice(1) : lines;
    const rows = body.map((l) => { const [month, item, region, amount] = cells(l); return { month: (month || '').slice(0, 7), item: itemBy.get(norm(item || '')) || item || '', region: regBy.get(norm(region || '')) || region || '', amount: Number((amount || '').replace(/,/g, '')) }; });
    return { rows, months: [...new Set(rows.map((r) => r.month))].sort(), total: sum(rows.map((r) => (Number.isFinite(r.amount) ? r.amount : 0))) };
  }, [text, meta]);

  if (!d || !meta) return msg ? <p className="msg err">{msg.t}</p> : <p className="sub">…</p>;
  const byMonth = d.cycle.monthKeys.map((k) => { const rs = d.rows.filter((r) => r.month === k); return { k, n: rs.length, total: sum(rs.map((r) => r.amount)), source: rs[0]?.source }; });
  const template = () => download('actuals-template.csv', [['month', 'item', 'region', 'amount', 'item name (ignored)', 'department (ignored)'],
    ...meta.pack.items.map((i) => [d.cycle.monthKeys[0], i.id, meta.regions[0]?.id || '', 0, i.name.en, txt(meta.pack.allDepartments.find((x) => x.id === i.dept)?.name)])]);
  async function loadRows() {
    if (!parsed) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ months: string[]; rows: number }>('PUT', `/api/budget/cycles/${cycleId}/actuals`, { rows: parsed.rows, source: 'csv' });
      setText(''); await load();
      setMsg({ ok: true, t: T(`${r.rows} rows loaded for `, `حُمّل ${r.rows} سطرًا لأشهر `) + r.months.map((x) => monthLabel(x, lang)).join(', ') + '.' });
    } catch (e) { setMsg({ ok: false, t: codeText(e instanceof ApiError ? e.code : 'network', T, err) }); }
    finally { setBusy(false); }
  }
  async function clearMonth(k: string) {
    if (!window.confirm(T(`Remove the actuals of ${monthLabel(k, lang)}?`, `حذف الفعلي لشهر ${monthLabel(k, lang)}؟`))) return;
    try { await api('PUT', `/api/budget/cycles/${cycleId}/actuals`, { rows: [], replace: [k] }); await load(); } catch (e) { setMsg({ ok: false, t: codeText(e instanceof ApiError ? e.code : 'network', T, err) }); }
  }
  return (
    <div className="bgt">
      <div className="head">
        <div><span className="an-eyebrow">{d.cycle.name}</span><h1>{T('Actuals', 'الفعلي')}</h1>
          <p className="sub">{T('What really happened, month by month, by item and city. SAR, excluding VAT, the same basis as the budget. Loading a month replaces that month as a whole, so a re-import never counts twice.', 'ما حدث فعلًا شهرًا بشهر حسب البند والمدينة، بالريال وبدون ضريبة، على أساس الميزانية نفسه. تحميل شهر يستبدل الشهر كاملًا فلا يُحسب مرتين.')}</p></div>
        <div className="pills"><Link className="btn" to={`/budget/${cycleId}/variance`}>{T('Budget vs actual', 'الميزانية مقابل الفعلي')}</Link><Link className="btn ghost" to="/budget">{T('Departments', 'الإدارات')}</Link></div>
      </div>
      {msg && <p className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</p>}
      <section className="card">
        <h2>{T('Months loaded', 'الأشهر المحمّلة')}</h2>
        <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Month', 'الشهر')}</th><th className="n">{T('Rows', 'الأسطر')}</th><th className="n">{T('Total', 'الإجمالي')}</th><th /></tr></thead>
          <tbody>{byMonth.map((r) => <tr key={r.k}><td>{monthLabel(r.k, lang)}</td><td className="n num">{r.n || '–'}</td><td className="n num">{r.n ? acc(r.total) : '–'}</td><td>{r.n > 0 && <button type="button" className="link danger" onClick={() => clearMonth(r.k)}>{T('Remove', 'حذف')}</button>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Load from the accounting system', 'التحميل من النظام المحاسبي')}</h2>
        <p className="sub">{T('Paste or open a CSV with four columns: month (2027-01), item, city, amount. Item and city may be the id or the name. Costs and revenue are both positive.', 'الصق أو افتح ملف CSV بأربعة أعمدة: الشهر (2027-01)، البند، المدينة، المبلغ. البند والمدينة بالمعرّف أو بالاسم. التكاليف والإيرادات بأرقام موجبة.')} <button type="button" className="link" onClick={template}>{T('Download a template', 'تنزيل نموذج')}</button></p>
        <div className="actions"><input type="file" accept=".csv,text/csv,text/plain" aria-label={T('CSV file', 'ملف CSV')} onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setText); }} /></div>
        <textarea className="bgt-csv" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'month,item,region,amount\n2027-01,sa_branch_cash,riyadh,125000'} aria-label="CSV" />
        {parsed && <p className="sub">{T(`${parsed.rows.length} rows · months `, `${parsed.rows.length} سطرًا · الأشهر `)}{parsed.months.join(', ')}{T(' · total ', ' · الإجمالي ')}{acc(parsed.total)}</p>}
        <div className="actions"><button type="button" className="btn" disabled={busy || !parsed?.rows.length} onClick={loadRows}>{T('Load these months', 'تحميل هذه الأشهر')}</button></div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- budget against actual
interface VarData { cycle: { id: string; name: string; monthKeys: string[] }; included: Array<{ department: string; revision: number }>; rows: Array<{ item: string; dept: string; kind: Kind; region: string; budget: number[]; actual: number[] }>; actualMonths: string[] }
type Group = 'item' | 'line' | 'dept' | 'city';
const SECTIONS: Array<{ id: string; kinds: Kind[]; en: string; ar: string }> = [
  { id: 'rev', kinds: ['revenue'], en: 'Revenue', ar: 'الإيرادات' },
  { id: 'cost', kinds: ['cogs', 'opex', 'financing', 'noncash'], en: 'Costs', ar: 'التكاليف' },
  { id: 'capex', kinds: ['capex'], en: 'Capital expenditure', ar: 'النفقات الرأسمالية' }
];
export function BudgetVariance() {
  const params = useParams();
  const { lang, txt, err } = useI18n(); const T = useT();
  const { meta } = useBudgetMeta();
  const [pick, setPick] = useState(''), [d, setD] = useState<VarData | null>(null), [e, setE] = useState('');
  const [period, setPeriod] = useState('ytd'), [group, setGroup] = useState<Group>('item'), [dept, setDept] = useState(''), [city, setCity] = useState('');
  const cycleId = params.cycle || pick || meta?.cycles[0]?.id || '';
  useEffect(() => { if (cycleId) api<VarData>('GET', `/api/budget/cycles/${cycleId}/variance`).then((r) => { setD(r); setE(''); }).catch((x) => setE(err(x instanceof ApiError ? x.code : 'network'))); }, [cycleId, err]);

  if (e) return <p className="msg err">{e}</p>;
  if (!meta) return <p className="sub">…</p>;
  if (!meta.cycles.length) return <p className="empty">{T('No budget round yet. Open one under Budgets.', 'لا توجد دورة ميزانية بعد. افتح واحدة من الميزانيات.')}</p>;
  if (!d) return <p className="sub">…</p>;
  const keys = d.cycle.monthKeys, last = d.actualMonths.length ? keys.indexOf(d.actualMonths[d.actualMonths.length - 1]) : -1;
  const idx = period === 'ytd' ? keys.map((_, i) => i).filter((i) => i <= last) : period === 'full' ? keys.map((_, i) => i) : [keys.indexOf(period)];
  const pick2 = (a: number[]) => sum(idx.map((i) => a[i] || 0));
  const itemOf = (id: string) => meta.pack.items.find((i) => i.id === id);
  const deptName = (id: string) => txt(meta.pack.allDepartments.find((x) => x.id === id)?.name) || id;
  const cityName = (id: string) => txt(meta.regions.find((x) => x.id === id)?.name) || id;
  const rows = d.rows.filter((r) => (!dept || r.dept === dept) && (!city || r.region === city));
  const keyOf = (r: VarData['rows'][number]) => (group === 'item' ? r.item : group === 'line' ? r.item + '|' + r.region : group === 'dept' ? r.dept : r.region);
  const labelOf = (r: VarData['rows'][number]) => (group === 'item' ? txt(itemOf(r.item)?.name) : group === 'line' ? txt(itemOf(r.item)?.name) + ' · ' + cityName(r.region) : group === 'dept' ? deptName(r.dept) : cityName(r.region));
  const sections = SECTIONS.map((s) => {
    const map = new Map<string, { label: string; dept: string; budget: number; actual: number; fav: number }>();
    for (const r of rows.filter((x) => s.kinds.includes(x.kind))) {
      const k = keyOf(r), b = pick2(r.budget), a = pick2(r.actual);
      const g = map.get(k) || { label: labelOf(r), dept: r.dept, budget: 0, actual: 0, fav: 0 };
      g.budget += b; g.actual += a; g.fav += favourable(r.kind, b, a); map.set(k, g);
    }
    const list = [...map.values()].filter((g) => g.budget || g.actual).sort((a, b) => Math.abs(b.fav) - Math.abs(a.fav));
    return { ...s, list, budget: sum(list.map((g) => g.budget)), actual: sum(list.map((g) => g.actual)), fav: sum(list.map((g) => g.fav)) };
  });
  const [rev, cost, capex] = sections;
  const ebitdaKinds: Kind[] = ['revenue', 'cogs', 'opex'];
  const ebitda = (which: 'budget' | 'actual') => sum(rows.filter((r) => ebitdaKinds.includes(r.kind)).map((r) => (r.kind === 'revenue' ? 1 : -1) * pick2(r[which])));
  const missing = meta.pack.departments.filter((x) => !d.included.some((i) => i.department === x.id));
  const csv = () => download(`budget-vs-actual-${d.cycle.name.replace(/\s+/g, '-')}.csv`, [
    ['section', 'line', 'budget', 'actual', 'variance (+ favourable)', 'variance %'],
    ...sections.flatMap((s) => s.list.map((g) => [s.en, g.label, g.budget.toFixed(2), g.actual.toFixed(2), g.fav.toFixed(2), g.budget ? ((g.fav / Math.abs(g.budget)) * 100).toFixed(1) : '']))
  ]);
  const periodText = period === 'ytd' ? (last >= 0 ? T('Year to date, to ', 'منذ بداية العام حتى ') + monthLabel(keys[last], lang) : T('Year to date', 'منذ بداية العام')) : period === 'full' ? T('Whole round', 'الدورة كاملة') : monthLabel(period, lang);
  const Fav = ({ v }: { v: number }) => <span className={v > 0.5 ? 'up' : v < -0.5 ? 'down' : ''}>{acc(v)}</span>;

  return (
    <div className="bgt">
      <div className="head">
        <div><span className="an-eyebrow">{d.cycle.name}</span><h1>{T('Budget vs actual', 'الميزانية مقابل الفعلي')}</h1>
          <p className="sub">{periodText} · {T('SAR, excluding VAT. Positive variance is favourable: more revenue or less cost than budget.', 'بالريال وبدون ضريبة. الانحراف الموجب في صالح الشركة: إيرادات أكثر أو تكاليف أقل من الميزانية.')}{missing.length > 0 && <b className="warn-t"> {T('Not approved yet, so not in the budget: ', 'لم تُعتمد بعد ولذا ليست في الميزانية: ')}{missing.map((x) => txt(x.name)).join(lang === 'ar' ? '، ' : ', ')}</b>}</p></div>
        <div className="pills">
          {!params.cycle && meta.cycles.length > 1 && <select className="pill" value={cycleId} onChange={(x) => setPick(x.target.value)} aria-label={T('Budget round', 'دورة الميزانية')}>{meta.cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <Link className="btn ghost" to={`/budget/${cycleId}/actuals`}>{T('Load actuals', 'تحميل الفعلي')}</Link>
          <button type="button" className="btn ghost" onClick={csv}>{T('Download CSV', 'تنزيل CSV')}</button>
        </div>
      </div>
      {!d.actualMonths.length && <div className="demo" role="note">{T('No actuals loaded yet. ', 'لم يُحمّل أي فعلي بعد. ')}<Link className="link" to={`/budget/${cycleId}/actuals`}>{T('Load the first month', 'حمّل أول شهر')}</Link></div>}
      <div className="bgt-filters">
        <select className="pill" value={period} onChange={(x) => setPeriod(x.target.value)} aria-label={T('Period', 'الفترة')}>
          <option value="ytd">{T('Year to date', 'منذ بداية العام')}</option><option value="full">{T('Whole round', 'الدورة كاملة')}</option>
          {keys.map((k) => <option key={k} value={k}>{monthLabel(k, lang)}{d.actualMonths.includes(k) ? '' : T(' (no actuals)', ' (بلا فعلي)')}</option>)}
        </select>
        <div className="seg" role="group" aria-label={T('Group by', 'التجميع حسب')}>
          {([['item', T('Item', 'البند')], ['line', T('Item and city', 'البند والمدينة')], ['dept', T('Department', 'الإدارة')], ['city', T('City', 'المدينة')]] as Array<[Group, string]>).map(([g, l]) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{l}</button>)}
        </div>
        <select className="pill" value={dept} onChange={(x) => setDept(x.target.value)} aria-label={T('Department', 'الإدارة')}><option value="">{T('All departments', 'كل الإدارات')}</option>{meta.pack.departments.map((x) => <option key={x.id} value={x.id}>{txt(x.name)}</option>)}</select>
        <select className="pill" value={city} onChange={(x) => setCity(x.target.value)} aria-label={T('City', 'المدينة')}><option value="">{T('All cities', 'كل المدن')}</option>{meta.regions.map((x) => <option key={x.id} value={x.id}>{txt(x.name)}</option>)}</select>
      </div>
      <div className="an-kpis">
        <div className="an-kpi t-rec"><span className="l">{T('Revenue', 'الإيرادات')}</span><span className="v num">{m(rev.actual)}</span><span className="s">{T('budget ', 'الميزانية ')}{m(rev.budget)} · <Fav v={rev.fav} /></span></div>
        <div className="an-kpi t-pay"><span className="l">{T('Costs', 'التكاليف')}</span><span className="v num">{m(cost.actual)}</span><span className="s">{T('budget ', 'الميزانية ')}{m(cost.budget)} · <Fav v={cost.fav} /></span></div>
        <div className="an-kpi t-brand"><span className="l">EBITDA</span><span className="v num">{m(ebitda('actual'))}</span><span className="s">{T('budget ', 'الميزانية ')}{m(ebitda('budget'))} · <Fav v={ebitda('actual') - ebitda('budget')} /></span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Capex', 'الرأسمالية')}</span><span className="v num">{m(capex.actual)}</span><span className="s">{T('budget ', 'الميزانية ')}{m(capex.budget)} · <Fav v={capex.fav} /></span></div>
      </div>
      {sections.map((s) => s.list.length > 0 && (
        <section className="card" key={s.id} style={{ marginTop: 20 }}>
          <h2>{T(s.en, s.ar)}</h2>
          <div className="khz-scroll"><table className="tbl bgt-var"><thead><tr><th>{group === 'dept' ? T('Department', 'الإدارة') : group === 'city' ? T('City', 'المدينة') : T('Item', 'البند')}</th>{(group === 'item' || group === 'line') && <th>{T('Department', 'الإدارة')}</th>}<th className="n">{T('Budget', 'الميزانية')}</th><th className="n">{T('Actual', 'الفعلي')}</th><th className="n">{T('Variance', 'الانحراف')}</th><th className="n">%</th><th>{T('Verdict', 'التقييم')}</th></tr></thead>
            <tbody>{s.list.map((g, i) => <tr key={i}><td>{g.label}</td>{(group === 'item' || group === 'line') && <td className="sub">{deptName(g.dept)}</td>}<td className="n num">{acc(g.budget)}</td><td className="n num">{acc(g.actual)}</td><td className="n num"><Fav v={g.fav} /></td><td className="n num">{pct(g.fav, g.budget)}</td>
              <td>{Math.abs(g.fav) < 0.5 ? <span className="pill">{T('On budget', 'ضمن الميزانية')}</span> : g.fav > 0 ? <span className="pill ok">{T('Favourable', 'في صالحنا')}</span> : <span className="pill bad">{T('Unfavourable', 'ضد صالحنا')}</span>}</td></tr>)}
              <tr className="tot"><td><b>{T('Total', 'الإجمالي')}</b></td>{(group === 'item' || group === 'line') && <td />}<td className="n num"><b>{acc(s.budget)}</b></td><td className="n num"><b>{acc(s.actual)}</b></td><td className="n num"><b><Fav v={s.fav} /></b></td><td className="n num">{pct(s.fav, s.budget)}</td><td /></tr>
            </tbody></table></div>
        </section>
      ))}
      <MonthTrend d={d} rows={rows} />
    </div>
  );
}
/** EBITDA budget against actual for every month that has actuals. */
function MonthTrend({ d, rows }: { d: VarData; rows: VarData['rows'] }) {
  const { lang } = useI18n(); const T = useT();
  if (!d.actualMonths.length) return null;
  const k: Kind[] = ['revenue', 'cogs', 'opex'];
  const at = (i: number, w: 'budget' | 'actual') => sum(rows.filter((r) => k.includes(r.kind)).map((r) => (r.kind === 'revenue' ? 1 : -1) * (r[w][i] || 0)));
  const months = d.cycle.monthKeys.map((key, i) => ({ key, i })).filter((x) => d.actualMonths.includes(x.key));
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('EBITDA month by month', 'EBITDA شهرًا بشهر')}</h2>
      <div className="khz-scroll"><table className="tbl"><thead><tr><th />{months.map((x) => <th key={x.key} className="n">{monthLabel(x.key, lang)}</th>)}</tr></thead>
        <tbody>
          <tr><td>{T('Budget', 'الميزانية')}</td>{months.map((x) => <td key={x.key} className="n num">{acc(at(x.i, 'budget'))}</td>)}</tr>
          <tr><td>{T('Actual', 'الفعلي')}</td>{months.map((x) => <td key={x.key} className="n num">{acc(at(x.i, 'actual'))}</td>)}</tr>
          <tr className="tot"><td>{T('Variance', 'الانحراف')}</td>{months.map((x) => { const v = at(x.i, 'actual') - at(x.i, 'budget'); return <td key={x.key} className={'n num ' + (v > 0.5 ? 'up' : v < -0.5 ? 'down' : '')}>{acc(v)}</td>; })}</tr>
        </tbody></table></div>
    </section>
  );
}

// ---------------------------------------------------------------- step 4: the approved budget becomes a cash plan
export function ToCashPlan({ cycleId, startMonth, approvedCount }: { cycleId: string; startMonth: string; approvedCount: number }) {
  const s = useSession(); const { err } = useI18n(); const T = useT(); const nav = useNavigate();
  const [opening, setOpening] = useState(''), [from, setFrom] = useState(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  // the cash the current forecast expects on the day before the budget starts
  useEffect(() => {
    const p = s.plans.find((x) => !x.demo && !x.name.endsWith('budget cash view'));
    if (!p) return;
    api<{ forecast: { weeks: Array<{ start: string; end: string }>; l1: { closing: number[] } } }>('GET', `/api/plans/${p.id}/forecast`).then((r) => {
      const start = startMonth + '-01';
      let w = -1; r.forecast.weeks.forEach((x, i) => { if (x.end < start) w = i; });
      if (w >= 0) { setOpening(String(Math.round(r.forecast.l1.closing[w]))); setFrom(`${p.name}, ${r.forecast.weeks[w].end}`); }
    }).catch(() => {});
  }, [s.plans, startMonth]);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ planId: string; closing: number; lowest: number }>('POST', `/api/budget/cycles/${cycleId}/to-plan`, { openingCash: Number(opening.replace(/,/g, '')) });
      try { localStorage.setItem('cf13_plan:' + s.tenant.id, r.planId); } catch { /* private mode */ }
      await s.reload();
      setMsg({ ok: true, t: T(`Cash plan ready: closing cash ${m(r.closing)}, lowest ${m(r.lowest)}.`, `خطة النقد جاهزة: النقد الختامي ${m(r.closing)}، وأدنى رصيد ${m(r.lowest)}.`) });
    } catch (e) { setMsg({ ok: false, t: codeText(e instanceof ApiError ? e.code : 'network', T, err) }); }
    finally { setBusy(false); }
  }
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Step 4 · Turn the approved budget into a cash forecast', 'الخطوة 4 · تحويل الميزانية المعتمدة إلى توقع نقدي')}</h2>
      <p className="sub">{T('Adds VAT where it applies, spreads each month over its days, pays the net VAT to ZATCA at the end of the following month and leaves out non-cash items. Every cash screen can then read it. Running it again makes a new version of the same plan.', 'يضيف ضريبة القيمة المضافة حيث تنطبق، ويوزّع كل شهر على أيامه، ويدفع صافي الضريبة للزكاة والضريبة نهاية الشهر التالي، ويستبعد البنود غير النقدية. ثم تقرؤه كل شاشات النقد. إعادة التشغيل تنشئ نسخة جديدة من الخطة نفسها.')}</p>
      <div className="bgt-form">
        <label className="field"><span>{T('Cash at the bank before the budget starts (SAR)', 'النقد في البنك قبل بدء الميزانية (ريال)')}</span><input inputMode="decimal" className="num" aria-label={T('Opening cash (SAR)', 'النقد الافتتاحي (ريال)')} value={opening} onChange={(e) => setOpening(e.target.value)} />{from && <small className="sub">{T('From the forecast: ', 'من التوقع: ')}{from}</small>}</label>
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !approvedCount || opening.trim() === '' || !Number.isFinite(Number(opening.replace(/,/g, '')))} onClick={go}>{T('Create the cash plan', 'إنشاء خطة النقد')}</button>
        {msg?.ok && <button type="button" className="btn ghost" onClick={() => nav('/')}>{T('Open the overview', 'فتح النظرة العامة')}</button>}
        {!approvedCount && <span className="sub">{T('Approve at least one department first.', 'اعتمد إدارة واحدة على الأقل أولًا.')}</span>}
        {msg && <span className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- compare any two cash plans, month by month
interface Fc { weeks: Array<{ start: string; end: string }>; categories: Array<{ id: string; en: string; ar: string; section: string }>; l1: { receipts: number[]; payments: number[]; closing: number[] }; l2: Record<string, number[]> }
export function ComparePlans() {
  const s = useSession(); const { lang, txt, err } = useI18n(); const T = useT();
  const real = s.plans;
  const [a, setA] = useState(s.plan?.id || real[0]?.id || ''), [b, setB] = useState(real.find((p) => p.id !== (s.plan?.id || real[0]?.id))?.id || '');
  const [fa, setFa] = useState<Fc | null>(null), [fb, setFb] = useState<Fc | null>(null), [e, setE] = useState('');
  useEffect(() => { if (a) api<{ forecast: Fc }>('GET', `/api/plans/${a}/forecast`).then((r) => setFa(r.forecast)).catch((x) => setE(err(x.code))); }, [a, err]);
  useEffect(() => { if (b) api<{ forecast: Fc }>('GET', `/api/plans/${b}/forecast`).then((r) => setFb(r.forecast)).catch((x) => setE(err(x.code))); }, [b, err]);
  const data = useMemo(() => {
    if (!fa || !fb) return null;
    const mk = (f: Fc) => f.weeks.map((w) => w.start.slice(0, 7));
    const ka = mk(fa), kb = mk(fb), months = [...new Set([...ka, ...kb])].sort();
    const byMonth = (f: Fc, keys: string[], v: number[]) => months.map((mo) => sum(v.filter((_, i) => keys[i] === mo)));
    const closeAt = (f: Fc, keys: string[]) => months.map((mo) => { let w = -1; keys.forEach((k, i) => { if (k === mo) w = i; }); return w >= 0 ? f.l1.closing[w] : null; });
    const cats = new Map<string, { label: string; section: string }>();
    for (const c of [...fa.categories, ...fb.categories]) if (!cats.has(c.id)) cats.set(c.id, { label: txt(c), section: c.section });
    const catRows = [...cats.entries()].map(([id, c]) => {
      const va = byMonth(fa, ka, fa.l2[id] || []), vb = byMonth(fb, kb, fb.l2[id] || []);
      return { id, ...c, a: sum(va), b: sum(vb), diff: va.map((x, i) => x - vb[i]) };
    }).filter((r) => r.a || r.b);
    return { months, catRows, rec: [byMonth(fa, ka, fa.l1.receipts), byMonth(fb, kb, fb.l1.receipts)], pay: [byMonth(fa, ka, fa.l1.payments), byMonth(fb, kb, fb.l1.payments)], close: [closeAt(fa, ka), closeAt(fb, kb)] };
  }, [fa, fb, txt]);
  const name = (id: string) => real.find((p) => p.id === id)?.name || '';
  if (real.length < 2) return <div className="bgt"><h1>{T('Compare plans', 'مقارنة الخطط')}</h1><p className="empty">{T('There is only one cash plan. Import another, or create one from an approved budget, to compare.', 'توجد خطة نقد واحدة فقط. استورد أخرى أو أنشئ واحدة من ميزانية معتمدة للمقارنة.')}</p></div>;
  const cell = (v: number | null) => (v === null ? '–' : acc(v));
  return (
    <div className="bgt">
      <div className="head">
        <div><h1>{T('Compare plans', 'مقارنة الخطط')}</h1><p className="sub">{T('Any two cash plans side by side, month by month, by category. For example the budget cash view against the bank forecast. Difference = first minus second. A week is counted in the month it starts.', 'أي خطتي نقد جنبًا إلى جنب شهرًا بشهر حسب الفئة، مثل عرض الميزانية النقدي مقابل توقع البنك. الفرق = الأولى ناقص الثانية. يُحسب الأسبوع في الشهر الذي يبدأ فيه.')}</p></div>
        <div className="pills">
          <select className="pill" value={a} onChange={(x) => setA(x.target.value)} aria-label={T('First plan', 'الخطة الأولى')}>{real.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <span className="sub">{T('against', 'مقابل')}</span>
          <select className="pill" value={b} onChange={(x) => setB(x.target.value)} aria-label={T('Second plan', 'الخطة الثانية')}>{real.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
      </div>
      {e && <p className="msg err">{e}</p>}
      {!data ? <p className="sub">…</p> : <>
        <section className="card">
          <h2>{T('Cash month by month', 'النقد شهرًا بشهر')}</h2>
          <div className="khz-scroll"><table className="tbl bgt-cmp"><thead><tr><th />{data.months.map((mo) => <th key={mo} className="n">{monthLabel(mo, lang)}</th>)}</tr></thead>
            <tbody>
              {([[T('Receipts', 'المقبوضات'), data.rec], [T('Payments', 'المدفوعات'), data.pay]] as Array<[string, number[][]]>).map(([l, v]) => <tr key={l}><td><b>{l}</b><div className="sub">{name(a)} / {name(b)}</div></td>{data.months.map((mo, i) => <td key={mo} className="n num">{acc(v[0][i])}<div className="sub">{acc(v[1][i])}</div></td>)}</tr>)}
              <tr className="tot"><td><b>{T('Closing cash', 'النقد الختامي')}</b><div className="sub">{name(a)} / {name(b)}</div></td>{data.months.map((mo, i) => <td key={mo} className="n num">{cell(data.close[0][i])}<div className="sub">{cell(data.close[1][i])}</div></td>)}</tr>
              <tr><td>{T('Difference in closing cash', 'الفرق في النقد الختامي')}</td>{data.months.map((mo, i) => { const x = data.close[0][i], y = data.close[1][i]; const v = x !== null && y !== null ? x - y : null; return <td key={mo} className={'n num ' + (v !== null && v > 0.5 ? 'up' : v !== null && v < -0.5 ? 'down' : '')}>{cell(v)}</td>; })}</tr>
            </tbody></table></div>
        </section>
        <section className="card" style={{ marginTop: 20 }}>
          <h2>{T('By category', 'حسب الفئة')}</h2>
          <div className="khz-scroll"><table className="tbl bgt-cmp"><thead><tr><th>{T('Category', 'الفئة')}</th><th className="n">{name(a)}</th><th className="n">{name(b)}</th><th className="n">{T('Difference', 'الفرق')}</th><th className="n">%</th>{data.months.map((mo) => <th key={mo} className="n">{monthLabel(mo, lang)}</th>)}</tr></thead>
            <tbody>{data.catRows.map((r) => <tr key={r.id}><td>{r.label} <span className="sub">{r.section === 'receipts' ? T('in', 'وارد') : T('out', 'صادر')}</span></td><td className="n num">{acc(r.a)}</td><td className="n num">{acc(r.b)}</td><td className="n num"><b>{acc(r.a - r.b)}</b></td><td className="n num">{pct(r.a - r.b, r.b)}</td>{r.diff.map((v, i) => <td key={i} className="n num sub">{acc(v)}</td>)}</tr>)}</tbody></table></div>
        </section>
      </>}
    </div>
  );
}
