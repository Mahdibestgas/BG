import { Fragment, useState } from 'react';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';

export interface RentContract {
  contract: string; branch: { en: string; ar: string }; landlord: string; annual: number; freq: string; start: string | null; end: string | null; status: string;
  monthly: number[]; total: number; payments: Array<{ due: string; amount: number; when: string; overdue: boolean }>;
}
export interface RentGap { type: string; contract: string; en: string; ar: string; annual?: number; items: Array<{ due: string; amount: number; before_study?: boolean }> }
export interface RentBlock { contracts: RentContract[]; gaps: RentGap[]; potential: number; potentialOverdue: number }
export interface PlanMonthInfo { key: string; from: string; to: string; days: number }
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** All rent in the plan by branch or landlord and by calendar month, each contract opening to its payments, plus what the schedule may be missing. */
export function RentBreakdown({ rent, months }: { rent: RentBlock; months: PlanMonthInfo[] }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [by, setBy] = useState<'branch' | 'landlord'>('branch');
  const [openK, setOpenK] = useState<string | null>(null);
  const cs = rent.contracts.filter((c) => c.total > 0.5);
  const key = (c: RentContract) => (by === 'branch' ? (lang === 'ar' ? c.branch.ar : c.branch.en) : c.landlord || T('(landlord not recorded)', '(المؤجر غير مسجل)'));
  const groups = new Map<string, RentContract[]>();
  cs.forEach((c) => { const k = key(c); groups.set(k, [...(groups.get(k) || []), c]); });
  const rows = [...groups.entries()].map(([k, list]) => ({ k, list, monthly: months.map((_, j) => sum(list.map((c) => c.monthly[j] || 0))), total: sum(list.map((c) => c.total)) })).sort((a, b) => b.total - a.total);
  const grand = sum(rows.map((r) => r.total)) || 1;
  const colM = months.map((_, j) => sum(rows.map((r) => r.monthly[j])));
  return (
    <div className="rent">
      <div className="khz-head">
        <span className="sub">{T('Rent paid in the study, by calendar month (SAR, as paid; overdue payments sit in the first month).', 'الإيجارات المدفوعة خلال الدراسة حسب الشهر التقويمي (بالريال كما تُدفع؛ المتأخرات في الشهر الأول).')}</span>
        <div className="seg" role="group">
          <button type="button" aria-pressed={by === 'branch'} onClick={() => setBy('branch')}>{T('By branch', 'حسب الفرع')}</button>
          <button type="button" aria-pressed={by === 'landlord'} onClick={() => setBy('landlord')}>{T('By landlord', 'حسب المؤجر')}</button>
        </div>
      </div>
      <div className="khz-scroll">
        <table className="an-tbl khz-tbl">
          <thead><tr><th>{by === 'branch' ? T('Branch', 'الفرع') : T('Landlord', 'المؤجر')}</th>{months.map((mo) => <th key={mo.key}>{date(mo.from, lang, { month: 'short' })}</th>)}<th>{T('Total', 'الإجمالي')}</th><th>{T('Share', 'الحصة')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.k}>
                <tr className="clk" onClick={() => setOpenK(openK === r.k ? null : r.k)}><td><span className="ch">{openK === r.k ? '⌄' : '›'}</span> {r.k} <span className="cnt">{r.list.length > 1 ? T(`${r.list.length} contracts`, `${r.list.length} عقود`) : ''}</span></td>
                  {r.monthly.map((v, j) => <td key={j} className="num">{acc(v)}</td>)}<td className="num"><b>{acc(r.total)}</b></td><td className="num">{((r.total / grand) * 100).toFixed(1)}%</td></tr>
                {openK === r.k && r.list.map((c) => (
                  <Fragment key={c.contract}>
                    <tr className="sub"><td>{by === 'branch' ? (c.landlord || T('(landlord not recorded)', '(المؤجر غير مسجل)')) : (lang === 'ar' ? c.branch.ar : c.branch.en)} · {c.contract} · {c.freq} · {T('annual', 'سنوي')} {acc(c.annual)}{c.end ? ' · ' + T('ends', 'ينتهي') + ' ' + date(c.end, lang, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</td>
                      {c.monthly.map((v, j) => <td key={j} className="num">{acc(v)}</td>)}<td className="num">{acc(c.total)}</td><td /></tr>
                    {c.payments.map((p, i) => <tr key={i} className="sub pay"><td>{T('payment due', 'دفعة مستحقة')} {date(p.due, lang, { day: 'numeric', month: 'short', year: 'numeric' })}{p.overdue ? ' · ' + T('overdue, placed on', 'متأخرة، توضع في') + ' ' + date(p.when, lang, { day: 'numeric', month: 'short' }) : ''}</td><td colSpan={months.length} /><td className="num">{acc(p.amount)}</td><td /></tr>)}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            <tr className="tot"><td>{T('All rent', 'كل الإيجارات')}</td>{colM.map((v, j) => <td key={j} className="num"><b>{acc(v)}</b></td>)}<td className="num"><b>{acc(sum(colM))}</b></td><td className="num">100%</td></tr>
          </tbody>
        </table>
      </div>
      {rent.gaps.length > 0 && (
        <div className="rent-gaps">
          <h3 className="an-h3">{T('Rent review: what the schedule may be missing', 'مراجعة الإيجارات: ما قد يغيب عن الجدول')}</h3>
          <p className="sub">{T(`Not in the plan until you confirm. In the study: ${m(rent.potential)}. Possibly unpaid from before the study: ${m(rent.potentialOverdue)} (renewals) plus the first payments of the three new Arar contracts.`, `غير مدرجة في الخطة حتى تؤكد. داخل الدراسة: ${m(rent.potential)}. وقد تكون غير مدفوعة قبل الدراسة: ${m(rent.potentialOverdue)} (تجديدات) إضافة إلى الدفعات الأولى لعقود عرعر الثلاثة الجديدة.`)}</p>
          <ul>{rent.gaps.map((g, i) => (
            <li key={i} className={g.type}><b>{lang === 'ar' ? g.ar : g.en}</b>
              {g.items.length > 0 && <span className="its">{g.items.map((it) => `${date(it.due, lang, { day: 'numeric', month: 'short', year: 'numeric' })}: ${m(it.amount)}${it.before_study ? ' ' + T('(before the study: was it paid?)', '(قبل الدراسة: هل دُفعت؟)') : ''}`).join(' · ')}</span>}</li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}
