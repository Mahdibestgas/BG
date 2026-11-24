import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Loading } from '../ui/Loading';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { KIND_NAMES, positionLines, type Consolidated, type HrParams, type Item, type Kind, type Line, type Position, type Txt } from '@cf13/budget';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';
import { EMPTY_PLAN, EMPTY_STUDY, type DeptPlan, type Study } from '@cf13/budget';
import { PlanEditor, StudyEditor, ToCashPlan } from './BudgetCycle';
import { CountUp, deptColor, Donut, HBars, MoneyFlow, MonthColumns } from '../ui/bgtCharts';

// ---------------------------------------------------------------- shared
export interface Cycle { id: string; name: string; startMonth: string; months: number; monthKeys: string[]; status: 'open' | 'closed'; deadline: string | null; version: number }
interface Meta {
  you: { role: string; department: string | null };
  pack: { id: string; name: Txt; departments: Array<{ id: string; name: Txt; covers: Txt }>; allDepartments: Array<{ id: string; name: Txt }>; items: Item[] };
  regions: Array<{ id: string; name: Txt }>; params: HrParams; settingsVersion: number; cycles: Cycle[];
  guidance: Guidance | null;
}
interface Guidance { source: string; period: string; note: string; updatedAt: string; items: Record<string, number> }
type Status = 'not_started' | 'draft' | 'submitted' | 'approved' | 'returned';
const STATUS: Record<Status, Txt> = {
  not_started: { en: 'Not started', ar: 'لم تبدأ' }, draft: { en: 'Draft', ar: 'مسودة' }, submitted: { en: 'Waiting for approval', ar: 'بانتظار الاعتماد' },
  approved: { en: 'Approved', ar: 'معتمدة' }, returned: { en: 'Returned for changes', ar: 'أعيدت للتعديل' }
};
const sum = (a: number[]) => a.reduce((t, x) => t + (x || 0), 0);
const uid = () => Math.random().toString(36).slice(2, 10);

