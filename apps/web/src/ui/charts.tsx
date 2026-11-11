import { useState } from 'react';
import type { Forecast } from '../api';
import { useI18n } from '../i18n';
import { date, m, sar } from '../format';

const niceMax = (v: number) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), x = v / p; return (x <= 1 ? 1 : x <= 2 ? 2 : x <= 5 ? 5 : 10) * p; };

/** Closing cash over the buffer zone, facility zone below zero, this week shaded. Mirrors in Arabic. */
export function Runway({ f, now }: { f: Forecast; now: number }) {
  const { t, lang } = useI18n();
  const [tip, setTip] = useState<number | null>(null);
  const c = f.l1.closing, N = c.length, buf = f.headline.minBuffer;
  const W = 1000, H = 330, L = lang === 'ar' ? 14 : 104, R = lang === 'ar' ? W - 104 : W - 14, T = 24, B = H - 42;
  const hi = niceMax(Math.max(...c, buf, 1) * 1.12), lo = Math.min(0, ...c) < 0 ? -niceMax(-Math.min(...c) * 1.15) : 0;
  const y = (v: number) => T + (hi - v) / (hi - lo) * (B - T);
  const x = (i: number) => { const p = L + (R - L) / N * (i + 0.5); return lang === 'ar' ? L + R - p : p; };
  const sw = (R - L) / N, low = f.headline.lowestWeek;
  const path = c.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const raw = (hi - lo) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-6; v += step) ticks.push(Math.round(v));
  const axisX = lang === 'ar' ? R + 8 : L - 10, anchor = lang === 'ar' ? 'start' : 'end';
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('runwayTitle')}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke="var(--rule)" /><text x={axisX} y={y(v) + 4} textAnchor={anchor} fontSize="12" fill="var(--ink2)">{m(v)}</text></g>)}
        {now >= 0 && <rect x={x(now) - sw / 2} y={T} width={sw} height={B - T} fill="var(--warn)" opacity=".08" />}
        <path d={`${path} L${x(N - 1)} ${y(Math.max(lo, 0))} L${x(0)} ${y(Math.max(lo, 0))}Z`} fill="var(--brand-soft)" opacity=".8" />
        {buf > 0 && <>
          <rect x={L} y={y(buf)} width={R - L} height={y(0) - y(buf)} fill="var(--warn-bg)" opacity=".8" />
          <line x1={L} x2={R} y1={y(buf)} y2={y(buf)} stroke="var(--warn)" strokeDasharray="3 5" />
        </>}
        {lo < 0 && <rect x={L} y={y(0)} width={R - L} height={y(lo) - y(0)} fill="var(--crit-bg)" opacity=".8" />}
        <line x1={L} x2={R} y1={y(0)} y2={y(0)} stroke="var(--ink2)" strokeOpacity=".6" />
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {c.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === low ? 6 : 3.8} fill={v < 0 ? 'var(--crit)' : v < buf ? 'var(--warn)' : i === low ? 'var(--warn)' : 'var(--brand)'} stroke="var(--surface)" strokeWidth="2" />)}
        <text x={x(low)} y={y(c[low]) + 24} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--warn)">{m(c[low])}</text>
        {f.weeks.map((w, i) => (
          <g key={i}>
            <text x={x(i)} y={B + 18} textAnchor="middle" fontSize="12" fontWeight={i === now ? 700 : 400} fill={i === now ? 'var(--ink)' : 'var(--ink2)'}>{w.label}</text>
            <text x={x(i)} y={B + 33} textAnchor="middle" fontSize="10.5" fill="var(--ink2)">{date(w.start, lang)}</text>
            <rect x={x(i) - sw / 2} y={T} width={sw} height={B - T} fill="transparent" tabIndex={0} aria-label={`${w.label} ${sar(c[i])}`}
              onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(i)} onBlur={() => setTip(null)} />
          </g>
        ))}
      </svg>
      {tip !== null && (
        <div className="tip num" style={{ left: (x(tip) / W * 100) + '%', top: `calc(${y(c[tip]) / H * 100}% - 12px)` }}>
          <b>{f.weeks[tip].label}</b> · {date(f.weeks[tip].start, lang)}–{date(f.weeks[tip].end, lang)}<br />
          {t('closing')}: {sar(c[tip])}<br />{t('net')}: {sar(f.l1.net[tip])}
        </div>
      )}
    </div>
  );
}

/** Receipts and payments per week: a chart of its own, its own scale (never a second axis). */
export function Bars({ f }: { f: Forecast }) {
  const { t, lang } = useI18n();
  const [tip, setTip] = useState<number | null>(null);
  const N = f.weeks.length, W = 1000, H = 230, L = lang === 'ar' ? 8 : 104, R = lang === 'ar' ? W - 104 : W - 8, T = 10, B = H - 26;
  const mx = niceMax(Math.max(...f.l1.receipts, ...f.l1.payments, 1));
  const y = (v: number) => B - v / mx * (B - T), step = (R - L) / N, bw = step * 0.28;
  const cx = (i: number) => { const p = L + step * (i + 0.5); return lang === 'ar' ? L + R - p : p; };
  const bar = (bx: number, v: number, fill: string, k: string) => {
    const top = y(v), r = Math.min(4, bw / 2, Math.max(0, B - top));
    return <path key={k} d={`M${bx} ${B}V${top + r}Q${bx} ${top} ${bx + r} ${top}H${bx + bw - r}Q${bx + bw} ${top} ${bx + bw} ${top + r}V${B}Z`} fill={fill} />;
  };
  const dir = lang === 'ar' ? -1 : 1;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('recPay')}>
        {[0, mx / 2, mx].map((v) => <g key={v}><line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke="var(--rule)" /><text x={lang === 'ar' ? R + 8 : L - 8} y={y(v) + 4} textAnchor={lang === 'ar' ? 'start' : 'end'} fontSize="11" fill="var(--ink2)">{m(v)}</text></g>)}
        {f.weeks.map((w, i) => (
          <g key={i}>
            {bar(cx(i) - dir * (bw / 2 + 1) - bw / 2, f.l1.receipts[i], 'var(--rec)', 'r')}
            {bar(cx(i) + dir * (bw / 2 + 1) - bw / 2, f.l1.payments[i], 'var(--pay)', 'p')}
            <text x={cx(i)} y={B + 17} textAnchor="middle" fontSize="11" fill="var(--ink2)">{w.label}</text>
            <rect x={cx(i) - step / 2} y={T} width={step} height={B - T} fill="transparent" onMouseEnter={() => setTip(i)} onMouseLeave={() => setTip(null)} />
          </g>
        ))}
      </svg>
      {tip !== null && (
        <div className="tip num" style={{ left: (cx(tip) / W * 100) + '%', top: `calc(${y(Math.max(f.l1.receipts[tip], f.l1.payments[tip])) / H * 100}% - 10px)` }}>
          <b>{f.weeks[tip].label}</b><br />{t('receipts')}: {sar(f.l1.receipts[tip])}<br />{t('payments')}: {sar(f.l1.payments[tip])}
        </div>
      )}
    </div>
  );
}
