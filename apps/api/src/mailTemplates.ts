// Best Gas emails: bilingual, brand colours, tables and inline styles only (what every mail client renders).
const PUBLIC = () => (process.env.CF13_PUBLIC_URL || 'https://bestgas-budgeting.onrender.com').replace(/\/$/, '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const INK = '#1F2720', GREEN = '#4D6D51', PAPER = '#F4F1E8', MUTED = '#5A635B', RULE = '#D9D4C7', SOFT = '#E5ECE5';

function frame(title: string, bodyEn: string, bodyAr: string, preheader: string) {
  const u = PUBLIC();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:32px 14px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid ${RULE};border-radius:16px;overflow:hidden;">
  <tr><td style="background:${GREEN};padding:22px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="56" valign="middle"><img src="${u}/bestgas-logo.png" width="52" height="52" alt="Best Gas" style="display:block;border-radius:50%;border:0;"></td>
      <td valign="middle" style="padding-left:14px;"><img src="${u}/bestgas-wordmark-light.png" width="210" alt="Best Gas Carrier Co. · شركة الناقل الأفضل للغاز" style="display:block;max-width:210px;height:auto;border:0;"></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 28px 8px;font-size:15px;line-height:1.6;">${bodyEn}</td></tr>
  <tr><td style="padding:0 28px;"><div style="border-top:1px solid ${RULE};"></div></td></tr>
  <tr><td dir="rtl" style="padding:18px 28px 8px;font-size:15px;line-height:1.8;text-align:right;font-family:Tahoma,'Segoe UI',Arial,sans-serif;">${bodyAr}</td></tr>
  <tr><td style="padding:18px 28px 24px;font-size:12.5px;line-height:1.6;color:${MUTED};border-top:1px solid ${RULE};">
    Best Gas Budgeting · ميزانيات بست غاز<br>Best Gas Carrier Co. · شركة الناقل الأفضل للغاز · Kingdom of Saudi Arabia<br>
    <a href="${u}" style="color:${GREEN};">${u.replace(/^https?:\/\//, '')}</a> · This is an automatic message; replies are not read.
  </td></tr>
</table></td></tr></table></body></html>`;
}

/** The sign-in code: big spaced digits, expiry, and what to do if it was not you. */
export function signInCodeEmail(name: string, code: string, minutes: number) {
  const digits = code.split('').map((d) => `<td style="width:46px;height:58px;background:${SOFT};border:1px solid ${RULE};border-radius:10px;font-size:30px;font-weight:700;color:${INK};text-align:center;font-family:'Segoe UI',Arial,sans-serif;">${d}</td><td style="width:8px;"></td>`).join('');
  const box = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 8px;"><tr>${digits}</tr></table>`;
  const html = frame('Your sign-in code',
    `<p style="margin:0 0 6px;font-size:20px;font-weight:700;color:${INK};">Your sign-in code</p>
     <p style="margin:0;">Hello ${esc(name)}, use this code to finish signing in to Best Gas Budgeting.</p>${box}
     <p style="margin:0 0 4px;color:${MUTED};font-size:13.5px;">It works once, for ${minutes} minutes. Best Gas will never ask you for it by phone or chat.</p>
     <p style="margin:12px 0 0;font-size:13.5px;">Not you? Someone has your password: <a href="${PUBLIC()}/account" style="color:${GREEN};font-weight:600;">change it now</a>.</p>`,
    `<p style="margin:0 0 6px;font-size:20px;font-weight:700;">رمز الدخول</p>
     <p style="margin:0;">مرحبًا ${esc(name)}، استخدم هذا الرمز لإكمال الدخول إلى ميزانيات بست غاز: <b style="font-size:18px;letter-spacing:4px;">${code}</b></p>
     <p style="margin:6px 0 0;color:${MUTED};font-size:13.5px;">صالح لمرة واحدة لمدة ${minutes} دقائق. لن تطلبه بست غاز منك هاتفيًا أو بالمحادثة. إن لم تكن أنت فغيّر كلمة المرور فورًا.</p>`,
    `Your Best Gas Budgeting code is ${code}. It works for ${minutes} minutes.`);
  const text = `Your Best Gas Budgeting sign-in code is ${code}\n\nIt works once, for ${minutes} minutes. Best Gas will never ask you for it by phone or chat.\nNot you? Change your password: ${PUBLIC()}/account\n\nرمز الدخول: ${code} (صالح لمرة واحدة لمدة ${minutes} دقائق)\n\nBest Gas Carrier Co. · شركة الناقل الأفضل للغاز`;
  return { subject: `${code} is your Best Gas sign-in code`, html, text };
}

/** A short notice in the same frame (codes switched on, email changed). */
export function noticeEmail(titleEn: string, en: string, titleAr: string, ar: string) {
  return {
    html: frame(titleEn, `<p style="margin:0 0 8px;font-size:18px;font-weight:700;">${esc(titleEn)}</p><p style="margin:0;">${esc(en)}</p>`,
      `<p style="margin:0 0 8px;font-size:18px;font-weight:700;">${esc(titleAr)}</p><p style="margin:0;">${esc(ar)}</p>`, en),
    text: `${en}\n\n${ar}\n\nBest Gas Carrier Co. · شركة الناقل الأفضل للغاز`
  };
}
