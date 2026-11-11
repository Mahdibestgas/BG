/**
 * The generic template, for any company: no industry drivers. Its cash flow is
 * the opening balances plus the finance team's scheduled items (receipts from
 * customers, supplier runs, payroll, rent...), with VAT from the core.
 */
import { zeros } from '../calendar';
import type { Category, CoreModel, Template } from '../types';

export interface GenericModel extends CoreModel { template: 'generic' }

export const GENERIC_CATEGORIES: Category[] = [
  { id: 'R_CUSTOMERS', section: 'receipts', group: 'sales', en: 'Customer receipts', ar: 'مقبوضات العملاء' },
  { id: 'R_OPEN_AR', section: 'receipts', group: 'opening', en: 'Collection of opening receivables', ar: 'تحصيل الذمم المدينة الافتتاحية' },
  { id: 'R_OTHER', section: 'receipts', group: 'other', en: 'Other receipts', ar: 'مقبوضات أخرى' },
  { id: 'P_SUPPLIERS', section: 'payments', group: 'suppliers', en: 'Supplier payments', ar: 'مدفوعات الموردين' },
  { id: 'P_PAYROLL', section: 'payments', group: 'people', en: 'Payroll & GOSI', ar: 'الرواتب والتأمينات' },
  { id: 'P_RENT', section: 'payments', group: 'premises', en: 'Rent', ar: 'الإيجارات' },
  { id: 'P_GA', section: 'payments', group: 'overheads', en: 'Overheads', ar: 'المصاريف العمومية' },
  { id: 'P_VAT', section: 'payments', group: 'tax', en: 'VAT settlement to ZATCA', ar: 'سداد ضريبة القيمة المضافة (زاتكا)' },
  { id: 'P_LOAN', section: 'payments', group: 'debt', en: 'Loan repayments', ar: 'سداد القروض' },
  { id: 'P_CAPEX', section: 'payments', group: 'capex', en: 'Capex', ar: 'النفقات الرأسمالية' },
  { id: 'P_OTHER', section: 'payments', group: 'other', en: 'Other payments', ar: 'مدفوعات أخرى' },
  { id: 'F_INTEREST', section: 'financing', group: 'financing', en: 'Financing cost on drawn facility', ar: 'تكلفة التمويل على التسهيلات المستخدمة' }
];

export const generic: Template<GenericModel> = {
  id: 'generic',
  name: { en: 'Any business', ar: 'أي نشاط' },
  categories: GENERIC_CATEGORIES,
  run(model, cal) {
    const N = cal.weeks.length;
    // VAT on scheduled items is the finance team's to enter as its own line for now
    return { drivers: {}, vat: { output: zeros(N), inputPurchases: zeros(N), opexBase: zeros(N) } };
  }
};
