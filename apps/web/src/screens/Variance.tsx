import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../App';
import { useI18n } from '../i18n';
import { acc, date } from '../format';

interface Row { cat: string; section: 'receipts' | 'payments'; forecast: number; actual: number }
interface Variance { start: string; through: string; days: number; rows: Row[]; notInPlan: { ownerIn: number; ownerOut: number; internal: number }; opening: number; forecastClose: number; actualClose: number }

const NAMES: Record<string, [string, string]> = {
  R_CASH: ['Cash collections', 'التحصيل النقدي'], R_POS: ['POS receipts', 'مقبوضات نقاط البيع'], R_CUSTOMERS: ['Customers', 'العملاء'], R_TRANSFERS: ['Transfers in', 'تحويلات واردة'], R_OTHER: ['Other receipts', 'مقبوضات أخرى'],
  P_KHAZEEN: ['Gas purchases (Khazeen)', 'مشتريات الغاز (خزين)'], P_PAYROLL: ['Payroll', 'الرواتب'], P_RENT: ['Rent', 'الإيجارات'], P_SUPPLIERS: ['Suppliers', 'الموردون'], P_RESIDENTS: ['Residence fees', 'رسوم الإقامات'], P_STAFF: ['Staff', 'الموظفون'],
  P_UTILITIES: ['Utilities', 'المرافق'], P_GOV: ['Government', 'حكومية'], P_POS_FEES: ['POS fees', 'عمولات نقاط البيع'], P_BANK: ['Bank charges', 'رسوم بنكية'], P_VAT: ['VAT', 'ضريبة القيمة المضافة'], P_LOAN: ['Loans', 'القروض'], P_CAPEX: ['Capex', 'مصروفات رأسمالية'], P_DIESEL: ['Fuel', 'الوقود'], P_GOSI: ['GOSI', 'التأمينات'],
};

