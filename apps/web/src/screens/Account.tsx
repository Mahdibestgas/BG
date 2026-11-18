import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';

interface Sec { email: string; totp: boolean; emailOtp: boolean; mailReady: boolean }
type Msg = { ok: boolean; t: string } | null;

/** The signed-in person's own account: sign-in email, password, and the second step at sign-in. */
export function Account() {
  const s = useSession();
  const { lang, err } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [sec, setSec] = useState<Sec | null>(null);
  const load = () => api<Sec>('GET', '/api/auth/security').then(setSec).catch(() => setSec(null));
  useEffect(() => { load(); }, []);
  const known = (code: string) => ({
    wrong_current_password: T('The current password is not right.', 'كلمة المرور الحالية غير صحيحة.'),
    email_taken: T('That email already has an account.', 'هذا البريد مسجل لحساب آخر.'),
    invalid_email: T('That is not a valid email.', 'البريد غير صحيح.'),
    weak_password: T('Use at least 12 characters.', 'استخدم 12 حرفًا على الأقل.'),
    email_not_configured: T('Email is not set up on the server yet (RESEND_API_KEY).', 'البريد غير مُعد على الخادم بعد (RESEND_API_KEY).'),
    email_send_failed: T('The email could not be sent. Nothing was changed.', 'تعذر إرسال البريد ولم يتغير شيء.'),
    invalid_code: T('That code is not right.', 'الرمز غير صحيح.')
  } as Record<string, string>)[code.split(':')[0]] || err(code);
  const fail = (set: (m: Msg) => void) => (e: unknown) => set({ ok: false, t: known(e instanceof ApiError ? e.code : 'network') });

  // ---- email
  const [em, setEm] = useState({ email: '', current: '' }), [emMsg, setEmMsg] = useState<Msg>(null);
  const saveEmail = () => api<{ email: string }>('POST', '/api/auth/email', em).then(async (r) => { setEm({ email: '', current: '' }); setEmMsg({ ok: true, t: T('Your sign-in email is now ', 'بريد الدخول الآن ') + r.email }); await s.reload(); load(); }).catch(fail(setEmMsg));
  // ---- password
  const [pw, setPw] = useState({ current: '', next: '', again: '' }), [pwMsg, setPwMsg] = useState<Msg>(null);
  const savePw = () => {
    if (pw.next !== pw.again) { setPwMsg({ ok: false, t: T('The two new passwords are not the same.', 'كلمتا المرور الجديدتان غير متطابقتين.') }); return; }
    api('POST', '/api/auth/password', { current: pw.current, next: pw.next }).then(() => { setPw({ current: '', next: '', again: '' }); setPwMsg({ ok: true, t: T('Password changed. Other devices are signed out.', 'تم تغيير كلمة المرور وخرجت الأجهزة الأخرى.') }); }).catch(fail(setPwMsg));
  };
  // ---- email codes
  const [otpPw, setOtpPw] = useState(''), [otpMsg, setOtpMsg] = useState<Msg>(null);
  const setOtp = (enabled: boolean) => api('POST', '/api/auth/email-otp', { password: otpPw, enabled }).then(() => { setOtpPw(''); setOtpMsg({ ok: true, t: enabled ? T('On. A test email was sent to you.', 'مفعّل. أُرسل لك بريد تجريبي.') : T('Off.', 'متوقف.') }); load(); }).catch(fail(setOtpMsg));
  // ---- authenticator app
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null), [code, setCode] = useState(''), [codes, setCodes] = useState<string[] | null>(null), [appMsg, setAppMsg] = useState<Msg>(null), [offPw, setOffPw] = useState('');
  const startApp = () => api<{ secret: string; uri: string }>('POST', '/api/auth/totp/setup').then(setSetup).catch(fail(setAppMsg));
  const confirmApp = () => api<{ recoveryCodes: string[] }>('POST', '/api/auth/totp/enable', { code }).then((r) => { setCodes(r.recoveryCodes); setSetup(null); setCode(''); load(); }).catch(fail(setAppMsg));
  const stopApp = () => api('POST', '/api/auth/totp/disable', { password: offPw, code }).then(() => { setOffPw(''); setCode(''); setAppMsg({ ok: true, t: T('The authenticator app is off.', 'تم إيقاف تطبيق المصادقة.') }); load(); }).catch(fail(setAppMsg));
  const M = ({ m }: { m: Msg }) => (m ? <span className={'msg ' + (m.ok ? 'ok' : 'err')}>{m.t}</span> : null);

  return (
    <div className="bgt">
      <div className="head"><div><h1>{T('My account', 'حسابي')}</h1><p className="sub">{s.me.account.name} · {sec?.email || s.me.account.email}</p></div></div>

      <div className="bgt-two">
        <section className="card"><h2>{T('Change sign-in email', 'تغيير بريد الدخول')}</h2>
          <label className="field"><span>{T('New email', 'البريد الجديد')}</span><input type="email" autoComplete="email" value={em.email} onChange={(e) => setEm({ ...em, email: e.target.value })} /></label>
          <label className="field"><span>{T('Current password', 'كلمة المرور الحالية')}</span><input type="password" autoComplete="current-password" value={em.current} onChange={(e) => setEm({ ...em, current: e.target.value })} /></label>
          <div className="actions"><button type="button" className="btn" disabled={!em.email || !em.current} onClick={saveEmail}>{T('Change email', 'تغيير البريد')}</button><M m={emMsg} /></div>
        </section>
        <section className="card"><h2>{T('Change password', 'تغيير كلمة المرور')}</h2>
          <label className="field"><span>{T('Current password', 'كلمة المرور الحالية')}</span><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field"><span>{T('New password (12 characters or more)', 'كلمة المرور الجديدة (12 حرفًا أو أكثر)')}</span><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
          <label className="field"><span>{T('New password again', 'أعد كتابة كلمة المرور الجديدة')}</span><input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></label>
          <div className="actions"><button type="button" className="btn" disabled={!pw.current || pw.next.length < 12} onClick={savePw}>{T('Change password', 'تغيير كلمة المرور')}</button><M m={pwMsg} /></div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Sign-in code by email', 'رمز الدخول بالبريد')} {sec && <span className={'pill' + (sec.emailOtp ? ' ok' : '')}>{sec.emailOtp ? T('On', 'مفعّل') : T('Off', 'متوقف')}</span>}</h2>
        <p className="sub">{T('After your password, a six-digit code is emailed to you; it works once, for 10 minutes.', 'بعد كلمة المرور يصلك رمز من ستة أرقام بالبريد، صالح مرة واحدة لمدة 10 دقائق.')}</p>
        {sec && !sec.mailReady && <div className="demo" role="note">{T('Email is not connected to the server yet. The system owner adds a Resend key (RESEND_API_KEY) in Render > Environment; until then use the authenticator app below.', 'البريد غير متصل بالخادم بعد. يضيف مالك النظام مفتاح Resend (RESEND_API_KEY) في Render > Environment، وحتى ذلك الحين استخدم تطبيق المصادقة أدناه.')}</div>}
        {sec?.mailReady && <>
          <label className="field"><span>{T('Your password', 'كلمة المرور')}</span><input type="password" autoComplete="current-password" value={otpPw} onChange={(e) => setOtpPw(e.target.value)} /></label>
          <div className="actions">{sec.emailOtp ? <button type="button" className="btn ghost" disabled={!otpPw} onClick={() => setOtp(false)}>{T('Turn off', 'إيقاف')}</button> : <button type="button" className="btn" disabled={!otpPw} onClick={() => setOtp(true)}>{T('Turn on', 'تفعيل')}</button>}<M m={otpMsg} /></div>
        </>}
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Authenticator app', 'تطبيق المصادقة')} {sec && <span className={'pill' + (sec.totp ? ' ok' : '')}>{sec.totp ? T('On', 'مفعّل') : T('Off', 'متوقف')}</span>}</h2>
        <p className="sub">{T('Google or Microsoft Authenticator shows a new six-digit code every 30 seconds. Works without email. If it is on, it is used instead of the email code.', 'يعرض Google أو Microsoft Authenticator رمزًا جديدًا كل 30 ثانية، ويعمل دون بريد. عند تفعيله يُستخدم بدل رمز البريد.')}</p>
        {sec && !sec.totp && !setup && !codes && <div className="actions"><button type="button" className="btn" onClick={startApp}>{T('Set up the app', 'إعداد التطبيق')}</button><M m={appMsg} /></div>}
        {setup && <>
          <p>{T('In the app choose "Add account" > "Enter a setup key" and type this key:', 'في التطبيق اختر "إضافة حساب" ثم "إدخال مفتاح الإعداد" واكتب هذا المفتاح:')}</p>
          <p><code className="bgt-key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
          <p className="sub"><a className="link" href={setup.uri}>{T('On this phone? Open it in the app', 'على الهاتف؟ افتحه في التطبيق')}</a></p>
          <label className="field"><span>{T('The six-digit code the app shows', 'الرمز المكوّن من ستة أرقام في التطبيق')}</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          <div className="actions"><button type="button" className="btn" disabled={code.length !== 6} onClick={confirmApp}>{T('Confirm and turn on', 'تأكيد وتفعيل')}</button><M m={appMsg} /></div>
        </>}
        {codes && <div className="demo" role="note"><b>{T('Recovery codes: keep them somewhere safe. Each works once if you lose the phone.', 'رموز الاسترداد: احفظها في مكان آمن. كل رمز يعمل مرة واحدة إذا فقدت الهاتف.')}</b><p><code className="bgt-key">{codes.join('   ')}</code></p></div>}
        {sec?.totp && !codes && <>
          <label className="field"><span>{T('Your password', 'كلمة المرور')}</span><input type="password" autoComplete="current-password" value={offPw} onChange={(e) => setOffPw(e.target.value)} /></label>
          <label className="field"><span>{T('A code from the app, or a recovery code', 'رمز من التطبيق أو رمز استرداد')}</span><input value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <div className="actions"><button type="button" className="btn ghost" disabled={!offPw || !code} onClick={stopApp}>{T('Turn off', 'إيقاف')}</button><M m={appMsg} /></div>
        </>}
      </section>
    </div>
  );
}
