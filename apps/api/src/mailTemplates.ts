// Best Gas emails: bilingual, brand colours, tables and inline styles only (what every mail client renders).
const PUBLIC = () => (process.env.CF13_PUBLIC_URL || 'https://bestgas-budgeting.onrender.com').replace(/\/$/, '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const INK = '#1F2720', GREEN = '#4D6D51', DEEP = '#2F4A33', PAPER = '#F4F1E8', MUTED = '#5A635B', RULE = '#D9D4C7', SOFT = '#E5ECE5', AMBER = '#8F5A0C', AMBER_BG = '#FBF1DE';
const FONT = "'Segoe UI',Tahoma,Arial,sans-serif";

/** A bulletproof button (works in Outlook too). */
const button = (href: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 0;"><tr><td style="background:${GREEN};border-radius:12px;">
  <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">${label}</a></td></tr></table>`;

function frame(o: { title: string; preheader: string; heroEn: string; heroAr: string; body: string }) {
  const u = PUBLIC();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${FONT};color:${INK};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:36px 14px 28px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:${DEEP};background-image:linear-gradient(160deg,${GREEN} 0%,${DEEP} 100%);border-radius:20px 20px 0 0;padding:34px 28px 30px;text-align:center;">
    <img src="${u}/bestgas-logo.png" width="76" height="76" alt="Best Gas" style="display:block;margin:0 auto 14px;border-radius:50%;border:2px solid rgba(255,255,255,.25);">
    <img src="${u}/bestgas-wordmark-light.png" width="260" alt="Best Gas Carrier Co. · شركة الناقل الأفضل للغاز" style="display:block;margin:0 auto;max-width:260px;height:auto;">
    <p style="margin:22px 0 0;font-size:24px;line-height:1.3;font-weight:700;color:#FFFFFF;">${o.heroEn}</p>
    <p dir="rtl" style="margin:4px 0 0;font-size:20px;line-height:1.5;font-weight:700;color:rgba(255,255,255,.86);font-family:Tahoma,${FONT};">${o.heroAr}</p>
  </td></tr>
  <tr><td style="background:#FFFFFF;border:1px solid ${RULE};border-top:0;border-radius:0 0 20px 20px;padding:30px 32px 30px;">${o.body}</td></tr>
  <tr><td style="padding:22px 18px 0;text-align:center;font-size:12px;line-height:1.7;color:${MUTED};">
    <b style="color:${INK};">Best Gas Carrier Co.</b> · <span dir="rtl">شركة الناقل الأفضل للغاز</span><br>Kingdom of Saudi Arabia · المملكة العربية السعودية<br>
    <a href="${u}" style="color:${GREEN};text-decoration:none;font-weight:600;">Best Gas Budgeting</a> · This is an automatic message, replies are not read.
  </td></tr>
</table></td></tr></table></body></html>`;
}

/** The sign-in code: big spaced digits, expiry, one button, and what to do if it was not you. */
export function signInCodeEmail(name: string, code: string, minutes: number) {
  const u = PUBLIC();
  const tiles = code.split('').map((d) => `<td style="padding:0 4px;"><div style="width:50px;height:64px;line-height:64px;background:${SOFT};border-radius:12px;border-bottom:4px solid ${GREEN};font-size:32px;font-weight:800;color:${INK};text-align:center;font-family:${FONT};">${d}</div></td>`).join('');
  const body = `
    <p style="margin:0;font-size:15.5px;line-height:1.6;">Hello ${esc(name)},<br>use this code to finish signing in.</p>
    <p dir="rtl" style="margin:6px 0 0;font-size:15.5px;line-height:1.8;text-align:right;font-family:Tahoma,${FONT};">مرحبًا ${esc(name)}، استخدم هذا الرمز لإكمال الدخول.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 14px;" dir="ltr"><tr>${tiles}</tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 22px;"><tr><td style="background:${AMBER_BG};color:${AMBER};border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;">
      Expires in ${minutes} minutes · <span dir="rtl">ينتهي خلال ${minutes} دقائق</span></td></tr></table>
    ${button(u, 'Open Best Gas Budgeting · افتح النظام')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;background:${PAPER};border-radius:14px;"><tr><td style="padding:16px 18px;font-size:13px;line-height:1.65;color:${MUTED};">
      <b style="color:${INK};">Keep it private.</b> The code works once. Best Gas never asks for it by phone, WhatsApp or email. If you did not try to sign in, someone has your password: <a href="${u}/account" style="color:${GREEN};font-weight:600;">change it now</a>.
      <div dir="rtl" style="margin-top:8px;text-align:right;font-family:Tahoma,${FONT};"><b style="color:${INK};">لا تشاركه.</b> الرمز يعمل مرة واحدة، ولن تطلبه بست غاز منك هاتفيًا أو عبر واتساب أو البريد. إن لم تحاول الدخول فكلمة مرورك معروفة لغيرك: <a href="${u}/account" style="color:${GREEN};font-weight:600;">غيّرها الآن</a>.</div>
    </td></tr></table>`;
  const html = frame({ title: 'Your sign-in code', preheader: `${code} is your code. It expires in ${minutes} minutes.`, heroEn: 'Your sign-in code', heroAr: 'رمز الدخول', body });
  const text = `Your Best Gas Budgeting sign-in code is ${code}\n\nIt works once and expires in ${minutes} minutes. Best Gas never asks for it by phone, WhatsApp or email.\nNot you? Change your password: ${u}/account\n\nرمز الدخول: ${code} (يعمل مرة واحدة وينتهي خلال ${minutes} دقائق)\n\nBest Gas Carrier Co. · شركة الناقل الأفضل للغاز`;
  return { subject: `${code} is your Best Gas sign-in code`, html, text };
}

/** A short notice in the same frame (codes switched on, email changed). */
export function noticeEmail(titleEn: string, en: string, titleAr: string, ar: string) {
  const body = `<p style="margin:0;font-size:15.5px;line-height:1.6;">${esc(en)}</p>
    <p dir="rtl" style="margin:12px 0 0;font-size:15.5px;line-height:1.8;text-align:right;font-family:Tahoma,${FONT};">${esc(ar)}</p>
    <div style="height:18px;"></div>${button(PUBLIC() + '/account', 'Open my account · حسابي')}`;
  return {
    html: frame({ title: titleEn, preheader: en, heroEn: esc(titleEn), heroAr: esc(titleAr), body }),
    text: `${en}\n\n${ar}\n\nBest Gas Carrier Co. · شركة الناقل الأفضل للغاز`
  };
}
