import type { Calendar, Month, Week } from './types';

// Whole days since 1970-01-01 (UTC), so no time zone can move a day.
export function dayNum(iso: string): number {
  const p = String(iso).slice(0, 10).split('-');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}
export function isoOf(dn: number): string { return new Date(dn * 86400000).toISOString().slice(0, 10); }
export function ymOf(dn: number): { y: number; m: number } {
  const d = new Date(dn * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}
export function monthStart(y: number, m: number): number { return Math.round(Date.UTC(y, m, 1) / 86400000); }
export function monthEnd(y: number, m: number): number { return Math.round(Date.UTC(y, m + 1, 0) / 86400000); }
export function isRealDate(iso: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(iso) && isoOf(dayNum(iso)) === iso; }

export class EngineError extends Error {
  constructor(public code: string) { super(code); }
}

/** Weeks run from the start date. Excel-model plans must start on a Sunday; plans built from bank history may start on any day.
 *  An end date inside the last week makes that week a short one: nothing is planned after it. */
export function buildCalendar(startIso: string, nWeeks: number, anyStartDay = false, endIso?: string | null): Calendar {
  if (!isRealDate(startIso)) throw new EngineError('invalid_start_date');
  const s = dayNum(startIso);
  if (!anyStartDay && new Date(s * 86400000).getUTCDay() !== 0) throw new EngineError('start_not_sunday');
  const weeks: Week[] = [];
  for (let i = 0; i < nWeeks; i++) {
    weeks.push({ i, label: 'W' + (i + 1), start: s + 7 * i, end: s + 7 * i + 6, startIso: isoOf(s + 7 * i), endIso: isoOf(s + 7 * i + 6) });
  }
  if (endIso) {
    const last = weeks[nWeeks - 1];
    if (!isRealDate(endIso)) throw new EngineError('invalid_end_date');
    const e = dayNum(endIso);
    if (e < last.start || e > last.end) throw new EngineError('end_date_outside_last_week');
    last.end = e; last.endIso = endIso;
  }
  const first = ymOf(s), lastDay = weeks[nWeeks - 1].end, months: Month[] = [];
  for (let y = first.y, m = first.m; monthStart(y, m) <= lastDay; m++) {
    if (m === 12) { m = 0; y++; }
    const ms = monthStart(y, m), me = monthEnd(y, m);
    months.push({ y, m, start: ms, end: me, key: isoOf(ms).slice(0, 7),
      weights: weeks.map((w) => Math.max(0, Math.min(w.end, me) - Math.max(w.start, ms) + 1) / (w.end - w.start + 1)) });
  }
  return { start: s, end: lastDay, weeks, months };
}

/** The week index (0-based) a day falls in, or -1 if outside the window. */
export function weekOf(cal: Calendar, dn: number): number {
  if (dn < cal.start || dn > cal.end) return -1;
  return Math.floor((dn - cal.start) / 7);
}

export const zeros = (n: number): number[] => new Array<number>(n).fill(0);
export const sum = (a: number[]): number => { let t = 0; for (const x of a) t += x; return t; };
export const pct = (x: number): string => Math.round(x * 1000) / 10 + '%';
export const r0 = (x: number): string => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
