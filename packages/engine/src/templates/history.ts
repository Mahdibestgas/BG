/**
 * Built from bank history: every line is a weekly series that the import has
 * already worked out, actual weeks from the bank statement and forecast weeks
 * from that line's own method (weekday averages, share of sales, monthly dates).
 * The engine adds the core's lines (VAT, schedules, interest), rolls up and
 * runs the balance, so a history plan is checked exactly like any other.
 */
import { zeros } from '../calendar';
import type { Category, CoreModel, Template, Txt } from '../types';

export interface HistoryLine {
  cat: string;
  l3: string;                 // e.g. the bank's own label, "KHAZEEN 1023249-الرياض"
  label: Txt;
  values: number[];           // positive = cash moving in the line's direction, one per week
  actualWeeks: number;        // weeks 0 … actualWeeks-1 are actual bank movements
  method: Txt;                // how the forecast weeks were made
  confidence: 'High' | 'Medium' | 'Low' | 'Missing' | 'Actual';
}
export interface HistoryModel extends CoreModel {
  template: 'bank-history';
  source: { en: string; ar: string; through: string };
  lines: HistoryLine[];
}

export const HISTORY_CATEGORIES: Category[] = [
  { id: 'R_CASH', section: 'receipts', group: 'sales', en: 'Cash deposits from branches', ar: 'إيداعات نقدية (مبيعات الفروع)' },
  { id: 'R_POS', section: 'receipts', group: 'sales', en: 'POS / mada settlements', ar: 'تسويات نقاط البيع / مدى' },
  { id: 'R_CUSTOMERS', section: 'receipts', group: 'sales', en: 'Customer collections', ar: 'تحصيل العملاء' },
  { id: 'R_TRANSFERS', section: 'receipts', group: 'sales', en: 'Incoming transfers, branch sales', ar: 'تحويلات واردة - مبيعات الفروع' },
  { id: 'R_OPEN_AR', section: 'receipts', group: 'opening', en: 'Collection of opening receivables', ar: 'تحصيل الذمم المدينة الافتتاحية' },
  { id: 'R_OTHER', section: 'receipts', group: 'other', en: 'Other receipts', ar: 'مقبوضات أخرى' },
  { id: 'R_OWNER', section: 'receipts', group: 'funding', en: 'Funding from the owner', ar: 'تمويل من المالك' },
  { id: 'P_KHAZEEN', section: 'payments', group: 'supply', en: 'Gas purchases (KHAZEEN accounts)', ar: 'مشتريات الغاز (حسابات خزين)' },
  { id: 'P_PAYROLL', section: 'payments', group: 'people', en: 'Payroll and incentives', ar: 'الرواتب والحوافز' },
  { id: 'P_GOSI', section: 'payments', group: 'people', en: 'GOSI', ar: 'التأمينات الاجتماعية' },
  { id: 'P_RESIDENTS', section: 'payments', group: 'people', en: 'Residency services (iqama)', ar: 'خدمات المقيمين' },
  { id: 'P_STAFF', section: 'payments', group: 'people', en: 'Maintenance and medical policy', ar: 'الصيانة والتأمين الطبي' },
  { id: 'P_RENT', section: 'payments', group: 'premises', en: 'Rent', ar: 'الإيجارات' },
  { id: 'P_UTILITIES', section: 'payments', group: 'premises', en: 'Electricity, water, internet', ar: 'الكهرباء والمياه والإنترنت' },
  { id: 'P_SUPPLIERS', section: 'payments', group: 'supply', en: 'Other suppliers', ar: 'سداد موردين' },
  { id: 'P_DIESEL', section: 'payments', group: 'fleet', en: 'Truck diesel top-up', ar: 'ديزل الشاحنات' },
  { id: 'P_GOV', section: 'payments', group: 'government', en: 'Government fees', ar: 'الرسوم الحكومية' },
  { id: 'P_VAT', section: 'payments', group: 'tax', en: 'VAT settlement to ZATCA', ar: 'سداد ضريبة القيمة المضافة (زاتكا)' },
  { id: 'P_ZATCA', section: 'payments', group: 'tax', en: 'Other ZATCA payments', ar: 'مدفوعات أخرى لهيئة الزكاة والضريبة' },
  { id: 'P_LOAN', section: 'payments', group: 'debt', en: 'Loan instalments', ar: 'أقساط القروض' },
  { id: 'P_POS_FEES', section: 'payments', group: 'bank', en: 'POS fees', ar: 'رسوم نقاط البيع' },
  { id: 'P_BANK', section: 'payments', group: 'bank', en: 'Bank charges', ar: 'رسوم بنكية' },
  { id: 'P_ACQUISITION', section: 'payments', group: 'other', en: 'Acquisition instalments', ar: 'سداد دفعات استحواذ' },
  { id: 'P_RELATED', section: 'payments', group: 'other', en: 'Related parties', ar: 'أطراف علاقة' },
  { id: 'P_CAPEX', section: 'payments', group: 'capex', en: 'Capex', ar: 'النفقات الرأسمالية' },
  { id: 'P_OTHER', section: 'payments', group: 'other', en: 'Other payments', ar: 'مدفوعات أخرى' },
  { id: 'P_OWNER', section: 'payments', group: 'funding', en: 'Paid to the owner', ar: 'تحويلات إلى المالك' },
  { id: 'P_OUTSIDE', section: 'payments', group: 'funding', en: 'Moved to accounts outside this plan', ar: 'تحويلات إلى حسابات خارج الخطة' },
  { id: 'F_INTEREST', section: 'financing', group: 'financing', en: 'Financing cost on drawn facility', ar: 'تكلفة التمويل على التسهيلات المستخدمة' }
];

export const bankHistory: Template<HistoryModel> = {
  id: 'bank-history',
  name: { en: 'Built from bank history', ar: 'مبني على حركة البنك' },
  categories: HISTORY_CATEGORIES,
  run(model, cal, add) {
    const N = cal.weeks.length;
    for (const line of model.lines) {
      if (!Array.isArray(line.values) || line.values.length !== N) throw new Error('history_line_length:' + line.l3);
      line.values.forEach((v, w) => {
        if (!Number.isFinite(v)) throw new Error('history_line_value:' + line.l3);
        const actual = w < line.actualWeeks;
        // a negative actual (a refund on a payment line) stays on its line, as the bank shows it
        add(line.cat, w, v, line.l3, line.label, { source: actual ? 'bank' : 'forecast' },
          { ref: actual ? 'actual' : 'forecast', status: actual ? 'actual' : line.confidence,
            note: actual ? { en: 'Actual, from the bank statement', ar: 'فعلي، من كشف البنك' } : line.method });
      });
    }
    return { drivers: {}, vat: { output: zeros(N), inputPurchases: zeros(N), opexBase: zeros(N) } };
  }
};
