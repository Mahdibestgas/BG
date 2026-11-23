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

  // ---- added 2026-11-23: a complete Saudi LPG distributor catalogue ----
  // HR
  I('hr_leave_accrual', 'hr', g.benefits, t('Annual leave accrual', 'مخصص الإجازات السنوية'), 'noncash', false, '', { ebitda: true, hint: t('21 days a year (30 after five years), earned monthly; paid when the leave is taken.', '21 يومًا سنويًا (30 بعد خمس سنوات)، تُستحق شهريًا وتُدفع عند أخذ الإجازة.') }),
  I('hr_vacation_pay', 'hr', g.benefits, t('Leave salary paid in advance', 'رواتب الإجازات المدفوعة مقدمًا'), 'opex', false, 'P_PAYROLL'),
  I('hr_life_insurance', 'hr', g.benefits, t('Group life and accident insurance', 'تأمين الحياة والحوادث الجماعي'), 'opex', true, 'P_SUPPLIERS'),
  I('hr_dependants', 'hr', g.gov, t('Dependants fees paid by the company', 'رسوم المرافقين على حساب الشركة'), 'opex', false, 'P_RESIDENTS'),
  I('hr_transfer_fees', 'hr', g.gov, t('Sponsorship transfer and profession change fees', 'رسوم نقل الكفالة وتغيير المهنة'), 'opex', false, 'P_RESIDENTS'),
  I('hr_platforms', 'hr', g.gov, t('Qiwa, Muqeem, Mudad and GOSI platform subscriptions', 'اشتراكات قوى ومقيم ومدد والتأمينات'), 'opex', true, 'P_GOV'),
  I('hr_health_cards', 'hr', g.gov, t('Health certificates and municipality health cards', 'الشهادات الصحية وبطاقات البلدية الصحية'), 'opex', false, 'P_GOV'),
  I('hr_outsourced', 'hr', g.people, t('Outsourced and Ajeer temporary labour', 'العمالة المؤقتة وأجير والتعهيد'), 'opex', true, 'P_SUPPLIERS'),
  I('hr_tamheer', 'hr', g.people, t('Saudization programmes (Tamheer, trainees)', 'برامج التوطين (تمهير والمتدربون)'), 'opex', false, 'P_PAYROLL'),
  I('hr_uniforms', 'hr', g.people, t('Uniforms and protective clothing', 'الزي الموحد وملابس الوقاية'), 'opex', true, 'P_SUPPLIERS'),
  I('hr_transport', 'hr', g.benefits, t('Staff transport', 'نقل الموظفين'), 'opex', true, 'P_SUPPLIERS'),
  I('hr_meals', 'hr', g.benefits, t('Staff meals and catering', 'وجبات الموظفين والإعاشة'), 'opex', true, 'P_SUPPLIERS'),
  I('hr_housing_allowance', 'hr', g.benefits, t('Housing for staff (rented units, utilities)', 'سكن الموظفين (وحدات مستأجرة ومرافق)'), 'opex', true, 'P_RENT'),
  I('hr_rewards', 'hr', g.people, t('Employee recognition and end-of-year events', 'تكريم الموظفين وفعاليات نهاية العام'), 'opex', true, 'P_SUPPLIERS'),
  // Operations
  I('op_oil', 'operations', g.fleet, t('Engine oil, lubricants and filters', 'زيوت المحركات والمرشحات'), 'opex', true, 'P_STAFF'),
  I('op_washing', 'operations', g.fleet, t('Vehicle washing', 'غسيل المركبات'), 'opex', true, 'P_STAFF'),
  I('op_vehicle_rental', 'operations', g.fleet, t('Rented or leased vehicles', 'مركبات مستأجرة أو بالتأجير'), 'opex', true, 'P_SUPPLIERS'),
  I('op_tga', 'operations', g.fleet, t('Transport Authority (TGA) operating cards', 'بطاقات تشغيل هيئة النقل'), 'opex', false, 'P_GOV'),
  I('op_driver_permits', 'operations', g.fleet, t('Driver licences and dangerous-goods permits', 'رخص القيادة وتصاريح نقل المواد الخطرة'), 'opex', false, 'P_GOV'),
  I('op_fines', 'operations', g.fleet, t('Traffic fines (Saher) and violations', 'المخالفات المرورية (ساهر)'), 'opex', false, 'P_GOV'),
  I('op_accidents', 'operations', g.fleet, t('Accident repairs and insurance excess', 'إصلاح الحوادث وتحمل التأمين'), 'opex', true, 'P_STAFF'),
  I('op_parking', 'operations', g.fleet, t('Truck yards and parking', 'ساحات ومواقف الشاحنات'), 'opex', true, 'P_RENT'),
  I('op_gas_liability', 'operations', g.compliance, t('Third-party liability insurance for gas', 'تأمين المسؤولية تجاه الغير للغاز'), 'opex', true, 'P_SUPPLIERS'),
  I('op_calibration', 'operations', g.compliance, t('Scale calibration and SASO certificates', 'معايرة الموازين وشهادات المواصفات'), 'opex', true, 'P_SUPPLIERS'),
  I('op_cylinder_repair', 'operations', g.compliance, t('Cylinder valve replacement, painting and repair', 'استبدال صمامات الأسطوانات وطلاؤها وإصلاحها'), 'opex', true, 'P_SUPPLIERS'),
  I('op_cylinder_loss', 'operations', g.compliance, t('Lost and scrapped cylinders', 'الأسطوانات المفقودة والتالفة'), 'opex', false, ''),
  I('op_branch_repairs', 'operations', g.premises, t('Branch and warehouse repairs', 'إصلاحات الفروع والمستودعات'), 'opex', true, 'P_SUPPLIERS'),
  I('op_branch_supplies', 'operations', g.premises, t('Branch consumables and stationery', 'مستهلكات وقرطاسية الفروع'), 'opex', true, 'P_SUPPLIERS'),
  I('op_telecom', 'operations', g.premises, t('Mobile lines and branch internet', 'خطوط الجوال وإنترنت الفروع'), 'opex', true, 'P_UTILITIES'),
  I('op_generators', 'operations', g.premises, t('Generators and branch diesel', 'المولدات وديزل الفروع'), 'opex', true, 'P_DIESEL'),
  I('op_pest_waste', 'operations', g.premises, t('Pest control and waste removal', 'مكافحة الحشرات وإزالة النفايات'), 'opex', true, 'P_SUPPLIERS'),
  I('op_capex_cages', 'operations', g.capex, t('Cylinder cages, racks and storage', 'أقفاص ورفوف تخزين الأسطوانات'), 'capex', true, 'P_CAPEX'),
  I('op_capex_safety', 'operations', g.capex, t('Fire systems, CCTV and safety installations', 'أنظمة الحريق والمراقبة وتجهيزات السلامة'), 'capex', true, 'P_CAPEX'),
  // Procurement
  I('pr_cylinder_parts', 'procurement', g.gas, t('Cylinder valves and spare parts', 'صمامات وقطع غيار الأسطوانات'), 'cogs', true, 'P_SUPPLIERS'),
  I('pr_gas_loss', 'procurement', g.gas, t('Gas shrinkage and stock losses', 'فاقد الغاز وخسائر المخزون'), 'cogs', false, ''),
  I('pr_tank_rental', 'procurement', g.gas, t('Bulk tank rental from suppliers', 'استئجار خزانات الجملة من الموردين'), 'cogs', true, 'P_SUPPLIERS'),
  I('pr_inspection', 'procurement', g.services, t('Supplier inspection and quality checks', 'فحص الموردين والجودة'), 'opex', true, 'P_SUPPLIERS'),
  I('pr_capex_tanks', 'procurement', g.capex, t('Bulk tanks installed at customers', 'خزانات الجملة لدى العملاء'), 'capex', true, 'P_CAPEX'),
  // Sales
  I('sa_new_cylinders', 'sales', g.revenue, t('New cylinder sales to first-time customers', 'بيع أسطوانات جديدة لعملاء جدد'), 'revenue', true, 'R_CASH', { unit: t('cylinders', 'أسطوانة') }),
  I('sa_installation', 'sales', g.revenue, t('Installation and gas network services', 'خدمات التركيب وشبكات الغاز'), 'revenue', true, 'R_CUSTOMERS'),
  I('sa_tank_rental', 'sales', g.revenue, t('Tank rental to customers', 'تأجير الخزانات للعملاء'), 'revenue', true, 'R_CUSTOMERS'),
  I('sa_government', 'sales', g.revenue, t('Government and contract customers', 'العملاء الحكوميون والعقود'), 'revenue', true, 'R_CUSTOMERS'),
  I('sa_scrap', 'sales', g.revenue, t('Scrap cylinder and metal sales', 'بيع الأسطوانات والمعادن الخردة'), 'revenue', true, 'R_OTHER'),
  // Sales team
  I('st_training', 'sales_team', g.team, t('Sales training', 'تدريب فريق المبيعات'), 'opex', true, 'P_SUPPLIERS'),
  I('st_hospitality', 'sales_team', g.team, t('Customer hospitality and gifts', 'ضيافة العملاء والهدايا'), 'opex', true, 'P_SUPPLIERS'),
  I('st_samples', 'sales_team', g.team, t('Free trials and sample cylinders', 'تجارب مجانية وأسطوانات عينات'), 'opex', true, 'P_SUPPLIERS'),
  I('st_collection', 'sales_team', g.team, t('Collection agency and recovery fees', 'رسوم التحصيل واسترداد الديون'), 'opex', true, 'P_SUPPLIERS'),
  I('st_phones', 'sales_team', g.team, t('Sales phones and tablets', 'هواتف وأجهزة فريق المبيعات'), 'opex', true, 'P_UTILITIES'),
  // Marketing
  I('mk_loyalty', 'marketing', g.media, t('Loyalty programme rewards', 'مكافآت برنامج الولاء'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_messaging', 'marketing', g.media, t('SMS and WhatsApp messaging', 'رسائل SMS وواتساب'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_influencers', 'marketing', g.media, t('Influencers and creators', 'المؤثرون وصناع المحتوى'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_outdoor', 'marketing', g.media, t('Billboards, radio and outdoor', 'اللوحات الإعلانية والإذاعة'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_seo', 'marketing', g.media, t('Search, maps and app-store listings', 'محركات البحث والخرائط ومتاجر التطبيقات'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_photo', 'marketing', g.media, t('Photography and video production', 'التصوير وإنتاج الفيديو'), 'opex', true, 'P_SUPPLIERS'),
  I('mk_csr', 'marketing', g.media, t('Community and CSR activities', 'المسؤولية الاجتماعية والأنشطة المجتمعية'), 'opex', false, 'P_SUPPLIERS'),
  // Finance and administration
  I('fa_office', 'finance_admin', g.admin, t('Office supplies, printing and courier', 'مستلزمات المكتب والطباعة والبريد'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_hq_utilities', 'finance_admin', g.admin, t('Head office electricity, water and internet', 'كهرباء ومياه وإنترنت المركز الرئيسي'), 'opex', true, 'P_UTILITIES'),
  I('fa_travel', 'finance_admin', g.admin, t('Management travel', 'سفر الإدارة'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_einvoicing', 'finance_admin', g.admin, t('ZATCA e-invoicing (Fatoora) solution', 'حل الفوترة الإلكترونية (فاتورة)'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_board', 'finance_admin', g.admin, t('Board and shareholder costs', 'مصاريف مجلس الإدارة والمساهمين'), 'opex', true, 'P_SUPPLIERS'),
  I('fa_donations', 'finance_admin', g.admin, t('Donations', 'التبرعات'), 'opex', false, 'P_SUPPLIERS'),
  I('fa_penalties', 'finance_admin', g.finance, t('Government penalties (ZATCA, labour, municipality)', 'الغرامات الحكومية (الزكاة والعمل والبلدية)'), 'opex', false, 'P_GOV'),
  I('fa_wht', 'finance_admin', g.finance, t('Withholding tax on payments abroad', 'ضريبة الاستقطاع على المدفوعات للخارج'), 'opex', false, 'P_ZATCA'),
  I('fa_guarantees', 'finance_admin', g.finance, t('Bank guarantees and letters of credit fees', 'عمولات الضمانات البنكية والاعتمادات'), 'financing', false, 'P_BANK'),
  I('fa_facility_fees', 'finance_admin', g.finance, t('Facility arrangement and commitment fees', 'رسوم ترتيب والتزام التسهيلات'), 'financing', false, 'P_BANK'),
  I('fa_bad_debts', 'finance_admin', g.finance, t('Provision for doubtful debts', 'مخصص الديون المشكوك فيها'), 'noncash', false, '', { ebitda: true }),
  I('fa_lease_interest', 'finance_admin', g.finance, t('Lease interest (IFRS 16)', 'فوائد عقود الإيجار (IFRS 16)'), 'financing', false, 'P_RENT'),
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
