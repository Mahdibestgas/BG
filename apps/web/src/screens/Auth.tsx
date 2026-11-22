import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { firebaseIdToken } from '../firebase';

function Art() {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const steps = [T('Study', 'الدراسة'), T('Plan', 'الخطة'), T('Budget', 'الميزانية'), T('Forecast', 'التوقعات'), T('Variance', 'الانحراف')];
  // an illustration, not data: a budget line and an actual line drawing themselves across 13 months
  const W = 560, H = 220, pts = [0.42, 0.47, 0.44, 0.55, 0.6, 0.58, 0.66, 0.7, 0.64, 0.74, 0.8, 0.78, 0.88];
  const bud = [0.45, 0.48, 0.5, 0.54, 0.57, 0.6, 0.63, 0.66, 0.68, 0.72, 0.75, 0.79, 0.83];
  const xy = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${(20 + (i * (W - 40)) / 12).toFixed(1)} ${(H - 20 - v * (H - 50)).toFixed(1)}`).join(' ');
  const last = { x: W - 20, y: H - 20 - pts[12] * (H - 50) };
  return (
    <section className="auth-art v3">
      <div className="auth-brand">
        <img src="/khitta-mark.svg" alt="" className="auth-emblem kh" />
        <span className="kh-word"><b>Khitta</b><span className="kh-ar">خطة</span></span>
      </div>
      <div className="v3-body">
        <h2 className="v3-claim">{lang === 'ar' ? <>كل ريال مخطط له،<br /><em>وكل شهر محسوب.</em></> : <>Every riyal planned.<br /><em>Every month accounted for.</em></>}</h2>
        <p className="v3-lead">{T('Department budgets, the 13-month cash forecast and budget against actual, in one place.', 'ميزانيات الإدارات والتوقعات النقدية لثلاثة عشر شهرًا والميزانية مقابل الفعلي في مكان واحد.')}</p>
        <div className="v3-stage" aria-hidden="true">
          <svg viewBox={`0 0 ${W} ${H}`}>
            <defs><linearGradient id="v3a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9CC8A0" stopOpacity=".35" /><stop offset="1" stopColor="#9CC8A0" stopOpacity="0" /></linearGradient></defs>
            {[0, 1, 2, 3].map((i) => <line key={i} x1="20" x2={W - 20} y1={30 + i * 50} y2={30 + i * 50} className="v3-grid" />)}
            <path d={`${xy(pts)} L${W - 20} ${H - 20} L20 ${H - 20}Z`} fill="url(#v3a)" className="v3-area" />
            <path d={xy(bud)} className="v3-bud" />
            <path d={xy(pts)} className="v3-act" pathLength={1} />
            <circle cx={last.x} cy={last.y} r="5" className="v3-dot" /><circle cx={last.x} cy={last.y} r="5" className="v3-ping" />
          </svg>
          <span className="v3-chip c1"><i className="ok" />{T('Budget approved', 'الميزانية معتمدة')}</span>
          <span className="v3-chip c2"><i />{T('Forecast to Dec 2027', 'التوقعات حتى ديسمبر 2027')}</span>
          <span className="v3-chip c3"><i className="warn" />{T('Variance flagged', 'انحراف مرصود')}</span>
        </div>
        <ol className="v3-flow">{steps.map((x, i) => <li key={x} style={{ ['--i' as any]: i }}><b>{i + 1}</b>{x}</li>)}</ol>
      </div>
      <span className="auth-foot">{T('Khitta · budgeting and cash planning for growing companies', 'خطة · الميزانيات والتخطيط النقدي للشركات النامية')}</span>
    </section>
  );
}

/** Top of the verification step: what is happening, how long the code lasts, and a way to get a new one. */
function VerifyHead({ kind, sentAt, onResend }: { kind: 'app' | 'email'; sentAt: number; onResend: () => void }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const total = 600, left = Math.max(0, total - Math.floor((now - sentAt) / 1000)), canResend = now - sentAt > 60000;
  const R = 22, C = 2 * Math.PI * R;
  return (
    <div className="vh">
      <div className="vh-art" aria-hidden="true">
        {kind === 'email'
          ? <svg viewBox="0 0 96 72" className="vh-mail"><rect x="6" y="14" width="84" height="52" rx="8" className="env" /><path d="M8 18l40 28 40-28" className="flap" /><rect x="30" y="4" width="36" height="26" rx="4" className="letter" /><path d="M37 13h22M37 20h14" className="lines" /></svg>
          : <svg viewBox="0 0 72 80" className="vh-shield"><path d="M36 4l28 10v20c0 20-12 34-28 42C20 68 8 54 8 34V14z" className="sh" /><path d="M24 40l8 8 16-17" className="ok" /></svg>}
      </div>
      <p className="vh-text">{kind === 'email' ? T('We emailed you a six-digit code. Type it, or paste it.', 'أرسلنا إلى بريدك رمزًا من ستة أرقام. اكتبه أو الصقه.') : T('Open your authenticator app and type the six-digit code it shows.', 'افتح تطبيق المصادقة واكتب الرمز الظاهر من ستة أرقام.')}</p>
      {kind === 'email' && <div className="vh-row">
        <span className="vh-timer" title={T('Time left', 'الوقت المتبقي')}>
          <svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r={R} className="tr" /><circle cx="26" cy="26" r={R} className="tp" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - left / total) }} /></svg>
          <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>
        </span>
        <span className="vh-left">{left ? T('until the code expires', 'حتى ينتهي الرمز') : T('The code has expired. Get a new one.', 'انتهى الرمز. اطلب رمزًا جديدًا.')}</span>
        <button type="button" className="link" disabled={!canResend} onClick={onResend}>{canResend ? T('Send a new code', 'أرسل رمزًا جديدًا') : T('New code in ', 'رمز جديد بعد ') + Math.max(0, 60 - Math.floor((now - sentAt) / 1000)) + T('s', ' ث')}</button>
      </div>}
    </div>
  );
}

/** Six boxes for a six-digit code: type, paste or let the phone fill it; the last digit submits. A recovery code (letters) still fits. */
function CodeBoxes({ onCode, busy, verified, allowLetters, errorKey }: { onCode: (c: string) => void; busy: boolean; verified: boolean; allowLetters: boolean; errorKey: number }) {
  const { lang } = useI18n();
  const [d, setD] = useState<string[]>(['', '', '', '', '', '']), [alt, setAlt] = useState(''), [shake, setShake] = useState(false);
  useEffect(() => { if (!errorKey) return; setShake(true); setD(['', '', '', '', '', '']); setAlt(''); const t = setTimeout(() => { setShake(false); (document.getElementById('otp-0') as HTMLInputElement | null)?.focus(); }, 450); return () => clearTimeout(t); }, [errorKey]);
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
      <div className={'otp' + (busy ? ' busy' : '') + (shake ? ' shake' : '')} dir="ltr">
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
  const [verified, setVerified] = useState(false), [showPw, setShowPw] = useState(false), [caps, setCaps] = useState(false), [sentAt, setSentAt] = useState(0), [errKey, setErrKey] = useState(0);
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
      catch (x) { setErrKey((k) => k + 1); setMsg(x instanceof ApiError && x.code === 'invalid_credentials' ? (lang === 'ar' ? 'الرمز غير صحيح أو انتهت صلاحيته.' : 'That code is not right or has expired.') : err(x instanceof ApiError ? x.code : 'network')); }
      finally { setBusy(false); }
      return;
    }
    try {
      // with Firebase on, try Firebase first; an unknown Firebase user falls back to the company's own password sign-in
      if (fb) { try { await viaFirebase('password', String(f.get('email')), String(f.get('pw'))); onDone(); return; } catch (x) { if (x instanceof ApiError) throw x; /* not a Firebase user: use the password sign-in below */ } }
      await api('POST', '/api/auth/login', { email: f.get('email'), password: f.get('pw') }); onDone(); }
    catch (x) {
      if (x instanceof ApiError && (x.code === 'totp_required' || x.code === 'email_code_required')) { setCreds({ email: String(f.get('email')), password: String(f.get('pw')) }); setStep2(x.code === 'totp_required' ? 'app' : 'email'); setSentAt(Date.now()); }
      else setMsg(err(x instanceof ApiError ? x.code : 'network'));
    }
    finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <Art />
      <section className="auth-form">
        <form id="signin-form" onSubmit={submit} noValidate>
          <div className="auth-hi"><h1>{step2 ? (lang === 'ar' ? 'تحقق من هويتك' : 'Confirm it is you') : (lang === 'ar' ? 'أهلًا بعودتك' : 'Welcome back')}</h1>
            <p className="sub">{step2 ? '' : (lang === 'ar' ? 'سجّل الدخول إلى خطة' : 'Sign in to Khitta')}</p></div>
          {step2 ? <>
            {!verified && <VerifyHead kind={step2} sentAt={sentAt} onResend={async () => { setMsg(''); try { await api('POST', '/api/auth/login', creds); } catch (x) { if (x instanceof ApiError && x.code === 'email_code_required') { setSentAt(Date.now()); setMsg(''); } else setMsg(err(x instanceof ApiError ? x.code : 'network')); } }} />}
            <CodeBoxes busy={busy} verified={verified} onCode={(c) => { const f = document.getElementById('signin-form') as HTMLFormElement | null; const i = f?.querySelector('input[name=code]') as HTMLInputElement | null; if (i) i.value = c; f?.requestSubmit(); }} allowLetters={step2 === 'app'} errorKey={errKey} />
            <input type="hidden" name="code" />
            <button type="button" className="link" onClick={() => { setStep2(null); setMsg(''); }}>{lang === 'ar' ? 'رجوع' : 'Back'}</button>
          </> : <>
          <label className="field ic"><span>{t('email')}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14v10H3zM3 6l7 5 7-5" /></svg><input name="email" type="email" autoComplete="username" required placeholder="name@company.com" /></label>
          <label className="field ic"><span>{t('password')}</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 9h10v8H5zM7 9V6a3 3 0 016 0v3" /></svg>
            <input name="pw" type={showPw ? 'text' : 'password'} autoComplete="current-password" required onKeyUp={(e) => setCaps(e.getModifierState && e.getModifierState('CapsLock'))} />
            <button type="button" className="pw-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? (lang === 'ar' ? 'إخفاء كلمة المرور' : 'Hide password') : (lang === 'ar' ? 'إظهار كلمة المرور' : 'Show password')} aria-pressed={showPw}>{showPw ? (lang === 'ar' ? 'إخفاء' : 'Hide') : (lang === 'ar' ? 'إظهار' : 'Show')}</button></label>
          {caps && <p className="caps">{lang === 'ar' ? 'مفتاح الأحرف الكبيرة مفعّل' : 'Caps Lock is on'}</p>}
          </>}
          {!verified && <button className={'btn auth-go' + (busy ? ' busy' : '')} disabled={busy}>{busy ? <><i className="spin" aria-hidden="true" />{t('signingIn')}</> : step2 ? (lang === 'ar' ? 'تحقق' : 'Verify') : t('signIn')}</button>}
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
