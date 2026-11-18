/** Calls the API on the same origin. Every write carries x-cf13 (the server's CSRF check). */
export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-cf13': '1' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    if (r.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event('cf13:signed-out'));
    throw new ApiError(data.error || 'server_error', r.status);
  }
  return data as T;
}

// ---- shapes the screens use
export interface Txt { en: string; ar: string }
export interface Company { id: string; slug: string; name: string; nameAr: string | null; role: 'owner' | 'finance' | 'viewer' | 'contributor' }
export interface Me { account: { id: string; name: string; email: string; language: string }; role: Company['role']; department: string | null; tenantId: string; companies: Company[] }
export interface PlanSummary { id: string; name: string; status: string; version: number; startDate: string; weeks: number; template: string; demo: boolean }
export interface Category extends Txt { id: string; section: 'receipts' | 'payments' | 'financing'; group: string }
export interface L3Row { l3: string; label: Txt; values: number[]; items: number }
export interface Forecast {
  weeks: Array<{ label: string; start: string; end: string }>;
  categories: Category[];
  l1: { receipts: number[]; payments: number[]; net: number[]; opening: number[]; interest: number[]; closing: number[]; facility: number[]; headroom: number[]; buffer: number[]; alert: string[] };
  l2: Record<string, number[]>;
  l3: Record<string, L3Row[]>;
  checks: Array<Txt & { id: string; ok: boolean; diff: number }>;
  upcoming: Array<{ cat: string; l3: string; label: Txt; week: number; date: string | null; amount: number }>;
  headline: { openingCash: number; closingCash: number; lowestCash: number; lowestWeek: number; peakFacility: number; facilityLimit: number; minBuffer: number; items: number; checksOk: boolean };
  demo: boolean;
}
export interface Item { w: number; amount: number; note: Txt | null; date: string | null; ref: string | null; overdue: boolean; dims: Record<string, unknown> }
