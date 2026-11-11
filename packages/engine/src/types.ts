/** Bilingual text: every label the engine produces carries both languages. */
export interface Txt { en: string; ar: string }

export type Section = 'receipts' | 'payments' | 'financing';

/** An L2 cash line. The core ships a default set; a tenant may add its own. */
export interface Category extends Txt { id: string; section: Section; group: string }

/** The one unit of cash movement. L3, L2 and L1 are only sums of these. */
export interface Item {
  cat: string;
  w: number;
  amount: number;
  l3: string;
  label: Txt;
  dims: Record<string, string | number | undefined>;
  note?: Txt;
  date?: string;
  ref?: string;
  units?: number;
  overdue?: boolean;
  status?: string;
  scheduleId?: string;
}

export interface Week { i: number; label: string; start: number; end: number; startIso: string; endIso: string }
export interface Month { y: number; m: number; start: number; end: number; key: string; weights: number[] }
export interface Calendar { start: number; end: number; weeks: Week[]; months: Month[] }

/** A finance-entered L4 line (one-off or repeating). */
export interface Schedule {
  id: string;
  cat?: string;
  date: string;
  amount: number;
  recurrence?: { freq: 'once' | 'weekly' | 'monthly' | 'quarterly'; until?: string };
  labelEn?: string;
  labelAr?: string;
  counterparty?: string;
  branchId?: string;
  status?: string;
}

/** What every plan has, whatever its industry. */
export interface CoreModel {
  meta: { name?: string; demo?: boolean; currency?: string; startDate: string; weeks?: number; anyStartDay?: boolean };
  tax: { vatRate: number; vatFiling: number; vatDueDays: number; opexVatShare?: number; zakatRate?: number; zakatBase?: number };
  financing: {
    openingCash: number; openingVatPayable: number; openingVatDueDate?: string | null;
    facilityLimit: number; facilityRate: number; loanMonthly: number; otherCapexMonthly: number; minBuffer: number;
  };
  openingReceivable: { amount: number; schedule: number[] };
  schedules?: Schedule[];
  template: string;
  compat?: { v2?: boolean };
}

export type AddItem = (cat: string, w: number, amount: number, l3: string, label: Txt,
  dims?: Item['dims'], extra?: Partial<Item>) => void;

/** What a template hands back to the core besides its items. */
export interface TemplateOutput {
  drivers: Record<string, unknown>;
  /** weekly VAT bases the core turns into ZATCA returns */
  vat: { output: number[]; inputPurchases: number[]; opexBase: number[] };
  /** template-specific checks, run with the core's */
  checks?: Check[];
  /** every unit of currency sold is received inside the window or explicitly after it */
  salesConservation?: { sold: number; afterWindow: number; categories: string[] };
}

export interface Template<M extends CoreModel = CoreModel> {
  id: string;
  name: Txt;
  categories: Category[];
  run(model: M, cal: Calendar, add: AddItem, ctx: { v2: boolean }): TemplateOutput;
}

export interface Check extends Txt { id: string; diff: number; ok: boolean }

export interface L1 {
  receipts: number[]; payments: number[]; net: number[]; opening: number[]; interest: number[];
  closing: number[]; facility: number[]; headroom: number[]; buffer: number[];
  alert: Array<'OK' | 'BELOW_BUFFER' | 'FACILITY_DRAWN' | 'LIMIT_BREACHED'>;
}

export interface VatPeriodResult {
  key: string; output: number; inputPurchases: number; inputOpex: number; net: number;
  broughtForward: number; total: number; due: string; week: number;
}

export interface ForecastResult {
  calendar: Calendar;
  categories: Category[];
  items: Item[];
  l2: Record<string, number[]>;
  l1: L1;
  drivers: Record<string, unknown>;
  vat: VatPeriodResult[];
  checks: Check[];
  compat: 'v2' | null;
  demo: boolean;
}
