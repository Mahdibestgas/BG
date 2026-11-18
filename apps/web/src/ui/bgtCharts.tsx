// Budget charts: month columns with an EBITDA line, a donut by department, bars by city, budget-vs-actual lines and the
// biggest variances. One SAR axis per chart (never two), hover tooltips, legends with values, draw-in motion that stops
// for people who ask for reduced motion. Department colours: the validated 7-slot palette, assigned in fixed order.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { acc } from '../format';

const sum = (a: number[]) => a.reduce((t, x) => t + (x || 0), 0);
const short = (v: number) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : String(Math.round(a)); return (v < 0 ? '−' : '') + s; };
/** Department slots in fixed order (light and dark steps are CSS variables, see styles.css). */
export const deptColor = (i: number) => `var(--s${(i % 7) + 1})`;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up to its value once, then follows it. */
export function CountUp({ value, format = acc }: { value: number; format?: (n: number) => string }) {
  const [v, setV] = useState(reduced() ? value : 0);
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced()) { setV(value); return; }
    const start = performance.now(), a = from.current, b = value, dur = 700;
    let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - start) / dur); const e = 1 - Math.pow(1 - k, 3); setV(a + (b - a) * e); if (k < 1) raf = requestAnimationFrame(tick); else from.current = b; };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(v)}</>;
}

function niceMax(v: number) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), w - 70);
  return <div className="bc-tip" style={{ left, top: y }} role="status">{children}</div>;
}
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null), [w, setW] = useState(720);
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width))); ro.observe(ref.current); return () => ro.disconnect(); }, []);
  return [ref, w] as const;
}

/** Revenue and costs side by side for every month, EBITDA as a line on the same SAR axis. */
export function MonthColumns({ months, revenue, costs, line, labels }: { months: string[]; revenue: number[]; costs: number[]; line?: number[]; labels: { revenue: string; costs: string; line?: string } }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240, L = 46, R = 8, T = 12, B = 26, n = months.length;
  const hi = niceMax(Math.max(1, ...revenue, ...costs, ...(line || []).map(Math.abs)));
  const lo = Math.min(0, ...(line || [0]));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const slot = (W - L - R) / Math.max(1, n), bw = Math.max(4, Math.min(18, slot / 3.2));
  const cx = (i: number) => L + slot * i + slot / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k);
  const linePath = line ? line.map((v, i) => (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ') : '';
  return (
    <div className="bc" ref={ref}>
      <div className="bc-legend">
        <span><i style={{ background: 'var(--rec)' }} />{labels.revenue} <b>{acc(sum(revenue))}</b></span>
        <span><i style={{ background: 'var(--pay)' }} />{labels.costs} <b>{acc(sum(costs))}</b></span>
        {line && labels.line && <span><i className="ln" style={{ background: 'var(--ink)' }} />{labels.line} <b>{acc(sum(line))}</b></span>}
      </div>
      <svg width={W} height={H} role="img" aria-label={labels.revenue + ', ' + labels.costs} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="bc-grid" /><text x={L - 6} y={y(t) + 4} className="bc-ax" textAnchor="end">{short(t)}</text></g>)}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="bc-zero" />
        {months.map((m, i) => (
          <g key={m} className="an-bar">
            <rect className="r" style={{ ['--d' as any]: i * 35 + 'ms' }} x={cx(i) - bw - 1} y={y(Math.max(0, revenue[i]))} width={bw} height={Math.max(0, y(0) - y(Math.max(0, revenue[i])))} rx={3} fill="var(--rec)" opacity={hover === null || hover === i ? 1 : 0.45} />
            <rect className="r" style={{ ['--d' as any]: i * 35 + 60 + 'ms' }} x={cx(i) + 1} y={y(Math.max(0, costs[i]))} width={bw} height={Math.max(0, y(0) - y(Math.max(0, costs[i])))} rx={3} fill="var(--pay)" opacity={hover === null || hover === i ? 1 : 0.45} />
            {(n <= 14 || i % 2 === 0) && <text x={cx(i)} y={H - 8} className="bc-ax" textAnchor="middle">{m}</text>}
            <rect x={cx(i) - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {line && <path d={linePath} pathLength={1} className="bc-line an-draw" />}
        {line && line.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 3.5} className="bc-dot" />)}
      </svg>
      {hover !== null && <Tip x={cx(hover)} y={8} w={W}><b>{months[hover]}</b><span><i style={{ background: 'var(--rec)' }} />{labels.revenue} {acc(revenue[hover])}</span><span><i style={{ background: 'var(--pay)' }} />{labels.costs} {acc(costs[hover])}</span>{line && labels.line && <span><i className="ln" style={{ background: 'var(--ink)' }} />{labels.line} {acc(line[hover])}</span>}</Tip>}
    </div>
  );
}

/** Share of a total, one slice per department, in the fixed department order. */
export function Donut({ parts, center, sub }: { parts: Array<{ id: string; label: string; value: number; color: string }>; center: string; sub: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const tot = sum(parts.map((p) => Math.max(0, p.value)));
  const R = 70, C = 2 * Math.PI * R, gap = parts.length > 1 ? 2 : 0;
  let off = 0;
  const shown = hover ? parts.find((p) => p.id === hover) : null;
  return (
    <div className="bc-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label={sub}>
        <circle cx="100" cy="100" r={R} className="bc-track" />
        {tot > 0 && parts.filter((p) => p.value > 0).map((p, i) => {
          const len = (p.value / tot) * C;
          const el = <circle key={p.id} cx="100" cy="100" r={R} fill="none" stroke={p.color} strokeWidth={hover === p.id ? 30 : 24}
            strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 100 100)" className="bc-slice" style={{ animationDelay: i * 60 + 'ms' }}
            onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} />;
          off += len;
          return el;
        })}
        <text x="100" y="96" textAnchor="middle" className="bc-dc">{shown ? short(shown.value) : center}</text>
        <text x="100" y="116" textAnchor="middle" className="bc-ds">{shown ? (tot ? ((shown.value / tot) * 100).toFixed(1) + '%' : '') : sub}</text>
      </svg>
      <ul className="bc-keys">{parts.map((p) => <li key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} className={hover === p.id ? 'on' : ''}>
        <i style={{ background: p.color }} /><span>{p.label}</span><b>{acc(p.value)}</b><em>{tot ? ((p.value / tot) * 100).toFixed(0) + '%' : '–'}</em></li>)}</ul>
    </div>
  );
}

