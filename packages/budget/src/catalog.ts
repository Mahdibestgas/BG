/**
 * The budget catalogue: which department budgets which item, and what kind of
 * money it is. The core (cycles, submissions, approval, consolidation) knows
 * nothing about gas or Saudi labour law: those live in this template pack,
 * `KSA_LPG`, the one Best Gas uses. Another industry adds its own pack.
 *
 * Amounts in a budget are monthly and EXCLUDE VAT. `vat` says whether VAT
 * applies to the item (for the later bridge from budget to cash).
 */
export interface Txt { en: string; ar: string }
export type Kind = 'revenue' | 'cogs' | 'opex' | 'capex' | 'financing' | 'noncash';

export interface Department { id: string; name: Txt; covers: Txt }
export interface Item {
  id: string;
  dept: string;
  group: Txt;
  name: Txt;
  kind: Kind;
  vat: boolean;          // VAT applies (15% in KSA)
  cash: string;          // the cash-plan category it maps to later (R_*, P_*)
  ebitda?: boolean;      // non-cash items only: counts in EBITDA (end-of-service) or not (depreciation)
  hint?: Txt;
  unit?: Txt;            // when the line is usually entered as quantity x price
}
export interface Region { id: string; name: Txt }
export interface Pack { id: string; name: Txt; departments: Department[]; items: Item[]; regions: Region[] }

export const KIND_NAMES: Record<Kind, Txt> = {
  revenue: { en: 'Revenue', ar: 'الإيرادات' },
  cogs: { en: 'Cost of sales', ar: 'تكلفة المبيعات' },
  opex: { en: 'Operating costs', ar: 'المصاريف التشغيلية' },
  capex: { en: 'Capital spending (capex)', ar: 'النفقات الرأسمالية' },
  financing: { en: 'Financing', ar: 'التمويل' },
  noncash: { en: 'Non-cash charges', ar: 'مصاريف غير نقدية' }
};

const t = (en: string, ar: string): Txt => ({ en, ar });
const g = {
  people: t('People', 'الموظفون'), gov: t('Government and residency', 'الرسوم الحكومية والإقامات'), benefits: t('Benefits', 'المزايا'),
  fleet: t('Fleet', 'الأسطول'), premises: t('Branches and premises', 'الفروع والمباني'), compliance: t('Licences and safety', 'التراخيص والسلامة'),
  services: t('Services', 'الخدمات'), capex: t('Capital spending', 'النفقات الرأسمالية'), gas: t('Gas and stock', 'الغاز والمخزون'),
  revenue: t('Sales', 'المبيعات'), team: t('Sales team', 'فريق المبيعات'), media: t('Media and campaigns', 'الإعلام والحملات'),
  admin: t('Head office', 'المركز الرئيسي'), finance: t('Finance and tax', 'المالية والضرائب')
};

const DEPARTMENTS: Department[] = [
  { id: 'hr', name: t('Human resources', 'الموارد البشرية'), covers: t('Headcount for every department, salaries, GOSI, end of service, iqama, levy, medical insurance, tickets, training.', 'أعداد الموظفين لكل الإدارات، الرواتب، التأمينات، نهاية الخدمة، الإقامات، المقابل المالي، التأمين الطبي، التذاكر، التدريب.') },
  { id: 'operations', name: t('Operations', 'التشغيل'), covers: t('Fleet, fuel, maintenance, branches and warehouses, licences, safety, cylinder testing, operating capex.', 'الأسطول، الوقود، الصيانة، الفروع والمستودعات، التراخيص، السلامة، فحص الأسطوانات، النفقات الرأسمالية التشغيلية.') },
  { id: 'procurement', name: t('Procurement', 'المشتريات'), covers: t('Gas purchases, cylinders, accessories for resale, freight.', 'مشتريات الغاز، الأسطوانات، الملحقات المعدة للبيع، الشحن.') },
  { id: 'sales', name: t('Sales', 'المبيعات'), covers: t('Revenue by city and channel: branches, POS, business customers, delivery, bulk.', 'الإيرادات حسب المدينة والقناة: الفروع، نقاط البيع، العملاء من الشركات، التوصيل، البيع بالجملة.') },
  { id: 'sales_team', name: t('Sales team', 'فريق المبيعات'), covers: t('Commissions, incentive schemes, allowances, travel, sales tools and vehicles. Salaries are priced by HR.', 'العمولات، برامج الحوافز، البدلات، السفر، أدوات ومركبات المبيعات. الرواتب تسعّرها الموارد البشرية.') },
  { id: 'marketing', name: t('Marketing', 'التسويق'), covers: t('Digital and social media, branding and signage, promotions, events, app and website.', 'الإعلان الرقمي ووسائل التواصل، الهوية واللوحات، العروض، الفعاليات، التطبيق والموقع.') },
  { id: 'finance_admin', name: t('Finance and administration', 'المالية والإدارة'), covers: t('Head office, IT and ERP, audit and legal, insurance, bank charges, zakat, loans, depreciation.', 'المركز الرئيسي، تقنية المعلومات والنظام المحاسبي، المراجعة والقانونية، التأمين، الرسوم البنكية، الزكاة، القروض، الإهلاك.') }
];

