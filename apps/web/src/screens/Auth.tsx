import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { firebaseIdToken } from '../firebase';

function Art() {
  const { t } = useI18n();
  const pts = [0.62, 0.7, 0.78, 0.71, 0.5, 0.57, 0.64, 0.72, 0.52, 0.6, 0.68, 0.77, 0.66];
  const d = pts.map((p, i) => (i ? 'L' : 'M') + (10 + i * 30) + ' ' + (130 - p * 110)).join(' ');
  return (
    <section className="auth-art">
      <div className="auth-brand"><i aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3 14l4-5 3 3 7-8" strokeLinecap="round" strokeLinejoin="round" /></svg></i>{t('product')}</div>
      <svg className="sketch" viewBox="0 0 380 150" aria-hidden="true">
        {[30, 67, 105].map((y) => <line key={y} x1="0" y1={y} x2="380" y2={y} stroke="currentColor" strokeOpacity=".12" />)}
        <rect x="0" y="105" width="380" height="35" fill="currentColor" opacity=".07" />
        <line x1="0" y1="105" x2="380" y2="105" stroke="currentColor" strokeOpacity=".45" strokeDasharray="3 5" />
        <path d={d + ' L370 140 L10 140Z'} fill="currentColor" opacity=".08" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={10 + i * 30} cy={130 - p * 110} r={i === 4 ? 5 : 2.6} fill="currentColor" />)}
      </svg>
      <p>{t('tagline')}</p>
    </section>
  );
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const { t, err, lang, setLang } = useI18n();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [fb, setFb] = useState<Record<string, string> | null>(null);
  const [signupOpen, setSignupOpen] = useState(true);
  useEffect(() => { api<{ signup?: boolean; firebase: { enabled: boolean; config?: Record<string, string> } }>('GET', '/api/auth/config').then((r) => { setSignupOpen(r.signup !== false); setFb(r.firebase.enabled ? r.firebase.config || null : null); }).catch(() => setFb(null)); }, []);
  async function viaFirebase(kind: 'google' | 'password', email?: string, password?: string) {
    const idToken = await firebaseIdToken(fb!, kind === 'google' ? { kind } : { kind, email: email || '', password: password || '' });
    await api('POST', '/api/auth/firebase', { idToken });
  }
  async function google() {
    setBusy(true); setMsg('');
    try { await viaFirebase('google'); onDone(); } catch (x) { setMsg(x instanceof ApiError ? err(x.code) : t('e_generic', { c: 'firebase' })); } finally { setBusy(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg('');
    try {
      // with Firebase on, try Firebase first; an unknown Firebase user falls back to the company's own password sign-in
      if (fb) { try { await viaFirebase('password', String(f.get('email')), String(f.get('pw'))); onDone(); return; } catch (x) { if (x instanceof ApiError) throw x; /* not a Firebase user: use the password sign-in below */ } }
      await api('POST', '/api/auth/login', { email: f.get('email'), password: f.get('pw') }); onDone(); }
    catch (x) { setMsg(err(x instanceof ApiError ? x.code : 'network')); }
    finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <Art />
      <section className="auth-form">
        <form onSubmit={submit} noValidate>
          <h1>{t('signIn')}</h1>
          <label className="field"><span>{t('email')}</span><input name="email" type="email" autoComplete="username" required /></label>
          <label className="field"><span>{t('password')}</span><input name="pw" type="password" autoComplete="current-password" required /></label>
          <button className="btn" disabled={busy}>{busy ? t('signingIn') : t('signIn')}</button>
          {fb && <button type="button" className="btn ghost" style={{ marginTop: 8 }} disabled={busy} onClick={google}>{lang === 'ar' ? 'المتابعة باستخدام Google' : 'Continue with Google'}</button>}
          <p className="msg err" role="alert" style={{ minHeight: 22, marginTop: 8 }}>{msg}</p>
          <p className="alt">{signupOpen && <>{t('noAccount')} <Link to="/signup">{t('signUp')}</Link> · </>}<button type="button" className="link" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{t('lang')}</button></p>
        </form>
      </section>
    </div>
  );
}

export function SignUp({ onDone }: { onDone: () => void }) {
  const { t, err, lang } = useI18n();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (String(f.get('pw') || '').length < 12) { setMsg(t('e_weak_password')); return; }
    setBusy(true); setMsg('');
    try {
      await api('POST', '/api/auth/signup', { company: f.get('company'), companyAr: f.get('companyAr'), name: f.get('name'), email: f.get('email'), password: f.get('pw'), template: f.get('template'), language: lang });
      onDone();
    } catch (x) { setMsg(err(x instanceof ApiError ? x.code : 'network')); }
    finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <Art />
      <section className="auth-form">
        <form onSubmit={submit} noValidate>
          <h1>{t('signUp')}</h1>
          <label className="field"><span>{t('company')}</span><input name="company" required maxLength={120} /></label>
          <label className="field"><span>{t('companyAr')}</span><input name="companyAr" dir="rtl" maxLength={120} /></label>
          <label className="field"><span>{t('industry')}</span>
            <select name="template" defaultValue="lpg-distribution"><option value="lpg-distribution">{t('tplLpg')}</option><option value="generic">{t('tplGeneric')}</option></select></label>
          <label className="field"><span>{t('yourName')}</span><input name="name" required autoComplete="name" maxLength={120} /></label>
          <label className="field"><span>{t('email')}</span><input name="email" type="email" required autoComplete="username" /></label>
          <label className="field"><span>{t('password')}</span><input name="pw" type="password" required autoComplete="new-password" minLength={12} /><span className="sub">{t('pwHint')}</span></label>
          <button className="btn" disabled={busy}>{busy ? t('creating') : t('create')}</button>
          <p className="msg err" role="alert" style={{ minHeight: 22, marginTop: 8 }}>{msg}</p>
          <p className="alt">{t('haveAccount')} <Link to="/">{t('signIn')}</Link></p>
        </form>
      </section>
    </div>
  );
}
