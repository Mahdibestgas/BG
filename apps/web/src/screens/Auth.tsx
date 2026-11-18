import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { firebaseIdToken } from '../firebase';

function Art() {
  const { t } = useI18n();
  return (
    <section className="auth-art">
      <div className="auth-brand">
        <img src="/bestgas-logo.png" alt="" className="auth-emblem" />
        <div><img src="/bestgas-wordmark-light.png" alt="Best Gas Carrier Co. · شركة الناقل الأفضل للغاز" className="auth-wordmark" /><span>{t('product')}</span></div>
      </div>
      <div className="auth-round" aria-hidden="true">
        {[0.35, 0.6, 1, 0.85, 1, 0.5, 0.75].map((f, i) => (
          <svg key={i} viewBox="0 0 48 112" style={{ ['--i' as any]: i }}>
            <rect x="17" y="2" width="14" height="8" rx="2" className="ar-valve" />
            <rect x="6" y="12" width="36" height="96" rx="15" className="ar-body" />
            <clipPath id={'ar' + i}><rect x="6" y="12" width="36" height="96" rx="15" /></clipPath>
            <rect x="6" y={108 - 90 * f} width="36" height={90 * f} clipPath={`url(#ar${i})`} className={'ar-fill' + (f === 1 ? ' full' : '')} />
          </svg>
        ))}
      </div>
      <p>{t('tagline')}</p>
    </section>
  );
}

/** Six boxes for a six-digit code: type, paste or let the phone fill it; the last digit submits. A recovery code (letters) still fits. */
function CodeBoxes({ onCode, busy, verified, allowLetters }: { onCode: (c: string) => void; busy: boolean; verified: boolean; allowLetters: boolean }) {
  const { lang } = useI18n();
  const [d, setD] = useState<string[]>(['', '', '', '', '', '']), [alt, setAlt] = useState('');
  const refs = Array.from({ length: 6 }, () => null as HTMLInputElement | null);
  const box = (i: number) => document.getElementById('otp-' + i) as HTMLInputElement | null;
  const set = (i: number, v: string) => {
    const only = v.replace(/\D/g, '');
    if (only.length > 1) { const all = only.slice(0, 6).split(''); const next = [...all, ...new Array(6 - all.length).fill('')]; setD(next); if (all.length === 6) onCode(all.join('')); else box(all.length)?.focus(); return; }
    const next = d.map((x, j) => (j === i ? only : x)); setD(next);
    if (only && i < 5) box(i + 1)?.focus();
    if (next.every((x) => x)) onCode(next.join(''));
  };
  if (verified) return <div className="otp-done" role="status"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg><b>{lang === 'ar' ? 'تم التحقق' : 'Verified'}</b><span>{lang === 'ar' ? 'جارٍ الدخول…' : 'Signing you in…'}</span></div>;
  return (
    <>
      <div className={'otp' + (busy ? ' busy' : '')} dir="ltr">
        {d.map((x, i) => <input key={i} id={'otp-' + i} ref={(el) => { refs[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? 6 : 1} value={x} autoFocus={i === 0} disabled={busy}
          aria-label={(lang === 'ar' ? 'الرقم ' : 'Digit ') + (i + 1)}
          onChange={(e) => set(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Backspace' && !x && i > 0) box(i - 1)?.focus(); }}
          onPaste={(e) => { e.preventDefault(); set(i, e.clipboardData.getData('text')); }} />)}
      </div>
      {allowLetters && <label className="field"><span>{lang === 'ar' ? 'أو رمز استرداد' : 'Or a recovery code'}</span><input value={alt} onChange={(e) => setAlt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && alt.trim()) { e.preventDefault(); onCode(alt.trim()); } }} /></label>}
    </>
  );
}

export function SignIn({ onDone }: { onDone: () => void }) {
  const { t, err, lang, setLang } = useI18n();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [verified, setVerified] = useState(false);
  const [step2, setStep2] = useState<null | 'app' | 'email'>(null), [creds, setCreds] = useState<{ email: string; password: string }>({ email: '', password: '' });
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
    if (step2) {
      try { await api('POST', '/api/auth/login', { ...creds, code: String(f.get('code') || '') }); setVerified(true); await new Promise((r) => setTimeout(r, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900)); onDone(); }
      catch (x) { setMsg(x instanceof ApiError && x.code === 'invalid_credentials' ? (lang === 'ar' ? 'الرمز غير صحيح أو انتهت صلاحيته.' : 'That code is not right or has expired.') : err(x instanceof ApiError ? x.code : 'network')); }
      finally { setBusy(false); }
      return;
    }
    try {
      // with Firebase on, try Firebase first; an unknown Firebase user falls back to the company's own password sign-in
      if (fb) { try { await viaFirebase('password', String(f.get('email')), String(f.get('pw'))); onDone(); return; } catch (x) { if (x instanceof ApiError) throw x; /* not a Firebase user: use the password sign-in below */ } }
      await api('POST', '/api/auth/login', { email: f.get('email'), password: f.get('pw') }); onDone(); }
    catch (x) {
      if (x instanceof ApiError && (x.code === 'totp_required' || x.code === 'email_code_required')) { setCreds({ email: String(f.get('email')), password: String(f.get('pw')) }); setStep2(x.code === 'totp_required' ? 'app' : 'email'); }
      else setMsg(err(x instanceof ApiError ? x.code : 'network'));
    }
    finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <Art />
      <section className="auth-form">
        <form id="signin-form" onSubmit={submit} noValidate>
          <h1>{t('signIn')}</h1>
          {step2 ? <>
            <p className="sub">{step2 === 'email' ? (lang === 'ar' ? 'أرسلنا رمزًا من ستة أرقام إلى بريدك. صالح لمدة 10 دقائق.' : 'We emailed you a six-digit code. It works for 10 minutes.') : (lang === 'ar' ? 'اكتب الرمز الظاهر في تطبيق المصادقة، أو رمز استرداد.' : 'Type the code your authenticator app shows, or a recovery code.')}</p>
            <CodeBoxes busy={busy} verified={verified} onCode={(c) => { const f = document.getElementById('signin-form') as HTMLFormElement | null; const i = f?.querySelector('input[name=code]') as HTMLInputElement | null; if (i) i.value = c; f?.requestSubmit(); }} allowLetters={step2 === 'app'} />
            <input type="hidden" name="code" />
            <button type="button" className="link" onClick={() => { setStep2(null); setMsg(''); }}>{lang === 'ar' ? 'رجوع' : 'Back'}</button>
          </> : <>
          <label className="field"><span>{t('email')}</span><input name="email" type="email" autoComplete="username" required /></label>
          <label className="field"><span>{t('password')}</span><input name="pw" type="password" autoComplete="current-password" required /></label>
          </>}
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
