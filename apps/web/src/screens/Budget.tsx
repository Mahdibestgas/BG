import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { KIND_NAMES, positionLines, type Consolidated, type HrParams, type Item, type Kind, type Line, type Position, type Txt } from '@cf13/budget';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';
import { EMPTY_PLAN, EMPTY_STUDY, type DeptPlan, type Study } from '@cf13/budget';
import { PlanEditor, StudyEditor, ToCashPlan } from './BudgetCycle';

// ---------------------------------------------------------------- shared
export interface Cycle { id: string; name: string; startMonth: string; months: number; monthKeys: string[]; status: 'open' | 'closed'; deadline: string | null; version: number }
interface Meta {
  you: { role: string; department: string | null };
  pack: { id: string; name: Txt; departments: Array<{ id: string; name: Txt; covers: Txt }>; allDepartments: Array<{ id: string; name: Txt }>; items: Item[] };
  regions: Array<{ id: string; name: Txt }>; params: HrParams; settingsVersion: number; cycles: Cycle[];
}
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
    value={text ?? (value === undefined ? '' : String(value))}
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
  if (!meta) return <p className="sub">…</p>;
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

      {owner && <NewCycle onDone={(id) => { reload(); setCycleId(id); }} />}
      {owner && <Settings meta={meta} onDone={() => { reload(); setMsg({ ok: true, t: T('Settings saved.', 'تم حفظ الإعدادات.') }); }} />}
      {owner && <p className="sub" style={{ marginTop: 18 }}>{T('Department heads join by invitation: ', 'ينضم مديرو الإدارات بدعوة: ')}<Link className="link" to="/people">{T('People and invitations', 'الفريق والدعوات')}</Link></p>}
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
interface DeptData { cycle: Cycle & { monthKeys: string[] }; department: string; submission: null | { id: string; revision: number; status: Status; version: number; body: { lines: Line[]; positions: Position[]; study?: Study; plan?: DeptPlan }; reviewComment: string | null; submittedAt: string | null; updatedAt: string }; approvedRevision: number | null; revisions: Array<{ revision: number; status: Status }> }

