// Accounting format everywhere: thousands separators, negatives in brackets, zero as a dash,
// whole riyals. Digits stay Latin in both languages (as in KSA finance); tables align right.
const NF0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NF2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2,655,123 · (895,194) · - */
export function acc(x: number, dash = true): string {
  const r = Math.round(x);
  if (r === 0) return dash ? '-' : '0';
  const s = NF0.format(Math.abs(r));
  return r < 0 ? '(' + s + ')' : s;
}
/** Table cells: full riyals by default, or thousands. */
export function k(x: number, units: 'k' | 'full' = 'full'): string {
  return acc(units === 'k' ? x / 1000 : x);
}
/** Headline figures: the full accounting number, never "2.7M". */
export const m = (x: number) => acc(x, false);
export const sar = (x: number) => 'SAR ' + acc(x, false);
export const n0 = acc;

// ---- amounts typed into forms
/** "(1,234.50)" "-1,234.5" "1234.5" → -1234.5 ; empty/garbage → 0 */
export function parseMoney(s: string): number {
  const t = String(s).trim();
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = Number(t.replace(/[(),\s-]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
/** Shown when a field is not being edited: 1,250,000.50 · (50,000.00) */
export function fmtMoneyInput(s: string): string {
  if (!String(s).trim()) return '';
  const n = parseMoney(s);
  const t = NF2.format(Math.abs(n));
  return n < 0 ? '(' + t + ')' : t;
}

export function date(iso: string, lang: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, mo - 1, d)));
}
/** Index of the week containing today (Riyadh), or -1. */
/** Days the plan covers: the last week may be a short one (a plan that stops on 31 Dec). */
export function planDays(weeks: Array<{ start: string; end: string }>): number {
  return weeks.length ? Math.round((Date.parse(weeks[weeks.length - 1].end) - Date.parse(weeks[0].start)) / 864e5) + 1 : 0;
}

export function currentWeek(weeks: Array<{ start: string; end: string }>): number {
  const now = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  return weeks.findIndex((w) => now >= w.start && now <= w.end);
}
