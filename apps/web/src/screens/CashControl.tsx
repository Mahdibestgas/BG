import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date, m, planDays } from '../format';
import { Loading } from '../ui/Loading';
import { useForecast } from './Overview';

/**
 * Cash control and ROI. Read as an auditor and a treasurer would: is there enough cash cover, is cash lying idle,
 * where do payments bunch up, what does collection cost, which controls are in place. Every recommendation is
 * worked out from the plan's own numbers and gives a rough SAR effect. The ROI calculator tests an investment
 * (payback, ROI, NPV, IRR) before it goes into a budget.
 */
const sum = (a: number[]) => a.reduce((t, x) => t + (x || 0), 0);
const pct = (x: number, d = 1) => (isFinite(x) ? (x * 100).toFixed(d) : '0') + '%';

type Rec = { tone: 'high' | 'med' | 'ok'; area: string; t: string; b: string; effect: number | null; effectNote: string; action: string; kind?: 'value' | 'cash' | 'need' };

export function CashControl() {
  const s = useSession();
  const nav = useNavigate();
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { f, error } = useForecast(s.plan?.id, s.plan?.version);
  const [rate, setRate] = useState(4.5);          // short-term deposit / financing rate, % a year
  const [sec, setSec] = useState<{ totp: boolean; emailOtp: boolean } | null>(null);
  const [people, setPeople] = useState<Array<{ role: string }> | null>(null);
  useEffect(() => {
    api<{ totp: boolean; emailOtp: boolean }>('GET', '/api/auth/security').then(setSec).catch(() => setSec(null));
    if (s.me.role === 'owner') api<{ members: Array<{ role: string }> }>('GET', '/api/members').then((r) => setPeople(r.members)).catch(() => setPeople(null));
  }, [s.me.role]);

  const A = useMemo(() => {
    if (!f) return null;
    const N = f.weeks.length, L = (id: string) => f.l2[id] || new Array(N).fill(0), tot = (id: string) => sum(L(id));
    const rec = f.l1.receipts, pay = f.l1.payments, close = f.l1.closing;
    const days = planDays(f.weeks), weeksN = days / 7, years = days / 365, avgPayW = sum(pay) / weeksN;
    const R = sum(rec), P = sum(pay), avgPay = P / weeksN, avgRec = R / weeksN;
    const buf = f.headline.minBuffer || 0, low = f.headline.lowestCash;
    // idle cash: what sits above the buffer plus the next 4 weeks' payments, on average over the plan
    // near the end of the plan fewer than four weeks remain: the missing weeks count at the average payment, so idle cash is not overstated
    const idle = close.map((c, i) => { const next = pay.slice(i + 1, i + 5); return Math.max(0, c - buf - sum(next) - (4 - next.length) * avgPayW); });
    const avgIdle = sum(idle) / Math.max(1, N);
    // weeks of cover at the lowest point
    const cover = avgPay ? low / avgPay : 0;
    // payment bunching
    const heavy = pay.map((v, i) => ({ v, i })).filter((x) => x.v > avgPay * 1.5).sort((a, b) => b.v - a.v);
    // collection cost
    const pos = tot('R_POS'), posFees = tot('P_POS_FEES'), bank = tot('P_BANK'), gas = tot('P_KHAZEEN'), cash = tot('R_CASH');
    const gasWeekly = gas / weeksN;
    return { N, R, P, avgPay, avgRec, buf, low, avgIdle, cover, heavy, pos, posFees, bank, gas, gasWeekly, cash, years, weeksN, close, idle };
  }, [f]);

  if (error) return <p className="msg err">{error}</p>;
  if (!f || !A) return <Loading />;
  const r = rate / 100;
  const recs: Rec[] = [];
  // 1. cover
  recs.push(A.cover < 2
    ? { tone: 'high', area: T('Liquidity', 'السيولة'), t: T('Cash cover is thin at the lowest point', 'تغطية النقد ضعيفة عند أدنى نقطة'), b: T(`At its lowest the bank holds ${m(A.low)}, about ${A.cover.toFixed(1)} weeks of average payments (${m(A.avgPay)} a week). Two weeks is a prudent floor for a distributor.`, `عند أدنى نقطة يكون الرصيد ${m(A.low)}، أي حوالي ${A.cover.toFixed(1)} أسبوع من متوسط المدفوعات (${m(A.avgPay)} أسبوعيًا). أسبوعان حد أدنى حذر لموزع.`), effect: Math.max(0, 2 * A.avgPay - A.low), kind: 'need', effectNote: T('extra cover needed', 'تغطية إضافية مطلوبة'), action: T('Agree a standby facility or move a large payment out of that week.', 'اتفق على تسهيل احتياطي أو أجّل دفعة كبيرة من ذلك الأسبوع.') }
    : { tone: 'ok', area: T('Liquidity', 'السيولة'), t: T('Cash cover is healthy', 'تغطية النقد جيدة'), b: T(`Even at its lowest the bank holds ${m(A.low)}, about ${A.cover.toFixed(1)} weeks of average payments.`, `حتى عند أدنى نقطة يكون الرصيد ${m(A.low)}، أي حوالي ${A.cover.toFixed(1)} أسبوع من المدفوعات.`), effect: null, effectNote: '', action: T('Keep the buffer; review monthly.', 'حافظ على الهامش وراجعه شهريًا.') });
  // 2. idle cash
  if (A.avgIdle > 100000) recs.push({ tone: 'med', area: T('Idle cash', 'النقد الخامل'), t: T('Cash is lying idle above what the next month needs', 'نقد خامل فوق حاجة الشهر القادم'), b: T(`On average ${m(A.avgIdle)} sits above the safety buffer plus the next four weeks of payments. Placed in a short Murabaha deposit at ${rate}% a year it would earn about the amount on the right over the plan.`, `في المتوسط يبقى ${m(A.avgIdle)} فوق هامش الأمان ومدفوعات الأسابيع الأربعة القادمة. إذا وُضع في وديعة مرابحة قصيرة بعائد ${rate}% سنويًا يحقق المبلغ الظاهر خلال الخطة.`), effect: A.avgIdle * r * A.years, effectNote: T('income over the plan', 'دخل خلال الخطة'), action: T('Sweep the surplus weekly into a 1-month deposit; keep the buffer on current account.', 'حوّل الفائض أسبوعيًا إلى وديعة شهرية واترك الهامش في الحساب الجاري.') });
  // 3. bunching
  if (A.heavy.length) recs.push({ tone: 'med', area: T('Payment timing', 'توقيت المدفوعات'), t: T(`${A.heavy.length} weeks carry more than 1.5× the usual payments`, `${A.heavy.length} أسابيع تتجاوز مدفوعاتها 1.5 ضعف المعتاد`), b: T(`The heaviest is ${f.weeks[A.heavy[0].i].label} (${date(f.weeks[A.heavy[0].i].start, lang)}) with ${m(A.heavy[0].v)} against ${m(A.avgPay)} in a normal week. Spreading these lowers the buffer you must hold.`, `أثقلها ${f.weeks[A.heavy[0].i].label} (${date(f.weeks[A.heavy[0].i].start, lang)}) بمبلغ ${m(A.heavy[0].v)} مقابل ${m(A.avgPay)} في أسبوع عادي. توزيعها يخفض الهامش المطلوب.`), effect: (A.heavy[0].v - A.avgPay) * r * (28 / 365), effectNote: T('carrying cost saved a month', 'تكلفة احتفاظ موفرة شهريًا'), action: T('Agree fixed payment days with large suppliers and landlords; split annual rents into quarters.', 'اتفق على أيام دفع ثابتة مع كبار الموردين والملاك وقسّم الإيجارات السنوية إلى أرباع.') });
  // 4. gas supplier credit
  if (A.gas > 0) recs.push({ tone: 'med', area: T('Working capital', 'رأس المال العامل'), t: T('Each extra week of credit from gas suppliers frees cash', 'كل أسبوع ائتمان إضافي من موردي الغاز يحرر نقدًا'), b: T(`Gas purchases average ${m(A.gasWeekly)} a week (${pct(A.gas / Math.max(1, A.R))} of receipts). Moving from cash-on-delivery to 7 days' credit releases about one week of purchases, once, for good.`, `مشتريات الغاز بمتوسط ${m(A.gasWeekly)} أسبوعيًا (${pct(A.gas / Math.max(1, A.R))} من المقبوضات). الانتقال من الدفع عند التسليم إلى ائتمان 7 أيام يحرر مشتريات أسبوع مرة واحدة دائمًا.`), effect: A.gasWeekly, kind: 'cash', effectNote: T(`cash released once; worth ${m(A.gasWeekly * r)} a year`, `نقد يُحرر مرة واحدة؛ قيمته ${m(A.gasWeekly * r)} سنويًا`), action: T('Negotiate 7–14 days with the main supplier against a bank guarantee if needed.', 'فاوض المورد الرئيسي على 7–14 يومًا مقابل ضمان بنكي عند الحاجة.') });
  // 5. POS fees
  if (A.pos > 0 && A.posFees > 0) { const feeRate = A.posFees / A.pos; recs.push({ tone: feeRate > 0.008 ? 'med' : 'ok', area: T('Collection cost', 'تكلفة التحصيل'), t: T(`Card collection costs ${pct(feeRate, 2)} of card receipts`, `تحصيل البطاقات يكلف ${pct(feeRate, 2)} من مقبوضاتها`), b: T(`POS fees and card returns are ${m(A.posFees)} on ${m(A.pos)} of card receipts (returns inflate the rate a little). Every 0.10% cut in the rate saves the amount on the right over the plan.`, `رسوم نقاط البيع ومرتجعات البطاقات ${m(A.posFees)} على ${m(A.pos)} من مقبوضات البطاقات (المرتجعات ترفع النسبة قليلًا). كل خفض 0.10% في النسبة يوفر المبلغ الظاهر خلال الخطة.`), effect: A.pos * 0.001, effectNote: T('saved per 0.10% cut', 'وفر لكل خفض 0.10%'), action: T('Ask two banks for mada/POS quotes; the volume supports a lower rate.', 'اطلب عروض مدى/نقاط بيع من بنكين؛ الحجم يبرر نسبة أقل.') }); }
  // 6. cash handling
  if (A.cash > 0) recs.push({ tone: 'med', area: T('Cash control', 'رقابة النقد'), t: T('Branch cash is a large share of receipts', 'نقد الفروع حصة كبيرة من المقبوضات'), b: T(`${m(A.cash)} (${pct(A.cash / Math.max(1, A.R))} of receipts) is cash banked from branches. Cash held overnight is the main loss risk in distribution.`, `${m(A.cash)} (${pct(A.cash / Math.max(1, A.R))} من المقبوضات) نقد مودع من الفروع. النقد المحتفظ به ليلًا هو خطر الخسارة الرئيسي في التوزيع.`), effect: null, effectNote: '', action: T('Daily deposits, sales-to-deposit reconciliation every day, surprise counts monthly, and a push toward POS.', 'إيداع يومي ومطابقة المبيعات مع الإيداع يوميًا وجرد مفاجئ شهريًا وتشجيع الدفع بالبطاقة.') });
  // 7. bank charges
  if (A.bank > 0) recs.push({ tone: 'ok', area: T('Bank charges', 'الرسوم البنكية'), t: T(`Bank charges are ${pct(A.bank / Math.max(1, A.P), 2)} of payments`, `الرسوم البنكية ${pct(A.bank / Math.max(1, A.P), 2)} من المدفوعات`), b: T(`${m(A.bank)} over the plan. Bundle transfers and use the bank's corporate package to cap per-transfer fees.`, `${m(A.bank)} خلال الخطة. اجمع التحويلات واستخدم الباقة المؤسسية لتحديد رسوم التحويل.`), effect: A.bank * 0.2, effectNote: T('if cut by a fifth', 'إذا خُفضت بالخمس'), action: T('Review the bank tariff once a year.', 'راجع تعرفة البنك سنويًا.') });

  // controls checklist (what the system can see)
  const owners = people ? people.filter((p) => p.role === 'owner').length : null, finance = people ? people.filter((p) => p.role === 'finance').length : null, heads = people ? people.filter((p) => p.role === 'contributor').length : null;
  const controls: Array<{ ok: boolean | null; t: string; how: string }> = [
    { ok: sec ? sec.totp || sec.emailOtp : null, t: T('Second sign-in step on your account', 'خطوة دخول ثانية على حسابك'), how: T('Account → Email codes or Authenticator app.', 'الحساب ← رموز البريد أو تطبيق المصادقة.') },
    { ok: heads === null ? null : heads > 0, t: T('Budgets prepared by department heads, approved by the owner', 'الميزانيات يعدها مديرو الإدارات ويعتمدها المالك'), how: T('People and invitations → Department head for each department.', 'الفريق والدعوات ← مدير إدارة لكل إدارة.') },
    { ok: finance === null ? null : finance > 0, t: T('A finance reviewer separate from the owner (segregation of duties)', 'مراجع مالي منفصل عن المالك (فصل المهام)'), how: T('Invite a Finance user to review and return budgets.', 'ادعُ مستخدمًا ماليًا لمراجعة الميزانيات وإعادتها.') },
    { ok: owners === null ? null : owners <= 2, t: T('Few owners: full rights kept to one or two people', 'عدد قليل من المالكين: الصلاحية الكاملة لشخص أو اثنين'), how: T('Give others Finance, Department head or Viewer.', 'امنح الآخرين صلاحية مالية أو مدير إدارة أو مشاهد.') },
    { ok: f.checks.every((c) => c.ok), t: T('Every engine check passes (cash rolls forward, levels tie)', 'كل فحوصات المحرك ناجحة (النقد يُرحَّل والمستويات متطابقة)'), how: T('Load plan files only from the bank pipeline.', 'حمّل ملفات الخطط من مسار البنك فقط.') },
    { ok: null, t: T('Weekly bank reconciliation against this plan', 'مطابقة بنكية أسبوعية مع هذه الخطة'), how: T('Load actuals each week; review Forecast vs actual.', 'حمّل الفعلي أسبوعيًا وراجع التوقع مقابل الفعلي.') },
    { ok: null, t: T('Dual approval for payments above a limit', 'اعتماد مزدوج للمدفوعات فوق حد معين'), how: T('Set it in the bank portal (e.g. above SAR 100,000).', 'فعّلها في بوابة البنك (مثلًا فوق 100,000 ريال).') },
    { ok: null, t: T('Daily backup kept outside the system', 'نسخة احتياطية يومية خارج النظام'), how: T('Companies → Backups.', 'الشركات ← النسخ الاحتياطية.') }
  ];
  const effectTotal = sum(recs.filter((x) => x.effect && (x.kind || 'value') === 'value').map((x) => x.effect || 0));
  const cashFreed = sum(recs.filter((x) => x.effect && x.kind === 'cash').map((x) => x.effect || 0));

  return (
    <div className="cc">
      <div className="head"><div><h1>{T('Cash control and ROI', 'رقابة النقد والعائد')}</h1>
        <p className="sub">{T('Read like an auditor and a treasurer: cover, idle cash, timing, collection cost and controls, each with a rough SAR effect. Worked out from the plan on screen.', 'بعين المدقق وأمين الخزينة: التغطية والنقد الخامل والتوقيت وتكلفة التحصيل والضوابط، مع أثر تقريبي بالريال. محسوبة من الخطة المعروضة.')}</p></div>
        <label className="field cc-rate"><span>{T('Deposit / financing rate, % a year', 'عائد الوديعة / التمويل، % سنويًا')}</span><input type="number" min={0} max={20} step={0.25} value={rate} onChange={(e) => setRate(Math.max(0, Number(e.target.value) || 0))} /></label>
      </div>

      <div className="an-kpis">
        <div className="an-kpi t-brand"><span className="l">{T('Lowest cash', 'أدنى نقد')}</span><span className="v num">{m(A.low)}</span><span className="s">{A.cover.toFixed(1)} {T('weeks of payments', 'أسابيع من المدفوعات')}</span></div>
        <div className="an-kpi t-brand"><span className="l">{T('Idle cash on average', 'متوسط النقد الخامل')}</span><span className="v num">{m(A.avgIdle)}</span><span className="s">{T('above buffer + next 4 weeks', 'فوق الهامش + 4 أسابيع')}</span></div>
        <div className="an-kpi t-pay"><span className="l">{T('Payments a week', 'المدفوعات أسبوعيًا')}</span><span className="v num">{m(A.avgPay)}</span><span className="s">{A.heavy.length} {T('heavy weeks', 'أسابيع ثقيلة')}</span></div>
        <div className="an-kpi t-rec"><span className="l">{T('Rough value of the actions', 'القيمة التقريبية للإجراءات')}</span><span className="v num">{m(effectTotal)}</span><span className="s">{T('income and savings', 'دخل ووفر')}{cashFreed ? ' · ' + T('plus ', 'ونقد محرر ') + m(cashFreed) + T(' cash released', '') : ''}</span></div>
      </div>

      <section className="card" style={{ marginTop: 20 }}>
        <h2>{T('Recommendations', 'التوصيات')}</h2>
        <ul className="cc-recs">{recs.map((x, i) => (
          <li key={i} className={x.tone}>
            <div className="cc-r-main"><span className={'pri ' + (x.tone === 'high' ? 'high' : x.tone === 'med' ? 'med' : 'info')}>{x.area}</span><b>{x.t}</b><p>{x.b}</p><p className="cc-do"><b>{T('Do: ', 'الإجراء: ')}</b>{x.action}</p></div>
            {x.effect !== null && <div className="cc-r-eff"><b className="num">{m(x.effect)}</b><span>{x.effectNote}</span></div>}
          </li>))}</ul>
        <p className="sub" style={{ marginTop: 8 }}>{T('Effects are rough, before tax, and use the rate above. They are a guide for the decision, not a promise.', 'الآثار تقريبية قبل الضريبة وتستخدم العائد أعلاه. هي دليل للقرار وليست وعدًا.')}</p>
      </section>

      <div className="grid cc-two" style={{ marginTop: 20 }}>
        <section className="card">
          <h2>{T('Controls checklist', 'قائمة الضوابط')}</h2>
          <ul className="cc-ctl">{controls.map((c, i) => <li key={i} className={c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na'}><b aria-hidden="true">{c.ok === true ? '✓' : c.ok === false ? '!' : '?'}</b><div><span>{c.t}</span><small>{c.ok === null ? T('Outside the system: confirm it. ', 'خارج النظام: تأكد منه. ') : ''}{c.how}</small></div></li>)}</ul>
        </section>
        <RoiCalc rate={rate} />
      </div>
      <p className="sub" style={{ marginTop: 12 }}><button type="button" className="link" onClick={() => nav('/analysis')}>{T('See why the cash moves →', 'لماذا يتحرك النقد ←')}</button></p>
    </div>
  );
}

/** Investment test: payback, simple ROI, NPV and IRR from a few inputs, with ready examples for a gas distributor. */
function RoiCalc({ rate }: { rate: number }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const presets = [
    { k: 'truck', n: T('New delivery truck', 'شاحنة توصيل جديدة'), cost: 450000, gain: 18000, months: 60, residual: 90000 },
    { k: 'branch', n: T('New branch', 'فرع جديد'), cost: 600000, gain: 30000, months: 60, residual: 0 },
    { k: 'cyl', n: T('1,000 new cylinders', '1,000 أسطوانة جديدة'), cost: 250000, gain: 9000, months: 84, residual: 25000 },
    { k: 'pos', n: T('POS terminals for all branches', 'أجهزة نقاط بيع لكل الفروع'), cost: 40000, gain: 3500, months: 36, residual: 0 }
  ];
  const [v, setV] = useState({ name: presets[0].n, cost: presets[0].cost, gain: presets[0].gain, months: presets[0].months, residual: presets[0].residual, ramp: 3 });
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: k === 'name' ? x : Math.max(0, Number(x) || 0) });
  // monthly cash flows: ramp-up months earn half
  const flows = Array.from({ length: v.months }, (_, i) => (i < v.ramp ? v.gain / 2 : v.gain) + (i === v.months - 1 ? v.residual : 0));
  const total = sum(flows), profit = total - v.cost;
  let cum = -v.cost, payback: number | null = null;
  flows.forEach((x, i) => { cum += x; if (payback === null && cum >= 0) payback = i + 1; });
  const mr = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const npv = -v.cost + flows.reduce((t, x, i) => t + x / Math.pow(1 + mr, i + 1), 0);
  // IRR by bisection on the monthly rate, annualised
  let lo = -0.99, hi = 1, irr: number | null = null;
  const f = (q: number) => -v.cost + flows.reduce((t, x, i) => t + x / Math.pow(1 + q, i + 1), 0);
  if (f(lo) * f(hi) < 0) { for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; } irr = Math.pow(1 + (lo + hi) / 2, 12) - 1; }
  const roiYear = v.cost ? (profit / v.cost) / (v.months / 12) : 0;
  const verdict = npv > 0 && (payback ?? 999) <= v.months * 0.6 ? 'go' : npv > 0 ? 'maybe' : 'no';
  return (
    <section className="card roi">
      <h2>{T('ROI calculator', 'حاسبة العائد على الاستثمار')}</h2>
      <div className="roi-presets">{presets.map((p) => <button key={p.k} type="button" className="pill" onClick={() => setV({ name: p.n, cost: p.cost, gain: p.gain, months: p.months, residual: p.residual, ramp: 3 })}>{p.n}</button>)}</div>
      <div className="roi-form">
        <label className="field"><span>{T('Investment', 'الاستثمار')}</span><input value={v.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>{T('Cost (SAR, ex VAT)', 'التكلفة (ريال، بدون ضريبة)')}</span><input type="number" value={v.cost} onChange={(e) => set('cost', e.target.value)} /></label>
        <label className="field"><span>{T('Extra cash profit a month', 'ربح نقدي إضافي شهريًا')}</span><input type="number" value={v.gain} onChange={(e) => set('gain', e.target.value)} /></label>
        <label className="field"><span>{T('Useful life, months', 'العمر الإنتاجي، أشهر')}</span><input type="number" value={v.months} onChange={(e) => set('months', e.target.value)} /></label>
        <label className="field"><span>{T('Resale value at the end', 'قيمة البيع في النهاية')}</span><input type="number" value={v.residual} onChange={(e) => set('residual', e.target.value)} /></label>
        <label className="field"><span>{T('Ramp-up months (half profit)', 'أشهر البدء (نصف الربح)')}</span><input type="number" value={v.ramp} onChange={(e) => set('ramp', e.target.value)} /></label>
      </div>
      {(() => {
        // cumulative cash: starts at minus the cost, crosses zero at payback
        const W = 600, H = 170, P = 14, cumv: number[] = []; let c = -v.cost; cumv.push(c); flows.forEach((x) => { c += x; cumv.push(c); });
        const lo = Math.min(...cumv), hi = Math.max(0, ...cumv), x = (i: number) => P + (W - 2 * P) * (i / Math.max(1, cumv.length - 1)), y = (val: number) => P + ((hi - val) / ((hi - lo) || 1)) * (H - 2 * P);
        const d = cumv.map((val, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(val).toFixed(1)).join(' ');
        return (
          <svg viewBox={`0 0 ${W} ${H}`} className="roi-curve" role="img" aria-label={T('Cumulative cash of the investment', 'النقد التراكمي للاستثمار')} key={v.cost + '-' + v.gain + '-' + v.months}>
            <defs><linearGradient id="roi-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--good)" stopOpacity=".28" /><stop offset="1" stopColor="var(--good)" stopOpacity="0" /></linearGradient>
              <clipPath id="roi-up"><rect x="0" y="0" width={W} height={y(0)} /></clipPath><clipPath id="roi-dn"><rect x="0" y={y(0)} width={W} height={H} /></clipPath></defs>
            <path d={`${d} L${x(cumv.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z`} fill="url(#roi-g)" clipPath="url(#roi-up)" className="roi-area" />
            <path d={`${d} L${x(cumv.length - 1)} ${y(0)} L${x(0)} ${y(0)}Z`} fill="var(--crit)" fillOpacity=".14" clipPath="url(#roi-dn)" className="roi-area" />
            <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--ink2)" strokeOpacity=".5" strokeDasharray="4 5" />
            <path d={d} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="roi-line" />
            {payback && <g className="roi-pb"><circle cx={x(payback)} cy={y(0)} r="6" fill="var(--surface)" stroke="var(--good)" strokeWidth="3" />
              <text x={x(payback)} y={y(0) - 12} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--good)">{T('break-even', 'نقطة التعادل')} · {payback}{T(' mo', ' ش')}</text></g>}
            <text x={P} y={H - 2} fontSize="11" fill="var(--ink2)">{m(-v.cost)}</text>
            <text x={W - P} y={y(cumv[cumv.length - 1]) - 8} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--ink)">{m(cumv[cumv.length - 1])}</text>
          </svg>);
      })()}
      <div className={'roi-out ' + verdict}>
        <div><span>{T('Payback', 'الاسترداد')}</span><b className="num">{payback ? `${payback} ${T('months', 'شهرًا')}` : T('not within life', 'لا يتم خلال العمر')}</b></div>
        <div><span>{T('ROI a year', 'العائد سنويًا')}</span><b className="num">{pct(roiYear)}</b></div>
        <div><span>{T('NPV at ', 'صافي القيمة الحالية عند ')}{rate}%</span><b className="num">{acc(Math.round(npv))}</b></div>
        <div><span>IRR</span><b className="num">{irr === null ? '–' : pct(irr)}</b></div>
      </div>
      <p className="roi-verdict">{verdict === 'go' ? T(`${v.name}: worth doing. It pays back in ${payback} months and earns more than the ${rate}% the cash would earn on deposit.`, `${v.name}: مجدٍ. يسترد خلال ${payback} شهرًا ويحقق أكثر من ${rate}% التي يحققها النقد في وديعة.`)
        : verdict === 'maybe' ? T(`${v.name}: positive but slow. It pays back late in its life; check the profit estimate and the resale value before approving.`, `${v.name}: إيجابي لكنه بطيء. يسترد متأخرًا؛ راجع تقدير الربح وقيمة البيع قبل الاعتماد.`)
        : T(`${v.name}: not worth it at these numbers. The cash earns more on deposit at ${rate}%.`, `${v.name}: غير مجدٍ بهذه الأرقام. النقد يحقق أكثر في وديعة بعائد ${rate}%.`)}</p>
      <p className="sub">{T('Rough: profit is cash before tax and financing; ramp-up months earn half.', 'تقريبي: الربح نقدي قبل الضريبة والتمويل؛ أشهر البدء بنصف الربح.')}</p>
    </section>
  );
}