export function VarianceScreen() {
  const s = useSession();
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [v, setV] = useState<Variance | null | undefined>(undefined);
  useEffect(() => { if (s.plan?.id) api<{ model: { variance?: Variance | null } }>('GET', `/api/plans/${s.plan.id}`).then((r) => setV(r.model?.variance || null)).catch(() => setV(null)); }, [s.plan?.id, s.plan?.version]);
  if (v === undefined) return <p className="sub">…</p>;
  if (!v) return <div><h1>{T('Forecast vs actual', 'المتوقع مقابل الفعلي')}</h1><p className="sub">{T('No actual days yet inside the plan: the bank sheet has not reached the plan start.', 'لا توجد أيام فعلية داخل الخطة بعد.')}</p></div>;

  const name = (c: string) => (NAMES[c] ? NAMES[c][lang === 'ar' ? 1 : 0] : c);
  const rec = v.rows.filter((r) => r.section === 'receipts'), pay = v.rows.filter((r) => r.section === 'payments');
  const tot = (a: Row[], k: 'forecast' | 'actual') => a.reduce((x, r) => x + r[k], 0);
  const fR = tot(rec, 'forecast'), aR = tot(rec, 'actual'), fP = tot(pay, 'forecast'), aP = tot(pay, 'actual');
  const closeGap = v.actualClose - v.forecastClose;
  // favourable to cash = more receipts or fewer payments than planned
  const fav = (r: Row) => (r.section === 'receipts' ? r.actual - r.forecast : r.forecast - r.actual);
  const pc = (r: Row) => (r.forecast > 0 ? ((r.actual - r.forecast) / r.forecast) * 100 : r.actual > 0 ? 100 : 0);
  const biggest = [...v.rows].sort((a, b) => Math.abs(fav(b)) - Math.abs(fav(a))).filter((r) => Math.abs(fav(r)) > 50000).slice(0, 5);
  const timing = pay.filter((r) => r.forecast > 0 && r.actual < r.forecast * 0.2 && r.forecast - r.actual > 50000);

  const Tbl = ({ title, rows, ft, at }: { title: string; rows: Row[]; ft: number; at: number }) => (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="ledger-wrap"><table className="ledger"><thead><tr><th style={{ textAlign: 'start' }}>{T('Line', 'البند')}</th><th>{T('Forecast', 'المتوقع')}</th><th>{T('Actual', 'الفعلي')}</th><th>{T('Difference', 'الفرق')}</th><th>%</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.cat}><td style={{ textAlign: 'start' }}>{name(r.cat)}</td><td>{acc(r.forecast)}</td><td>{acc(r.actual)}</td><td style={{ color: fav(r) < 0 ? '#b3261e' : undefined }}>{acc(r.actual - r.forecast)}</td><td>{r.forecast > 0 ? pc(r).toFixed(0) + '%' : '–'}</td></tr>)}
          <tr style={{ fontWeight: 700 }}><td style={{ textAlign: 'start' }}>{T('Total', 'الإجمالي')}</td><td>{acc(ft)}</td><td>{acc(at)}</td><td>{acc(at - ft)}</td><td>{ft > 0 ? (((at - ft) / ft) * 100).toFixed(0) + '%' : '–'}</td></tr>
        </tbody></table></div>
    </section>
  );

  const kpis: Array<[string, number]> = [[T('Opening cash', 'الرصيد الافتتاحي'), v.opening], [T('Forecast closing', 'الإقفال المتوقع'), v.forecastClose], [T('Actual closing', 'الإقفال الفعلي'), v.actualClose], [T('Actual vs forecast', 'الفعلي مقابل المتوقع'), closeGap]];
  return (
    <div>
      <h1>{T('Forecast vs actual', 'المتوقع مقابل الفعلي')}</h1>
      <p className="sub">{T(`${v.days} actual day(s): ${date(v.start, lang)} to ${date(v.through, lang)}. Amounts in SAR.`, `${v.days} يوم فعلي: من ${date(v.start, lang)} إلى ${date(v.through, lang)}. المبالغ بالريال.`)}</p>
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 16 }}>
        {kpis.map(([l, x]) => <div key={l}><div className="sub">{l}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{acc(x)}</div></div>)}
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>{T('What this means', 'ماذا يعني ذلك')}</h2>
        <ul>
          <li>{closeGap >= 0 ? T(`Cash closed ${acc(closeGap)} above the forecast.`, `أُقفل النقد أعلى من المتوقع بمبلغ ${acc(closeGap)}.`) : T(`Cash closed ${acc(-closeGap)} below the forecast.`, `أُقفل النقد أقل من المتوقع بمبلغ ${acc(-closeGap)}.`)}</li>
          <li>{T(`Receipts ${acc(aR)} against ${acc(fR)} forecast; payments ${acc(aP)} against ${acc(fP)}.`, `المقبوضات ${acc(aR)} مقابل ${acc(fR)} متوقع؛ المدفوعات ${acc(aP)} مقابل ${acc(fP)}.`)}</li>
          {biggest.map((r) => <li key={r.cat}>{name(r.cat)}: {fav(r) >= 0 ? T('favourable', 'لصالح النقد') : T('unfavourable', 'ضد النقد')} {acc(Math.abs(fav(r)))}.</li>)}
          {timing.length > 0 && <li>{T('Payments far below forecast may be timing (paid on another day), not savings: ', 'مدفوعات أقل بكثير من المتوقع قد تكون توقيتاً لا وفراً: ')}{timing.map((r) => name(r.cat)).join(', ')}.</li>}
          {(v.notInPlan.ownerIn || v.notInPlan.ownerOut || v.notInPlan.internal) ? <li>{T('Outside the plan (owner in / owner out / internal transfers): ', 'خارج الخطة (مالك وارد / مالك صادر / تحويلات داخلية): ')}{acc(v.notInPlan.ownerIn)} / {acc(v.notInPlan.ownerOut)} / {acc(v.notInPlan.internal)}.</li> : null}
        </ul>
        {v.days < 7 && <p className="sub">{T('Only a few days of actuals so far: single-day differences are mostly timing. Read the trend after a full week.', 'أيام فعلية قليلة حتى الآن: فروقات اليوم الواحد غالباً توقيت. اقرأ الاتجاه بعد أسبوع كامل.')}</p>}
      </section>
      <Tbl title={T('Receipts', 'المقبوضات')} rows={rec} ft={fR} at={aR} />
      <Tbl title={T('Payments', 'المدفوعات')} rows={pay} ft={fP} at={aP} />
    </div>
  );
}