/** A number field that keeps the typed text ("21.", "1,250") while it is being typed and reports the number. */
function NumInput({ value, onValue, disabled, label, width, className = 'num' }: { value: number | undefined; onValue: (n: number | undefined) => void; disabled?: boolean; label: string; width?: number; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  return <input className={className} inputMode="decimal" style={width ? { width } : undefined} aria-label={label} disabled={disabled}
    value={text ?? (value === undefined ? '' : value.toLocaleString('en-US', { maximumFractionDigits: 2 }))}
    onFocus={() => setText(value === undefined ? '' : String(value))}
    onChange={(e) => { const v = e.target.value; setText(v); const t = v.replace(/,/g, '').trim(); if (t === '') onValue(undefined); else if (/^-?\d*\.?\d*$/.test(t) && t !== '-' && t !== '.') onValue(Number(t)); }}
    onBlur={() => setText(null)} />;
}
/** Quantity x price lines: the amounts always follow from the quantities and the price. */
const norm = (l: Line): Line => (l.basis ? { ...l, amounts: l.basis.qty.map((q) => Math.round(q * l.basis!.price * 100) / 100) } : l);

export function useBudgetMeta() {
  const [meta, setMeta] = useState<Meta | null>(null), [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => api<Meta>('GET', '/api/budget/meta').then(setMeta).catch((e) => setError(e instanceof ApiError ? e.code : 'network')), []);
  useEffect(() => { reload(); }, [reload]);
  return { meta, error, reload };
}
function StatusPill({ s }: { s: Status }) {
  const { txt } = useI18n();
  const cls = s === 'approved' ? 'pill ok' : s === 'returned' ? 'pill bad' : 'pill' + (s === 'submitted' ? ' wait' : '');
  return <span className={cls}>{txt(STATUS[s])}</span>;
}
const monthLabel = (k: string, lang: string) => date(k + '-01', lang, { month: 'short', year: '2-digit' });

// ---------------------------------------------------------------- home: cycles, approval inbox, settings
export function BudgetHome() {
  const s = useSession();
  const { lang, txt, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta, error, reload } = useBudgetMeta();
  const [cycleId, setCycleId] = useState<string>('');
  const [board, setBoard] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const owner = s.me.role === 'owner';

  useEffect(() => { if (meta && !cycleId && meta.cycles[0]) setCycleId(meta.cycles[0].id); }, [meta, cycleId]);
  useEffect(() => {
    if (!cycleId || s.me.role === 'contributor') return;
    api('GET', `/api/budget/cycles/${cycleId}/status`).then(setBoard).catch((e) => setMsg({ ok: false, t: err(e.code) }));
  }, [cycleId, s.me.role, err]);

  if (error) return <p className="msg err">{err(error)}</p>;
  if (!meta) return <Loading />;
  const cycle = meta.cycles.find((c) => c.id === cycleId);

  // a department head goes straight to their department in the open cycle
  if (s.me.role === 'contributor') {
    const open = meta.cycles.filter((c) => c.status === 'open');
    if (open.length === 1 && meta.you.department) return <Navigate to={`/budget/${open[0].id}/${meta.you.department}`} replace />;
    const d = meta.pack.departments[0];
    return (
      <div>
        <div className="head"><div><h1>{T('My department budget', 'ميزانية إدارتي')}</h1><p className="sub">{d ? txt(d.name) + ' · ' + txt(d.covers) : ''}</p></div></div>
        {!open.length && <p className="empty">{T('No budget round is open yet. The owner opens one and tells you when to start.', 'لا توجد دورة ميزانية مفتوحة بعد. يفتحها المالك ويبلغك بموعد البدء.')}</p>}
        <div className="grid">{open.map((c) => <Link key={c.id} className="card" to={`/budget/${c.id}/${meta.you.department}`}><h2>{c.name}</h2><p className="sub">{monthLabel(c.monthKeys[0], lang)} – {monthLabel(c.monthKeys[c.months - 1], lang)}{c.deadline ? ' · ' + T('due ', 'الموعد ') + date(c.deadline, lang, { day: 'numeric', month: 'long' }) : ''}</p></Link>)}</div>
      </div>
    );
  }

  return (
    <div className="bgt">
      <div className="head">
        <div><h1>{T('Department budgets', 'ميزانيات الإدارات')}</h1>
          <p className="sub">{T('Each department head prepares their own budget. You approve or return it, and approved budgets add up into one company budget.', 'يعدّ كل مدير إدارة ميزانية إدارته، وتعتمدها أنت أو تعيدها، ثم تجتمع الميزانيات المعتمدة في ميزانية واحدة للشركة.')}</p></div>
        {meta.cycles.length > 0 && <div className="pills"><select className="pill" value={cycleId} onChange={(e) => setCycleId(e.target.value)} aria-label={T('Budget round', 'دورة الميزانية')}>{meta.cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          {cycle && <Link className="btn" to={`/budget/${cycle.id}/company`}>{T('Company budget', 'ميزانية الشركة')}</Link>}
          {cycle && <Link className="btn ghost" to={`/budget/${cycle.id}/actuals`}>{T('Actuals', 'الفعلي')}</Link>}
          {cycle && <Link className="btn ghost" to={`/budget/${cycle.id}/variance`}>{T('Budget vs actual', 'الميزانية مقابل الفعلي')}</Link>}</div>}
      </div>
      {msg && <p className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</p>}

      {cycle && board && (
        <section className="card">
          <h2>{cycle.name} <span className={'pill' + (cycle.status === 'open' ? ' ok' : '')}>{cycle.status === 'open' ? T('Open', 'مفتوحة') : T('Closed', 'مغلقة')}</span></h2>
          <p className="sub">{monthLabel(cycle.monthKeys[0], lang)} – {monthLabel(cycle.monthKeys[cycle.months - 1], lang)} · {cycle.months} {T('months', 'شهرًا')}{cycle.deadline ? ' · ' + T('departments submit by ', 'تسليم الإدارات بحلول ') + date(cycle.deadline, lang, { day: 'numeric', month: 'long', year: 'numeric' }) : ''} · {T('amounts in SAR, excluding VAT', 'المبالغ بالريال وبدون ضريبة القيمة المضافة')}</p>
          <Cylinders cycleId={cycle.id} departments={board.departments} />
          <DeptGlance departments={board.departments} />
          <div className="khz-scroll" style={{ marginTop: 14 }}>
            <table className="tbl bgt-board"><thead><tr><th>{T('Department', 'الإدارة')}</th><th>{T('Status', 'الحالة')}</th><th>{T('Study and plan', 'الدراسة والخطة')}</th><th className="n">{T('Revenue', 'الإيرادات')}</th><th className="n">{T('Costs', 'التكاليف')}</th><th className="n">{T('Capex', 'الرأسمالية')}</th><th>{T('Updated', 'آخر تحديث')}</th><th /></tr></thead>
              <tbody>{board.departments.map((d: any) => (
                <tr key={d.department}>
                  <td><b>{txt(d.name)}</b>{d.revision > 1 ? <span className="sub"> · {T('revision', 'مراجعة')} {d.revision}</span> : null}{d.reviewComment && d.status === 'returned' ? <div className="sub">“{d.reviewComment}”</div> : null}</td>
                  <td><StatusPill s={d.status} />{d.approvedRevision && d.status !== 'approved' ? <div className="sub">{T('approved revision ', 'المراجعة المعتمدة ')}{d.approvedRevision}</div> : null}</td>
                  <td className="sub">{d.readiness ? <>{T('study ', 'الدراسة ')}{d.readiness.study}/{d.readiness.studyOf} · {d.readiness.vision ? T('vision', 'رؤية') : <span className="warn-t">{T('no vision', 'بلا رؤية')}</span>} · {d.readiness.objectives} {T('objectives', 'أهداف')} · {d.readiness.risks} {T('risks', 'مخاطر')}</> : '–'}</td>
                  <td className="n num">{d.totals ? acc(d.totals.revenue) : '–'}</td><td className="n num">{d.totals ? acc(d.totals.costs) : '–'}</td><td className="n num">{d.totals ? acc(d.totals.capex) : '–'}</td>
                  <td className="sub">{d.updatedAt ? date(d.updatedAt.slice(0, 10), lang, { day: 'numeric', month: 'short' }) : '–'}</td>
                  <td><Link className="link" to={`/budget/${cycle.id}/${d.department}`}>{d.status === 'submitted' && owner ? T('Review', 'مراجعة') : T('Open', 'فتح')}</Link></td>
                </tr>))}</tbody></table>
          </div>
          {owner && <CycleActions cycle={cycle} onDone={() => { reload(); setMsg({ ok: true, t: T('Saved.', 'تم الحفظ.') }); }} />}
        </section>
      )}

      {owner && meta.cycles.length === 0 && <QuickStart meta={meta} onDone={(id) => { reload(); setCycleId(id); }} />}
      {!owner && meta.cycles.length === 0 && <p className="empty">{T('No budget round is open yet. The owner opens one.', 'لا توجد دورة ميزانية مفتوحة بعد. يفتحها المالك.')}</p>}
      {(owner || s.me.role === 'finance') && <GuidanceLoader meta={meta} onDone={(t) => { reload(); setMsg({ ok: true, t }); }} />}
      {owner && <NewCycle onDone={(id) => { reload(); setCycleId(id); }} />}
      {owner && <Settings meta={meta} onDone={() => { reload(); setMsg({ ok: true, t: T('Settings saved.', 'تم حفظ الإعدادات.') }); }} />}
      {owner && <p className="sub" style={{ marginTop: 18 }}>{T('Department heads join by invitation: ', 'ينضم مديرو الإدارات بدعوة: ')}<Link className="link" to="/people">{T('People and invitations', 'الفريق والدعوات')}</Link></p>}
    </div>
  );
}

/** How far a department is: study and plan written, lines entered, submitted, approved. */
function progressOf(d: any): number {
  if (d.status === 'approved') return 1;
  if (d.status === 'submitted') return 0.9;
  const r = d.readiness;
  if (!r) return 0;
  const study = (r.study / Math.max(1, r.studyOf)) * 0.3;
  const plan = (r.vision ? 0.1 : 0) + Math.min(1, r.objectives / 3) * 0.15 + (r.risks ? 0.05 : 0);
  const lines = Math.min(1, r.lines / 5) * 0.3;
  return Math.min(0.85, study + plan + lines);
}
/** The round at a glance: every department is a cylinder that fills from study to approval. */
function Cylinders({ cycleId, departments }: { cycleId: string; departments: any[] }) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const tot = (k: 'revenue' | 'costs' | 'capex') => departments.reduce((t, d) => t + (d.totals ? d.totals[k] || 0 : 0), 0);
  const approved = departments.filter((d) => d.status === 'approved').length, waiting = departments.filter((d) => d.status === 'submitted').length;
  const stage = (d: any) => d.status === 'approved' ? T('Approved', 'معتمدة') : d.status === 'submitted' ? T('Waiting for you', 'بانتظارك') : d.status === 'returned' ? T('Returned', 'أعيدت') : !d.readiness ? T('Not started', 'لم تبدأ') : d.readiness.lines ? T('Budgeting', 'يعدّ الميزانية') : d.readiness.vision || d.readiness.objectives ? T('Planning', 'يخطط') : T('Studying', 'يدرس');
  const done = departments.filter((d) => d.status === 'approved').length;
  return (
    <div className="cyl-wrap">
      <div className="an-kpis sm round-kpis">
        <div className="an-kpi sm t-rec"><span className="l">{T('Revenue in the budgets', 'الإيرادات في الميزانيات')}</span><span className="v num"><CountUp value={tot('revenue')} format={m} /></span></div>
        <div className="an-kpi sm t-pay"><span className="l">{T('Costs', 'التكاليف')}</span><span className="v num"><CountUp value={tot('costs')} format={m} /></span></div>
        <div className="an-kpi sm t-brand"><span className="l">{T('Capex', 'الرأسمالية')}</span><span className="v num"><CountUp value={tot('capex')} format={m} /></span></div>
        <div className="an-kpi sm t-brand"><span className="l">{T('Approved', 'المعتمد')}</span><span className="v num"><CountUp value={departments.length ? (approved / departments.length) * 100 : 0} format={(x) => Math.round(x) + '%'} /></span><span className="s">{waiting ? T(`${waiting} waiting for you`, `${waiting} بانتظارك`) : T('none waiting', 'لا شيء بانتظارك')}</span></div>
      </div>
      <p className="sub cyl-note">{T(`${done} of ${departments.length} departments approved`, `${done} من ${departments.length} إدارات معتمدة`)}</p>
      <div className="cyl-row">
        {departments.map((d, i) => {
          const p = progressOf(d), H = 84, fill = Math.round(H * p);
          return (
            <Link key={d.department} to={`/budget/${cycleId}/${d.department}`} className={'cyl ' + d.status} aria-label={txt(d.name) + ': ' + stage(d) + ', ' + Math.round(p * 100) + '%'}>
              <svg viewBox="0 0 48 112" aria-hidden="true">
                <rect x="17" y="2" width="14" height="8" rx="2" className="cyl-valve" />
                <rect x="6" y="12" width="36" height="96" rx="15" className="cyl-body" />
                <clipPath id={'cy' + i}><rect x="6" y="12" width="36" height="96" rx="15" /></clipPath>
                <rect x="6" y={108 - fill - 6} width="36" height={fill + 6} clipPath={`url(#cy${i})`} className="cyl-fill" style={{ ['--h' as any]: (fill + 6) + 'px', animationDelay: i * 70 + 'ms' }} />
                <line x1="6" x2="42" y1={108 - H * 0.9 - 6} y2={108 - H * 0.9 - 6} className="cyl-mark" />
              </svg>
              <b>{txt(d.name)}</b>
              <span>{stage(d)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CycleActions({ cycle, onDone }: { cycle: Cycle; onDone: () => void }) {
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [deadline, setDeadline] = useState(cycle.deadline || ''), [e, setE] = useState('');
  const patch = (data: object) => api('PATCH', `/api/budget/cycles/${cycle.id}`, { version: cycle.version, ...data }).then(onDone).catch((x) => setE(err(x.code)));
  return (
    <div className="actions">
      <label className="field inline"><span>{T('Deadline', 'الموعد النهائي')}</span><input type="date" value={deadline} onChange={(ev) => setDeadline(ev.target.value)} /></label>
      <button type="button" className="btn ghost" onClick={() => patch({ deadline: deadline || null })}>{T('Save deadline', 'حفظ الموعد')}</button>
      <button type="button" className="btn ghost" onClick={() => patch({ status: cycle.status === 'open' ? 'closed' : 'open' })}>{cycle.status === 'open' ? T('Close the round', 'إغلاق الدورة') : T('Reopen the round', 'إعادة فتح الدورة')}</button>
      {e && <span className="msg err">{e}</span>}
    </div>
  );
}

/** First visit: one click opens the 2027 round, and every department gets its own screen (Study, Plan, Budget). */
function QuickStart({ meta, onDone }: { meta: Meta; onDone: (id: string) => void }) {
  const { lang, txt, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [busy, setBusy] = useState(false), [e, setE] = useState('');
  const open = () => { setBusy(true); setE(''); api<{ id: string }>('POST', '/api/budget/cycles', { name: 'Budget 2027', startMonth: '2027-01', months: 12, deadline: null }).then((r) => onDone(r.id)).catch((x) => setE(err(x.code))).finally(() => setBusy(false)); };
  return (
    <section className="card bgt-start">
      <span className="an-eyebrow">{T('Start here', 'ابدأ من هنا')}</span>
      <h2>{T('Open the 2027 budget round', 'افتح دورة ميزانية 2027')}</h2>
      <p className="sub">{T('Each department gets its own screen with three steps: 1 Study, 2 Plan, 3 Budget, month by month and city by city. You then approve or return each one, and the approved ones add up into the company budget.', 'تحصل كل إدارة على شاشتها بثلاث خطوات: 1 الدراسة، 2 الخطة، 3 الميزانية، شهرًا بشهر ومدينة بمدينة. ثم تعتمد كل واحدة أو تعيدها، وتجتمع المعتمدة في ميزانية الشركة.')}</p>
      <div className="bgt-depts">{meta.pack.departments.map((d) => <div key={d.id} className="bgt-dept"><b>{txt(d.name)}</b><span className="sub">{txt(d.covers)}</span></div>)}</div>
      <div className="actions"><button type="button" className="btn" disabled={busy} onClick={open}>{busy ? T('Opening…', 'جارٍ الفتح…') : T('Open Budget 2027 (January to December)', 'فتح ميزانية 2027 (يناير إلى ديسمبر)')}</button>{e && <span className="msg err">{e}</span>}</div>
    </section>
  );
}

function NewCycle({ onDone }: { onDone: (id: string) => void }) {
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [f, setF] = useState({ name: 'Budget 2027', startMonth: '2027-01', months: 12, deadline: '' }), [e, setE] = useState('');
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Open a budget round', 'فتح دورة ميزانية')}</h2>
      <p className="sub">{T('For example the 2027 budget: twelve months from January. Every department then prepares its part.', 'مثل ميزانية 2027: اثنا عشر شهرًا من يناير، ثم تعدّ كل إدارة جزءها.')}</p>
      <div className="bgt-form">
        <label className="field"><span>{T('Name', 'الاسم')}</span><input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></label>
        <label className="field"><span>{T('First month', 'أول شهر')}</span><input type="month" value={f.startMonth} onChange={(x) => setF({ ...f, startMonth: x.target.value })} /></label>
        <label className="field"><span>{T('Months', 'عدد الأشهر')}</span><input type="number" min={1} max={24} value={f.months} onChange={(x) => setF({ ...f, months: Number(x.target.value) })} /></label>
        <label className="field"><span>{T('Departments submit by', 'تسليم الإدارات بحلول')}</span><input type="date" value={f.deadline} onChange={(x) => setF({ ...f, deadline: x.target.value })} /></label>
      </div>
      <div className="actions"><button type="button" className="btn" onClick={() => api<{ id: string }>('POST', '/api/budget/cycles', { ...f, deadline: f.deadline || null }).then((r) => onDone(r.id)).catch((x) => setE(err(x.code)))}>{T('Open the round', 'فتح الدورة')}</button>{e && <span className="msg err">{e}</span>}</div>
    </section>
  );
}

/** The company's cities and the Saudi HR parameters, dated, confirmed by HR. */
function Settings({ meta, onDone }: { meta: Meta; onDone: () => void }) {
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [regions, setRegions] = useState(meta.regions), [p, setP] = useState(meta.params), [e, setE] = useState(''), [open, setOpen] = useState(false);
  const rate = (k: keyof HrParams, label: string) => <label className="field"><span>{label}</span><NumInput label={label} value={Math.round((p[k] as number) * 10000) / 100} onValue={(v) => setP({ ...p, [k]: (v ?? 0) / 100 })} /></label>;
  const sar = (k: keyof HrParams, label: string) => <label className="field"><span>{label}</span><NumInput label={label} value={p[k] as number} onValue={(v) => setP({ ...p, [k]: v ?? 0 })} /></label>;
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <button type="button" className="fold" aria-expanded={open} onClick={() => setOpen(!open)}><h2>{T('Cities and Saudi HR rates', 'المدن ونسب الموارد البشرية في السعودية')}</h2><span className="ch">{open ? '⌄' : '›'}</span></button>
      <p className="sub">{T(`HR rates as of ${p.asOf}: `, `نسب الموارد البشرية بتاريخ ${p.asOf}: `)}{p.confirmed ? <b>{T('confirmed by HR', 'مؤكدة من الموارد البشرية')}</b> : <b className="warn-t">{T('to be confirmed by HR before approval', 'تحتاج تأكيد الموارد البشرية قبل الاعتماد')}</b>}</p>
      {open && <>
        <h3 className="an-h3">{T('Cities', 'المدن')}</h3>
        <table className="tbl"><thead><tr><th>{T('English', 'بالإنجليزية')}</th><th>{T('Arabic', 'بالعربية')}</th><th /></tr></thead><tbody>
          {regions.map((r, i) => <tr key={r.id}><td><input value={r.name.en} onChange={(x) => setRegions(regions.map((y, j) => (j === i ? { ...y, name: { ...y.name, en: x.target.value } } : y)))} /></td><td><input dir="rtl" value={r.name.ar} onChange={(x) => setRegions(regions.map((y, j) => (j === i ? { ...y, name: { ...y.name, ar: x.target.value } } : y)))} /></td><td><button type="button" className="link" onClick={() => setRegions(regions.filter((_, j) => j !== i))}>{T('Remove', 'حذف')}</button></td></tr>)}
        </tbody></table>
        <button type="button" className="link" onClick={() => setRegions([...regions, { id: 'c' + uid(), name: { en: '', ar: '' } }])}>{T('Add a city', 'إضافة مدينة')}</button>
        <h3 className="an-h3">{T('HR cost parameters', 'معايير تكلفة الموارد البشرية')}</h3>
        <div className="bgt-form">
          {rate('gosiSaudiEmployer', T('GOSI, Saudi, employer % (annuities, hazards, SANED)', 'التأمينات، سعودي، % صاحب العمل'))}
          {rate('gosiNonSaudiEmployer', T('GOSI, non-Saudi, employer % (hazards)', 'التأمينات، غير سعودي، % صاحب العمل'))}
          {sar('gosiFloor', T('GOSI wage floor (basic + housing)', 'الحد الأدنى لأجر الاشتراك'))}
          {sar('gosiCap', T('GOSI wage cap (basic + housing)', 'الحد الأعلى لأجر الاشتراك'))}
          {sar('expatLevyMonthly', T('Expat levy a month, per non-Saudi', 'المقابل المالي شهريًا لكل غير سعودي'))}
          {sar('iqamaAnnual', T('Iqama a year', 'الإقامة سنويًا'))}
          {sar('workPermitAnnual', T('Work permit a year', 'رخصة العمل سنويًا'))}
          {sar('medicalAnnual', T('Medical insurance a year, per head (company policy)', 'التأمين الطبي سنويًا لكل فرد'))}
          <label className="field"><span>{T('Rates as of', 'النسب بتاريخ')}</span><input type="date" value={p.asOf} onChange={(x) => setP({ ...p, asOf: x.target.value })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={p.confirmed} onChange={(x) => setP({ ...p, confirmed: x.target.checked })} /> {T('HR has confirmed these rates', 'أكدت الموارد البشرية هذه النسب')}</label>
        <div className="actions"><button type="button" className="btn" onClick={() => api('PUT', '/api/budget/settings', { version: meta.settingsVersion, regions: regions.map((r) => ({ ...r, id: r.id.startsWith('c') && r.name.en ? r.name.en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || r.id : r.id })), params: p }).then(onDone).catch((x) => setE(err(x.code)))}>{T('Save settings', 'حفظ الإعدادات')}</button>{e && <span className="msg err">{e}</span>}</div>
      </>}
    </section>
  );
}

// ---------------------------------------------------------------- department workspace
interface DeptData { cycle: Cycle & { monthKeys: string[] }; department: string; submission: null | { id: string; revision: number; status: Status; version: number; body: { lines: Line[]; positions: Position[]; study?: Study; plan?: DeptPlan }; reviewComment: string | null; submittedAt: string | null; updatedAt: string }; approvedRevision: number | null; revisions: Array<{ revision: number; status: Status }>; history?: HistoryEvent[] }
interface HistoryEvent { action: string; at: string; by: { name: string; role: string } | null; revision: number | null; comment: string | null; total: number; lines: number | null }

export function DeptBudget() {
  const { cycle: cycleId = '', dept = '' } = useParams();
  const s = useSession();
  const { lang, txt, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta } = useBudgetMeta();
  const [d, setD] = useState<DeptData | null>(null), [lines, setLines] = useState<Line[]>([]), [positions, setPositions] = useState<Position[]>([]);
  const [study, setStudy] = useState<Study>(EMPTY_STUDY), [plan, setPlan] = useState<DeptPlan>(EMPTY_PLAN), [tab, setTab] = useState<'study' | 'plan' | 'budget' | 'report'>('study');
  const [lv, setLv] = useState<'cards' | 'table'>(() => { try { return localStorage.getItem('cf13.lineView') === 'table' ? 'table' : 'cards'; } catch { return 'cards'; } });
  const pickLv = (v: 'cards' | 'table') => { setLv(v); try { localStorage.setItem('cf13.lineView', v); } catch { /* private window */ } };
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [comment, setComment] = useState('');
  const load = useCallback(() => api<DeptData>('GET', `/api/budget/cycles/${cycleId}/departments/${dept}`).then((r) => {
    setD(r); setLines((r.submission?.body.lines || []).filter((l) => !l.posId)); setPositions(r.submission?.body.positions || []); setStudy({ ...EMPTY_STUDY, ...(r.submission?.body.study || {}) }); setPlan({ ...EMPTY_PLAN, ...(r.submission?.body.plan || {}) }); setDirty(false);
  }).catch((e) => setMsg({ ok: false, t: err(e instanceof ApiError ? e.code : 'network') })), [cycleId, dept, err]);
  useEffect(() => { load(); }, [load]);

  const n = d?.cycle.monthKeys.length || 0;
  const items = useMemo(() => (meta ? meta.pack.items.filter((i) => i.dept === dept) : []), [meta, dept]);
  const liveGenerated = useMemo(() => (meta ? positions.flatMap((p) => positionLines(p, n, meta.params)) : []), [positions, meta, n]);
  if (!d || !meta) return msg ? <p className="msg err">{msg.t}</p> : <Loading />;

  const depName = meta.pack.allDepartments.find((x) => x.id === dept)?.name;
  const status: Status = d.submission?.status || 'not_started';
  const editable = d.cycle.status === 'open' && (status === 'not_started' || status === 'draft' || status === 'returned') && s.me.role !== 'viewer';
  const isOwner = s.me.role === 'owner', canReturn = isOwner || s.me.role === 'finance';
  // a locked budget shows the HR lines as they were saved, never redrawn from today's rates
  const generated = editable ? liveGenerated : (d.submission?.body.lines || []).filter((l) => l.posId);
  const itemOf = (id: string) => meta.pack.items.find((i) => i.id === id);
  const regionName = (id: string) => (id === 'company' ? T('Whole company', 'الشركة كاملة') : txt(meta.regions.find((r) => r.id === id)?.name) || id);
  const all = [...lines, ...generated];
  const byKind = (k: Kind) => sum(all.filter((l) => itemOf(l.item)?.kind === k).map((l) => sum(l.amounts)));
  const version = d.submission?.version ?? 0;
  const touch = () => { setDirty(true); setMsg(null); };

  async function act(path: string, body: object, okText: string) {
    setBusy(true); setMsg(null);
    try { await api('POST', `/api/budget/cycles/${cycleId}/departments/${dept}/${path}`, { version, ...body }); await load(); setMsg({ ok: true, t: okText }); }
    catch (e) { setMsg({ ok: false, t: err(e instanceof ApiError ? e.code : 'network') }); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setMsg(null);
    try { await api('PUT', `/api/budget/cycles/${cycleId}/departments/${dept}`, { version, body: { lines, positions, study, plan } }); await load(); setMsg({ ok: true, t: T('Draft saved.', 'تم حفظ المسودة.') }); }
    catch (e) { setMsg({ ok: false, t: errText(e) }); }
    finally { setBusy(false); }
  }
  const errText = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : 'network';
    const [base, where] = code.split(':');
    const at = where ? (() => { const [kind, i] = where.split('.'); return kind === 'lines' ? T(` (line ${Number(i) + 1})`, ` (السطر ${Number(i) + 1})`) : kind === 'positions' ? T(` (position ${Number(i) + 1})`, ` (الوظيفة ${Number(i) + 1})`) : ''; })() : '';
    const known: Record<string, Txt> = {
      item_not_in_department: { en: 'An item belongs to another department', ar: 'بند يتبع إدارة أخرى' }, unknown_region: { en: 'Pick a city', ar: 'اختر المدينة' },
      required: { en: 'A required field is empty', ar: 'حقل مطلوب فارغ' }, invalid_number: { en: 'A number is not valid', ar: 'رقم غير صحيح' }, out_of_range: { en: 'A number is out of range', ar: 'رقم خارج النطاق' },
      stale_budget: { en: 'Someone else saved this budget meanwhile: reload the page', ar: 'حفظ شخص آخر هذه الميزانية: أعد تحميل الصفحة' }, budget_submitted: { en: 'It is waiting for approval and cannot change', ar: 'بانتظار الاعتماد ولا يمكن تعديلها' },
      budget_approved_start_revision: { en: 'It is approved: start a revision to change it', ar: 'معتمدة: ابدأ مراجعة جديدة لتعديلها' }, empty_budget: { en: 'Add at least one line before submitting', ar: 'أضف سطرًا واحدًا على الأقل قبل التسليم' },
      cycle_closed: { en: 'The budget round is closed', ar: 'دورة الميزانية مغلقة' }, invalid_months: { en: 'The months of a position are not valid', ar: 'أشهر الوظيفة غير صحيحة' }
    };
    return known[base] ? txt(known[base]) + at : err(code);
  };

  const setLine = (i: number, fn: (l: Line) => Line) => { setLines(lines.map((l, j) => (j === i ? norm(fn(l)) : l))); touch(); };
  const addLine = (item: string) => { setLines([...lines, { id: uid(), item, region: 'company', desc: '', amounts: new Array(n).fill(meta.guidance?.items[item] ? 0 : 0) }]); touch(); };
  // one line becomes one line per city, the amounts shared equally (quantities too, for quantity x price lines)
  const splitLine = (i: number) => { const l = lines[i], cities = meta.regions.filter((r) => r.id !== 'hq'), k = cities.length || 1;
    const share = (a: number[]) => a.map((v) => Math.round((v / k) * 100) / 100);
    const parts = cities.map((r) => norm({ ...l, id: uid(), region: r.id, amounts: share(l.amounts), basis: l.basis ? { ...l.basis, qty: share(l.basis.qty) } : undefined }));
    setLines([...lines.slice(0, i), ...parts, ...lines.slice(i + 1)]); touch(); };
  const groups = items.reduce<Array<{ g: Txt; items: Item[] }>>((acc2, it) => { const k = acc2.find((x) => x.g.en === it.group.en); if (k) k.items.push(it); else acc2.push({ g: it.group, items: [it] }); return acc2; }, []);

  return (
    <div className="bgt">
      <div className="head">
        <div>
          <span className="an-eyebrow">{d.cycle.name}</span>
          <h1>{txt(depName)}</h1>
          <p className="sub">{monthLabel(d.cycle.monthKeys[0], lang)} – {monthLabel(d.cycle.monthKeys[n - 1], lang)} · {T('amounts in SAR a month, excluding VAT', 'المبالغ بالريال شهريًا وبدون ضريبة القيمة المضافة')}{d.cycle.deadline ? ' · ' + T('submit by ', 'التسليم بحلول ') + date(d.cycle.deadline, lang, { day: 'numeric', month: 'long' }) : ''}</p>
        </div>
        <div className="pills"><StatusPill s={status} />{d.submission && d.submission.revision > 1 && <span className="pill">{T('Revision ', 'المراجعة ')}{d.submission.revision}</span>}{d.approvedRevision && status !== 'approved' && <span className="pill ok">{T('Approved revision ', 'المراجعة المعتمدة ')}{d.approvedRevision}</span>}</div>
      </div>
      {s.me.role !== 'contributor' && <p className="sub" style={{ marginTop: -12, marginBottom: 14 }}><Link className="link" to="/budget">{T('← All departments', '← كل الإدارات')}</Link></p>}
      <DeptHero status={status} deadline={d.cycle.deadline} tab={tab} onTab={setTab}
        readiness={{ study: Object.values(study).filter((x) => x.trim()).length, studyOf: 5, vision: !!plan.vision.trim(), objectives: plan.objectives.length, risks: plan.risks.length, lines: all.length }} />
      <HowTo first={!d.submission} />
      <ApprovalTracker status={status} history={d.history || []} submittedAt={d.submission?.submittedAt || null} deadline={d.cycle.deadline} revision={d.submission?.revision || 1} />
      {status === 'returned' && d.submission?.reviewComment && <div className="demo" role="note"><b>{T('Returned for changes: ', 'أعيدت للتعديل: ')}</b>{d.submission.reviewComment}</div>}

      <div className="an-kpis sm">
        {dept === 'sales' ? <div className="an-kpi sm t-rec"><span className="l">{T('Revenue', 'الإيرادات')}</span><span className="v num">{m(byKind('revenue'))}</span></div> : null}
        <div className="an-kpi sm t-pay"><span className="l">{T('Costs', 'التكاليف')}</span><span className="v num">{m(byKind('cogs') + byKind('opex') + byKind('noncash') + byKind('financing'))}</span></div>
        <div className="an-kpi sm t-brand"><span className="l">{T('Capex', 'النفقات الرأسمالية')}</span><span className="v num">{m(byKind('capex'))}</span></div>
        {dept === 'hr' && <div className="an-kpi sm t-brand"><span className="l">{T('Headcount', 'عدد الموظفين')}</span><span className="v num">{positions.reduce((t, p) => t + p.headcount, 0)}</span><span className="s">{T('Saudi ', 'سعودي ')}{positions.filter((p) => p.saudi).reduce((t, p) => t + p.headcount, 0)}</span></div>}
        <div className="an-kpi sm t-brand"><span className="l">{T('Lines', 'الأسطر')}</span><span className="v num">{all.length}</span></div>
      </div>

      <div className="seg bgt-tabs" role="tablist" aria-label={T('Steps', 'الخطوات')}>
        {([['study', T('1 Study', '1 الدراسة'), `${Object.values(study).filter((x) => x.trim()).length}/5`], ['plan', T('2 Plan', '2 الخطة'), T(`${plan.objectives.length} objectives`, `${plan.objectives.length} أهداف`)], ['budget', T('3 Budget', '3 الميزانية'), T(`${all.length} lines`, `${all.length} سطرًا`)], ['report', T('Report', 'التقرير'), m(sum(all.map((l) => sum(l.amounts))))]] as Array<['study' | 'plan' | 'budget' | 'report', string, string]>).map(([k, l, c]) => <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l} <small className="tab-count">{c}</small></button>)}
      </div>
      {tab === 'study' && <StudyEditor study={study} editable={editable} onChange={(x) => { setStudy(x); touch(); }} />}
      {tab === 'plan' && <PlanEditor plan={plan} months={d.cycle.monthKeys} editable={editable} onChange={(x) => { setPlan(x); touch(); }} />}
      {tab === 'budget' && dept === 'hr' && <Positions meta={meta} n={n} months={d.cycle.monthKeys} positions={positions} editable={editable} onChange={(p) => { setPositions(p); touch(); }} generated={generated} />}

      {tab === 'budget' && <GuidanceCard meta={meta} items={items} lines={all} n={n} editable={editable}
        onUse={(ids) => { setLines([...lines, ...ids.map((id) => ({ id: uid(), item: id, region: 'company', desc: T('From guidance: ', 'من الإرشاد: ') + (meta.guidance?.source || ''), amounts: new Array(n).fill(meta.guidance!.items[id]) }))]); touch(); }} />}
      {tab === 'budget' && <section className="card" style={{ marginTop: 20 }}>
        <div className="guide-head"><h2>{dept === 'hr' ? T('Other HR lines', 'بنود الموارد البشرية الأخرى') : T('Budget lines', 'بنود الميزانية')}</h2>
          <div className="seg" role="group" aria-label={T('View', 'العرض')}><button type="button" aria-pressed={lv === 'cards'} onClick={() => pickLv('cards')}>{T('Cards', 'بطاقات')}</button><button type="button" aria-pressed={lv === 'table'} onClick={() => pickLv('table')}>{T('Spreadsheet', 'جدول')}</button></div></div>
        <p className="sub">{T('One line per item and city. Use quantity × price where the item has a unit (cylinders, litres, vehicles).', 'سطر لكل بند ومدينة. استخدم الكمية × السعر للبنود التي لها وحدة (أسطوانات، لترات، مركبات).')}</p>
        {lines.length === 0 && <p className="empty" style={{ marginTop: 12 }}>{T('No lines yet. Add the first item below.', 'لا توجد أسطر بعد. أضف أول بند أدناه.')}</p>}
        {lines.length > 0 && lv === 'cards' && <div className="lc-list">{lines.map((l, i) => (
          <LineCard key={l.id} line={l} item={itemOf(l.item)} groups={groups} regions={meta.regions} months={d.cycle.monthKeys} editable={editable}
            guide={meta.guidance?.items[l.item]} onChange={(fn) => setLine(i, fn)} onRemove={() => { setLines(lines.filter((_, j) => j !== i)); touch(); }} onSplit={() => splitLine(i)} />))}
          <div className="lc-total"><span>{T('Total of these lines', 'إجمالي هذه الأسطر')}</span><b className="num">{m(sum(lines.map((l) => sum(l.amounts))))}</b><small>{T('a month on average ', 'متوسط شهري ')}{m(sum(lines.map((l) => sum(l.amounts))) / Math.max(1, n))}</small></div>
        </div>}
        {lines.length > 0 && lv === 'table' && (
          <div className="ledger-wrap" style={{ marginTop: 12 }}>
            <table className="ledger bgt-grid">
              <thead><tr><th className="lab">{T('Item, city, description', 'البند والمدينة والوصف')}</th>{d.cycle.monthKeys.map((k) => <th key={k}>{monthLabel(k, lang)}</th>)}<th>{T('Total', 'الإجمالي')}</th></tr></thead>
              <tbody>{lines.map((l, i) => {
                const it = itemOf(l.item);
                const qty = l.basis ? l.basis.qty : null;
                return (
                  <Fragment key={l.id}>
                    <tr>
                      <td className="lab">
                        <div className="bgt-line">
                          <select disabled={!editable} value={l.item} onChange={(e) => setLine(i, (x) => ({ ...x, item: e.target.value, basis: itemOf(e.target.value)?.unit ? x.basis : undefined }))} aria-label={T('Item', 'البند')}>
                            {groups.map((gr) => <optgroup key={gr.g.en} label={txt(gr.g)}>{gr.items.map((x) => <option key={x.id} value={x.id}>{txt(x.name)}{x.kind === 'capex' ? ' · capex' : ''}</option>)}</optgroup>)}
                          </select>
                          <select disabled={!editable} value={l.region} onChange={(e) => setLine(i, (x) => ({ ...x, region: e.target.value }))} aria-label={T('Applies to', 'ينطبق على')}><option value="company">{T('Whole company', 'الشركة كاملة')}</option>{meta.regions.map((r) => <option key={r.id} value={r.id}>{txt(r.name)}</option>)}</select>
                          <input disabled={!editable} placeholder={T('Description', 'الوصف')} value={l.desc} onChange={(e) => setLine(i, (x) => ({ ...x, desc: e.target.value }))} />
                          {editable && <span className="bgt-tools">
                            {it?.unit && <button type="button" className="link" onClick={() => setLine(i, (x) => (x.basis ? { ...x, basis: undefined } : { ...x, basis: { qty: new Array(n).fill(0), price: 0 } }))}>{l.basis ? T('Enter amounts', 'إدخال مبالغ') : T('Quantity × price', 'الكمية × السعر')}</button>}
                            <button type="button" className="link" onClick={() => setLine(i, (x) => (x.basis ? { ...x, basis: { ...x.basis, qty: new Array(n).fill(x.basis.qty[0] || 0) } } : { ...x, amounts: new Array(n).fill(x.amounts[0] || 0) }))}>{T('Copy first month', 'نسخ الشهر الأول')}</button>
                            <button type="button" className="link" onClick={() => { const tot = sum(l.amounts); setLine(i, (x) => ({ ...x, basis: undefined, amounts: new Array(n).fill(Math.round((tot / n) * 100) / 100) })); }}>{T('Spread total evenly', 'توزيع الإجمالي بالتساوي')}</button>
                            <button type="button" className="link danger" onClick={() => { setLines(lines.filter((_, j) => j !== i)); touch(); }}>{T('Remove', 'حذف')}</button>
                          </span>}
                          {l.basis && <label className="bgt-price">{T('Unit price', 'سعر الوحدة')} ({txt(it?.unit)}) <NumInput disabled={!editable} label={T('Price', 'السعر')} width={120} value={l.basis.price} onValue={(v) => setLine(i, (x) => ({ ...x, basis: { ...x.basis!, price: v ?? 0 } }))} /></label>}
                        </div>
                      </td>
                      {(qty || l.amounts).map((v, k) => <td key={k}><NumInput disabled={!editable} label={monthLabel(d.cycle.monthKeys[k], lang)} value={v} onValue={(nv) => setLine(i, (x) => (x.basis ? { ...x, basis: { ...x.basis, qty: x.basis.qty.map((y, j) => (j === k ? nv ?? 0 : y)) } } : { ...x, amounts: x.amounts.map((y, j) => (j === k ? nv ?? 0 : y)) }))} /></td>)}
                      <td className="num"><b>{acc(sum(l.amounts))}</b></td>
                    </tr>
                    {qty && <tr className="bgt-sub"><td className="lab sub">{T('Amount (quantity × price)', 'المبلغ (الكمية × السعر)')}</td>{l.amounts.map((v, k) => <td key={k} className="num sub">{acc(v)}</td>)}<td /></tr>}
                  </Fragment>
                );
              })}
                <tr className="tot"><td className="lab">{T('Total of these lines', 'إجمالي هذه الأسطر')}</td>{d.cycle.monthKeys.map((_, k) => <td key={k} className="num">{acc(sum(lines.map((l) => l.amounts[k])))}</td>)}<td className="num">{acc(sum(lines.map((l) => sum(l.amounts))))}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {editable && <div className="actions"><select className="pill" value="" onChange={(e) => e.target.value && addLine(e.target.value)} aria-label={T('Add a line', 'إضافة سطر')}>
          <option value="">{T('+ Add a line…', '+ إضافة سطر…')}</option>
          {groups.map((gr) => <optgroup key={gr.g.en} label={txt(gr.g)}>{gr.items.filter((x) => !(dept === 'hr' && ['hr_salaries', 'hr_gosi', 'hr_eosb', 'hr_levy', 'hr_iqama'].includes(x.id))).map((x) => <option key={x.id} value={x.id}>{txt(x.name)}</option>)}</optgroup>)}
        </select></div>}
      </section>}

      <section className="card bgt-actions" style={{ marginTop: 20 }}>
        <div className="actions" style={{ marginTop: 0 }}>
          {editable && <button type="button" className="btn ghost" disabled={busy || !dirty} onClick={save}>{T('Save draft', 'حفظ المسودة')}</button>}
          {editable && d.submission && <button type="button" className="btn" disabled={busy || dirty} onClick={() => act('submit', {}, T('Submitted for approval.', 'سُلّمت للاعتماد.'))} title={dirty ? T('Save first', 'احفظ أولًا') : ''}>{T('Submit for approval', 'تسليم للاعتماد')}</button>}
          {status === 'submitted' && isOwner && <button type="button" className="btn" disabled={busy} onClick={() => act('approve', {}, T('Approved: it is now part of the company budget.', 'اعتُمدت وأصبحت جزءًا من ميزانية الشركة.'))}>{T('Approve', 'اعتماد')}</button>}
          {status === 'submitted' && canReturn && <><input className="bgt-comment" placeholder={T('What should change?', 'ما الذي يجب تعديله؟')} value={comment} onChange={(e) => setComment(e.target.value)} /><button type="button" className="btn ghost" disabled={busy || !comment.trim()} onClick={() => act('return', { comment }, T('Returned to the department.', 'أعيدت إلى الإدارة.'))}>{T('Return for changes', 'إعادة للتعديل')}</button></>}
          {status === 'approved' && d.cycle.status === 'open' && <button type="button" className="btn ghost" disabled={busy} onClick={() => act('revise', {}, T('A new revision is open. The approved one stays in the company budget until the new one is approved.', 'فُتحت مراجعة جديدة. تبقى المعتمدة في ميزانية الشركة حتى تُعتمد الجديدة.'))}>{T('Start a revision', 'بدء مراجعة جديدة')}</button>}
          {dirty && <span className="sub">{T('Unsaved changes', 'تغييرات غير محفوظة')}</span>}
          {msg && <span className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</span>}
        </div>
        {status === 'submitted' && !isOwner && <p className="sub" style={{ marginTop: 10 }}>{T('Waiting for the owner. It cannot change until it is approved or returned.', 'بانتظار المالك. لا يمكن تعديلها حتى تُعتمد أو تُعاد.')}</p>}
      </section>
      {tab === 'budget' && all.length > 0 && <Summary meta={meta} lines={all} months={d.cycle.monthKeys} regionName={regionName} />}
      {tab === 'report' && <DeptReport meta={meta} dept={dept} deptName={txt(depName)} cycleName={d.cycle.name} lines={all} positions={positions} months={d.cycle.monthKeys} regionName={regionName} study={study} plan={plan} status={status} />}
    </div>
  );
}

/**
 * Guidance from history (bank cash flow, later the P&L): a monthly average per item, shown next to what the
 * department enters. It is a starting point only; the department's own approved figures are the budget.
 */
function GuidanceCard({ meta, items, lines, n, editable, onUse }: { meta: Meta; items: Item[]; lines: Line[]; n: number; editable: boolean; onUse: (ids: string[]) => void }) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const g = meta.guidance;
  const rows = g ? items.filter((i) => g.items[i.id] > 0) : [];
  if (!g || !rows.length) return null;
  const entered = (id: string) => { const ls = lines.filter((l) => l.item === id); return ls.length ? sum(ls.map((l) => sum(l.amounts))) / Math.max(1, n) : null; };
  const unused = rows.filter((i) => entered(i.id) === null).map((i) => i.id);
  return (
    <section className="card guide" style={{ marginTop: 20 }}>
      <div className="guide-head">
        <div><h2>{T('Guidance from history', 'إرشاد من البيانات التاريخية')}</h2>
          <p className="sub">{g.source}{g.period ? ' · ' + g.period : ''} · {T('a month, excluding VAT. A starting point only: your figures, once approved, are the budget.', 'شهريًا وبدون ضريبة. نقطة بداية فقط: أرقامك بعد اعتمادها هي الميزانية.')}</p></div>
        {editable && unused.length > 0 && <button type="button" className="btn ghost" onClick={() => onUse(unused)}>{T(`Start from guidance (${unused.length})`, `ابدأ من الإرشاد (${unused.length})`)}</button>}
      </div>
      <table className="tbl guide-tbl"><thead><tr><th>{T('Item', 'البند')}</th><th className="n">{T('Guide a month', 'الإرشاد شهريًا')}</th><th className="n">{T('Your average a month', 'متوسطك شهريًا')}</th><th className="n">{T('Difference', 'الفرق')}</th><th /></tr></thead>
        <tbody>{rows.map((i) => {
          const gv = g.items[i.id], ev = entered(i.id), d = ev === null ? null : ev - gv;
          return <tr key={i.id}><td>{txt(i.name)}</td><td className="n num">{acc(gv)}</td><td className="n num">{ev === null ? <span className="sub">{T('not entered', 'لم يُدخل')}</span> : acc(ev)}</td>
            <td className={'n num ' + (d === null ? '' : Math.abs(d) <= gv * 0.1 ? '' : 'warn-t')}>{d === null ? '–' : Math.abs(d) < 0.5 ? T('on guide', 'مطابق') : (d > 0 ? '+' : '') + acc(d) + (gv ? ` (${d > 0 ? '+' : ''}${Math.round((d / gv) * 100)}%)` : '')}</td>
            <td>{editable && ev === null && <button type="button" className="link" onClick={() => onUse([i.id])}>{T('Use', 'استخدم')}</button>}</td></tr>;
        })}</tbody></table>
      {g.note && <p className="sub" style={{ marginTop: 8 }}>{g.note}</p>}
    </section>
  );
}

/** Owner and finance load the guidance file (a monthly average per catalogue item). */
function GuidanceLoader({ meta, onDone }: { meta: Meta; onDone: (t: string) => void }) {
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const g = meta.guidance;
  async function send(body: object, done: string) {
    setBusy(true); setMsg('');
    try { await api('PUT', '/api/budget/guidance', body); onDone(done); }
    catch (e) { setMsg(err(e instanceof ApiError ? e.code : 'network')); }
    finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    let body: unknown;
    try { body = JSON.parse(await file.text()); } catch { setMsg(T('That file is not a guidance file (JSON).', 'هذا الملف ليس ملف إرشاد (JSON).')); return; }
    await send(body as object, T('Guidance loaded. Department heads now see it next to their lines.', 'تم تحميل الإرشاد. يراه مديرو الإدارات بجانب بنودهم.'));
  }
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Guidance from history', 'الإرشاد من البيانات التاريخية')}</h2>
      <p className="sub">{g ? T(`Loaded: ${g.source}${g.period ? ', ' + g.period : ''}, ${Object.keys(g.items).length} items. `, `محمّل: ${g.source}${g.period ? '، ' + g.period : ''}، ${Object.keys(g.items).length} بندًا. `) : T('None loaded. ', 'لا يوجد إرشاد. ')}
        {T('Monthly averages from the bank cash flow or the P&L, shown to each department as a starting point. Approved department figures always win.', 'متوسطات شهرية من التدفق النقدي البنكي أو الأرباح والخسائر تُعرض لكل إدارة كنقطة بداية. الأرقام المعتمدة من الإدارات هي الأساس دائمًا.')}</p>
      <div className="actions">
        <label className="btn ghost" style={{ cursor: busy ? 'wait' : 'pointer' }}>{g ? T('Replace guidance file', 'استبدال ملف الإرشاد') : T('Load guidance file', 'تحميل ملف الإرشاد')}
          <input type="file" accept=".json,application/json" hidden disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {g && <button type="button" className="link danger" disabled={busy} onClick={() => send({ source: g.source, items: {} }, T('Guidance removed.', 'تمت إزالة الإرشاد.'))}>{T('Remove', 'إزالة')}</button>}
        {msg && <span className="msg err">{msg}</span>}
      </div>
    </section>
  );
}

/**
 * One budget line as a card: what it is, how much a month, and the shape of the year as a bar strip.
 * The twelve months open only when the department wants them different from each other.
 */
function LineCard({ line: l, item: it, groups, regions, months, editable, guide, onChange, onRemove, onSplit }: {
  line: Line; item: Item | undefined; groups: Array<{ g: Txt; items: Item[] }>; regions: Array<{ id: string; name: Txt }>; months: string[]; editable: boolean; guide: number | undefined;
  onChange: (fn: (l: Line) => Line) => void; onRemove: () => void; onSplit: () => void;
}) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [open, setOpen] = useState(false), [hover, setHover] = useState<number | null>(null);
  const n = months.length, tot = sum(l.amounts), avg = tot / Math.max(1, n);
  const vals = l.basis ? l.basis.qty : l.amounts;
  const flat = vals.every((v) => v === vals[0]);
  const mx = Math.max(...l.amounts.map((v) => Math.abs(v)), 1);
  const setAll = (v: number) => onChange((x) => (x.basis ? { ...x, basis: { ...x.basis, qty: new Array(n).fill(v) } } : { ...x, amounts: new Array(n).fill(v) }));
  const setOne = (k: number, v: number) => onChange((x) => (x.basis ? { ...x, basis: { ...x.basis, qty: x.basis.qty.map((y, j) => (j === k ? v : y)) } } : { ...x, amounts: x.amounts.map((y, j) => (j === k ? v : y)) }));
  const grow = (pct: number) => onChange((x) => { const base = (x.basis ? x.basis.qty : x.amounts)[0] || 0; const a = Array.from({ length: n }, (_, j) => Math.round(base * Math.pow(1 + pct / 100, j) * 100) / 100); return x.basis ? { ...x, basis: { ...x.basis, qty: a } } : { ...x, amounts: a }; });
  const diff = guide ? (avg - guide) / guide : null;
  const kindCls = it?.kind === 'revenue' ? 'rev' : it?.kind === 'capex' ? 'cap' : 'cost';
  return (
    <article className={'lc ' + kindCls}>
      <div className="lc-top">
        <select className="lc-item" disabled={!editable} value={l.item} onChange={(e) => onChange((x) => ({ ...x, item: e.target.value }))} aria-label={T('Item', 'البند')}>
          {groups.map((gr) => <optgroup key={gr.g.en} label={txt(gr.g)}>{gr.items.map((x) => <option key={x.id} value={x.id}>{txt(x.name)}</option>)}</optgroup>)}
        </select>
        <select className="lc-city" disabled={!editable} value={l.region} onChange={(e) => onChange((x) => ({ ...x, region: e.target.value }))} aria-label={T('Applies to', 'ينطبق على')}>
          <option value="company">{T('Whole company', 'الشركة كاملة')}</option>
          <optgroup label={T('By city', 'حسب المدينة')}>{regions.map((r) => <option key={r.id} value={r.id}>{txt(r.name)}</option>)}</optgroup></select>
        {editable && <button type="button" className="lc-x" onClick={onRemove} aria-label={T('Remove this line', 'حذف هذا السطر')} title={T('Remove', 'حذف')}>×</button>}
      </div>
      <input className="lc-desc" disabled={!editable} placeholder={T('What is it for? (optional)', 'لأي غرض؟ (اختياري)')} value={l.desc} onChange={(e) => onChange((x) => ({ ...x, desc: e.target.value }))} />
      <div className="lc-body">
        <div className="lc-amount">
          {l.basis ? <>
            <label><span>{txt(it?.unit) || T('Quantity', 'الكمية')} {T('a month', 'شهريًا')}</span><NumInput disabled={!editable} label={T('Quantity a month', 'الكمية شهريًا')} className="lc-big num" value={flat ? vals[0] : undefined} onValue={(v) => setAll(v ?? 0)} /></label>
            <label><span>{T('Price each', 'سعر الوحدة')}</span><NumInput disabled={!editable} label={T('Price', 'السعر')} className="lc-mid num" value={l.basis.price} onValue={(v) => onChange((x) => ({ ...x, basis: { ...x.basis!, price: v ?? 0 } }))} /></label>
          </> : <label><span>{T('SAR a month', 'ريال شهريًا')}</span><NumInput disabled={!editable} label={T('Amount a month', 'المبلغ شهريًا')} className="lc-big num" value={flat ? vals[0] : undefined} onValue={(v) => setAll(v ?? 0)} /></label>}
          {!flat && <small className="lc-varies">{T('Varies by month · average ', 'يختلف حسب الشهر · المتوسط ')}{m(avg)}</small>}
          <div className="lc-sum"><b className="num">{m(tot)}</b><span>{T('for the year', 'للسنة')}</span></div>
          {guide ? <div className={'lc-guide' + (diff !== null && Math.abs(diff) > 0.1 ? ' off' : '')}>
            <span>{T('Guide ', 'الإرشاد ')}<b className="num">{m(guide)}</b>{T(' a month', ' شهريًا')}</span>
            <span><b className="num">{m(guide * 12)}</b>{T(' a year', ' سنويًا')}{l.region !== 'company' ? T(' · whole company', ' · للشركة كاملة') : ''}</span>
            {diff !== null && tot && Math.round(diff * 100) !== 0 ? <span>{diff > 0 ? '+' : ''}{Math.round(diff * 100)}% {T('vs guide', 'مقابل الإرشاد')}</span> : null}
            {editable && <button type="button" className="link" onClick={() => onChange((x) => (x.basis ? x : { ...x, amounts: new Array(months.length).fill(Math.round(guide * 100) / 100) }))}>{T('Use the guide', 'استخدم الإرشاد')}</button>}
          </div> : <span className="lc-noguide sub">{T('No history for this item: enter your own estimate.', 'لا يوجد تاريخ لهذا البند: أدخل تقديرك.')}</span>}
        </div>
        <div className="lc-strip" role="img" aria-label={T('Amount by month', 'المبلغ حسب الشهر')}>
          {l.amounts.map((v, k) => <button type="button" key={k} className={'lc-bar' + (hover === k ? ' on' : '')} style={{ ['--h' as string]: Math.max(4, (Math.abs(v) / mx) * 100) + '%', animationDelay: k * 35 + 'ms' }}
            onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onClick={() => setOpen(true)} title={monthLabel(months[k], lang) + ' · ' + m(v)}><i /><small>{date(months[k] + '-01', lang, { month: 'short' })}</small></button>)}
          {hover !== null && <span className="lc-tip num">{monthLabel(months[hover], lang)} · {m(l.amounts[hover])}</span>}
        </div>
      </div>
      {editable && <div className="lc-tools">
        <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? T('Hide months', 'إخفاء الأشهر') : T('Different each month', 'مختلف كل شهر')}</button>
        <button type="button" className="link" onClick={() => grow(2)}>{T('Grow 2% a month', 'نمو 2% شهريًا')}</button>
        {regions.length > 1 && <button type="button" className="link" onClick={onSplit} title={T('One line per city, the amount shared equally', 'سطر لكل مدينة بمبالغ متساوية')}>{l.region === 'company' ? T('Split across cities', 'وزّع على المدن') : T('Split across all cities', 'وزّع على كل المدن')}</button>}
        {it?.unit && <button type="button" className="link" onClick={() => onChange((x) => (x.basis ? { ...x, basis: undefined } : { ...x, basis: { qty: new Array(n).fill(0), price: 0 } }))}>{l.basis ? T('Enter amounts instead', 'إدخال مبالغ بدلًا من ذلك') : T('Quantity × price', 'الكمية × السعر')}</button>}
      </div>}
      {open && <div className="lc-months">{months.map((k, j) => <label key={k}><span>{monthLabel(k, lang)}</span><NumInput disabled={!editable} label={monthLabel(k, lang)} value={vals[j]} onValue={(v) => setOne(j, v ?? 0)} /></label>)}</div>}
    </article>
  );
}

/**
 * The department report: everything the head needs to read and defend their own budget, built only from their own
 * lines (so it never shows another department). Totals, the shape of the year, items against the bank guide,
 * cities, quarters, people, and a list of things worth a second look. Downloads as CSV and prints cleanly.
 */
function DeptReport({ meta, dept, deptName, cycleName, lines, positions, months, regionName, study, plan, status }: {
  meta: Meta; dept: string; deptName: string; cycleName: string; lines: Line[]; positions: Position[]; months: string[]; regionName: (id: string) => string;
  study: Study; plan: DeptPlan; status: Status;
}) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const n = months.length, item = (id: string) => meta.pack.items.find((i) => i.id === id);
  const kindOf = (l: Line) => item(l.item)?.kind;
  const monthTot = months.map((_, k) => sum(lines.map((l) => l.amounts[k] || 0)));
  const total = sum(monthTot), avg = total / Math.max(1, n);
  const byKind = (k: Kind | 'cost') => sum(lines.filter((l) => (k === 'cost' ? !['revenue', 'capex'].includes(kindOf(l) || '') : kindOf(l) === k)).map((l) => sum(l.amounts)));
  const rev = byKind('revenue'), capex = byKind('capex'), cost = byKind('cost');
  const peak = monthTot.indexOf(Math.max(...monthTot)), low = monthTot.indexOf(Math.min(...monthTot));
  const heads = positions.reduce((t, p) => t + p.headcount, 0), saudi = positions.filter((p) => p.saudi).reduce((t, p) => t + p.headcount, 0);
  // per item
  const items = [...new Set(lines.map((l) => l.item))].map((id) => {
    const a = months.map((_, k) => sum(lines.filter((l) => l.item === id).map((l) => l.amounts[k] || 0)));
    const t = sum(a), g = meta.guidance?.items[id];
    return { id, name: txt(item(id)?.name) || id, group: txt(item(id)?.group), kind: item(id)?.kind, a, t, avg: t / Math.max(1, n), min: Math.min(...a), max: Math.max(...a), guide: g, diff: g ? (t / Math.max(1, n) - g) / g : null };
  }).sort((x, y) => y.t - x.t);
  // groups and cities
  const groups = new Map<string, number>(); items.forEach((i) => groups.set(i.group, (groups.get(i.group) || 0) + i.t));
  const cities = new Map<string, number>(); lines.forEach((l) => cities.set(l.region, (cities.get(l.region) || 0) + sum(l.amounts)));
  const quarters = [0, 1, 2, 3].map((q) => sum(monthTot.slice(q * 3, q * 3 + 3))).filter((_, q) => q * 3 < n);
  // guide items this department has not budgeted at all
  const guideMissing = Object.entries(meta.guidance?.items || {}).filter(([id, v]) => v > 0 && item(id)?.dept === dept && !items.some((i) => i.id === id)).map(([id, v]) => ({ id, name: txt(item(id)?.name), v }));
  // things worth a second look
  const notes: Array<{ tone: 'warn' | 'info' | 'ok'; t: string }> = [];
  items.filter((i) => i.diff !== null && Math.abs(i.diff) > 0.1).forEach((i) => notes.push({ tone: 'warn', t: T(`${i.name}: ${i.diff! > 0 ? '+' : ''}${Math.round(i.diff! * 100)}% against the bank guide (${m(i.avg)} vs ${m(i.guide!)} a month). Explain the change in the study.`, `${i.name}: ${i.diff! > 0 ? '+' : ''}${Math.round(i.diff! * 100)}% مقابل إرشاد البنك (${m(i.avg)} مقابل ${m(i.guide!)} شهريًا). اشرح السبب في الدراسة.`) }));
  guideMissing.forEach((g) => notes.push({ tone: 'warn', t: T(`${g.name} is not in your budget, but the bank shows about ${m(g.v)} a month.`, `${g.name} غير موجود في ميزانيتك، بينما يُظهر البنك حوالي ${m(g.v)} شهريًا.`) }));
  items.filter((i) => i.t === 0).forEach((i) => notes.push({ tone: 'warn', t: T(`${i.name} has a line with no amounts.`, `${i.name} له سطر بلا مبالغ.`) }));
  monthTot.forEach((v, k) => { if (k && monthTot[k - 1] > 0 && Math.abs(v - monthTot[k - 1]) / monthTot[k - 1] > 0.3) notes.push({ tone: 'info', t: T(`${monthLabel(months[k], lang)} moves ${v > monthTot[k - 1] ? 'up' : 'down'} ${Math.round(Math.abs(v - monthTot[k - 1]) / monthTot[k - 1] * 100)}% from the month before.`, `${monthLabel(months[k], lang)} يتغير ${Math.round(Math.abs(v - monthTot[k - 1]) / monthTot[k - 1] * 100)}% عن الشهر السابق.`) }); });
  const studyDone = Object.values(study).filter((x) => x.trim()).length;
  if (studyDone < 3) notes.push({ tone: 'warn', t: T(`The study has ${studyDone} of 5 sections. The owner reads it before approving.`, `الدراسة فيها ${studyDone} من 5 أقسام. يقرؤها المالك قبل الاعتماد.`) });
  if (!plan.objectives.length) notes.push({ tone: 'warn', t: T('No objectives yet. Add at least one with its KPI.', 'لا أهداف بعد. أضف هدفًا واحدًا على الأقل مع مؤشره.') });
  if (!notes.length) notes.push({ tone: 'ok', t: T('Nothing stands out: every item is close to the guide and the months move smoothly.', 'لا شيء لافت: كل البنود قريبة من الإرشاد والأشهر متدرجة.') });

  const csv = () => {
    const q = (v: string | number) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : '"' + v.replace(/"/g, '""') + '"');
    const rows: Array<Array<string | number>> = [[T('Item', 'البند'), T('Group', 'المجموعة'), ...months.map((k) => monthLabel(k, lang)), T('Total', 'الإجمالي'), T('Average a month', 'المتوسط الشهري'), T('Guide a month', 'الإرشاد الشهري')]];
    items.forEach((i) => rows.push([i.name, i.group, ...i.a, i.t, i.avg, i.guide ?? '']));
    rows.push([T('Total', 'الإجمالي'), '', ...monthTot, total, avg, '']);
    rows.push([]); rows.push([T('City', 'المدينة'), T('Total', 'الإجمالي')]);
    [...cities.entries()].forEach(([r, v]) => rows.push([regionName(r), v]));
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cycleName} - ${deptName}.csv`.replace(/[\\/:*?"<>|]/g, '-'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!lines.length) return <section className="card" style={{ marginTop: 20 }}><h2>{T('Report', 'التقرير')}</h2><p className="empty">{T('The report fills in as you add budget lines in step 3.', 'يمتلئ التقرير عند إضافة بنود الميزانية في الخطوة 3.')}</p></section>;
  return (
    <div className="dr">
      <section className="card dr-head">
        <div><span className="an-eyebrow">{cycleName} · {T('department report', 'تقرير الإدارة')}</span><h2>{deptName}</h2>
          <p className="sub">{monthLabel(months[0], lang)} – {monthLabel(months[n - 1], lang)} · {T('SAR, excluding VAT', 'ريال، بدون ضريبة')} · {txt(STATUS[status])}</p></div>
        <div className="actions no-print" style={{ marginTop: 0 }}>
          <button type="button" className="btn ghost" onClick={csv}>{T('Download CSV', 'تنزيل CSV')}</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>{T('Print or save as PDF', 'طباعة أو حفظ PDF')}</button>
        </div>
      </section>

      <div className="an-kpis dr-kpis">
        <div className="an-kpi t-brand"><span className="l">{T('Total for the year', 'إجمالي السنة')}</span><span className="v num"><CountUp value={total} format={(v) => m(v)} /></span><span className="s">{items.length} {T('items', 'بندًا')} · {lines.length} {T('lines', 'سطرًا')}</span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Average a month', 'المتوسط الشهري')}</span><span className="v num">{m(avg)}</span><span className="s">{T('peak ', 'الأعلى ')}{monthLabel(months[peak], lang)} · {T('lowest ', 'الأدنى ')}{monthLabel(months[low], lang)}</span></div>
        {rev > 0 && <div className="an-kpi t-rec"><span className="l">{T('Revenue', 'الإيرادات')}</span><span className="v num">{m(rev)}</span><span className="s">{m(rev / n)} {T('a month', 'شهريًا')}</span></div>}
        <div className="an-kpi t-pay"><span className="l">{T('Running costs', 'المصاريف التشغيلية')}</span><span className="v num">{m(cost)}</span><span className="s">{total ? Math.round((cost / total) * 100) : 0}% {T('of the total', 'من الإجمالي')}</span></div>
        {capex > 0 && <div className="an-kpi t-brand"><span className="l">{T('Capex', 'الرأسمالية')}</span><span className="v num">{m(capex)}</span><span className="s">{T('one-off investment', 'استثمار لمرة واحدة')}</span></div>}
        {heads > 0 && <div className="an-kpi t-brand"><span className="l">{T('Headcount', 'عدد الموظفين')}</span><span className="v num">{heads}</span><span className="s">{T('Saudi ', 'سعودي ')}{saudi} · {Math.round((saudi / heads) * 100)}%</span></div>}
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Month by month', 'شهرًا بشهر')}</h2>
        <p className="sub">{T('The shape of the year. The line is the running total.', 'شكل السنة. الخط هو الإجمالي التراكمي.')}</p>
        <MonthColumns months={months.map((k) => monthLabel(k, lang))} revenue={months.map((_, k) => sum(lines.filter((l) => kindOf(l) === 'revenue').map((l) => l.amounts[k] || 0)))} costs={months.map((_, k) => sum(lines.filter((l) => kindOf(l) !== 'revenue').map((l) => l.amounts[k] || 0)))}
          line={monthTot.map((_, k) => sum(monthTot.slice(0, k + 1)) / Math.max(1, k + 1))} labels={{ revenue: T('Revenue', 'الإيرادات'), costs: T('Costs and capex', 'التكاليف والرأسمالية'), line: T('Average so far', 'المتوسط حتى الشهر') }} />
        <div className="dr-quarters">{quarters.map((v, q) => <div key={q}><span>{T(`Quarter ${q + 1}`, `الربع ${q + 1}`)}</span><b className="num">{m(v)}</b><i style={{ width: (total ? (v / Math.max(...quarters)) * 100 : 0) + '%' }} /></div>)}</div>
      </section>

      <div className="grid dr-two" style={{ marginTop: 20 }}>
        <section className="card">
          <h2>{T('Where it goes', 'أين يذهب')}</h2>
          <Donut parts={[...groups.entries()].sort((a, b) => b[1] - a[1]).map(([g, v], i) => ({ id: g, label: g, value: v, color: deptColor(i) }))} center={m(total)} sub={T('by group', 'حسب المجموعة')} />
        </section>
        <section className="card">
          <h2>{T('By city', 'حسب المدينة')}</h2>
          <HBars rows={[...cities.entries()].sort((a, b) => b[1] - a[1]).map(([r, v]) => ({ id: r, label: regionName(r), a: v }))} labels={{ a: T('Total for the year', 'إجمالي السنة') }} />
        </section>
      </div>

      {(() => {
        const guideMonth = sum(Object.entries(meta.guidance?.items || {}).filter(([id]) => item(id)?.dept === dept).map(([, v]) => v));
        if (!guideMonth) return null;
        const gaps = items.filter((i) => i.guide).map((i) => ({ ...i, gap: i.avg - (i.guide || 0) })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 5);
        const yearGap = total - guideMonth * n;
        return (
          <section className="card dr-vs" style={{ marginTop: 20 }}>
            <h2>{T('Your budget against history, month by month', 'ميزانيتك مقابل التاريخ شهرًا بشهر')}</h2>
            <p className="sub">{T(`Bars: your budget. Line: the bank history for this department, ${m(guideMonth)} a month (${m(guideMonth * n)} for the year). `, `الأعمدة: ميزانيتك. الخط: تاريخ البنك لهذه الإدارة، ${m(guideMonth)} شهريًا (${m(guideMonth * n)} للسنة). `)}
              <b className={yearGap > 0 ? 'warn-t' : ''}>{yearGap >= 0 ? T(`${m(yearGap)} above history for the year (${guideMonth ? ((yearGap / (guideMonth * n)) * 100).toFixed(1) : 0}%).`, `أعلى من التاريخ بـ ${m(yearGap)} للسنة (${guideMonth ? ((yearGap / (guideMonth * n)) * 100).toFixed(1) : 0}%).`) : T(`${m(-yearGap)} below history for the year (${((-yearGap / (guideMonth * n)) * 100).toFixed(1)}%).`, `أقل من التاريخ بـ ${m(-yearGap)} للسنة (${((-yearGap / (guideMonth * n)) * 100).toFixed(1)}%).`)}</b></p>
            <MonthColumns months={months.map((k) => monthLabel(k, lang))} revenue={months.map(() => 0)} costs={monthTot} line={months.map(() => guideMonth)} labels={{ revenue: '', costs: T('Your budget', 'ميزانيتك'), line: T('Bank history', 'تاريخ البنك') }} />
            <h3 className="an-h3">{T('Biggest gaps against history', 'أكبر الفروقات عن التاريخ')}</h3>
            <ul className="dr-gaps">{gaps.map((g) => <li key={g.id}><span>{g.name}</span><span className="dr-gapbar"><i className={g.gap > 0 ? 'up' : 'down'} style={{ width: Math.min(100, (Math.abs(g.gap) / Math.max(1, Math.abs(gaps[0].gap))) * 100) + '%' }} /></span>
              <b className={'num ' + (g.gap > 0 ? 'warn-t' : '')}>{g.gap > 0 ? '+' : '−'}{m(Math.abs(g.gap))}</b><span className="sub">{T('a month', 'شهريًا')} · {g.guide ? (g.gap > 0 ? '+' : '') + Math.round((g.gap / g.guide) * 100) + '%' : ''}</span></li>)}</ul>
          </section>);
      })()}
      {items.some((i) => i.guide) && <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Against the bank guide', 'مقابل إرشاد البنك')}</h2>
        <p className="sub">{meta.guidance?.source}{meta.guidance?.period ? ' · ' + meta.guidance.period : ''} · {T('your average a month next to the history', 'متوسطك الشهري بجانب التاريخي')}</p>
        <HBars rows={items.filter((i) => i.guide).map((i) => ({ id: i.id, label: i.name, a: i.avg, b: i.guide }))} labels={{ a: T('Your average a month', 'متوسطك الشهري'), b: T('Bank guide a month', 'إرشاد البنك الشهري') }} />
      </section>}

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Item by item', 'بندًا ببند')}</h2>
        <div className="khz-scroll"><table className="tbl dr-tbl">
          <thead><tr><th>{T('Item', 'البند')}</th><th className="n">{T('Total', 'الإجمالي')}</th><th className="n">{T('Share', 'النسبة')}</th><th className="n">{T('A month', 'شهريًا')}</th><th className="n">{T('Lowest – highest month', 'أدنى – أعلى شهر')}</th><th className="n">{T('Guide a month', 'الإرشاد')}</th><th className="n">{T('Difference', 'الفرق')}</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.id}>
            <td><b>{i.name}</b><div className="sub">{i.group}{i.kind ? ' · ' + txt(KIND_NAMES[i.kind]) : ''}</div></td>
            <td className="n num">{acc(i.t)}</td>
            <td className="n"><span className="dr-share"><i style={{ width: (total ? (i.t / total) * 100 : 0) + '%' }} /></span>{total ? ((i.t / total) * 100).toFixed(1) : '0'}%</td>
            <td className="n num">{acc(i.avg)}</td>
            <td className="n num sub">{acc(i.min)} – {acc(i.max)}</td>
            <td className="n num">{i.guide ? acc(i.guide) : '–'}</td>
            <td className={'n num ' + (i.diff !== null && Math.abs(i.diff) > 0.1 ? 'warn-t' : '')}>{i.diff === null ? '–' : (i.diff > 0 ? '+' : '') + Math.round(i.diff * 100) + '%'}</td>
          </tr>)}
            <tr className="tot"><td>{T('Total', 'الإجمالي')}</td><td className="n num">{acc(total)}</td><td className="n">100%</td><td className="n num">{acc(avg)}</td><td /><td /><td /></tr>
          </tbody></table></div>
      </section>

      {positions.length > 0 && <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('People', 'الموظفون')}</h2>
        <div className="khz-scroll"><table className="tbl dr-tbl">
          <thead><tr><th>{T('Position', 'الوظيفة')}</th><th>{T('City', 'المدينة')}</th><th className="n">{T('Headcount', 'العدد')}</th><th>{T('Saudi', 'سعودي')}</th><th>{T('Months', 'الأشهر')}</th></tr></thead>
          <tbody>{positions.map((p, i) => <tr key={i}><td>{p.title || '–'}</td><td>{regionName(p.region)}</td><td className="n num">{p.headcount}</td><td>{p.saudi ? T('Yes', 'نعم') : T('No', 'لا')}</td><td>{monthLabel(months[p.from], lang)} – {monthLabel(months[p.to], lang)}</td></tr>)}</tbody>
        </table></div>
      </section>}

      <section className="card dr-notes" style={{ marginTop: 20 }}>
        <h2>{T('Worth a second look', 'يستحق مراجعة ثانية')}</h2>
        <ul>{notes.map((x, i) => <li key={i} className={x.tone}><b aria-hidden="true">{x.tone === 'ok' ? '✓' : x.tone === 'warn' ? '!' : 'i'}</b><span>{x.t}</span></li>)}</ul>
      </section>
    </div>
  );
}

/**
 * Where the department's request for approval stands: a four-stop line (prepare, submit, review, approved), how long it
 * has been waiting, and the full trail of who did what and when, including the owner's comments when it came back.
 */
function ApprovalTracker({ status, history, submittedAt, deadline, revision }: { status: Status; history: HistoryEvent[]; submittedAt: string | null; deadline: string | null; revision: number }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [open, setOpen] = useState(false);
  const stage = status === 'approved' ? 3 : status === 'submitted' ? 2 : status === 'returned' ? 1 : status === 'draft' ? 1 : 0;
  const stops = [T('Prepare', 'الإعداد'), T('Submitted', 'التسليم'), T('Owner review', 'مراجعة المالك'), T('Approved', 'الاعتماد')];
  const waited = submittedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(submittedAt)) / 86400000)) : null;
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const label: Record<string, string> = {
    saved: T('Draft saved', 'حُفظت المسودة'), submitted: T('Submitted for approval', 'سُلّمت للاعتماد'), approved: T('Approved', 'اعتُمدت'),
    returned: T('Returned for changes', 'أُعيدت للتعديل'), revision_started: T('New revision started', 'بدأت مراجعة جديدة')
  };
  const role: Record<string, string> = { owner: T('owner', 'المالك'), finance: T('finance', 'المالية'), contributor: T('department head', 'مدير الإدارة'), viewer: T('viewer', 'مشاهد') };
  // consecutive draft saves are folded into one row so the trail stays readable
  const rows = history.filter((h, i) => !(h.action === 'saved' && history[i + 1]?.action === 'saved')).slice().reverse();
  const nowText = status === 'approved' ? T('Approved. It is part of the company budget.', 'معتمدة وأصبحت جزءًا من ميزانية الشركة.')
    : status === 'submitted' ? T(`Waiting for the owner${waited !== null ? ` · ${waited === 0 ? 'sent today' : waited === 1 ? '1 day' : waited + ' days'}` : ''}`, `بانتظار المالك${waited !== null ? ` · ${waited === 0 ? 'أُرسلت اليوم' : waited + ' يوم'}` : ''}`)
    : status === 'returned' ? T('Returned: read the comment, change, then submit again.', 'أُعيدت: اقرأ الملاحظة وعدّل ثم سلّم مجددًا.')
    : status === 'draft' ? T('Draft: submit when it is ready.', 'مسودة: سلّمها عندما تكون جاهزة.') : T('Not started yet.', 'لم تبدأ بعد.');
  return (
    <section className={'card at ' + status}>
      <div className="at-top">
        <div><h2>{T('Approval request', 'طلب الاعتماد')}{revision > 1 ? <span className="pill" style={{ marginInlineStart: 8 }}>{T('revision ', 'مراجعة ')}{revision}</span> : null}</h2>
          <p className="sub">{nowText}{deadline && status !== 'approved' ? ' · ' + T('due ', 'الموعد ') + date(deadline, lang, { day: 'numeric', month: 'long' }) : ''}</p></div>
        {rows.length > 0 && <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? T('Hide history', 'إخفاء السجل') : T(`History (${rows.length})`, `السجل (${rows.length})`)}</button>}
      </div>
      <ol className="at-line">{stops.map((x, i) => <li key={x} className={(i < stage ? 'done' : i === stage ? 'on' : '') + (status === 'returned' && i === 2 ? ' back' : '')}><i aria-hidden="true">{i < stage || (i === 3 && status === 'approved') ? '✓' : i + 1}</i><span>{x}</span></li>)}</ol>
      {open && <ul className="at-log">{rows.map((h, i) => (
        <li key={i} className={h.action}>
          <span className="at-dot" aria-hidden="true" />
          <div><b>{label[h.action] || h.action}</b>{h.revision ? <span className="sub"> · {T('revision ', 'مراجعة ')}{h.revision}</span> : null}
            <div className="sub">{when(h.at)}{h.by ? ` · ${h.by.name} (${role[h.by.role] || h.by.role})` : ''}{h.total ? ` · ${m(h.total)}` : ''}{h.lines ? ` · ${h.lines} ${T('lines', 'سطرًا')}` : ''}</div>
            {h.comment && <blockquote className="at-comment">{h.comment}</blockquote>}</div>
        </li>))}</ul>}
    </section>
  );
}

/** The department head's own view of the round: how full their cylinder is, what each step still needs, and the days left. */
function DeptHero({ status, deadline, readiness, tab, onTab }: { status: Status; deadline: string | null; readiness: { study: number; studyOf: number; vision: boolean; objectives: number; risks: number; lines: number }; tab: string; onTab: (t: 'study' | 'plan' | 'budget') => void }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const p = progressOf({ status, readiness }), H = 84, fill = Math.round(H * p);
  const days = deadline ? Math.ceil((new Date(deadline + 'T23:59:59').getTime() - Date.now()) / 86400000) : null;
  const steps: Array<{ k: 'study' | 'plan' | 'budget'; t: string; done: boolean; note: string }> = [
    { k: 'study', t: T('Study', 'الدراسة'), done: readiness.study >= 3, note: T(`${readiness.study} of 5 sections written`, `${readiness.study} من 5 أقسام مكتوبة`) },
    { k: 'plan', t: T('Plan', 'الخطة'), done: readiness.vision && readiness.objectives > 0, note: readiness.vision ? T(`${readiness.objectives} objectives, ${readiness.risks} risks`, `${readiness.objectives} أهداف، ${readiness.risks} مخاطر`) : T('Write the vision and objectives', 'اكتب الرؤية والأهداف') },
    { k: 'budget', t: T('Budget', 'الميزانية'), done: readiness.lines > 0, note: readiness.lines ? T(`${readiness.lines} lines entered`, `${readiness.lines} سطرًا مُدخلًا`) : T('Add the first line', 'أضف أول سطر') }
  ];
  const next = status === 'approved' ? T('Approved. It is part of the company budget.', 'معتمدة وأصبحت جزءًا من ميزانية الشركة.')
    : status === 'submitted' ? T('Submitted. Waiting for the owner to approve or return it.', 'مسلّمة. بانتظار اعتماد المالك أو إعادتها.')
    : steps.every((x) => x.done) ? T('All three steps have content: save and submit for approval below.', 'الخطوات الثلاث مكتملة: احفظ ثم سلّم للاعتماد أدناه.')
    : (() => { const k = steps.find((x) => !x.done)!.k; return k === 'study' ? T('Next: write at least three of the five study sections.', 'التالي: اكتب ثلاثة على الأقل من أقسام الدراسة الخمسة.') : k === 'plan' ? T('Next: write the vision and at least one objective with its KPI.', 'التالي: اكتب الرؤية وهدفًا واحدًا على الأقل مع مؤشره.') : T('Next: add your budget lines, month by month.', 'التالي: أضف بنود ميزانيتك شهرًا بشهر.'); })();
  return (
    <section className={'card dept-hero ' + status}>
      <svg viewBox="0 0 48 112" className="dept-cyl" aria-hidden="true">
        <rect x="17" y="2" width="14" height="8" rx="2" className="cyl-valve" />
        <rect x="6" y="12" width="36" height="96" rx="15" className="cyl-body" />
        <clipPath id="dh-cyl"><rect x="6" y="12" width="36" height="96" rx="15" /></clipPath>
        <rect x="6" y={108 - fill - 6} width="36" height={fill + 6} clipPath="url(#dh-cyl)" className="cyl-fill" />
      </svg>
      <div className="dept-hero-main">
        <div className="dept-hero-top"><b className="dept-pct">{Math.round(p * 100)}%</b>
          {days !== null && status !== 'approved' && <span className={'dept-days' + (days <= 3 ? ' soon' : '')}>{days > 1 ? T(`${days} days to submit`, `${days} يومًا للتسليم`) : days === 1 ? T('Due tomorrow', 'الموعد غدًا') : days === 0 ? T('Due today', 'الموعد اليوم') : T('Past the deadline', 'تجاوز الموعد')}</span>}</div>
        <p className="dept-next">{next}</p>
        <ol className="dept-steps">{steps.map((x, i) => <li key={x.k} className={(x.done ? 'done' : '') + (tab === x.k ? ' on' : '')}>
          <button type="button" onClick={() => onTab(x.k)}><span className="n" aria-hidden="true">{x.done ? '✓' : i + 1}</span><span><b>{x.t}</b><small>{x.note}</small></span></button></li>)}</ol>
      </div>
    </section>
  );
}

/** HR positions: grade and headcount, not named people. Each one becomes salary, GOSI, end of service, levy, iqama and medical lines. */
function Positions({ meta, n, months, positions, editable, onChange, generated }: { meta: Meta; n: number; months: string[]; positions: Position[]; editable: boolean; onChange: (p: Position[]) => void; generated: Line[] }) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const set = (i: number, patch: Partial<Position>) => onChange(positions.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () => onChange([...positions, { id: uid(), title: '', forDept: 'operations', region: meta.regions[0]?.id || '', saudi: false, headcount: 1, basic: 0, housing: 0, transport: 0, other: 0, from: 0, to: n - 1, eosbFullMonth: false }]);
  const num = (i: number, k: keyof Position, label: string, w = 92) => <td><NumInput width={w} label={label} disabled={!editable} value={positions[i][k] as number | undefined} onValue={(v) => set(i, { [k]: v === undefined ? (k === 'medicalAnnual' || k === 'ticketAnnual' ? undefined : 0) : v } as Partial<Position>)} /></td>;
  const itemName = (id: string) => txt(meta.pack.items.find((x) => x.id === id)?.name);
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Positions and headcount', 'الوظائف وأعداد الموظفين')}</h2>
      <p className="sub">{T('One row per role and city (not per person). HR prices the headcount of every department. The system adds GOSI, end of service, expat levy, iqama and medical insurance at the company rates.', 'صف لكل وظيفة ومدينة (وليس لكل شخص). تسعّر الموارد البشرية أعداد كل الإدارات، ويضيف النظام التأمينات ونهاية الخدمة والمقابل المالي والإقامة والتأمين الطبي حسب نسب الشركة.')}{!meta.params.confirmed && <b className="warn-t"> {T('Rates not yet confirmed by HR.', 'النسب لم تؤكدها الموارد البشرية بعد.')}</b>}</p>
      {positions.length > 0 && <div className="khz-scroll" style={{ marginTop: 12 }}>
        <table className="tbl bgt-pos"><thead><tr>
          <th>{T('Role or grade', 'الوظيفة أو الدرجة')}</th><th>{T('Works in', 'تعمل في')}</th><th>{T('City', 'المدينة')}</th><th>{T('Saudi', 'سعودي')}</th><th className="n">{T('Headcount', 'العدد')}</th>
          <th className="n">{T('Basic', 'الأساسي')}</th><th className="n">{T('Housing', 'السكن')}</th><th className="n">{T('Transport', 'النقل')}</th><th className="n">{T('Other', 'أخرى')}</th>
          <th>{T('From', 'من')}</th><th>{T('To', 'إلى')}</th><th className="n">{T('Medical a year', 'التأمين الطبي سنويًا')}</th><th className="n">{T('Tickets a year', 'التذاكر سنويًا')}</th><th>{T('Over 5 years', 'أكثر من 5 سنوات')}</th><th />
        </tr></thead>
          <tbody>{positions.map((p, i) => (
            <tr key={p.id}>
              <td><input style={{ width: 150 }} disabled={!editable} value={p.title} onChange={(e) => set(i, { title: e.target.value })} aria-label={T('Role', 'الوظيفة')} /></td>
              <td><select disabled={!editable} value={p.forDept} onChange={(e) => set(i, { forDept: e.target.value })}>{meta.pack.allDepartments.map((x) => <option key={x.id} value={x.id}>{txt(x.name)}</option>)}</select></td>
              <td><select disabled={!editable} value={p.region} onChange={(e) => set(i, { region: e.target.value })}>{meta.regions.map((r) => <option key={r.id} value={r.id}>{txt(r.name)}</option>)}</select></td>
              <td><input type="checkbox" disabled={!editable} checked={p.saudi} onChange={(e) => set(i, { saudi: e.target.checked })} aria-label={T('Saudi', 'سعودي')} /></td>
              {num(i, 'headcount', T('Headcount', 'العدد'), 64)}{num(i, 'basic', T('Basic', 'الأساسي'))}{num(i, 'housing', T('Housing', 'السكن'))}{num(i, 'transport', T('Transport', 'النقل'))}{num(i, 'other', T('Other', 'أخرى'))}
              <td><select disabled={!editable} value={p.from} onChange={(e) => set(i, { from: Number(e.target.value), to: Math.max(Number(e.target.value), p.to) })}>{months.map((k, j) => <option key={k} value={j}>{monthLabel(k, lang)}</option>)}</select></td>
              <td><select disabled={!editable} value={p.to} onChange={(e) => set(i, { to: Number(e.target.value) })}>{months.map((k, j) => j >= p.from && <option key={k} value={j}>{monthLabel(k, lang)}</option>)}</select></td>
              {num(i, 'medicalAnnual', T('Medical a year', 'التأمين الطبي'))}{num(i, 'ticketAnnual', T('Tickets a year', 'التذاكر'))}
              <td><input type="checkbox" disabled={!editable} checked={p.eosbFullMonth} onChange={(e) => set(i, { eosbFullMonth: e.target.checked })} aria-label={T('Over five years of service', 'أكثر من خمس سنوات خدمة')} /></td>
              <td>{editable && <button type="button" className="link danger" onClick={() => onChange(positions.filter((_, j) => j !== i))}>{T('Remove', 'حذف')}</button>}</td>
            </tr>))}</tbody></table>
      </div>}
      {editable && <div className="actions"><button type="button" className="btn ghost" onClick={add}>{T('+ Add a position', '+ إضافة وظيفة')}</button></div>}
      {generated.length > 0 && <>
        <h3 className="an-h3">{T('What the positions cost, a year', 'تكلفة الوظائف سنويًا')}</h3>
        <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Item', 'البند')}</th><th className="n">{T('A year', 'سنويًا')}</th><th className="n">{T('A month, on average', 'شهريًا في المتوسط')}</th></tr></thead><tbody>
          {['hr_salaries', 'hr_gosi', 'hr_eosb', 'hr_levy', 'hr_iqama', 'hr_medical', 'hr_tickets'].map((id) => { const tot = sum(generated.filter((l) => l.item === id).map((l) => sum(l.amounts))); return tot ? <tr key={id}><td>{itemName(id)}</td><td className="n num">{acc(tot)}</td><td className="n num">{acc(tot / n)}</td></tr> : null; })}
          <tr className="tot"><td><b>{T('Total people cost', 'إجمالي تكلفة الموظفين')}</b></td><td className="n num"><b>{acc(sum(generated.map((l) => sum(l.amounts))))}</b></td><td className="n num"><b>{acc(sum(generated.map((l) => sum(l.amounts))) / n)}</b></td></tr>
        </tbody></table></div>
      </>}
    </section>
  );
}

/** The department's budget by item and by city. */
function Summary({ meta, lines, months, regionName }: { meta: Meta; lines: Line[]; months: string[]; regionName: (id: string) => string }) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const byItem = new Map<string, number[]>(), byRegion = new Map<string, number>();
  for (const l of lines) {
    const a = byItem.get(l.item) || new Array(months.length).fill(0);
    l.amounts.forEach((v, k) => { a[k] += v; }); byItem.set(l.item, a);
    byRegion.set(l.region, (byRegion.get(l.region) || 0) + sum(l.amounts));
  }
  const kindOf = (id: string) => meta.pack.items.find((i) => i.id === id)?.kind;
  const rev = months.map((_, k) => sum(lines.filter((l) => kindOf(l.item) === 'revenue').map((l) => l.amounts[k])));
  const cost = months.map((_, k) => sum(lines.filter((l) => { const x = kindOf(l.item); return x !== 'revenue'; }).map((l) => l.amounts[k])));
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Summary', 'الملخص')}</h2>
      <MonthColumns months={months.map((k) => monthLabel(k, lang))} revenue={rev} costs={cost} labels={{ revenue: T('Revenue', 'الإيرادات'), costs: T('Costs and capex', 'التكاليف والرأسمالية') }} />
      <div className="ledger-wrap" style={{ marginTop: 12 }}><table className="ledger">
        <thead><tr><th className="lab">{T('Item', 'البند')}</th>{months.map((k) => <th key={k}>{monthLabel(k, lang)}</th>)}<th>{T('Total', 'الإجمالي')}</th></tr></thead>
        <tbody>{[...byItem.entries()].map(([id, a]) => { const it = meta.pack.items.find((x) => x.id === id); return <tr key={id}><td className="lab">{txt(it?.name)} <span className="sub">· {it ? txt(KIND_NAMES[it.kind]) : ''}</span></td>{a.map((v, k) => <td key={k}>{acc(v)}</td>)}<td><b>{acc(sum(a))}</b></td></tr>; })}</tbody>
      </table></div>
      <h3 className="an-h3">{T('By city', 'حسب المدينة')}</h3>
      <div className="bgt-cities">{[...byRegion.entries()].sort((a, b) => b[1] - a[1]).map(([r, v]) => <div key={r} className="an-kpi sm t-brand"><span className="l">{regionName(r)}</span><span className="v num">{m(v)}</span></div>)}</div>
    </section>
  );
}

// ---------------------------------------------------------------- the company budget
export function CompanyBudget() {
  const { cycle: cycleId = '' } = useParams();
  const s = useSession();
  const { lang, txt, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const nav = useNavigate();
  const { meta } = useBudgetMeta();
  const [preview, setPreview] = useState(false), [r, setR] = useState<{ cycle: Cycle; included: Array<{ department: string; status: string; revision: number }>; budget: Consolidated } | null>(null), [e, setE] = useState('');
  useEffect(() => { api('GET', `/api/budget/cycles/${cycleId}/consolidated${preview ? '?include=submitted' : ''}`).then(setR).catch((x) => setE(err(x.code))); }, [cycleId, preview, err]);
  if (e) return <p className="msg err">{e}</p>;
  if (!r || !meta) return <Loading />;
  const b = r.budget, keys = b.months;
  const dName = (id: string) => txt(meta.pack.allDepartments.find((x) => x.id === id)?.name);
  const rName = (id: string) => txt(meta.regions.find((x) => x.id === id)?.name) || id;
  const iName = (id: string) => txt(meta.pack.items.find((x) => x.id === id)?.name);
  const gp = keys.map((_, k) => b.total.revenue[k] - b.total.cogs[k]);
  const ebitda = keys.map((_, k) => gp[k] - b.total.opex[k] - b.ebitdaNoncash[k]);
  const after = keys.map((_, k) => ebitda[k] - b.total.capex[k] - b.total.financing[k]);
  const row = (label: string, a: number[], cls = '') => <tr className={cls}><td className="lab">{label}</td>{a.map((v, k) => <td key={k}>{acc(v)}</td>)}<td><b>{acc(sum(a))}</b></td></tr>;
  const csv = () => {
    const head = ['Department', 'Item', 'Kind', ...keys, 'Total'];
    const rows = b.byItem.map((x) => [dName(x.dept), iName(x.item), x.kind, ...x.amounts.map(String), String(x.total)]);
    const text = [head, ...rows].map((a) => a.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `company-budget-${r.cycle.name.replace(/\s+/g, '-')}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const missing = meta.pack.allDepartments.filter((d) => !r.included.some((x) => x.department === d.id));
  return (
    <div className="bgt">
      <div className="head">
        <div><span className="an-eyebrow">{r.cycle.name}</span><h1>{T('Company budget', 'ميزانية الشركة')}</h1>
          <p className="sub">{T('The approved budget of every department, added up. SAR, excluding VAT.', 'مجموع الميزانيات المعتمدة لكل الإدارات. بالريال وبدون ضريبة القيمة المضافة.')} {missing.length > 0 && <b className="warn-t">{T('Not yet included: ', 'لم تُضمَّن بعد: ')}{missing.map((d) => txt(d.name)).join(lang === 'ar' ? '، ' : ', ')}</b>}</p></div>
        <div className="pills">
          <label className="check"><input type="checkbox" checked={preview} onChange={(x) => setPreview(x.target.checked)} /> {T('Preview with budgets waiting for approval', 'معاينة مع الميزانيات بانتظار الاعتماد')}</label>
          <button type="button" className="btn ghost" onClick={csv}>{T('Download CSV', 'تنزيل CSV')}</button>
          <Link className="btn ghost" to={`/budget/${cycleId}/variance`}>{T('Budget vs actual', 'الميزانية مقابل الفعلي')}</Link>
          <button type="button" className="btn ghost" onClick={() => nav('/budget')}>{T('Departments', 'الإدارات')}</button>
        </div>
      </div>
      <div className="an-kpis">
        <div className="an-kpi t-rec"><span className="l">{T('Revenue', 'الإيرادات')}</span><span className="v num"><CountUp value={b.kpi.revenue} format={m} /></span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Gross profit', 'مجمل الربح')}</span><span className="v num"><CountUp value={b.kpi.grossProfit} format={m} /></span><span className="s">{b.kpi.revenue ? ((b.kpi.grossProfit / b.kpi.revenue) * 100).toFixed(1) + '%' : '–'}</span></div>
        <div className="an-kpi t-brand"><span className="l">EBITDA</span><span className="v num"><CountUp value={b.kpi.ebitda} format={m} /></span><span className="s">{b.kpi.revenue ? ((b.kpi.ebitda / b.kpi.revenue) * 100).toFixed(1) + '%' : '–'}</span></div>
        <div className="an-kpi t-pay"><span className="l">{T('Capex', 'النفقات الرأسمالية')}</span><span className="v num"><CountUp value={b.kpi.capex} format={m} /></span></div>
        <div className="an-kpi t-brand"><span className="l">{T('After capex and financing', 'بعد الرأسمالية والتمويل')}</span><span className="v num">{m(b.kpi.netAfterCapex)}</span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Saudi share of headcount', 'نسبة السعوديين')}</span><span className="v num">{b.kpi.saudiShare === null ? '–' : (b.kpi.saudiShare * 100).toFixed(1) + '%'}</span></div>
      </div>
      <div className="bgt-dash">
        <section className="card wide"><h2>{T('Revenue, costs and EBITDA by month', 'الإيرادات والتكاليف وEBITDA شهريًا')}</h2>
          <MonthColumns months={keys.map((k) => monthLabel(k, lang))} revenue={b.total.revenue} costs={keys.map((_, k) => b.total.cogs[k] + b.total.opex[k] + b.ebitdaNoncash[k])} line={ebitda}
            labels={{ revenue: T('Revenue', 'الإيرادات'), costs: T('Cost of sales and running costs', 'تكلفة المبيعات والمصاريف'), line: 'EBITDA' }} /></section>
        {sum(b.total.revenue) > 0 && <section className="card wide"><h2>{T('Where the revenue goes', 'أين تذهب الإيرادات')}</h2>
          <p className="sub">{T('Every riyal of budgeted revenue, followed to gas and cost of sales, to the running costs of each department, and to what is left as EBITDA. Hover a band.', 'كل ريال من الإيرادات المخططة حتى الغاز وتكلفة المبيعات ومصاريف كل إدارة وما يتبقى EBITDA. مرّر على أي مسار.')}</p>
          <MoneyFlow source={{ label: T('Revenue', 'الإيرادات'), value: sum(b.total.revenue) }} labels={{ share: T('of revenue', 'من الإيرادات') }}
            flows={[
              { id: 'cogs', label: T('Gas and cost of sales', 'الغاز وتكلفة المبيعات'), value: sum(b.total.cogs), color: 'var(--pay)' },
              ...meta.pack.allDepartments.map((d, i) => ({ id: d.id, label: txt(d.name), color: deptColor(i), value: (() => { const k = b.byDept[d.id]; return k ? sum(k.opex) + sum(k.noncash) : 0; })() })),
              { id: 'ebitda', label: 'EBITDA', value: Math.max(0, sum(b.total.revenue) - sum(b.total.cogs) - sum(b.total.opex) - sum(b.ebitdaNoncash)), color: 'var(--good)' }
            ]} /></section>}
        <section className="card"><h2>{T('Spending by department', 'الإنفاق حسب الإدارة')}</h2><p className="sub">{T('Costs and capex. Hover a slice for its share.', 'التكاليف والرأسمالية. مرّر على الجزء لرؤية نسبته.')}</p>
          <Donut center={(() => { const t = Object.values(b.byDept).reduce((a, k) => a + sum(k.cogs) + sum(k.opex) + sum(k.noncash) + sum(k.financing) + sum(k.capex), 0); return t >= 1e6 ? (t / 1e6).toFixed(1) + 'M' : Math.round(t / 1e3) + 'k'; })()} sub={T('SAR, whole round', 'ريال، الدورة كاملة')}
            parts={meta.pack.allDepartments.map((d, i) => ({ id: d.id, label: txt(d.name), color: deptColor(i), value: (() => { const k = b.byDept[d.id]; return k ? sum(k.cogs) + sum(k.opex) + sum(k.noncash) + sum(k.financing) + sum(k.capex) : 0; })() })).filter((p) => p.value > 0)} /></section>
        <section className="card"><h2>{T('Revenue and costs by city', 'الإيرادات والتكاليف حسب المدينة')}</h2>
          <HBars labels={{ a: T('Revenue', 'الإيرادات'), b: T('Costs', 'التكاليف') }} rows={Object.entries(b.byRegion).map(([c, v]) => ({ id: c, label: rName(c), a: sum(v.revenue), b: sum(v.costs) })).sort((x, y) => (y.a + (y.b || 0)) - (x.a + (x.b || 0)))} /></section>
      </div>
      <ScenarioStudio b={b} />
      <KeyRatios b={b} />
      <CompanyHeat b={b} keys={keys} dName={dName} iName={iName} />
      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Month by month', 'شهرًا بشهر')}</h2>
        <div className="ledger-wrap" style={{ marginTop: 12 }}><table className="ledger">
          <thead><tr><th className="lab" />{keys.map((k) => <th key={k}>{monthLabel(k, lang)}</th>)}<th>{T('Total', 'الإجمالي')}</th></tr></thead>
          <tbody>
            {row(txt(KIND_NAMES.revenue), b.total.revenue)}{row(txt(KIND_NAMES.cogs), b.total.cogs)}{row(T('Gross profit', 'مجمل الربح'), gp, 'tot')}
            {row(txt(KIND_NAMES.opex), b.total.opex)}{row(T('End of service (non-cash)', 'نهاية الخدمة (غير نقدي)'), b.ebitdaNoncash)}{row('EBITDA', ebitda, 'key')}
            {row(txt(KIND_NAMES.capex), b.total.capex)}{row(txt(KIND_NAMES.financing), b.total.financing)}{row(T('After capex and financing', 'بعد الرأسمالية والتمويل'), after, 'key')}
          </tbody></table></div>
      </section>
      <div className="bgt-two">
        <section className="card"><h2>{T('By department', 'حسب الإدارة')}</h2>
          <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Department', 'الإدارة')}</th><th className="n">{T('Revenue', 'الإيرادات')}</th><th className="n">{T('Costs', 'التكاليف')}</th><th className="n">{T('Capex', 'الرأسمالية')}</th></tr></thead>
            <tbody>{Object.entries(b.byDept).map(([d, k]) => <tr key={d}><td><Link className="link" to={`/budget/${cycleId}/${d}`}>{dName(d)}</Link> <span className="sub">{r.included.find((x) => x.department === d)?.status === 'submitted' ? T('(waiting)', '(بانتظار)') : ''}</span></td><td className="n num">{acc(sum(k.revenue))}</td><td className="n num">{acc(sum(k.cogs) + sum(k.opex) + sum(k.noncash) + sum(k.financing))}</td><td className="n num">{acc(sum(k.capex))}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card"><h2>{T('By city', 'حسب المدينة')}</h2>
          <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('City', 'المدينة')}</th><th className="n">{T('Revenue', 'الإيرادات')}</th><th className="n">{T('Costs', 'التكاليف')}</th><th className="n">{T('Margin', 'الهامش')}</th><th className="n">{T('Capex', 'الرأسمالية')}</th></tr></thead>
            <tbody>{Object.entries(b.byRegion).map(([c, v]) => <tr key={c}><td>{rName(c)}</td><td className="n num">{acc(sum(v.revenue))}</td><td className="n num">{acc(sum(v.costs))}</td><td className="n num">{acc(sum(v.revenue) - sum(v.costs))}</td><td className="n num">{acc(sum(v.capex))}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      <div className="bgt-two">
        <section className="card"><h2>{T('Largest items', 'أكبر البنود')}</h2>
          <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Item', 'البند')}</th><th>{T('Department', 'الإدارة')}</th><th className="n">{T('Total', 'الإجمالي')}</th></tr></thead>
            <tbody>{b.byItem.slice(0, 15).map((x) => <tr key={x.item}><td>{iName(x.item)} <span className="sub">· {txt(KIND_NAMES[x.kind])}</span></td><td>{dName(x.dept)}</td><td className="n num">{acc(x.total)}</td></tr>)}</tbody></table></div>
        </section>
        <section className="card"><h2>{T('Headcount', 'أعداد الموظفين')}</h2>
          {b.headcount.length === 0 ? <p className="empty">{T('No approved HR positions yet.', 'لا توجد وظائف معتمدة بعد.')}</p> :
            <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Works in', 'تعمل في')}</th><th>{T('City', 'المدينة')}</th><th className="n">{T('Saudi', 'سعودي')}</th><th className="n">{T('Non-Saudi', 'غير سعودي')}</th></tr></thead>
              <tbody>{b.headcount.map((h) => <tr key={h.forDept + h.region}><td>{dName(h.forDept)}</td><td>{rName(h.region)}</td><td className="n num">{h.saudi}</td><td className="n num">{h.nonSaudi}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      {s.me.role === 'owner' && !preview && <ToCashPlan cycleId={cycleId} startMonth={r.cycle.startMonth} approvedCount={r.included.filter((x) => x.status === 'approved').length} />}
    </div>
  );
}

/** The owner's comparison of departments: how much each asks for, how far along each is, and the share of the total. */
function DeptGlance({ departments }: { departments: any[] }) {
  const { lang, txt } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const rows = departments.map((d, i) => ({ id: d.department, name: txt(d.name), costs: d.totals?.costs || 0, capex: d.totals?.capex || 0, revenue: d.totals?.revenue || 0, status: d.status as Status, p: progressOf(d), color: deptColor(i) }));
  const spend = rows.map((r) => r.costs + r.capex), total = sum(spend), max = Math.max(1, ...spend);
  const approved = rows.filter((r) => r.status === 'approved').length, waiting = rows.filter((r) => r.status === 'submitted').length;
  const revenue = sum(rows.map((r) => r.revenue));
  if (!rows.length) return null;
  return (
    <div className="dg">
      <div className="an-kpis sm" style={{ marginTop: 14 }}>
        <div className="an-kpi sm t-brand"><span className="l">{T('Approved', 'معتمدة')}</span><span className="v num">{approved} / {rows.length}</span></div>
        <div className="an-kpi sm t-brand"><span className="l">{T('Waiting for you', 'بانتظارك')}</span><span className="v num">{waiting}</span></div>
        <div className="an-kpi sm t-pay"><span className="l">{T('Costs and capex asked', 'التكاليف والرأسمالية المطلوبة')}</span><span className="v num">{m(total)}</span></div>
        {revenue > 0 && <div className="an-kpi sm t-rec"><span className="l">{T('Revenue planned', 'الإيرادات المخططة')}</span><span className="v num">{m(revenue)}</span><span className="s">{T('cost to revenue ', 'التكلفة إلى الإيراد ')}{revenue ? Math.round((total / revenue) * 100) : 0}%</span></div>}
      </div>
      <ul className="dg-rows">{rows.map((r, i) => (
        <li key={r.id} style={{ animationDelay: i * 45 + 'ms' }}>
          <span className="dg-name"><i style={{ background: r.color }} />{r.name}</span>
          <span className="dg-bar"><i style={{ width: (spend[i] / max) * 100 + '%', background: r.color }} /></span>
          <b className="num">{m(spend[i])}</b>
          <span className="dg-share sub">{total ? Math.round((spend[i] / total) * 100) : 0}%</span>
          <span className={'dg-prog ' + r.status}><i style={{ width: Math.round(r.p * 100) + '%' }} /><em>{Math.round(r.p * 100)}%</em></span>
        </li>))}</ul>
      <p className="sub" style={{ marginTop: 6 }}>{T('Bar: costs and capex asked by each department. Right: how far along it is.', 'الشريط: التكاليف والرأسمالية المطلوبة لكل إدارة. يمين: مدى تقدمها.')}</p>
    </div>
  );
}

/**
 * The owner's company view: spending by department and month as a heat map (darker = more), the ten biggest items,
 * and the company budget against the bank history item by item.
 */
function CompanyHeat({ b, keys, dName, iName }: { b: Consolidated; keys: string[]; dName: (id: string) => string; iName: (id: string) => string }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta } = useBudgetMeta();
  const [tip, setTip] = useState<string | null>(null);
  const spendOf = (k: Consolidated['byDept'][string], i: number) => k.cogs[i] + k.opex[i] + k.noncash[i] + k.financing[i] + k.capex[i];
  const depts = Object.entries(b.byDept).map(([id, k]) => ({ id, name: dName(id), cells: keys.map((_, i) => spendOf(k, i)) })).filter((d) => sum(d.cells) > 0).sort((a, c) => sum(c.cells) - sum(a.cells));
  const max = Math.max(1, ...depts.flatMap((d) => d.cells));
  const top = [...b.byItem].filter((x) => x.kind !== 'revenue').sort((a, c) => c.total - a.total).slice(0, 10);
  const topMax = Math.max(1, ...top.map((x) => x.total));
  const guide = meta?.guidance?.items || {};
  const vs = b.byItem.filter((x) => guide[x.item]).map((x) => ({ id: x.item, label: iName(x.item), a: x.total / keys.length, b: guide[x.item] })).sort((a, c) => c.b - a.b).slice(0, 12);
  if (!depts.length) return null;
  return (
    <>
      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Spending heat map: department by month', 'خريطة الإنفاق: الإدارة حسب الشهر')}</h2>
        <p className="sub">{T('Costs and capex. Darker cells spend more; hover a cell for the amount. Peaks show where cash will be needed.', 'التكاليف والرأسمالية. الخلايا الأغمق تنفق أكثر؛ مرّر على الخلية لرؤية المبلغ. القمم تُظهر متى سيلزم النقد.')}</p>
        <div className="hm-wrap"><table className="hm">
          <thead><tr><th />{keys.map((k) => <th key={k}>{monthLabel(k, lang)}</th>)}<th>{T('Total', 'الإجمالي')}</th></tr></thead>
          <tbody>{depts.map((d, r) => <tr key={d.id}><th>{d.name}</th>{d.cells.map((v, i) => {
            const a = v / max, id = d.id + i;
            return <td key={i} onMouseEnter={() => setTip(id)} onMouseLeave={() => setTip(null)} style={{ background: `color-mix(in oklab, var(--brand) ${Math.round(8 + a * 80)}%, var(--surface))`, color: a > 0.55 ? '#fff' : 'var(--ink)', animationDelay: (r * keys.length + i) * 8 + 'ms' }} title={`${d.name} · ${monthLabel(keys[i], lang)} · ${acc(v)}`}>{tip === id ? acc(v) : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : v ? Math.round(v) : ''}</td>;
          })}<td className="hm-tot num">{m(sum(d.cells))}</td></tr>)}</tbody>
        </table></div>
      </section>
      <div className="bgt-two">
        <section className="card"><h2>{T('The ten biggest items', 'أكبر عشرة بنود')}</h2>
          <ul className="mx">{top.map((x, i) => <li key={x.dept + x.item} style={{ animationDelay: i * 40 + 'ms' }}><div className="mx-top"><span>{iName(x.item)} <span className="sub">· {dName(x.dept)}</span></span><b className="num">{m(x.total)}</b></div>
            <div className="mx-bar"><i style={{ width: (x.total / topMax) * 100 + '%', background: 'var(--pay)' }} /></div></li>)}</ul></section>
        {vs.length > 0 && <section className="card"><h2>{T('Company budget against history', 'ميزانية الشركة مقابل التاريخ')}</h2>
          <p className="sub">{T('Average a month in the budget next to the bank history, for every item that has history.', 'المتوسط الشهري في الميزانية بجانب تاريخ البنك لكل بند له تاريخ.')}</p>
          <HBars rows={vs} labels={{ a: T('Budget a month', 'الميزانية شهريًا'), b: T('Bank history a month', 'التاريخ شهريًا') }} /></section>}
      </div>
    </>
  );
}

/**
 * Scenario studio: move sales volume, selling price, gas cost, payroll and other running costs, and see revenue,
 * gross profit and EBITDA against the approved budget at once. Goal seek works backward from a target EBITDA margin
 * to the sales volume it needs, holding everything else as set.
 */
function ScenarioStudio({ b }: { b: Consolidated }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta } = useBudgetMeta();
  const [v, setV] = useState({ volume: 0, price: 0, gas: 0, payroll: 0, other: 0 });
  // starts one point above the budget's own EBITDA margin, so the first answer is a useful one
  const [target, setTarget] = useState(() => { const r = sum(b.total.revenue); return r ? Math.round(((b.kpi.ebitda / r) * 100 + 1) * 2) / 2 : 10; });
  const item = (id: string) => meta?.pack.items.find((x) => x.id === id);
  const isPayroll = (id: string) => ['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS'].includes(item(id)?.cash || '') || id.startsWith('hr_');
  const rev = sum(b.total.revenue), gas = sum(b.byItem.filter((x) => x.item === 'pr_gas').map((x) => x.total));
  const otherCogs = sum(b.total.cogs) - gas;
  const payroll = sum(b.byItem.filter((x) => x.kind === 'opex' && isPayroll(x.item)).map((x) => x.total));
  const opexOther = sum(b.total.opex) - payroll, nonc = sum(b.ebitdaNoncash);
  const calc = (s: typeof v) => {
    const vol = 1 + s.volume / 100, R = rev * vol * (1 + s.price / 100);
    // gas and other cost of sales move with volume; gas also with its price
    const C = gas * vol * (1 + s.gas / 100) + otherCogs * vol;
    const O = payroll * (1 + s.payroll / 100) + opexOther * (1 + s.other / 100) + nonc;
    return { R, GP: R - C, E: R - C - O };
  };
  const base = calc({ volume: 0, price: 0, gas: 0, payroll: 0, other: 0 }), sc = calc(v);
  // goal seek: sales volume change that reaches the target EBITDA margin (bisection on -50%..+100%)
  const seek = (() => {
    const f = (x: number) => { const r = calc({ ...v, volume: x }); return r.R ? r.E / r.R - target / 100 : -1; };
    let lo = -50, hi = 100; if (f(lo) * f(hi) > 0) return null;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  })();
  if (!rev) return null;
  const sliders: Array<[keyof typeof v, string, number, number]> = [
    ['volume', T('Sales volume', 'حجم المبيعات'), -30, 30], ['price', T('Selling price', 'سعر البيع'), -15, 15], ['gas', T('Gas purchase price', 'سعر شراء الغاز'), -15, 25],
    ['payroll', T('Payroll', 'الرواتب'), -20, 30], ['other', T('Other running costs', 'المصاريف الأخرى'), -30, 30]
  ];
  const bars = [
    { l: T('Revenue', 'الإيرادات'), a: base.R, b: sc.R }, { l: T('Gross profit', 'مجمل الربح'), a: base.GP, b: sc.GP }, { l: 'EBITDA', a: base.E, b: sc.E }
  ];
  const mx = Math.max(1, ...bars.flatMap((x) => [Math.abs(x.a), Math.abs(x.b)]));
  return (
    <section className="card sc" style={{ marginTop: 20 }}>
      <div className="dr-head" style={{ marginTop: 0 }}><div><h2>{T('Scenario studio', 'استوديو السيناريوهات')}</h2>
        <p className="sub">{T('Move a driver and watch the year change against the approved budget. Volume moves gas and cost of sales with it.', 'حرّك أي محرك وشاهد تغير السنة مقابل الميزانية المعتمدة. الحجم يحرك الغاز وتكلفة المبيعات معه.')}</p></div>
        <button type="button" className="btn ghost" onClick={() => setV({ volume: 0, price: 0, gas: 0, payroll: 0, other: 0 })}>{T('Back to budget', 'العودة للميزانية')}</button></div>
      <div className="sc-grid">
        <div className="sc-sliders">{sliders.map(([k, l, lo, hi]) => (
          <label key={k} className="sc-sl"><span>{l}<b className={'num ' + (v[k] > 0 ? 'up' : v[k] < 0 ? 'down' : '')}>{v[k] > 0 ? '+' : ''}{v[k]}%</b></span>
            <input type="range" min={lo} max={hi} step={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></label>))}
          <div className="sc-presets">
            <button type="button" className="pill" onClick={() => setV({ volume: -10, price: 0, gas: 8, payroll: 5, other: 5 })}>{T('Bad year', 'سنة صعبة')}</button>
            <button type="button" className="pill" onClick={() => setV({ volume: 0, price: 0, gas: 0, payroll: 0, other: 0 })}>{T('Budget', 'الميزانية')}</button>
            <button type="button" className="pill" onClick={() => setV({ volume: 10, price: 2, gas: -3, payroll: 3, other: 0 })}>{T('Good year', 'سنة جيدة')}</button>
          </div>
        </div>
        <div className="sc-out">
          {bars.map((x) => <div key={x.l} className="sc-row"><span>{x.l}</span>
            <span className="sc-bars"><i className="a" style={{ width: (Math.max(0, x.a) / mx) * 100 + '%' }} /><i className="b" style={{ width: (Math.max(0, x.b) / mx) * 100 + '%' }} /></span>
            <b className="num">{m(x.b)}</b><span className={'num sc-d ' + (x.b - x.a >= 0 ? 'up' : 'down')}>{x.b - x.a >= 0 ? '+' : '−'}{m(Math.abs(x.b - x.a))}</span></div>)}
          <div className="legend"><span><i style={{ background: 'var(--ink2)' }} />{T('Budget', 'الميزانية')}</span><span><i style={{ background: 'var(--brand)' }} />{T('Scenario', 'السيناريو')}</span></div>
          <p className="sc-margin">{T('EBITDA margin ', 'هامش EBITDA ')}<b className="num">{base.R ? ((base.E / base.R) * 100).toFixed(1) : '0'}%</b> → <b className="num">{sc.R ? ((sc.E / sc.R) * 100).toFixed(1) : '0'}%</b></p>
          <div className="sc-seek"><label>{T('Goal seek: target EBITDA margin', 'البحث عن الهدف: هامش EBITDA المستهدف')} <input type="number" step={0.5} value={target} onChange={(e) => setTarget(Number(e.target.value) || 0)} />%</label>
            <p>{seek === null ? T('Not reachable by volume alone at these settings: change price or costs.', 'لا يمكن بلوغه بالحجم وحده بهذه الإعدادات: غيّر السعر أو التكاليف.')
              : T(`Needs sales volume ${seek >= 0 ? '+' : ''}${seek.toFixed(1)}% against budget (revenue ${m(calc({ ...v, volume: seek }).R)}).`, `يحتاج حجم مبيعات ${seek >= 0 ? '+' : ''}${seek.toFixed(1)}% مقابل الميزانية (إيرادات ${m(calc({ ...v, volume: seek }).R)}).`)}</p></div>
        </div>
      </div>
    </section>
  );
}

/** The ratios a finance director reads first, from the budget, each against a typical range for a gas distributor. */
function KeyRatios({ b }: { b: Consolidated }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta } = useBudgetMeta();
  const item = (id: string) => meta?.pack.items.find((x) => x.id === id);
  const byCash = (codes: string[]) => sum(b.byItem.filter((x) => x.kind !== 'revenue' && codes.includes(item(x.item)?.cash || '')).map((x) => x.total));
  const R = sum(b.total.revenue);
  if (!R) return null;
  const pct = (x: number) => (x / R) * 100;
  const rows = [
    { l: T('Gross margin', 'هامش الربح الإجمالي'), v: pct(R - sum(b.total.cogs)), lo: 8, hi: 25, good: 'high' },
    { l: T('EBITDA margin', 'هامش EBITDA'), v: pct(b.kpi.ebitda), lo: 3, hi: 12, good: 'high' },
    { l: T('Gas cost to revenue', 'تكلفة الغاز إلى الإيرادات'), v: pct(sum(b.byItem.filter((x) => x.item === 'pr_gas').map((x) => x.total))), lo: 75, hi: 92, good: 'low' },
    { l: T('Payroll to revenue', 'الرواتب إلى الإيرادات'), v: pct(byCash(['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS'])), lo: 2, hi: 6, good: 'low' },
    { l: T('Rent to revenue', 'الإيجارات إلى الإيرادات'), v: pct(byCash(['P_RENT'])), lo: 0.5, hi: 3, good: 'low' },
    { l: T('Fleet and fuel to revenue', 'الأسطول والوقود إلى الإيرادات'), v: pct(byCash(['P_DIESEL', 'P_STAFF'])), lo: 0.5, hi: 3, good: 'low' },
    { l: T('Running costs to revenue', 'المصاريف التشغيلية إلى الإيرادات'), v: pct(sum(b.total.opex)), lo: 4, hi: 12, good: 'low' },
    { l: T('Capex to revenue', 'الرأسمالية إلى الإيرادات'), v: pct(sum(b.total.capex)), lo: 0.5, hi: 4, good: 'mid' }
  ];
  return (
    <section className="card kr" style={{ marginTop: 20 }}>
      <h2>{T('Key ratios', 'النسب الرئيسية')}</h2>
      <p className="sub">{T('From the budget, against a typical range for a Saudi gas distributor (shaded). Outside the range is worth a question, not automatically wrong.', 'من الميزانية مقابل النطاق المعتاد لموزع غاز في السعودية (المظلل). الخروج عن النطاق يستحق سؤالًا وليس خطأً بالضرورة.')}</p>
      <ul className="kr-list">{rows.map((r) => {
        const top = Math.max(r.hi * 1.6, r.v * 1.1, 1), pos = Math.min(100, (r.v / top) * 100), inR = r.v >= r.lo && r.v <= r.hi;
        return <li key={r.l}><span className="kr-l">{r.l}</span>
          <span className="kr-track"><i className="kr-band" style={{ insetInlineStart: (r.lo / top) * 100 + '%', width: ((r.hi - r.lo) / top) * 100 + '%' }} /><i className={'kr-dot ' + (inR ? 'ok' : 'off')} style={{ insetInlineStart: `calc(${pos}% - 7px)` }} /></span>
          <b className={'num ' + (inR ? '' : 'warn-t')}>{r.v.toFixed(1)}%</b><span className="sub kr-r">{r.lo}–{r.hi}%</span></li>;
      })}</ul>
    </section>
  );
}

/** A short guide for the department head: what to do, in order, and what the owner looks for. Open on a first visit. */
function HowTo({ first }: { first: boolean }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [open, setOpen] = useState(first);
  const steps: Array<[string, string]> = [
    [T('Study', 'الدراسة'), T('Write at least three of the five sections: where you are today, what changes next year, risks. The owner reads this before the numbers.', 'اكتب ثلاثة على الأقل من الأقسام الخمسة: أين أنت اليوم وما الذي سيتغير العام القادم والمخاطر. يقرؤها المالك قبل الأرقام.')],
    [T('Plan', 'الخطة'), T('Set the vision and at least one objective with a KPI and a target, for example "cut fuel per trip 5%".', 'حدد الرؤية وهدفًا واحدًا على الأقل مع مؤشر ومستهدف، مثل "خفض الوقود لكل رحلة 5%".')],
    [T('Budget', 'الميزانية'), T('Press "Start from guidance" to begin from the bank history, then change each line. Choose Whole company or a city; use "Split across cities" when each city differs. Add missing items from "+ Add a line".', 'اضغط "ابدأ من الإرشاد" للبدء من تاريخ البنك ثم عدّل كل سطر. اختر الشركة كاملة أو مدينة؛ واستخدم "وزّع على المدن" عند اختلاف المدن. أضف البنود الناقصة من "+ إضافة سطر".')],
    [T('Check the report', 'راجع التقرير'), T('Open Report: every item more than 10% away from history is flagged. Explain each one in the study.', 'افتح التقرير: كل بند يبتعد أكثر من 10% عن التاريخ مُعلَّم. اشرح كل واحد في الدراسة.')],
    [T('Submit', 'التسليم'), T('Save, then "Submit for approval". Follow it in "Approval request" above; if it comes back, read the comment, change and submit again.', 'احفظ ثم "تسليم للاعتماد". تابعه في "طلب الاعتماد"؛ وإن أُعيد اقرأ الملاحظة وعدّل وسلّم مجددًا.')]
  ];
  return (
    <section className="card howto" style={{ marginTop: 16 }}>
      <button type="button" className="howto-h" onClick={() => setOpen(!open)} aria-expanded={open}><b>{T('How to prepare your budget', 'كيف تعدّ ميزانيتك')}</b><span>{open ? '−' : '+'}</span></button>
      {open && <ol className="howto-steps">{steps.map(([h, b], i) => <li key={i}><i>{i + 1}</i><div><b>{h}</b><p>{b}</p></div></li>)}
        <li className="tip"><i>✓</i><div><b>{T('Amounts', 'المبالغ')}</b><p>{T('SAR a month, excluding VAT. Only your own department is visible to you.', 'بالريال شهريًا وبدون ضريبة. لا ترى إلا إدارتك.')}</p></div></li></ol>}
    </section>
  );
}