const I = (id: string, dept: string, group: Txt, name: Txt, kind: Kind, vat: boolean, cash: string, extra: Partial<Item> = {}): Item =>
  ({ id, dept, group, name, kind, vat, cash, ...extra });

const ITEMS: Item[] = [
  // ---- HR: lines come from positions (grade x headcount); the calculator writes the first six
  I('hr_salaries', 'hr', g.people, t('Salaries and allowances', 'الرواتب والبدلات'), 'opex', false, 'P_PAYROLL', { hint: t('Basic, housing, transport and other allowances, by position and headcount.', 'الأساسي والسكن والنقل والبدلات الأخرى حسب الوظيفة والعدد.') }),
  I('hr_gosi', 'hr', g.people, t('GOSI, employer share', 'التأمينات الاجتماعية، حصة صاحب العمل'), 'opex', false, 'P_GOSI', { hint: t('Saudi: annuities, occupational hazards and SANED; non-Saudi: occupational hazards. On basic + housing, within the GOSI floor and cap.', 'السعودي: المعاشات والأخطار المهنية وساند؛ غير السعودي: الأخطار المهنية. على الأساسي والسكن ضمن الحد الأدنى والأعلى.') }),
  I('hr_eosb', 'hr', g.benefits, t('End-of-service benefit (accrual)', 'مكافأة نهاية الخدمة (مخصص)'), 'noncash', false, 'P_PAYROLL', { ebitda: true, hint: t('Labour Law article 84: half a month per year for the first five years, a full month after.', 'نظام العمل المادة 84: نصف شهر عن كل سنة من الخمس الأولى وشهر كامل بعدها.') }),
  I('hr_levy', 'hr', g.gov, t('Expat levy (work permit fee)', 'المقابل المالي (رخصة العمل)'), 'opex', false, 'P_RESIDENTS', { hint: t('Per non-Saudi employee per month.', 'لكل موظف غير سعودي شهريًا.') }),
  I('hr_iqama', 'hr', g.gov, t('Iqama issue and renewal', 'إصدار وتجديد الإقامة'), 'opex', false, 'P_RESIDENTS'),
  I('hr_medical', 'hr', g.benefits, t('Medical insurance (CCHI)', 'التأمين الطبي (مجلس الضمان الصحي)'), 'opex', true, 'P_STAFF'),
  I('hr_eosb_paid', 'hr', g.benefits, t('End of service paid on planned exits', 'نهاية الخدمة المدفوعة للمغادرين المخططين'), 'opex', false, 'P_PAYROLL'),
  I('hr_tickets', 'hr', g.benefits, t('Annual leave tickets', 'تذاكر الإجازة السنوية'), 'opex', true, 'P_PAYROLL'),
  I('hr_overtime', 'hr', g.people, t('Overtime', 'العمل الإضافي'), 'opex', false, 'P_PAYROLL'),
  I('hr_incentives', 'hr', g.people, t('Incentives and bonuses', 'الحوافز والمكافآت'), 'opex', false, 'P_PAYROLL'),
  I('hr_recruitment', 'hr', g.gov, t('Recruitment, visas, Qiwa and Musaned fees', 'التوظيف والتأشيرات ورسوم قوى ومساند'), 'opex', false, 'P_RESIDENTS'),
  I('hr_exit_reentry', 'hr', g.gov, t('Exit and re-entry visas', 'تأشيرات الخروج والعودة'), 'opex', false, 'P_RESIDENTS'),
  I('hr_housing', 'hr', g.benefits, t('Staff housing provided', 'سكن الموظفين المقدم'), 'opex', false, 'P_RENT', { hint: t('Residential rent is exempt from VAT.', 'الإيجار السكني معفى من ضريبة القيمة المضافة.') }),
  I('hr_training', 'hr', g.people, t('Training (HRDF)', 'التدريب (هدف)'), 'opex', true, 'P_SUPPLIERS'),
  I('hr_other', 'hr', g.people, t('Other HR costs', 'تكاليف موارد بشرية أخرى'), 'opex', true, 'P_SUPPLIERS'),

  // ---- Operations
  I('op_fuel', 'operations', g.fleet, t('Fleet fuel', 'وقود الأسطول'), 'opex', true, 'P_DIESEL', { unit: t('litres', 'لتر') }),
  I('op_maintenance', 'operations', g.fleet, t('Vehicle maintenance and spare parts', 'صيانة المركبات وقطع الغيار'), 'opex', true, 'P_STAFF'),
  I('op_tyres', 'operations', g.fleet, t('Tyres', 'الإطارات'), 'opex', true, 'P_STAFF'),
  I('op_vehicle_insurance', 'operations', g.fleet, t('Vehicle insurance', 'تأمين المركبات'), 'opex', true, 'P_SUPPLIERS'),
  I('op_registration', 'operations', g.fleet, t('Registration (Istimara) and inspection (MVPI)', 'الاستمارة والفحص الدوري'), 'opex', false, 'P_GOV'),
  I('op_tracking', 'operations', g.fleet, t('GPS tracking and fleet systems', 'أنظمة التتبع وإدارة الأسطول'), 'opex', true, 'P_SUPPLIERS'),
  I('op_inbound', 'operations', g.fleet, t('Inbound haulage to branches', 'نقل الغاز إلى الفروع'), 'opex', true, 'P_SUPPLIERS'),
  I('op_rent', 'operations', g.premises, t('Branch and warehouse rent', 'إيجار الفروع والمستودعات'), 'opex', true, 'P_RENT'),
  I('op_utilities', 'operations', g.premises, t('Electricity, water and internet', 'الكهرباء والمياه والإنترنت'), 'opex', true, 'P_UTILITIES'),
  I('op_cleaning_security', 'operations', g.premises, t('Cleaning and security', 'النظافة والحراسة'), 'opex', true, 'P_SUPPLIERS'),
  I('op_licences', 'operations', g.compliance, t('Municipality (Balady) and civil defence (Salamah) licences', 'رخص البلدية (بلدي) والدفاع المدني (سلامة)'), 'opex', false, 'P_GOV'),
  I('op_cylinder_testing', 'operations', g.compliance, t('Cylinder testing and requalification', 'فحص وإعادة تأهيل الأسطوانات'), 'opex', true, 'P_SUPPLIERS'),
  I('op_safety', 'operations', g.compliance, t('Safety and fire equipment', 'معدات السلامة والإطفاء'), 'opex', true, 'P_SUPPLIERS'),
  I('op_capex_vehicles', 'operations', g.capex, t('New vehicles (trucks, Dyna, pickups)', 'مركبات جديدة (شاحنات، دينا، بيك أب)'), 'capex', true, 'P_CAPEX', { unit: t('vehicles', 'مركبة') }),
  I('op_capex_branches', 'operations', g.capex, t('New branches and fit-out', 'فروع جديدة وتجهيزها'), 'capex', true, 'P_CAPEX'),
  I('op_capex_equipment', 'operations', g.capex, t('Equipment (forklifts, scales, filling)', 'معدات (رافعات، موازين، تعبئة)'), 'capex', true, 'P_CAPEX'),

  // ---- Procurement
  I('pr_gas', 'procurement', g.gas, t('LPG purchases', 'مشتريات الغاز'), 'cogs', true, 'P_KHAZEEN', { unit: t('cylinders', 'أسطوانة') }),
  I('pr_accessories', 'procurement', g.gas, t('Regulators, hoses and valves for resale', 'المنظمات والخراطيم والصمامات للبيع'), 'cogs', true, 'P_SUPPLIERS'),
  I('pr_packaging', 'procurement', g.gas, t('Seals, labels and packaging', 'الأختام والملصقات والتغليف'), 'cogs', true, 'P_SUPPLIERS'),
  I('pr_freight', 'procurement', g.gas, t('Freight and customs', 'الشحن والجمارك'), 'cogs', true, 'P_SUPPLIERS'),
  I('pr_cylinders', 'procurement', g.capex, t('New cylinders', 'أسطوانات جديدة'), 'capex', true, 'P_CAPEX', { unit: t('cylinders', 'أسطوانة') }),
  I('pr_other', 'procurement', g.services, t('Other purchases', 'مشتريات أخرى'), 'opex', true, 'P_SUPPLIERS'),

  // ---- Sales (revenue, excluding VAT)
  I('sa_branch_cash', 'sales', g.revenue, t('Cylinder sales at branches, cash', 'مبيعات الأسطوانات في الفروع، نقدًا'), 'revenue', true, 'R_CASH', { unit: t('cylinders', 'أسطوانة') }),
  I('sa_branch_pos', 'sales', g.revenue, t('Cylinder sales at branches, POS and mada', 'مبيعات الأسطوانات في الفروع، نقاط البيع ومدى'), 'revenue', true, 'R_POS', { unit: t('cylinders', 'أسطوانة') }),
  I('sa_b2b', 'sales', g.revenue, t('Business customers on credit', 'العملاء من الشركات بالآجل'), 'revenue', true, 'R_CUSTOMERS'),
  I('sa_delivery', 'sales', g.revenue, t('App and home delivery', 'التطبيق والتوصيل للمنازل'), 'revenue', true, 'R_TRANSFERS', { unit: t('orders', 'طلب') }),
  I('sa_bulk', 'sales', g.revenue, t('Bulk and tank sales', 'البيع بالجملة والخزانات'), 'revenue', true, 'R_CUSTOMERS'),
  I('sa_accessories', 'sales', g.revenue, t('Accessory sales', 'مبيعات الملحقات'), 'revenue', true, 'R_CASH'),
  I('sa_other', 'sales', g.revenue, t('Other income', 'إيرادات أخرى'), 'revenue', true, 'R_OTHER'),

  // ---- Sales team (salaries are HR positions)
  I('st_commissions', 'sales_team', g.team, t('Sales commissions', 'عمولات المبيعات'), 'opex', false, 'P_PAYROLL'),
  I('st_incentives', 'sales_team', g.team, t('Target incentive schemes', 'برامج حوافز الأهداف'), 'opex', false, 'P_PAYROLL'),
  I('st_allowances', 'sales_team', g.team, t('Phone, car and travel allowances', 'بدلات الهاتف والسيارة والسفر'), 'opex', false, 'P_PAYROLL'),
  I('st_travel', 'sales_team', g.team, t('Sales travel and customer visits', 'سفر المبيعات وزيارات العملاء'), 'opex', true, 'P_SUPPLIERS'),
  I('st_tools', 'sales_team', g.team, t('CRM and sales tools', 'نظام إدارة العملاء وأدوات المبيعات'), 'opex', true, 'P_SUPPLIERS'),
  I('st_capex_vehicles', 'sales_team', g.capex, t('Sales vehicles', 'مركبات المبيعات'), 'capex', true, 'P_CAPEX', { unit: t('vehicles', 'مركبة') }),

  // ---- Marketing
  I('mk_digital', 'marketing', g.media, t('Digital advertising', 'الإعلان الرقمي'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_social', 'marketing', g.media, t('Social media and content', 'وسائل التواصل والمحتوى'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_branding', 'marketing', g.media, t('Branding, signage and vehicle wraps', 'الهوية واللوحات وتغليف المركبات'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_promotions', 'marketing', g.media, t('Promotions and discounts', 'العروض والخصومات'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_events', 'marketing', g.media, t('Events and sponsorships', 'الفعاليات والرعايات'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_print', 'marketing', g.media, t('Printing and flyers', 'المطبوعات والنشرات'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_agency', 'marketing', g.media, t('Agency and research fees', 'أتعاب الوكالات والأبحاث'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_app', 'marketing', g.media, t('Customer app and website', 'تطبيق العملاء والموقع'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_capex', 'marketing', g.capex, t('Marketing assets (signboards, displays)', 'أصول تسويقية (لوحات، شاشات عرض)'), 'capex', true, 'P_CAPEX'),

  // ---- Finance and administration
  I('fa_hq_rent', 'finance_admin', g.admin, t('Head office rent', 'إيجار المركز الرئيسي'), 'opex', true, 'P_RENT'),
  I('fa_it', 'finance_admin', g.admin, t('IT, ERP (Odoo) and software licences', 'تقنية المعلومات والنظام المحاسبي (أودو) والتراخيص'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_professional', 'finance_admin', g.admin, t('Audit, legal and consulting', 'المراجعة والقانونية والاستشارات'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_insurance', 'finance_admin', g.admin, t('Property and general insurance', 'تأمين الممتلكات والتأمين العام'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_gov', 'finance_admin', g.admin, t('Commercial register, chamber and subscriptions', 'السجل التجاري والغرفة والاشتراكات'), 'opex', false, 'P_GOV'),
  I('fa_bank', 'finance_admin', g.finance, t('Bank charges and POS fees', 'الرسوم البنكية ورسوم نقاط البيع'), 'opex', true, 'P_BANK'),
  I('fa_zakat', 'finance_admin', g.finance, t('Zakat', 'الزكاة'), 'opex', false, 'P_ZATCA'),
  I('fa_loan_interest', 'finance_admin', g.finance, t('Loan interest', 'فوائد القروض'), 'financing', false, 'P_LOAN'),
  I('fa_loan_principal', 'finance_admin', g.finance, t('Loan principal repaid', 'سداد أصل القروض'), 'financing', false, 'P_LOAN'),
  I('fa_depreciation', 'finance_admin', g.finance, t('Depreciation and amortisation', 'الإهلاك والإطفاء'), 'noncash', false, '', { ebitda: false }),
  I('fa_capex_it', 'finance_admin', g.capex, t('IT equipment and software (capex)', 'أجهزة وبرامج تقنية (رأسمالية)'), 'capex', true, 'P_CAPEX'),
  I('fa_other', 'finance_admin', g.admin, t('Other administration costs', 'مصاريف إدارية أخرى'), 'opex', true, 'P_SUPPLIERS')
];

/** Cities of the company, seeded from the data-request template; each company edits its own list. */
const REGIONS: Region[] = [
  { id: 'riyadh', name: t('Riyadh', 'الرياض') }, { id: 'qassim', name: t('Qassim', 'القصيم') }, { id: 'jeddah', name: t('Jeddah', 'جدة') },
  { id: 'arar', name: t("Ar'ar", 'عرعر') }, { id: 'hq', name: t('Head office', 'المركز الرئيسي') }, { id: 'other', name: t('Other', 'أخرى') }
];

export const KSA_LPG: Pack = { id: 'ksa-lpg', name: t('Saudi LPG distribution', 'توزيع الغاز في السعودية'), departments: DEPARTMENTS, items: ITEMS, regions: REGIONS };
export const PACKS: Record<string, Pack> = { [KSA_LPG.id]: KSA_LPG };

/**
 * Saudi labour-cost parameters the HR calculator uses. Rates as published in late 2026; each company keeps
 * its own copy, dated, and HR confirms them before the budget is approved. Amounts in SAR.
 */
export interface HrParams {
  asOf: string; confirmed: boolean;
  gosiSaudiEmployer: number;      // annuities 9% + occupational hazards 2% + SANED 0.75% = 11.75%
  gosiNonSaudiEmployer: number;   // occupational hazards 2%
  gosiFloor: number; gosiCap: number;   // contributory wage (basic + housing) limits
  expatLevyMonthly: number;       // per non-Saudi employee
  iqamaAnnual: number; workPermitAnnual: number;
  medicalAnnual: number;          // per head, company policy: HR enters it
}
export const KSA_HR_DEFAULTS: HrParams = {
  asOf: '2026-11-18', confirmed: false,
  gosiSaudiEmployer: 0.1175, gosiNonSaudiEmployer: 0.02, gosiFloor: 1500, gosiCap: 45000,
  expatLevyMonthly: 800, iqamaAnnual: 650, workPermitAnnual: 100, medicalAnnual: 0
};
