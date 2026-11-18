import { useEffect, useState, type FormEvent } from 'react';
import { Loading } from '../ui/Loading';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';

/** Opening an invitation link: a new person picks a name and password; someone with an account confirms with theirs. */
export function Join({ onDone }: { onDone: () => void }) {
  const { token = '' } = useParams();
  const { lang, setLang, err, t } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [inv, setInv] = useState<{ company: string; role: string; email: string; existingAccount: boolean } | null>(null);
  const [name, setName] = useState(''), [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [e, setE] = useState('');
  useEffect(() => { api('POST', '/api/auth/invite/peek', { token }).then(setInv).catch((x) => setE(x instanceof ApiError && x.code === 'invalid_invite' ? T('This invitation link has expired, was used already or was cancelled. Ask for a new one.', 'انتهت صلاحية رابط الدعوة أو استُخدم أو أُلغي. اطلب رابطًا جديدًا.') : err(x.code))); }, [token]);   // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(ev: FormEvent) {
    ev.preventDefault(); setBusy(true); setE('');
    try { await api('POST', '/api/auth/invite/accept', { token, name, password: pw, language: lang }); onDone(); }
    catch (x) { setE(err(x instanceof ApiError ? x.code : 'network')); }
    finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <section className="auth-art"><div className="auth-brand">{t('product')}</div><p>{T('Every department plans its part. One company budget.', 'كل إدارة تخطط لجزئها. ميزانية واحدة للشركة.')}</p></section>
      <div className="auth-form"><form onSubmit={submit}>
        <button type="button" className="link" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('lang')}</button>
        {!inv && !e && <Loading />}
        {e && <p className="msg err">{e}</p>}
        {inv && <>
          <h1>{T(`Join ${inv.company}`, `الانضمام إلى ${inv.company}`)}</h1>
          <p className="sub">{inv.role === 'contributor' ? T('You are invited to prepare your department’s budget.', 'أنت مدعو لإعداد ميزانية إدارتك.') : T('You are invited to the company’s cash and budget system.', 'أنت مدعو إلى نظام النقد والميزانية في الشركة.')} {inv.email}</p>
          {!inv.existingAccount && <label className="field"><span>{T('Your name', 'اسمك')}</span><input required value={name} onChange={(x) => setName(x.target.value)} autoComplete="name" /></label>}
          <label className="field"><span>{inv.existingAccount ? T('Your current password', 'كلمة المرور الحالية') : T('Choose a password (at least 12 characters)', 'اختر كلمة مرور (12 حرفًا على الأقل)')}</span>
            <input required type="password" minLength={inv.existingAccount ? 1 : 12} value={pw} onChange={(x) => setPw(x.target.value)} autoComplete={inv.existingAccount ? 'current-password' : 'new-password'} /></label>
          <button className="btn" disabled={busy}>{busy ? '…' : T('Join', 'انضمام')}</button>
        </>}
      </form></div>
    </div>
  );
}