/** Horizontal bars, largest first: one bar per row, or a pair (revenue, costs). */
export function HBars({ rows, labels }: { rows: Array<{ id: string; label: string; a: number; b?: number }>; labels: { a: string; b?: string } }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.a), Math.abs(r.b ?? 0))));
  return (
    <div className="bc-h">
      <div className="bc-legend"><span><i style={{ background: 'var(--rec)' }} />{labels.a}</span>{labels.b && <span><i style={{ background: 'var(--pay)' }} />{labels.b}</span>}</div>
      {rows.map((r, i) => (
        <div key={r.id} className="bc-hrow" title={r.label + ': ' + acc(r.a) + (r.b !== undefined ? ' / ' + acc(r.b) : '')}>
          <span className="lab">{r.label}</span>
          <span className="bars">
            <span className="bar" style={{ width: (Math.abs(r.a) / max) * 100 + '%', background: 'var(--rec)', animationDelay: i * 50 + 'ms' }} />
            {r.b !== undefined && <span className="bar" style={{ width: (Math.abs(r.b) / max) * 100 + '%', background: 'var(--pay)', animationDelay: i * 50 + 40 + 'ms' }} />}
          </span>
          <span className="val">{acc(r.a)}{r.b !== undefined && <><br /><em>{acc(r.b)}</em></>}</span>
        </div>
      ))}
    </div>
  );
}

/** Budget against actual, month by month, two lines on one axis; months without actuals end the actual line. */
export function BudgetActualLines({ months, budget, actual, labels }: { months: string[]; budget: number[]; actual: Array<number | null>; labels: { budget: string; actual: string } }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220, L = 46, R = 10, T = 12, B = 26, n = months.length;
  const vals = [...budget, ...(actual.filter((x) => x !== null) as number[])];
  const hi = niceMax(Math.max(1, ...vals)), lo = Math.min(0, ...vals);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const x = (i: number) => L + ((W - L - R) * (n === 1 ? 0.5 : i / (n - 1)));
  const path = (a: Array<number | null>) => { let d = '', pen = false; a.forEach((v, i) => { if (v === null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; }); return d; };
  return (
    <div className="bc" ref={ref}>
      <div className="bc-legend"><span><i className="ln dash" />{labels.budget}</span><span><i className="ln" style={{ background: 'var(--brand)' }} />{labels.actual}</span></div>
      <svg width={W} height={H} role="img" aria-label={labels.budget + ' / ' + labels.actual} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((k, i) => { const t = lo + (hi - lo) * k; return <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="bc-grid" /><text x={L - 6} y={y(t) + 4} className="bc-ax" textAnchor="end">{short(t)}</text></g>; })}
        <path d={path(budget)} className="bc-line budget" />
        <path d={path(actual)} pathLength={1} className="bc-line actual an-draw" />
        {actual.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 3.5} className="bc-dot actual" />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="bc-cross" />}
        {months.map((m, i) => <g key={m}>{(n <= 14 || i % 2 === 0) && <text x={x(i)} y={H - 8} className="bc-ax" textAnchor="middle">{m}</text>}
          <rect x={x(i) - (W - L - R) / Math.max(1, n - 1) / 2} y={T} width={(W - L - R) / Math.max(1, n - 1)} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} /></g>)}
      </svg>
      {hover !== null && <Tip x={x(hover)} y={8} w={W}><b>{months[hover]}</b><span>{labels.budget} {acc(budget[hover])}</span><span>{labels.actual} {actual[hover] === null ? '–' : acc(actual[hover]!)}</span>{actual[hover] !== null && <span>{acc(actual[hover]! - budget[hover])}</span>}</Tip>}
    </div>
  );
}

