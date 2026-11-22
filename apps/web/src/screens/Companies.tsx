import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';

/** The system owner's list of companies, and a form to add one. Each company is a separate space. */
export function Companies() {
  const s = useSession();
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [f, setF] = useState({ company: '', companyAr: '', template: 'lpg-distribution' }), [busy, setBusy] = useState(false), [e, setE] = useState('');
  if (!s.me.platformOwner) return <p className="empty">{T('Only the system owner manages companies.', 'يدير الشركاتِ مالكُ النظام فقط.')}</p>;
  async function create() {
    setBusy(true); setE('');
    try { await api('POST', '/api/auth/companies', f); await s.reload(); window.location.assign('/'); }
    catch (x) { setE(err(x instanceof ApiError ? x.code : 'network')); setBusy(false); }
  }
  return (
    <div className="bgt">
      <div className="head"><div><h1>{T('Companies', 'الشركات')}</h1>
        <p className="sub">{T('You own the whole system. Every company is a separate space: its people, budgets and plans never mix with another company. Switch between them at the bottom of the menu.', 'أنت مالك النظام كاملًا. كل شركة مساحة منفصلة: موظفوها وميزانياتها وخططها لا تختلط بشركة أخرى. بدّل بينها من أسفل القائمة.')}</p></div></div>
      <section className="card">
        <h2>{T('Your companies', 'شركاتك')}</h2>
        <div className="khz-scroll"><table className="tbl"><thead><tr><th>{T('Company', 'الشركة')}</th><th>{T('Your role', 'دورك')}</th><th /></tr></thead>
          <tbody>{s.me.companies.map((c) => <tr key={c.id}><td><b>{lang === 'ar' && c.nameAr ? c.nameAr : c.name}</b></td><td>{c.role}</td>
            <td>{c.id === s.me.tenantId ? <span className="pill ok">{T('Open now', 'مفتوحة الآن')}</span> : <button type="button" className="link" onClick={() => s.switchTo(c.id)}>{T('Open', 'فتح')}</button>}</td></tr>)}</tbody></table></div>
      </section>
      <BackupCard />
      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Add a company', 'إضافة شركة')}</h2>
        <div className="bgt-form">
          <label className="field"><span>{T('Name in English', 'الاسم بالإنجليزية')}</span><input value={f.company} maxLength={120} onChange={(x) => setF({ ...f, company: x.target.value })} /></label>
          <label className="field"><span>{T('Name in Arabic', 'الاسم بالعربية')}</span><input dir="rtl" value={f.companyAr} maxLength={120} onChange={(x) => setF({ ...f, companyAr: x.target.value })} /></label>
          <label className="field"><span>{T('Kind of business', 'نوع النشاط')}</span><select value={f.template} onChange={(x) => setF({ ...f, template: x.target.value })}>
            <option value="lpg-distribution">{T('Gas distribution (LPG)', 'توزيع الغاز المسال')}</option>
            <option value="generic">{T('Any other company', 'أي شركة أخرى')}</option></select></label>
        </div>
        <div className="actions"><button type="button" className="btn" disabled={busy || !f.company.trim()} onClick={create}>{T('Create the company', 'إنشاء الشركة')}</button>{e && <span className="msg err">{e}</span>}</div>
      </section>
    </div>
  );
}

/** Backups of every company: download one now, and see whether the daily email copy is running. */
function BackupCard() {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [st, setSt] = useState<{ dailyEmail: boolean; to: string[] } | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => { api<{ dailyEmail: boolean; to: string[] }>('GET', '/api/platform/backup-status').then(setSt).catch(() => setSt(null)); }, []);
  async function download() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/platform/backup', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob(), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `khitta-backup-${new Date().toISOString().slice(0, 10)}.json.gz`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setMsg(T(`Saved (${Math.round(blob.size / 1024)} KB). Keep it somewhere safe.`, `تم الحفظ (${Math.round(blob.size / 1024)} ك.ب). احفظه في مكان آمن.`));
    } catch { setMsg(T('The backup could not be made. Try again.', 'تعذّر إنشاء النسخة. حاول مجددًا.')); }
    finally { setBusy(false); }
  }
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <h2>{T('Backups', 'النسخ الاحتياطية')}</h2>
      <p className="sub">{T('One file with every company: settings, logo, plans, budget rounds, department budgets, actuals, members and the activity log. Passwords and keys are never in it.', 'ملف واحد بكل الشركات: الإعدادات والشعار والخطط ودورات الميزانية وميزانيات الإدارات والفعلي والأعضاء وسجل النشاط. لا يحتوي على كلمات مرور أو مفاتيح.')}</p>
      <ul className="bk-list">
        <li className={st?.dailyEmail ? 'ok' : 'warn'}><b aria-hidden="true">{st?.dailyEmail ? '✓' : '!'}</b><span>{st?.dailyEmail
          ? T(`Automatic: every day after 02:00 Riyadh time, emailed to ${st.to.join(', ')}.`, `تلقائي: كل يوم بعد الساعة 02:00 بتوقيت الرياض، يُرسل إلى ${st.to.join('، ')}.`)
          : T('Automatic daily email is off until the mail service key (RESEND_API_KEY) is set in Render. Download a copy by hand meanwhile.', 'الإرسال اليومي التلقائي متوقف حتى يُضاف مفتاح خدمة البريد (RESEND_API_KEY) في Render. نزّل نسخة يدويًا حتى ذلك الحين.')}</span></li>
      </ul>
      <div className="actions"><button type="button" className="btn" disabled={busy} onClick={download}>{busy ? T('Preparing…', 'جارٍ التحضير…') : T('Download backup now', 'تنزيل نسخة الآن')}</button>{msg && <span className="msg ok">{msg}</span>}</div>
    </section>
  );
}
