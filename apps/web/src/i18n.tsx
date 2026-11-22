import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const EN = {
  product: 'Khitta', tagline: 'Study, plan and budget every department, then follow the cash and the actuals month by month.',
  signIn: 'Sign in', signingIn: 'Signing in…', signUp: 'Create a company account', email: 'Work email', password: 'Password',
  noAccount: 'New company?', haveAccount: 'Already have an account?', company: 'Company name', companyAr: 'Company name in Arabic (optional)',
  yourName: 'Your name', industry: 'Industry template', tplLpg: 'LPG distribution (drivers: branches, cylinders, supplier terms)', tplGeneric: 'Any business (opening balances and scheduled items)',
  pwHint: 'At least 12 characters.', create: 'Create account', creating: 'Creating…',
  nav_overview: 'Overview', nav_cash: 'Cash flow', nav_analysis: 'Why cash moves', nav_variance: 'Forecast vs actual', nav_board: 'Board approval', nav_pnl: 'Expected P&L', nav_balances: 'Opening balances', nav_brand: 'Company look', nav_activity: 'Activity',
  signOut: 'Sign out', switchCompany: 'Switch company', lang: 'العربية', schemeDark: 'Dark', schemeLight: 'Light',
  demo: 'Demo figures.', demoText: 'This plan still holds placeholder figures. Replace them with your opening balances and schedules.',
  overviewTitle: 'Cash position', weeksFrom: 'From {d}', todayWeek: 'today is week {n}',
  runwayTitle: 'Closing cash, week by week', runwaySub: 'Each point is the bank balance at the end of the week, in SAR',
  fOpening: 'Opening cash, {d}', fLowest: 'Lowest, week {n}', fClosing: 'Closing cash', fFacility: 'Facility peak', notNeeded: 'Not needed',
  aboveBuffer: '{v} above buffer', belowBuffer: '{v} below buffer', overWeeks: '{v} net change over the plan',
  checksOk: 'All {n} checks pass', checksBad: '{n} checks fail',
  upcoming: 'Biggest payments, this week and next', recPay: 'Receipts and payments (SAR)', receipts: 'Receipts', payments: 'Payments',
  decisionsTitle: 'Recommended decisions', decisionsSoon: 'Decisions appear here once actuals are imported and compared with the plan.',
  cashTitle: 'Cash flow', cashSub: 'Click any line to open what it is made of, down to each payment.',
  unitsK: "SAR '000", unitsFull: 'SAR', openAll: 'Open all', closeAll: 'Close all', total: 'Total',
  opening: 'Opening cash', closing: 'Closing cash', net: 'Net cash flow', interest: 'Financing cost', facility: 'Facility used', vsBuffer: 'Above / (below) buffer',
  sec_receipts: 'Receipts', sec_payments: 'Payments', lines: '{n} lines', items: '{n} items', line1: '1 line', item1: '1 item', loading: 'Loading…',
  balTitle: 'Opening balances', balSub: 'What the company holds and owes at the close of {d}, the day before week 1.',
  bank: 'Bank accounts', bankSub: 'Opening cash is the total. An overdrawn account is a negative number.',
  accName: 'Account', accBank: 'Bank', accBal: 'Balance (SAR)', addAcc: 'Add account', remove: 'Remove', openingCash: 'Opening cash',
  ar: 'Receivables to collect', arSub: 'Sales before week 1 the bank has not paid out yet.',
  ap: 'Owed to the gas supplier', apSub: 'Unpaid supplier invoices at the start of week 1.',
  vat: 'VAT owed to ZATCA', vatSub: 'The return for the month before week 1. Leave the date empty for the usual due date.',
  amount: 'Amount (SAR)', dueDate: 'Due date', whenPaid: 'When it is paid', sumPct: 'Total {p}%', addWeek: 'Add a week',
  confirmed: 'These balances come from bank statements and ledgers, not estimates.', save: 'Save balances', saving: 'Saving…',
  saved: 'Saved. The forecast now uses these balances (version {v}).', readOnly: 'You can view these figures. Only finance can change them.',
  brandTitle: 'Company look', brandSub: 'Upload your logo: the app takes its colours from it. Figures and alerts keep fixed colours so they always read the same.',
  chooseLogo: 'Choose logo (PNG, JPEG or WebP, up to 512 KB)', preview: 'Preview', saveLook: 'Save look', adjusted: 'We darkened the logo colour slightly so text on it stays readable.',
  lookSaved: 'Saved. Everyone in the company now sees this look.', ownerOnly: 'Only the owner can change the company look.',
  actTitle: 'Activity', actSub: 'Every change, newest first. Entries can never be edited or deleted.',
  a_company_created: 'Created the company', a_login: 'Signed in', a_opening_balances_saved: 'Saved opening balances', a_branding_saved: 'Changed the company look', a_password_changed: 'Changed their password',
  e_invalid_credentials: 'That email and password do not match.', e_locked: 'Too many attempts. Try again in 15 minutes.',
  e_email_taken: 'An account with this email already exists. Sign in instead.', e_weak_password: 'Use at least 12 characters.',
  e_invalid_email: 'Enter a valid email address.', e_network: 'The server did not answer. Check the connection.',
  e_schedule_not_100: 'A payment schedule must add up to 100%.', e_negative_not_allowed: 'This amount cannot be negative.',
  e_invalid_number: 'One of the amounts is not a number.', e_invalid_date: 'That date does not exist.', e_bank_accounts_required: 'Add at least one bank account.',
  e_required: 'Fill in every required field.', e_stale_plan: 'Someone saved this plan after you opened it. Reload, then make your change again.',
  e_plan_locked: 'This plan is locked.', e_forbidden: 'Your role cannot do this.', e_logo_type: 'Use a PNG, JPEG or WebP image.', e_logo_size: 'The logo must be 512 KB or smaller.',
  e_theme_contrast: 'Those colours would be hard to read. Try another logo.', e_generic: 'Something went wrong: {c}'
};
type Key = keyof typeof EN;
const AR: Record<Key, string> = {
  product: 'خطة', tagline: 'دراسة كل إدارة وخطتها وميزانيتها، ثم متابعة النقد والفعلي شهرًا بشهر.',
  signIn: 'تسجيل الدخول', signingIn: 'جارٍ الدخول…', signUp: 'إنشاء حساب لشركتك', email: 'البريد الإلكتروني للعمل', password: 'كلمة المرور',
  noAccount: 'شركة جديدة؟', haveAccount: 'لديك حساب؟', company: 'اسم الشركة', companyAr: 'اسم الشركة بالعربية (اختياري)',
  yourName: 'اسمك', industry: 'قالب النشاط', tplLpg: 'توزيع الغاز المسال (الفروع، الأسطوانات، شروط المورد)', tplGeneric: 'أي نشاط (الأرصدة الافتتاحية والبنود المجدولة)',
  pwHint: '١٢ حرفًا على الأقل.', create: 'إنشاء الحساب', creating: 'جارٍ الإنشاء…',
  nav_overview: 'نظرة عامة', nav_cash: 'التدفق النقدي', nav_analysis: 'لماذا يتحرك النقد', nav_variance: 'المتوقع مقابل الفعلي', nav_board: 'اعتماد المجلس', nav_pnl: 'الأرباح والخسائر المتوقعة', nav_balances: 'الأرصدة الافتتاحية', nav_brand: 'هوية الشركة', nav_activity: 'سجل التغييرات',
  signOut: 'تسجيل الخروج', switchCompany: 'تبديل الشركة', lang: 'English', schemeDark: 'داكن', schemeLight: 'فاتح',
  demo: 'أرقام تجريبية.', demoText: 'هذه الخطة ما زالت تحتوي أرقامًا افتراضية. استبدلها بأرصدتك الافتتاحية وجداولك.',
  overviewTitle: 'المركز النقدي', weeksFrom: 'من {d}', todayWeek: 'اليوم في الأسبوع {n}',
  runwayTitle: 'رصيد الإقفال أسبوعيًا', runwaySub: 'كل نقطة هي رصيد البنك في نهاية الأسبوع، بالريال',
  fOpening: 'الرصيد الافتتاحي، {d}', fLowest: 'أدنى رصيد، الأسبوع {n}', fClosing: 'الرصيد الختامي', fFacility: 'أعلى استخدام للتسهيلات', notNeeded: 'غير مطلوب',
  aboveBuffer: '{v} فوق الحد الأدنى', belowBuffer: '{v} تحت الحد الأدنى', overWeeks: '{v} صافي التغيير خلال الخطة',
  checksOk: 'جميع الفحوصات ({n}) سليمة', checksBad: '{n} فحوصات غير سليمة',
  upcoming: 'أكبر المدفوعات هذا الأسبوع والقادم', recPay: 'المقبوضات والمدفوعات (ريال)', receipts: 'المقبوضات', payments: 'المدفوعات',
  decisionsTitle: 'القرارات المقترحة', decisionsSoon: 'تظهر القرارات هنا بعد استيراد الأرقام الفعلية ومقارنتها بالخطة.',
  cashTitle: 'التدفق النقدي', cashSub: 'اضغط أي بند لترى مكوناته حتى كل دفعة.',
  unitsK: 'ألف ريال', unitsFull: 'ريال', openAll: 'فتح الكل', closeAll: 'إغلاق الكل', total: 'الإجمالي',
  opening: 'الرصيد الافتتاحي', closing: 'رصيد الإقفال', net: 'صافي التدفق النقدي', interest: 'تكلفة التمويل', facility: 'التسهيلات المستخدمة', vsBuffer: 'فوق / (تحت) الحد الأدنى',
  sec_receipts: 'المقبوضات', sec_payments: 'المدفوعات', lines: '{n} بنود', items: '{n} حركة', line1: 'بند واحد', item1: 'حركة واحدة', loading: 'جارٍ التحميل…',
  balTitle: 'الأرصدة الافتتاحية', balSub: 'ما لدى الشركة وما عليها في نهاية يوم {d}، اليوم السابق للأسبوع الأول.',
  bank: 'الحسابات البنكية', bankSub: 'الرصيد الافتتاحي هو المجموع. الحساب المكشوف يُدخل بالسالب.',
  accName: 'الحساب', accBank: 'البنك', accBal: 'الرصيد (ريال)', addAcc: 'إضافة حساب', remove: 'حذف', openingCash: 'الرصيد الافتتاحي',
  ar: 'ذمم مدينة للتحصيل', arSub: 'مبيعات قبل الأسبوع الأول لم يحوّلها البنك بعد.',
  ap: 'المستحق لمورد الغاز', apSub: 'فواتير المورد غير المسددة في بداية الأسبوع الأول.',
  vat: 'ضريبة القيمة المضافة المستحقة لزاتكا', vatSub: 'إقرار الشهر السابق للأسبوع الأول. اترك التاريخ فارغًا للموعد المعتاد.',
  amount: 'المبلغ (ريال)', dueDate: 'تاريخ الاستحقاق', whenPaid: 'موعد السداد', sumPct: 'المجموع {p}٪', addWeek: 'إضافة أسبوع',
  confirmed: 'هذه الأرصدة من كشوف البنك والدفاتر، وليست تقديرات.', save: 'حفظ الأرصدة', saving: 'جارٍ الحفظ…',
  saved: 'تم الحفظ. التوقعات تستخدم هذه الأرصدة الآن (الإصدار {v}).', readOnly: 'يمكنك عرض هذه الأرقام فقط. التعديل لفريق المالية.',
  brandTitle: 'هوية الشركة', brandSub: 'ارفع شعارك وسيأخذ النظام ألوانه منه. الأرقام والتنبيهات تبقى بألوان ثابتة لتُقرأ دائمًا بنفس الطريقة.',
  chooseLogo: 'اختر الشعار (PNG أو JPEG أو WebP، حتى ٥١٢ كيلوبايت)', preview: 'معاينة', saveLook: 'حفظ الهوية', adjusted: 'غمّقنا لون الشعار قليلًا ليبقى النص عليه واضحًا.',
  lookSaved: 'تم الحفظ. يرى جميع أعضاء الشركة هذه الهوية الآن.', ownerOnly: 'المالك فقط يمكنه تغيير هوية الشركة.',
  actTitle: 'سجل التغييرات', actSub: 'كل تغيير، الأحدث أولًا. لا يمكن تعديل أي قيد أو حذفه.',
  a_company_created: 'أنشأ الشركة', a_login: 'سجّل الدخول', a_opening_balances_saved: 'حفظ الأرصدة الافتتاحية', a_branding_saved: 'غيّر هوية الشركة', a_password_changed: 'غيّر كلمة المرور',
  e_invalid_credentials: 'البريد وكلمة المرور غير متطابقين.', e_locked: 'محاولات كثيرة. حاول بعد ١٥ دقيقة.',
  e_email_taken: 'يوجد حساب بهذا البريد. سجّل الدخول بدلًا من ذلك.', e_weak_password: 'استخدم ١٢ حرفًا على الأقل.',
  e_invalid_email: 'أدخل بريدًا إلكترونيًا صحيحًا.', e_network: 'لم يستجب الخادم. تحقق من الاتصال.',
  e_schedule_not_100: 'يجب أن يكون مجموع جدول السداد ١٠٠٪.', e_negative_not_allowed: 'لا يمكن أن يكون هذا المبلغ سالبًا.',
  e_invalid_number: 'أحد المبالغ ليس رقمًا.', e_invalid_date: 'هذا التاريخ غير موجود.', e_bank_accounts_required: 'أضف حسابًا بنكيًا واحدًا على الأقل.',
  e_required: 'أكمل جميع الحقول المطلوبة.', e_stale_plan: 'حفظ شخص آخر الخطة بعد فتحك لها. أعد التحميل ثم أدخل تغييرك مرة أخرى.',
  e_plan_locked: 'هذه الخطة مقفلة.', e_forbidden: 'صلاحيتك لا تسمح بذلك.', e_logo_type: 'استخدم صورة PNG أو JPEG أو WebP.', e_logo_size: 'يجب ألا يتجاوز الشعار ٥١٢ كيلوبايت.',
  e_theme_contrast: 'هذه الألوان صعبة القراءة. جرّب شعارًا آخر.', e_generic: 'حدث خطأ: {c}'
};

type Lang = 'en' | 'ar';
interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string | number>) => string; err: (code: string) => string; txt: (o: { en: string; ar: string } | null | undefined) => string }
const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => { try { return localStorage.getItem('cf13_lang') === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } });
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try { localStorage.setItem('cf13_lang', lang); } catch { /* private mode */ }
  }, [lang]);
  const t = useCallback((k: Key, vars?: Record<string, string | number>) => {
    let s = (lang === 'ar' ? AR : EN)[k] ?? EN[k] ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', String(b));
    return s;
  }, [lang]);
  const err = useCallback((code: string) => {
    const base = String(code).split(':')[0], key = ('e_' + base) as Key;
    if (base.startsWith('theme_contrast')) return t('e_theme_contrast');
    return key in EN ? t(key) : t('e_generic', { c: code });
  }, [t]);
  const txt = useCallback((o: { en: string; ar: string } | null | undefined) => (o ? (lang === 'ar' ? o.ar || o.en : o.en) : ''), [lang]);
  const v = useMemo(() => ({ lang, setLang: setLangState, t, err, txt }), [lang, t, err, txt]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export function useI18n(): I18n { const c = useContext(Ctx); if (!c) throw new Error('no i18n'); return c; }