/** The biggest variances, favourable to the right, unfavourable to the left, labelled. */
export function VarianceBars({ rows, labels }: { rows: Array<{ id: string; label: string; fav: number }>; labels: { good: string; bad: string } }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.fav)));
  return (
    <div className="bc-var">
      <div className="bc-legend"><span><i style={{ background: 'var(--crit)' }} />{labels.bad}</span><span><i style={{ background: 'var(--good)' }} />{labels.good}</span></div>
      {rows.map((r, i) => (
        <div key={r.id} className="bc-vrow">
          <span className="lab" title={r.label}>{r.label}</span>
          <span className="track">
            <span className="half l">{r.fav < 0 && <span className="bar bad" style={{ width: (Math.abs(r.fav) / max) * 100 + '%', animationDelay: i * 50 + 'ms' }} />}</span>
            <span className="half r">{r.fav > 0 && <span className="bar good" style={{ width: (r.fav / max) * 100 + '%', animationDelay: i * 50 + 'ms' }} />}</span>
          </span>
          <span className={'val ' + (r.fav >= 0 ? 'up' : 'down')}>{r.fav >= 0 ? '▲ ' : '▼ '}{acc(Math.abs(r.fav))}</span>
        </div>
      ))}
    </div>
  );
}

/** Where the revenue goes: one band per destination, width = SAR, drawn in from left to right. */
export function MoneyFlow({ source, flows, labels }: { source: { label: string; value: number }; flows: Array<{ id: string; label: string; value: number; color: string }>; labels: { share: string } }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const items = flows.filter((f) => f.value > 0);
  const total = Math.max(source.value, sum(items.map((f) => f.value)), 1);
  // the bands keep their true width; every destination gets at least one line of label space, so small ones never collide
  const gap = 6, nodeW = 14, labelW = Math.min(230, W * 0.36), line = 22, scale = 240 / total;
  const hs = items.map((f) => Math.max(1.5, f.value * scale));
  const rightH = hs.reduce((t, h) => t + Math.max(h, line), 0) + gap * Math.max(0, items.length - 1);
  const leftH = hs.reduce((t, h) => t + h, 0);
  const H = Math.max(rightH, leftH) + 4;
  const x0 = 0, x1 = W - labelW - nodeW;
  let yl = (H - leftH) / 2, yr = (H - rightH) / 2;
  const bands = items.map((f, i) => {
    const h = hs[i], slot = Math.max(h, line);
    const b = { ...f, h, ly: yl, ry: yr + (slot - h) / 2 };
    yl += h; yr += slot + gap;
    return b;
  });
  const path = (b: typeof bands[number]) => {
    const a = x0 + nodeW, c = x1, m = (a + c) / 2;
    return `M${a},${b.ly} C${m},${b.ly} ${m},${b.ry} ${c},${b.ry} L${c},${b.ry + b.h} C${m},${b.ry + b.h} ${m},${b.ly + b.h} ${a},${b.ly + b.h} Z`;
  };
  const shown = hover ? bands.find((b) => b.id === hover) : null;
  return (
    <div className="bc mf" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={source.label}>
        <rect x={x0} y={bands[0]?.ly ?? 0} width={nodeW} height={Math.max(1, sum(bands.map((b) => b.h)))} rx={4} className="mf-src" />
        {bands.map((b, i) => (
          <g key={b.id} onMouseEnter={() => setHover(b.id)} onMouseLeave={() => setHover(null)} className={'mf-band' + (hover && hover !== b.id ? ' dim' : '')} style={{ ['--d' as any]: 150 + i * 70 + 'ms' }}>
            <path d={path(b)} fill={b.color} className="mf-ribbon" />
            <rect x={x1} y={b.ry} width={nodeW} height={b.h} rx={3} fill={b.color} />
            <text x={x1 + nodeW + 8} y={b.ry + b.h / 2 + 4} className="mf-lab">{b.label}</text>
            <text x={W} y={b.ry + b.h / 2 + 4} className="mf-val" textAnchor="end">{short(b.value)}</text>
          </g>
        ))}
      </svg>
      <div className="mf-head"><b>{source.label}</b> <span>{acc(source.value)}</span></div>
      {shown && <Tip x={(x0 + x1) / 2} y={shown.ly + shown.h / 2 - 30} w={W}><b>{shown.label}</b><span>{acc(shown.value)}</span><span>{source.value ? ((shown.value / source.value) * 100).toFixed(1) + '% ' + labels.share : ''}</span></Tip>}
    </div>
  );
}
