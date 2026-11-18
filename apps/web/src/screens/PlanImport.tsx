import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { m } from '../format';

/** Upload a plan file (bestgas_plan_*.json from the bank pipeline). The server runs it and saves it only if every check passes. */
export function PlanImport() {
  const s = useSession();
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const nav = useNavigate();
  const [file, setFile] = useState<{ name: string; model: any } | null>(null), [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [hideDemo, setHideDemo] = useState(true), [done, setDone] = useState<string | null>(null);
  async function pick(f: File | undefined) {
    setMsg(null); setFile(null); setDone(null);
    if (!f) return;
    if (f.size > 900_000) { setMsg({ ok: false, t: T('The file is too large (900 KB at most).', 'الملف كبير جدًا (900 كيلوبايت كحد أقصى).') }); return; }
    try { const model = JSON.parse(await f.text()); if (!model?.meta || !model?.template) throw new Error(); setFile({ name: f.name, model }); }
    catch { setMsg({ ok: false, t: T('This is not a plan file.', 'هذا ليس ملف خطة.') }); }
  }
  async function load() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ planId: string; name: string; weeks: number; closing: number; hiddenDemo: number; version: number }>('POST', '/api/plans/import', { model: file.model, hideDemo });
      try { localStorage.setItem('cf13_plan:' + s.tenant.id, r.planId); } catch { /* private mode */ }
      await s.reload();
      setDone(r.planId);
      setMsg({ ok: true, t: T(`Loaded "${r.name}" (version ${r.version}): ${r.weeks} weeks, closing cash ${m(r.closing)}.`, `حُمّلت "${r.name}" (النسخة ${r.version}): ${r.weeks} أسبوعًا، والنقد الختامي ${m(r.closing)}.`) + (r.hiddenDemo ? T(' The demo plan is hidden.', ' أُخفيت الخطة التجريبية.') : '') });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      setMsg({ ok: false, t: code.startsWith('plan_checks_failed') ? T('The plan failed its checks, so nothing was saved: ', 'فشلت فحوص الخطة ولم يُحفظ شيء: ') + code.split(':')[1] : code.startsWith('invalid_plan_file') ? T('The file could not be read as a plan.', 'تعذّرت قراءة الملف كخطة.') : err(code) });
    } finally { setBusy(false); }
  }
  const meta = file?.model?.meta;
  return (
    <div className="bgt">
      <div className="head"><div><h1>{T('Load a plan file', 'تحميل ملف خطة')}</h1>
        <p className="sub">{T('Choose the plan file built from the bank statements, for example bestgas_plan_unitcost_to2027_2026-11-18.json in the bank\\out folder. It is checked before anything is saved; loading a newer file with the same plan name makes a new version.', 'اختر ملف الخطة المبني من كشوف البنك، مثل bestgas_plan_unitcost_to2027_2026-11-18.json في مجلد bank\\out. يُفحص قبل الحفظ، وتحميل ملف أحدث بالاسم نفسه ينشئ نسخة جديدة.')}</p></div></div>
      <section className="card">
        <div className="actions" style={{ marginTop: 0 }}><input type="file" accept=".json,application/json" aria-label={T('Plan file', 'ملف الخطة')} onChange={(e) => pick(e.target.files?.[0])} /></div>
        {meta && <p className="sub" style={{ marginTop: 10 }}><b>{meta.name || file!.name}</b> · {T('starts ', 'يبدأ ')}{meta.startDate}{meta.endDate ? T(', ends ', '، ينتهي ') + meta.endDate : ''} · {meta.weeks} {T('weeks', 'أسبوعًا')} · {file!.model.template}</p>}
        <label className="check"><input type="checkbox" checked={hideDemo} onChange={(e) => setHideDemo(e.target.checked)} /> {T('Hide the demo plan afterwards (hidden, not deleted)', 'إخفاء الخطة التجريبية بعد التحميل (إخفاء لا حذف)')}</label>
        <div className="actions">
          <button type="button" className="btn" disabled={!file || busy} onClick={load}>{busy ? T('Checking and loading…', 'جارٍ الفحص والتحميل…') : T('Check and load', 'فحص وتحميل')}</button>
          {done && <button type="button" className="btn ghost" onClick={() => nav('/')}>{T('Open the overview', 'فتح النظرة العامة')}</button>}
          {msg && <span className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</span>}
        </div>
      </section>
    </div>
  );
}