export function DeptBudget() {
  const { cycle: cycleId = '', dept = '' } = useParams();
  const s = useSession();
  const { lang, txt, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { meta } = useBudgetMeta();
  const [d, setD] = useState<DeptData | null>(null), [lines, setLines] = useState<Line[]>([]), [positions, setPositions] = useState<Position[]>([]);
  const [study, setStudy] = useState<Study>(EMPTY_STUDY), [plan, setPlan] = useState<DeptPlan>(EMPTY_PLAN), [tab, setTab] = useState<'study' | 'plan' | 'budget'>('study');
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [comment, setComment] = useState('');
  const load = useCallback(() => api<DeptData>('GET', `/api/budget/cycles/${cycleId}/departments/${dept}`).then((r) => {
    setD(r); setLines((r.submission?.body.lines || []).filter((l) => !l.posId)); setPositions(r.submission?.body.positions || []); setStudy({ ...EMPTY_STUDY, ...(r.submission?.body.study || {}) }); setPlan({ ...EMPTY_PLAN, ...(r.submission?.body.plan || {}) }); setDirty(false);
  }).catch((e) => setMsg({ ok: false, t: err(e instanceof ApiError ? e.code : 'network') })), [cycleId, dept, err]);
  useEffect(() => { load(); }, [load]);

  const n = d?.cycle.monthKeys.length || 0;
  const items = useMemo(() => (meta ? meta.pack.items.filter((i) => i.dept === dept) : []), [meta, dept]);
  const liveGenerated = useMemo(() => (meta ? positions.flatMap((p) => positionLines(p, n, meta.params)) : []), [positions, meta, n]);
  if (!d || !meta) return msg ? <p className="msg err">{msg.t}</p> : <p className="sub">…</p>;

  const depName = meta.pack.allDepartments.find((x) => x.id === dept)?.name;
  const status: Status = d.submission?.status || 'not_started';
  const editable = d.cycle.status === 'open' && (status === 'not_started' || status === 'draft' || status === 'returned') && s.me.role !== 'viewer';
  const isOwner = s.me.role === 'owner', canReturn = isOwner || s.me.role === 'finance';
  // a locked budget shows the HR lines as they were saved, never redrawn from today's rates
  const generated = editable ? liveGenerated : (d.submission?.body.lines || []).filter((l) => l.posId);
  const itemOf = (id: string) => meta.pack.items.find((i) => i.id === id);
  const regionName = (id: string) => txt(meta.regions.find((r) => r.id === id)?.name) || id;
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
  const addLine = (item: string) => { setLines([...lines, { id: uid(), item, region: meta.regions[0]?.id || '', desc: '', amounts: new Array(n).fill(0) }]); touch(); };
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
      {status === 'returned' && d.submission?.reviewComment && <div className="demo" role="note"><b>{T('Returned for changes: ', 'أعيدت للتعديل: ')}</b>{d.submission.reviewComment}</div>}

      <div className="an-kpis sm">
        {dept === 'sales' ? <div className="an-kpi sm t-rec"><span className="l">{T('Revenue', 'الإيرادات')}</span><span className="v num">{m(byKind('revenue'))}</span></div> : null}
        <div className="an-kpi sm t-pay"><span className="l">{T('Costs', 'التكاليف')}</span><span className="v num">{m(byKind('cogs') + byKind('opex') + byKind('noncash') + byKind('financing'))}</span></div>
        <div className="an-kpi sm t-brand"><span className="l">{T('Capex', 'النفقات الرأسمالية')}</span><span className="v num">{m(byKind('capex'))}</span></div>
        {dept === 'hr' && <div className="an-kpi sm t-brand"><span className="l">{T('Headcount', 'عدد الموظفين')}</span><span className="v num">{positions.reduce((t, p) => t + p.headcount, 0)}</span><span className="s">{T('Saudi ', 'سعودي ')}{positions.filter((p) => p.saudi).reduce((t, p) => t + p.headcount, 0)}</span></div>}
        <div className="an-kpi sm t-brand"><span className="l">{T('Lines', 'الأسطر')}</span><span className="v num">{all.length}</span></div>
      </div>

      <div className="seg bgt-tabs" role="tablist" aria-label={T('Steps', 'الخطوات')}>
        {([['study', T('1 · Study', '1 · الدراسة')], ['plan', T('2 · Plan', '2 · الخطة')], ['budget', T('3 · Budget', '3 · الميزانية')]] as Array<['study' | 'plan' | 'budget', string]>).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'study' && <StudyEditor study={study} editable={editable} onChange={(x) => { setStudy(x); touch(); }} />}
      {tab === 'plan' && <PlanEditor plan={plan} months={d.cycle.monthKeys} editable={editable} onChange={(x) => { setPlan(x); touch(); }} />}
      {tab === 'budget' && dept === 'hr' && <Positions meta={meta} n={n} months={d.cycle.monthKeys} positions={positions} editable={editable} onChange={(p) => { setPositions(p); touch(); }} generated={generated} />}

      {tab === 'budget' && <section className="card" style={{ marginTop: 20 }}>
        <h2>{dept === 'hr' ? T('Other HR lines', 'بنود الموارد البشرية الأخرى') : T('Budget lines', 'بنود الميزانية')}</h2>
        <p className="sub">{T('One line per item and city. Use quantity × price where the item has a unit (cylinders, litres, vehicles).', 'سطر لكل بند ومدينة. استخدم الكمية × السعر للبنود التي لها وحدة (أسطوانات، لترات، مركبات).')}</p>
        {lines.length === 0 && <p className="empty" style={{ marginTop: 12 }}>{T('No lines yet. Add the first item below.', 'لا توجد أسطر بعد. أضف أول بند أدناه.')}</p>}
        {lines.length > 0 && (
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
                          <select disabled={!editable} value={l.region} onChange={(e) => setLine(i, (x) => ({ ...x, region: e.target.value }))} aria-label={T('City', 'المدينة')}>{meta.regions.map((r) => <option key={r.id} value={r.id}>{txt(r.name)}</option>)}</select>
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
    </div>
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
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Summary', 'الملخص')}</h2>
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
  if (!r || !meta) return <p className="sub">…</p>;
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
        <div className="an-kpi t-rec"><span className="l">{T('Revenue', 'الإيرادات')}</span><span className="v num">{m(b.kpi.revenue)}</span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Gross profit', 'مجمل الربح')}</span><span className="v num">{m(b.kpi.grossProfit)}</span><span className="s">{b.kpi.revenue ? ((b.kpi.grossProfit / b.kpi.revenue) * 100).toFixed(1) + '%' : '–'}</span></div>
        <div className="an-kpi t-brand"><span className="l">EBITDA</span><span className="v num">{m(b.kpi.ebitda)}</span><span className="s">{b.kpi.revenue ? ((b.kpi.ebitda / b.kpi.revenue) * 100).toFixed(1) + '%' : '–'}</span></div>
        <div className="an-kpi t-pay"><span className="l">{T('Capex', 'النفقات الرأسمالية')}</span><span className="v num">{m(b.kpi.capex)}</span></div>
        <div className="an-kpi t-brand"><span className="l">{T('After capex and financing', 'بعد الرأسمالية والتمويل')}</span><span className="v num">{m(b.kpi.netAfterCapex)}</span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Saudi share of headcount', 'نسبة السعوديين')}</span><span className="v num">{b.kpi.saudiShare === null ? '–' : (b.kpi.saudiShare * 100).toFixed(1) + '%'}</span></div>
      </div>
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
