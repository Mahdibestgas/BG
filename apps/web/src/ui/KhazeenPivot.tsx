import { useState } from 'react';
import { useI18n } from '../i18n';
import { acc, date, m } from '../format';

export interface KhzCity { id: string; en: string; ar: string; daily: number[]; instalments: number[] }
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const COL = ['#C2552B', '#9A6A1C', '#5B6FB0', '#24756B'];   // white text on each stays above 4.5:1, in light and dark
const pcs = (p: number | null) => (p === null ? '–' : p < 0 ? '(' + Math.abs(p).toFixed(1) + '%)' : p.toFixed(1) + '%');

/** KHAZEEN gas purchases aggregated, pivoted by city and by month (a week counts in the month it starts in). */
export function KhazeenPivot({ cities, weeks, onOpen }: { cities: KhzCity[]; weeks: Array<{ start: string; label: string }>; onOpen?: () => void }) {
  const { lang } = useI18n();
  const T = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [split, setSplit] = useState(false);
  const months: Array<{ key: string; label: string; w: number[] }> = [];
  weeks.forEach((w, i) => {
    const key = w.start.slice(0, 7); let c = months.find((x) => x.key === key);
    if (!c) { c = { key, label: date(w.start, lang, { month: 'short' }), w: [] }; months.push(c); }
    c.w.push(i);
  });
  const tot = (c: KhzCity) => c.daily.map((v, i) => v + c.instalments[i]);
  const mv = (arr: number[]) => months.map((mo) => sum(mo.w.map((i) => arr[i])));
  const grand = sum(cities.map((c) => sum(tot(c)))) || 1;
  const allM = months.map((_, j) => sum(cities.map((c) => mv(tot(c))[j])));
  const allDaily = months.map((_, j) => sum(cities.map((c) => mv(c.daily)[j]))), allInst = months.map((_, j) => sum(cities.map((c) => mv(c.instalments)[j])));
  const name = (c: KhzCity) => (lang === 'ar' ? c.ar : c.en);
  return (
    <div className="khz">
      <div className="khz-bar" role="img" aria-label={T('Share of gas purchases by city', 'حصة مشتريات الغاز حسب المدينة')}>
        {cities.map((c, i) => <button type="button" key={c.id} style={{ width: (sum(tot(c)) / grand) * 100 + '%', background: COL[i % COL.length] }} onClick={onOpen} title={name(c) + ' · ' + m(sum(tot(c))) + ' · ' + ((sum(tot(c)) / grand) * 100).toFixed(1) + '%'}><span>{name(c)} {((sum(tot(c)) / grand) * 100).toFixed(0)}%</span></button>)}
      </div>
      <div className="khz-head">
        <span className="sub">{T('Aggregated KHAZEEN gas purchases, by city and month, SAR (VAT-inclusive)', 'مشتريات الغاز الإجمالية من خزين حسب المدينة والشهر، بالريال (شاملة الضريبة)')}</span>
        <label className="chk"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> {T('Split daily purchases and instalments', 'فصل المشتريات اليومية والأقساط')}</label>
      </div>
      <div className="khz-scroll">
        <table className="an-tbl khz-tbl">
          <thead><tr><th>{T('City', 'المدينة')}</th>{months.map((mo) => <th key={mo.key}>{mo.label}</th>)}<th>{T('Total', 'الإجمالي')}</th><th>{T('Share', 'الحصة')}</th><th>{T('Last vs first month', 'آخر شهر مقابل أول شهر')}</th></tr></thead>
          <tbody>
            {cities.map((c, i) => {
              const v = mv(tot(c)), t = sum(v), d = mv(c.daily), ins = mv(c.instalments);
              const ch = v[0] > 0.5 ? ((v[v.length - 1] - v[0]) / v[0]) * 100 : null;
              return [
                <tr key={c.id}><td><i className="dot" style={{ background: COL[i % COL.length] }} />{name(c)}</td>{v.map((x, j) => <td key={j} className="num">{acc(x)}</td>)}<td className="num"><b>{acc(t)}</b></td><td className="num">{((t / grand) * 100).toFixed(1)}%</td><td className={'num ' + (ch === null ? '' : ch >= 0 ? 'down' : 'up')}>{pcs(ch)}</td></tr>,
                ...(split ? [
                  <tr key={c.id + 'd'} className="sub"><td>{T('daily purchases', 'مشتريات يومية')}</td>{d.map((x, j) => <td key={j} className="num">{acc(x)}</td>)}<td className="num">{acc(sum(d))}</td><td /><td /></tr>,
                  <tr key={c.id + 'i'} className="sub"><td>{T('instalments', 'أقساط')}</td>{ins.map((x, j) => <td key={j} className="num">{acc(x)}</td>)}<td className="num">{acc(sum(ins))}</td><td /><td /></tr>
                ] : [])
              ];
            })}
            <tr className="tot"><td>{T('All cities', 'كل المدن')}</td>{allM.map((x, j) => <td key={j} className="num"><b>{acc(x)}</b></td>)}<td className="num"><b>{acc(sum(allM))}</b></td><td className="num">100%</td>
              <td className={'num ' + (allM[0] > 0.5 ? (allM[allM.length - 1] >= allM[0] ? 'down' : 'up') : '')}>{pcs(allM[0] > 0.5 ? ((allM[allM.length - 1] - allM[0]) / allM[0]) * 100 : null)}</td></tr>
            {split && <><tr className="sub"><td>{T('of which daily purchases', 'منها مشتريات يومية')}</td>{allDaily.map((x, j) => <td key={j} className="num">{acc(x)}</td>)}<td className="num">{acc(sum(allDaily))}</td><td /><td /></tr>
              <tr className="sub"><td>{T('of which instalments', 'منها أقساط')}</td>{allInst.map((x, j) => <td key={j} className="num">{acc(x)}</td>)}<td className="num">{acc(sum(allInst))}</td><td /><td /></tr></>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
