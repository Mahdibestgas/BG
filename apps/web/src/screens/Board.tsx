import { useEffect, useMemo, useState } from 'react';
import { Loading } from '../ui/Loading';
import { api, ApiError } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { date, m, planDays } from '../format';
import { useForecast } from './Overview';

interface Approval { id: string; at: string; changes: { planName: string; version: number; approvedBy: string; meeting: string; resolution: string; notes?: string; numbers: { opening: number; closing: number; lowest: number; receipts: number; payments: number; weeks: number; start: string } } }
interface Model {
  meta?: { name?: string; startDate?: string; weeks?: number };
  months?: Array<{ key: string; from: string; to: string; days: number }>;
  seasonality?: { applied: boolean; peak?: number; ramadan: { start: string; effect: number }; uplift?: { receipts: number; gas: number; net: number } | null; dataPeak?: number } | null;
  crossCheck?: { months: string[]; revenue: number[]; cogs: number[]; cashProfit: number[] } | null;
  rent?: { gaps: Array<{ type: string }>; potential: number; potentialOverdue: number } | null;
  khazeen?: { cities: Array<{ en: string; ar: string; daily: number[]; instalments: number[] }> } | null;
  opening?: { bankAccounts?: Array<{ name: string; balance: number }> };
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (x: number, d = 1) => (isFinite(x) ? x.toFixed(d) : '0.0') + '%';
type Tag = 'data' | 'mgmt' | 'assumed' | 'confirm';

export function Board() {
  const s = useSession();
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { f, error } = useForecast(s.plan?.id, s.plan?.version);
  const [model, setModel] = useState<Model>({});
  const [apps, setApps] = useState<Approval[]>([]);
  const [form, setForm] = useState({ approvedBy: '', meeting: new Date().toISOString().slice(0, 10), resolution: '', notes: '', confirm: false });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [busy, setBusy] = useState(false);

  const load = async () => {
    if (!s.plan?.id) return;
    const [a, b] = await Promise.all([api<{ model: Model }>('GET', `/api/plans/${s.plan.id}`), api<{ approvals: Approval[] }>('GET', `/api/plans/${s.plan.id}/approvals`).catch(() => ({ approvals: [] as Approval[] }))]);
    setModel(a.model || {}); setApps(b.approvals);
  };
  useEffect(() => { load().catch(() => {}); /* eslint-disable-next-line */ }, [s.plan?.id, s.plan?.version]);

  const D = useMemo(() => {
    if (!f) return null;
    const N = f.weeks.length, rec = f.l1.receipts, R = sum(rec), P = sum(f.l1.payments);
    const L = (id: string) => f.l2[id] || new Array(N).fill(0);
    const G = sum(L('P_KHAZEEN'));
    const opex = sum(['P_PAYROLL', 'P_GOSI', 'P_RESIDENTS', 'P_STAFF', 'P_RENT', 'P_UTILITIES', 'P_SUPPLIERS', 'P_DIESEL', 'P_GOV', 'P_POS_FEES', 'P_BANK'].map((id) => sum(L(id))));
    return { N, R, P, G, opex, L, open: f.l1.opening[0], end: f.l1.closing[N - 1], low: Math.min(...f.l1.closing), lowW: f.l1.closing.indexOf(Math.min(...f.l1.closing)), capex: sum(L('P_CAPEX')), vat: sum(L('P_VAT')), loan: sum(L('P_LOAN')) };
  }, [f]);

  if (error) return <p className="msg err">{error}</p>;
  if (!f || !D || !s.plan) return <Loading />;
  const { N, R, P, G, opex, open, end, low, lowW, capex, vat, loan } = D;
  const last = apps[0], cur = s.plan.version;
  const sea = model.seasonality, cc = model.crossCheck, rent = model.rent;
  const avg3 = (v: number[]) => (v.length >= 3 ? (v[v.length - 1] + v[v.length - 2] + v[v.length - 3]) / 3 : 0);
  const plDay = cc ? (avg3(cc.revenue) * 1.15) / 30.4 : 0, planDay = R / planDays(f.weeks);
  const plCogs = cc ? avg3(cc.cogs) / Math.max(1, avg3(cc.revenue)) : 0;
  const branch = model.opening?.bankAccounts?.find((a) => /فرع|branch/i.test(a.name));
  const cities = model.khazeen?.cities || [];
  const approved = !!last && last.changes.version === cur;
  const stale = !!last && last.changes.version !== cur;
  const end0 = f.weeks[N - 1].end;

  const rows: Array<{ en: string; ar: string; v: string; tag: Tag; src: string }> = [
    { en: 'Opening cash', ar: 'النقد الافتتاحي', v: m(open), tag: branch ? 'confirm' : 'data', src: T(`Bank balances at close of ${date(new Date(Date.parse(f.weeks[0].start) - 864e5).toISOString().slice(0, 10), lang)}, from the shared bank sheet.${branch ? ` ${m(branch.balance)} sits in the branch account: confirm it in the bank app.` : ''}`, `أرصدة البنك عند إقفال ${date(new Date(Date.parse(f.weeks[0].start) - 864e5).toISOString().slice(0, 10), lang)} من ملف البنك المشترك.${branch ? ` ${m(branch.balance)} في حساب الفرع: أكد الرصيد في تطبيق البنك.` : ''}`) },
    { en: 'Sales', ar: 'المبيعات', v: T(`${m(870000)} a day at the start, ${m(planDay)} average`, `${m(870000)} يوميًا في البداية، المتوسط ${m(planDay)}`), tag: cc && planDay > plDay * 1.08 ? 'confirm' : 'mgmt', src: cc ? T(`Finance's current run-rate. The P&L's last three months average about ${m(plDay)} a day including VAT.`, `معدل التشغيل الحالي من المالية. متوسط الأرباح والخسائر لآخر ثلاثة أشهر حوالي ${m(plDay)} يوميًا شاملة الضريبة.`) : T("Finance's current run-rate.", 'معدل التشغيل الحالي من المالية.') },
    { en: 'Gas season', ar: 'موسم الغاز', v: sea?.applied ? T(`peak ×${(sea.peak || 1).toFixed(2)} mid-January`, `الذروة ×${(sea.peak || 1).toFixed(2)} في منتصف يناير`) : T('not applied', 'غير مطبق'), tag: 'mgmt', src: T(`Shape from 22 months of the company's own sales; the peak is set by management (the data alone gave ×${(sea?.dataPeak || 1).toFixed(2)}). Ramadan from ${sea ? date(sea.ramadan.start, lang, { day: 'numeric', month: 'long' }) : '8 February'}, about ${sea ? pct(Math.abs(sea.ramadan.effect) * 100, 0) : '3%'} lower.`, `الشكل من 22 شهرًا من مبيعات الشركة؛ والذروة حددتها الإدارة (أعطت البيانات وحدها ×${(sea?.dataPeak || 1).toFixed(2)}). رمضان من ${sea ? date(sea.ramadan.start, lang, { day: 'numeric', month: 'long' }) : '8 فبراير'} بانخفاض حوالي ${sea ? pct(Math.abs(sea.ramadan.effect) * 100, 0) : '3%'}.`) },
    { en: 'Gas purchases (KHAZEEN)', ar: 'مشتريات الغاز (خزين)', v: `${m(G)} · ${pct((G / R) * 100)} ${T('of receipts', 'من المقبوضات')}`, tag: cc && plCogs - G / R > 0.03 ? 'confirm' : 'mgmt', src: T(`Daily purchases by city from the vendor schedule plus month-end instalments; scaled with sales. The P&L shows cost of sales at ${pct(plCogs * 100)} of revenue.`, `مشتريات يومية حسب المدينة من جدول الموردين مع أقساط نهاية الشهر؛ تتغير مع المبيعات. تُظهر الأرباح والخسائر تكلفة المبيعات ${pct(plCogs * 100)} من الإيراد.`) },
    { en: 'Payroll', ar: 'الرواتب', v: `${m(sum(D.L('P_PAYROLL')))}`, tag: 'data', src: T('SAR 786,310 a month on the 4th, from the bank actuals (October payroll); November remainder on 12 Nov.', '786,310 ريال شهريًا في الرابع، من فعليات البنك (رواتب أكتوبر)؛ المتبقي من نوفمبر في 12 نوفمبر.') },
    { en: 'Rent', ar: 'الإيجارات', v: m(sum(D.L('P_RENT'))), tag: rent && rent.gaps.length ? 'confirm' : 'data', src: T(`Every unpaid lease payment on its due date (lease file), overdue in week 1, by branch and landlord.${rent ? ` ${rent.gaps.length} items to review (new Arar contracts, two expired contracts, one unlisted contract).` : ''}`, `كل دفعة إيجار غير مسددة في موعدها (ملف العقود) والمتأخر في الأسبوع الأول، حسب الفرع والمؤجر.${rent ? ` ${rent.gaps.length} بنود للمراجعة (عقود عرعر الجديدة وعقدان منتهيان وعقد غير مدرج).` : ''}`) },
    { en: 'Loan instalments', ar: 'أقساط القرض', v: m(loan), tag: 'data', src: T('Al Rajhi POS financing contract: SAR 349,128.21 on the 16th of each month.', 'عقد تمويل الراجحي لنقاط البيع: 349,128.21 ريال في 16 من كل شهر.') },
    { en: 'VAT to ZATCA', ar: 'ضريبة القيمة المضافة', v: m(vat), tag: 'confirm', src: T('SAR 350,000 at each month end, per finance. Taking the plan’s own sales and gas as VAT-inclusive, the net would be nearer SAR 490,000 a month.', '350,000 ريال في نهاية كل شهر حسب المالية. وباعتبار المبيعات والغاز شاملة الضريبة يكون الصافي أقرب إلى 490,000 ريال شهريًا.') },
    { en: 'New vehicles', ar: 'المركبات الجديدة', v: m(capex), tag: 'assumed', src: T('Two truck heads (SAR 400,000, 26 Nov) and 15 Dyna at SAR 75,000 before VAT in five payments of SAR 258,750 on the 26th. Dates are assumed.', 'رأسا شاحنتين (400,000 ريال في 26 نوفمبر) و15 ديانا بسعر 75,000 قبل الضريبة على خمس دفعات 258,750 في 26 من كل شهر. التواريخ افتراضية.') },
    { en: 'Fuel, maintenance, medical, other suppliers', ar: 'الوقود والصيانة والتأمين الطبي وموردون آخرون', v: m(sum(D.L('P_SUPPLIERS')) + sum(D.L('P_STAFF'))), tag: 'mgmt', src: T('SAR 30,000, 15,000 and 19,000 a week, and SAR 11,000 a month (medical, at month end).', '30,000 و15,000 و19,000 ريال أسبوعيًا و11,000 ريال شهريًا (التأمين الطبي في نهاية الشهر).') }
  ];
  const tagName: Record<Tag, string> = { data: T('from data', 'من البيانات'), mgmt: T('management figure', 'رقم الإدارة'), assumed: T('assumed', 'افتراض'), confirm: T('to confirm', 'للتأكيد') };
  const salesCushion = (R - G) * 0.1;

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      await api('POST', `/api/plans/${s.plan!.id}/approve`, { ...form, version: cur });
      setMsg({ ok: true, t: T('Recorded. The approval is now in the permanent activity log.', 'تم التسجيل. الموافقة الآن في سجل النشاط الدائم.') });
      setForm({ ...form, confirm: false, resolution: '', notes: '' });
      await load();
    } catch (e) { setMsg({ ok: false, t: e instanceof ApiError ? e.code : 'network' }); }
    setBusy(false);
  }

  return (
    <div className="bd">
      <div className="head">
        <div><h1>{T('Board approval', 'اعتماد مجلس الإدارة')}</h1>
          <p className="sub">{T('The projection plan for the board to approve. Print it as the board paper.', 'خطة التوقعات المعروضة على المجلس للاعتماد. اطبعها كورقة للمجلس.')}</p></div>
        <div className="pills no-print"><button type="button" className="btn ghost" onClick={() => window.print()}>{T('Print / save as PDF', 'طباعة / حفظ PDF')}</button></div>
      </div>

      <section className={'bd-status an-in ' + (approved ? 'ok' : stale ? 'warn' : 'none')}>
        <b>{approved ? T('Approved by the board', 'معتمدة من مجلس الإدارة') : stale ? T('Approved earlier, changed since', 'اعتُمدت سابقًا وتغيّرت بعد ذلك') : T('Not yet approved', 'لم تُعتمد بعد')}</b>
        <span>{last
          ? approved ? T(`Version ${last.changes.version} approved on ${date(last.changes.meeting, lang, { day: 'numeric', month: 'long', year: 'numeric' })} (resolution ${last.changes.resolution}) by ${last.changes.approvedBy}.`, `اعتُمد الإصدار ${last.changes.version} في ${date(last.changes.meeting, lang, { day: 'numeric', month: 'long', year: 'numeric' })} (القرار ${last.changes.resolution}) من ${last.changes.approvedBy}.`)
            : T(`The board approved version ${last.changes.version} on ${date(last.changes.meeting, lang, { day: 'numeric', month: 'long', year: 'numeric' })}. This is now version ${cur}: closing cash then ${m(last.changes.numbers.closing)}, now ${m(end)} (${end - last.changes.numbers.closing >= 0 ? '+' : '-'}${m(Math.abs(end - last.changes.numbers.closing))}). Re-approval is needed.`, `اعتمد المجلس الإصدار ${last.changes.version} في ${date(last.changes.meeting, lang, { day: 'numeric', month: 'long', year: 'numeric' })}. الإصدار الحالي ${cur}: النقد الختامي حينها ${m(last.changes.numbers.closing)} والآن ${m(end)}. يلزم اعتماد جديد.`)
          : T('This plan has no recorded board approval. Management should not rely on it for commitments until it is approved.', 'لا توجد موافقة مسجلة من المجلس على هذه الخطة. على الإدارة عدم الاعتماد عليها في الالتزامات إلى أن تُعتمد.')}</span>
      </section>

      <section className="card an-in bd-paper" style={{ marginTop: 16 }}>
        <div className="bd-title"><span className="an-eyebrow">{s.tenant.name}</span><h2>{T('Cash projection', 'توقعات النقد')} · {date(f.weeks[0].start, lang, { day: 'numeric', month: 'long', year: 'numeric' })} – {date(end0, lang, { day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          <p className="sub">{s.plan.name} · {T('version', 'الإصدار')} {cur} · {N} {T('weeks', 'أسبوعًا')}</p></div>

        <h3 className="an-h3">{T('1. The board is asked to approve', '1. يُطلب من المجلس اعتماد')}</h3>
        <ol className="bd-res">
          <li>{T(`The ${N}-week cash projection from ${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long' })} to ${date(end0, lang, { day: 'numeric', month: 'long', year: 'numeric' })}: opening cash ${m(open)}, closing cash ${m(end)}, receipts ${m(R)} and payments ${m(P)}.`, `توقعات النقد لمدة ${N} أسبوعًا من ${date(f.weeks[0].start, lang, { day: 'numeric', month: 'long' })} إلى ${date(end0, lang, { day: 'numeric', month: 'long', year: 'numeric' })}: نقد افتتاحي ${m(open)} ونقد ختامي ${m(end)} ومقبوضات ${m(R)} ومدفوعات ${m(P)}.`)}</li>
          <li>{T(`Gas purchases from KHAZEEN of ${m(G)} (${cities.map((c) => `${c.en} ${m(sum(c.daily) + sum(c.instalments))}`).join(', ')}).`, `مشتريات الغاز من خزين بمبلغ ${m(G)} (${cities.map((c) => `${c.ar} ${m(sum(c.daily) + sum(c.instalments))}`).join('، ')}).`)}</li>
          <li>{T(`Capital purchases of ${m(capex)}: two truck heads and 15 Dyna trucks.`, `مشتريات رأسمالية بمبلغ ${m(capex)}: رأسا شاحنتين و15 شاحنة ديانا.`)}</li>
          <li>{T(`Scheduled payments of VAT ${m(vat)}, loan instalments ${m(loan)} and rent ${m(sum(D.L('P_RENT')))}.`, `الدفعات المجدولة: ضريبة القيمة المضافة ${m(vat)} وأقساط القرض ${m(loan)} والإيجارات ${m(sum(D.L('P_RENT')))}.`)}</li>
          <li>{T('That management operates within this plan and reports any variance beyond the agreed tolerance for re-approval.', 'أن تعمل الإدارة ضمن هذه الخطة وترفع أي انحراف يتجاوز الحد المتفق عليه لإعادة الاعتماد.')}</li>
        </ol>

        <h3 className="an-h3">{T('2. The headline', '2. الخلاصة')}</h3>
        <div className="an-kpis sm bd-kpis">
          <div className="an-kpi sm t-brand"><span className="l">{T('Opening cash', 'النقد الافتتاحي')}</span><span className="v num">{m(open)}</span></div>
          <div className="an-kpi sm t-rec"><span className="l">{T('Closing cash', 'النقد الختامي')}</span><span className="v num">{m(end)}</span><span className="s">{end >= open ? '+' : '-'}{m(Math.abs(end - open))}</span></div>
          <div className="an-kpi sm t-brand"><span className="l">{T('Lowest cash', 'أدنى نقد')}</span><span className="v num">{m(low)}</span><span className="s">{f.weeks[lowW].label} · {date(f.weeks[lowW].start, lang)}</span></div>
          <div className="an-kpi sm t-rec"><span className="l">{T('Receipts', 'المقبوضات')}</span><span className="v num">{m(R)}</span><span className="s">{m(R / planDays(f.weeks))} {T('a day', 'يوميًا')}</span></div>
          <div className="an-kpi sm t-pay"><span className="l">{T('Gas purchases', 'مشتريات الغاز')}</span><span className="v num">{m(G)}</span><span className="s">{pct((G / R) * 100)}</span></div>
          <div className="an-kpi sm t-rec"><span className="l">{T('Cash margin', 'الهامش النقدي')}</span><span className="v num">{pct(((R - G - opex) / R) * 100)}</span><span className="s">{T('after gas and running costs', 'بعد الغاز والمصاريف')}</span></div>
        </div>
        <p className="an-p">{T('No borrowing is needed: cash never falls below the lowest figure above.', 'لا حاجة للاقتراض: لا ينخفض النقد عن أدنى رقم أعلاه.')}</p>

        <h3 className="an-h3">{T('3. What the plan rests on', '3. على ماذا تقوم الخطة')}</h3>
        <div className="khz-scroll"><table className="an-tbl bd-tbl"><thead><tr><th>{T('Item', 'البند')}</th><th>{T('In the plan', 'في الخطة')}</th><th>{T('Status', 'الحالة')}</th><th>{T('Source and note', 'المصدر والملاحظة')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.en}><td>{lang === 'ar' ? r.ar : r.en}</td><td className="num">{r.v}</td><td><span className={'bd-tag ' + r.tag}>{tagName[r.tag]}</span></td><td className="note">{r.src}</td></tr>)}</tbody></table></div>

        <h3 className="an-h3">{T('4. Risks the board should weigh', '4. المخاطر التي ينبغي للمجلس تقديرها')}</h3>
        <ul className="bd-risk">
          <li><b>{T('Gas cost.', 'تكلفة الغاز.')}</b> {T(`Every 1 point on the gas ratio moves cash by ${m(R / 100)}. ${cc ? `The P&L's cost of sales is ${pct(plCogs * 100)} of revenue against ${pct((G / R) * 100)} here: if the P&L level held, cash would be about ${m(Math.max(0, (plCogs - G / R)) * R)} lower over the plan.` : ''}`, `كل نقطة في نسبة الغاز تحرك النقد بمقدار ${m(R / 100)}. ${cc ? `تكلفة المبيعات في الأرباح والخسائر ${pct(plCogs * 100)} من الإيراد مقابل ${pct((G / R) * 100)} هنا: لو استمر مستوى الأرباح والخسائر لانخفض النقد بحوالي ${m(Math.max(0, (plCogs - G / R)) * R)}.` : ''}`)}</li>
          <li><b>{T('Sales level.', 'مستوى المبيعات.')}</b> {T(`A 10% shortfall in sales, with gas following, would cost about ${m(salesCushion)} of cash.${cc && planDay > plDay ? ` The plan starts ${pct((planDay / plDay - 1) * 100, 0)} above the P&L's recent daily sales.` : ''}`, `نقص المبيعات 10% مع تبعية الغاز يكلف حوالي ${m(salesCushion)} من النقد.${cc && planDay > plDay ? ` تبدأ الخطة أعلى بنسبة ${pct((planDay / plDay - 1) * 100, 0)} من مبيعات الأرباح والخسائر الأخيرة.` : ''}`)}</li>
          <li><b>{T('Gas season and Ramadan.', 'موسم الغاز ورمضان.')}</b> {sea?.applied && sea.uplift ? T(`The season adds ${m(sea.uplift.net)} of cash. If winter demand is weaker, this goes; Ramadan starts on 8 February (moon sighting).`, `يضيف الموسم ${m(sea.uplift.net)} من النقد. وإذا ضعف طلب الشتاء فسيزول؛ ويبدأ رمضان في 8 فبراير (رؤية الهلال).`) : T('Not applied in this plan.', 'غير مطبق في هذه الخطة.')}</li>
          <li><b>{T('Tax and rent.', 'الضريبة والإيجار.')}</b> {T(`VAT is entered at SAR 350,000 a month; the plan's own figures imply about SAR 490,000. ${rent ? `The rent schedule needs review (${rent.gaps.length} items, about ${m(rent.potential + rent.potentialOverdue)} possibly missing).` : ''}`, `ضريبة القيمة المضافة مدخلة بـ 350,000 شهريًا بينما أرقام الخطة تعني حوالي 490,000. ${rent ? `يحتاج جدول الإيجارات إلى مراجعة (${rent.gaps.length} بنود، وقد يغيب حوالي ${m(rent.potential + rent.potentialOverdue)}).` : ''}`)}</li>
          <li><b>{T('Timing.', 'التوقيت.')}</b> {T(`The tightest week is ${f.weeks[lowW].label}; the heaviest payments fall at month end (VAT, instalments, payroll, rent).`, `أضيق أسبوع هو ${f.weeks[lowW].label}؛ وتقع أثقل المدفوعات في نهاية الشهر (الضريبة والأقساط والرواتب والإيجار).`)}</li>
        </ul>

        <h3 className="an-h3">{T('5. Approval', '5. الاعتماد')}</h3>
        <div className="bd-sign">
          <div><span>{T('Chair of the board', 'رئيس المجلس')}</span><i /></div>
          <div><span>{T('Board member', 'عضو المجلس')}</span><i /></div>
          <div><span>{T('Chief executive', 'الرئيس التنفيذي')}</span><i /></div>
          <div><span>{T('Date', 'التاريخ')}</span><i /></div>
        </div>
      </section>

      <section className="card an-in no-print" style={{ marginTop: 16 }}>
        <h2>{T('Record the board’s decision', 'سجّل قرار المجلس')}</h2>
        {s.me.role !== 'owner' ? <p className="sub">{T('Only the company owner can record an approval.', 'يمكن لمالك الشركة فقط تسجيل الموافقة.')}</p> : <>
          <p className="sub">{T(`This records that the board approved version ${cur} of this plan, with the numbers above. It does not change the plan. A later change to the plan will show here as “changed since approval”.`, `هذا يسجل أن المجلس اعتمد الإصدار ${cur} من هذه الخطة بالأرقام أعلاه. ولا يغيّر الخطة. وأي تغيير لاحق سيظهر هنا باسم «تغيّرت بعد الاعتماد».`)}</p>
          <div className="bd-form">
            <label><span>{T('Approved by (names of the board members)', 'اعتمدها (أسماء أعضاء المجلس)')}</span><input value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })} maxLength={300} /></label>
            <label><span>{T('Date of the meeting', 'تاريخ الاجتماع')}</span><input type="date" value={form.meeting} onChange={(e) => setForm({ ...form, meeting: e.target.value })} /></label>
            <label><span>{T('Resolution reference', 'رقم القرار')}</span><input value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} maxLength={80} /></label>
            <label><span>{T('Notes (optional)', 'ملاحظات (اختياري)')}</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={1000} /></label>
          </div>
          <label className="chk"><input type="checkbox" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} /> {T(`I confirm the board has approved version ${cur} of this plan.`, `أؤكد أن المجلس اعتمد الإصدار ${cur} من هذه الخطة.`)}</label>
          <div className="actions">
            <button type="button" className="btn" disabled={busy || !form.confirm || !form.approvedBy.trim() || !form.resolution.trim()} onClick={submit}>{busy ? T('Recording…', 'جارٍ التسجيل…') : T('Record approval', 'سجّل الاعتماد')}</button>
            {msg && <span className={'msg ' + (msg.ok ? 'ok' : 'err')}>{msg.t}</span>}
          </div>
        </>}
        {apps.length > 0 && <><h3 className="an-h3" style={{ marginTop: 16 }}>{T('Approval history', 'سجل الاعتمادات')}</h3>
          <ul className="bd-hist">{apps.map((a) => <li key={a.id}><b>{T('Version', 'الإصدار')} {a.changes.version}</b> · {date(a.changes.meeting, lang, { day: 'numeric', month: 'long', year: 'numeric' })} · {a.changes.resolution} · {a.changes.approvedBy}<span>{T('closing cash then', 'النقد الختامي حينها')} {m(a.changes.numbers.closing)} · {T('recorded', 'سُجّل')} {date(a.at.slice(0, 10), lang, { day: 'numeric', month: 'short', year: 'numeric' })}</span></li>)}</ul></>}
      </section>
    </div>
  );
}
