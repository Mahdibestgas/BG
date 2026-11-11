/**
 * LPG distribution template: prefilled cylinders bought from one supplier
 * (Gasko for Best Gas), sold through an app, door-to-door trucks and branch
 * walk-in. Ported line for line from the reference engine (app/Forecast.gs),
 * which is tested to the halala against the Excel models v2 and v3.
 */
import { pct, weekOf, isoOf, zeros } from '../calendar';
import type { AddItem, Calendar, Category, CoreModel, Template, TemplateOutput, Txt } from '../types';

export interface LpgModel extends CoreModel {
  template: 'lpg-distribution';
  scenarios: { active: string; table: Record<string, { volume: number; price: number; cost: number }> };
  tradingDays: number;
  growthPerWeek: number;
  seasonality: number[];
  regions: Array<{ id: string } & Txt>;
  branches: Array<{
    id: string; no?: number; regionId: string; en: string; ar: string; deliveryPerDay: number; walkinPerDay: number;
    appShare: number; rentMonthly: number; headcount: number; salaryMonthly: number; active: boolean;
  }>;
  skus: Array<{ id: string; en: string; ar: string; mix: number; price: number; cost: number; openingStock: number }>;
  accessories: Array<{ id: string; en: string; ar: string; attach: number; price: number; cost: number }>;
  attachMultipliers: Record<'app' | 'field' | 'store', number>;
  deliveryFee: { fee: number; chargedShare: number; driverShare: number };
  paymentMix: Record<'app' | 'field' | 'store', Record<'online' | 'pos' | 'cash', number>>;
  fees: { posPct: number; gatewayPct: number; gatewayFixed: number; cashLossPct: number };
  settlement: Record<'online' | 'pos' | 'cash', number[]>;
  gasko: { creditWeeks: number; advancePct: number; stockCoverWeeks: number; openingPayable: number; openingSchedule: number[] };
  payroll: {
    driversSeparate: boolean; driverHeadcount: number; driverMonthly: number; branchBasis: number; assumedPerHead: number;
    hqHeadcount: number; hqPerHead: number; regionalOfficeMonthly: number; gosiPct: number; eosbPct: number; overtimePct: number; payDay: number;
  };
  fleet: {
    trucks: number; daysPerWeek: number; dieselLitresPerDay: number; dieselPrice: number; maintPerTruckMonth: number;
    insurancePerTruckYear: number; permitsPerTruckYear: number; truckCost?: number; truckLifeYears?: number; dropsPerTruckDay?: number;
  };
  overheads: {
    utilitiesPerBranchMonth: number; licencesPerBranchYear: number; hqRentMonthly: number; itMonthly: number; marketingPct: number;
    otherGAMonthly: number; shellPool: number; shellCost: number; shellLifeYears?: number; shellLossWeekly: number; shrinkPct?: number;
  };
}

export const LPG_CATEGORIES: Category[] = [
  { id: 'R_ONLINE', section: 'receipts', group: 'sales', en: 'Souq Gas online / gateway settlements', ar: 'تسويات الدفع الإلكتروني (سوق غاز)' },
  { id: 'R_POS', section: 'receipts', group: 'sales', en: 'POS / mada settlements', ar: 'تسويات نقاط البيع / مدى' },
  { id: 'R_CASH', section: 'receipts', group: 'sales', en: 'Cash banked (stores + drivers)', ar: 'النقد المودع (الفروع والسائقون)' },
  { id: 'R_OPEN_AR', section: 'receipts', group: 'opening', en: 'Collection of opening receivables', ar: 'تحصيل الذمم المدينة الافتتاحية' },
  { id: 'R_OTHER', section: 'receipts', group: 'other', en: 'Other receipts', ar: 'مقبوضات أخرى' },
  { id: 'P_GASKO_ADV', section: 'payments', group: 'gasko', en: 'Gasko advance paid on delivery', ar: 'دفعة جاسكو المقدمة عند التسليم' },
  { id: 'P_GASKO_DEF', section: 'payments', group: 'gasko', en: 'Gasko balance on credit terms', ar: 'رصيد جاسكو حسب مدة الائتمان' },
  { id: 'P_GASKO_OPEN', section: 'payments', group: 'gasko', en: 'Gasko opening payable', ar: 'ذمم جاسكو الدائنة الافتتاحية' },
  { id: 'P_DRIVER_FEE', section: 'payments', group: 'people', en: 'Driver delivery compensation', ar: 'تعويض توصيل السائقين' },
  { id: 'P_PAYROLL', section: 'payments', group: 'people', en: 'Payroll & GOSI (WPS run)', ar: 'الرواتب والتأمينات (حماية الأجور)' },
  { id: 'P_DIESEL', section: 'payments', group: 'fleet', en: 'Diesel', ar: 'الديزل' },
  { id: 'P_FLEET', section: 'payments', group: 'fleet', en: 'Fleet maintenance, insurance & permits', ar: 'صيانة الأسطول والتأمين والتصاريح' },
  { id: 'P_RENT', section: 'payments', group: 'premises', en: 'Branch rent', ar: 'إيجارات الفروع' },
  { id: 'P_UTIL', section: 'payments', group: 'premises', en: 'Store utilities & licences', ar: 'مرافق الفروع والتراخيص' },
  { id: 'P_GA', section: 'payments', group: 'overheads', en: 'G&A, marketing & transaction fees', ar: 'المصاريف العمومية والتسويق ورسوم المعاملات' },
  { id: 'P_VAT', section: 'payments', group: 'tax', en: 'VAT settlement to ZATCA', ar: 'سداد ضريبة القيمة المضافة (زاتكا)' },
  { id: 'P_LOAN', section: 'payments', group: 'debt', en: 'Term-loan repayment', ar: 'سداد القرض' },
  { id: 'P_CAPEX', section: 'payments', group: 'capex', en: 'Capex: cylinders, stores, equipment', ar: 'النفقات الرأسمالية: أسطوانات وفروع ومعدات' },
  { id: 'P_OTHER', section: 'payments', group: 'other', en: 'Other payments', ar: 'مدفوعات أخرى' },
  { id: 'F_INTEREST', section: 'financing', group: 'financing', en: 'Financing cost on drawn facility', ar: 'تكلفة التمويل على التسهيلات المستخدمة' }
];

type Channel = 'app' | 'field' | 'store';
type Method = 'online' | 'pos' | 'cash';
const CHANNELS: Array<{ id: Channel } & Txt> = [
  { id: 'app', en: 'Souq Gas app (delivered)', ar: 'تطبيق سوق غاز (توصيل)' },
  { id: 'field', en: 'House-to-house truck', ar: 'التوزيع من باب لباب' },
  { id: 'store', en: 'Store walk-in', ar: 'البيع المباشر بالفرع' }
];
const METHODS: Array<{ id: Method; cat: string }> = [
  { id: 'online', cat: 'R_ONLINE' }, { id: 'pos', cat: 'R_POS' }, { id: 'cash', cat: 'R_CASH' }
];

function run(model: LpgModel, cal: Calendar, add: AddItem, ctx: { v2: boolean }): TemplateOutput {
  const v2 = ctx.v2;
  const N = cal.weeks.length;
  const vat = model.tax.vatRate;
  const sc = model.scenarios.table[model.scenarios.active];
  const days = model.tradingDays;
  const branches = model.branches.filter((b) => b.active);
  const regionById: Record<string, Txt> = {};
  model.regions.forEach((r) => { regionById[r.id] = r; });

  const demand = cal.weeks.map((w) => model.seasonality[w.i] * Math.pow(1 + model.growthPerWeek, w.i) * sc.volume);
  let asp = 0, accRev = 0;
  model.skus.forEach((s) => { asp += s.mix * s.price; });
  asp *= sc.price;
  model.accessories.forEach((a) => { accRev += a.attach * a.price; });
  accRev *= sc.price;
  const fee = model.deliveryFee.fee * model.deliveryFee.chargedShare;
  const mult = model.attachMultipliers;

  const D = {
    orders: { app: zeros(N), field: zeros(N), store: zeros(N), total: zeros(N) },
    grossByChannel: { app: zeros(N), field: zeros(N), store: zeros(N) },
    grossByStream: { cylinders: zeros(N), accessories: zeros(N), deliveryFees: zeros(N) },
    grossByMethod: { online: zeros(N), pos: zeros(N), cash: zeros(N) },
    grossTotal: zeros(N), netRevenue: zeros(N), outputVat: zeros(N),
    weightedOrders: zeros(N), txnCosts: zeros(N), marketing: zeros(N),
    receiptsTail: 0,
    inventory: {} as Record<string, { opening: number[]; target: number[]; purchases: number[]; closing: number[]; sales: number[] }>,
    accessoryUnits: {} as Record<string, number[]>,
    purchasesExVat: zeros(N), inputVatPurchases: zeros(N)
  };
  const perBranch: Record<string, { netRevenue: number[]; feeRevenue: number[]; gross: number[] }> = {};
  const gross = (o: number, ch: Channel) => o * asp + o * mult[ch] * accRev + (ch === 'store' ? 0 : o * fee);

  // -- sales and their settlement, branch x channel x method
  for (const b of branches) {
    const reg = regionById[b.regionId];
    const pb = perBranch[b.id] = { netRevenue: zeros(N), feeRevenue: zeros(N), gross: zeros(N) };
    const dims = { branchId: b.id, regionId: b.regionId };
    const bl3 = 'branch:' + b.id;
    const blabel = { en: b.en, ar: b.ar, region: reg ? { en: reg.en, ar: reg.ar } : undefined } as unknown as Txt;
    for (const wk of cal.weeks) {
      const w = wk.i;
      const del = b.deliveryPerDay * days * demand[w];
      const ord: Record<Channel, number> = { app: del * b.appShare, field: del * (1 - b.appShare), store: b.walkinPerDay * days * demand[w] };
      let online = 0, posG = 0, cashG = 0;
      for (const ch of CHANNELS) {
        const o = ord[ch.id];
        const cyl = o * asp, acc = o * mult[ch.id] * accRev, fr = ch.id === 'store' ? 0 : o * fee, g = cyl + acc + fr;
        D.orders[ch.id][w] += o; D.orders.total[w] += o; D.weightedOrders[w] += o * mult[ch.id];
        D.grossByChannel[ch.id][w] += g;
        D.grossByStream.cylinders[w] += cyl; D.grossByStream.accessories[w] += acc; D.grossByStream.deliveryFees[w] += fr;
        D.grossTotal[w] += g; pb.feeRevenue[w] += fr; pb.gross[w] += g;
        for (const m of METHODS) {
          const amt = g * model.paymentMix[ch.id][m.id];
          if (!amt) continue;
          D.grossByMethod[m.id][w] += amt;
          const lag = model.settlement[m.id];
          const d2 = { branchId: b.id, regionId: b.regionId, channel: ch.id, method: m.id, saleWeek: w };
          add(m.cat, w, amt * lag[0], bl3, blabel, d2, { ref: 'settle', note: { en: ch.en + ', ' + wk.label + ' sales, ' + pct(lag[0]) + ' same week', ar: ch.ar + '، مبيعات ' + wk.label + '، ' + pct(lag[0]) + ' في نفس الأسبوع' } });
          if (w + 1 < N) add(m.cat, w + 1, amt * lag[1], bl3, blabel, d2, { ref: 'settle', note: { en: ch.en + ', ' + wk.label + ' sales, ' + pct(lag[1]) + ' following week', ar: ch.ar + '، مبيعات ' + wk.label + '، ' + pct(lag[1]) + ' في الأسبوع التالي' } });
          else D.receiptsTail += amt * lag[1];
        }
      }
      for (const ch of CHANNELS) {
        const g = gross(ord[ch.id], ch.id);
        online += g * model.paymentMix[ch.id].online; posG += g * model.paymentMix[ch.id].pos; cashG += g * model.paymentMix[ch.id].cash;
      }
      const gw = online * model.fees.gatewayPct + ord.app * model.paymentMix.app.online * model.fees.gatewayFixed;
      const posFee = posG * model.fees.posPct, cashLoss = cashG * model.fees.cashLossPct;
      D.txnCosts[w] += gw + posFee + cashLoss;
      const tl = { en: 'Payment transaction costs', ar: 'تكاليف معاملات الدفع' };
      add('P_GA', w, gw, 'ga:txn', tl, dims, { note: { en: b.en + ', gateway fees', ar: b.ar + '، رسوم بوابة الدفع' } });
      add('P_GA', w, posFee, 'ga:txn', tl, dims, { note: { en: b.en + ', mada merchant fees', ar: b.ar + '، رسوم مدى' } });
      add('P_GA', w, cashLoss, 'ga:txn', tl, dims, { note: { en: b.en + ', cash handling loss', ar: b.ar + '، فاقد النقد' } });
    }
  }
  for (let w = 0; w < N; w++) { D.netRevenue[w] = D.grossTotal[w] / (1 + vat); D.outputVat[w] = D.grossTotal[w] - D.netRevenue[w]; }
  for (const b of branches) perBranch[b.id].netRevenue = perBranch[b.id].gross.map((g) => g / (1 + vat));

  // -- stock and supplier purchases, per SKU
  const cf = sc.cost;
  const invoices: Array<Array<{ l3: string; label: Txt; exVat: number; units?: number }>> = cal.weeks.map(() => []);
  for (const s of model.skus) {
    const sales = D.orders.total.map((o) => o * s.mix);
    const inv = { opening: [] as number[], target: [] as number[], purchases: [] as number[], closing: [] as number[], sales };
    let open = s.openingStock;
    for (let w = 0; w < N; w++) {
      const target = model.gasko.stockCoverWeeks * (w + 1 < N ? sales[w + 1] : sales[w]);
      const buy = Math.max(0, sales[w] + target - open), close = open + buy - sales[w];
      inv.opening.push(open); inv.target.push(target); inv.purchases.push(buy); inv.closing.push(close);
      const value = buy * s.cost * cf;
      D.purchasesExVat[w] += value;
      if (value) invoices[w].push({ l3: 'sku:' + s.id, label: { en: s.en, ar: s.ar }, exVat: value, units: buy });
      open = close;
    }
    D.inventory[s.id] = inv;
  }
  for (const a of model.accessories) D.accessoryUnits[a.id] = D.weightedOrders.map((o) => o * a.attach);
  for (let w = 0; w < N; w++) {
    let v = 0;
    model.accessories.forEach((a, k) => {
      // v2: Volume!D37*E49+D38*E50+D39*E51+D40*E52*C22 — the factor binds to the last term only
      v += D.accessoryUnits[a.id][w] * a.cost * ((v2 && k < model.accessories.length - 1) ? 1 : cf);
    });
    D.purchasesExVat[w] += v;
    if (v) invoices[w].push({ l3: 'acc', label: { en: 'Accessories (bought to order)', ar: 'الإكسسوارات (حسب الطلب)' }, exVat: v });
  }
  D.inputVatPurchases = D.purchasesExVat.map((x) => x * vat);
  const g = model.gasko;
  for (const wk of cal.weeks) {
    for (const inv of invoices[wk.i]) {
      const grossInv = inv.exVat * (1 + vat), dims = { counterparty: 'Gasko', invoiceWeek: wk.i };
      const base = { en: 'PO ' + wk.label, ar: 'أمر شراء ' + wk.label };
      add('P_GASKO_ADV', wk.i, grossInv * g.advancePct, inv.l3, inv.label, dims, { ref: 'po', units: inv.units, note: { en: base.en + ', ' + pct(g.advancePct) + ' on delivery', ar: base.ar + '، ' + pct(g.advancePct) + ' عند التسليم' } });
      add('P_GASKO_DEF', wk.i + g.creditWeeks, grossInv * (1 - g.advancePct), inv.l3, inv.label, dims, { ref: 'po', note: { en: base.en + ', balance after ' + g.creditWeeks + ' weeks', ar: base.ar + '، الرصيد بعد ' + g.creditWeeks + ' أسابيع' } });
    }
  }
  g.openingSchedule.forEach((p, w) => {
    add('P_GASKO_OPEN', w, g.openingPayable * p, 'opening:gasko', { en: 'Opening Gasko payable', ar: 'ذمم جاسكو الافتتاحية' },
      { counterparty: 'Gasko' }, { ref: 'opening', note: { en: pct(p) + ' of the opening payable', ar: pct(p) + ' من الرصيد الافتتاحي' } });
  });

  // -- driver compensation, weekly per branch
  for (const b of branches) {
    perBranch[b.id].feeRevenue.forEach((fr, w) => add('P_DRIVER_FEE', w, fr * model.deliveryFee.driverShare, 'branch:' + b.id, { en: b.en, ar: b.ar }, { branchId: b.id, regionId: b.regionId }));
  }

  // -- payroll: one WPS run per month on the pay day
  const pr = model.payroll, uplift = (1 + pr.overtimePct) * (1 + pr.gosiPct);
  const groups: Array<{ l3: string; label: Txt; monthly: number; branchId?: string; regionId?: string }> = [];
  if (pr.driversSeparate) groups.push({ l3: 'pay:drivers', label: { en: 'Drivers', ar: 'السائقون' }, monthly: pr.driverHeadcount * pr.driverMonthly });
  for (const b of branches) groups.push({ l3: 'branch:' + b.id, label: { en: b.en, ar: b.ar }, branchId: b.id, regionId: b.regionId, monthly: pr.branchBasis === 2 ? b.headcount * pr.assumedPerHead : b.salaryMonthly });
  groups.push({ l3: 'pay:hq', label: { en: 'HQ, admin, call centre & ops', ar: 'المركز الرئيسي والإدارة ومركز الاتصال' }, monthly: pr.hqHeadcount * pr.hqPerHead + pr.regionalOfficeMonthly });
  for (const mo of cal.months) {
    let dom = pr.payDay;
    if (!v2) dom = Math.min(dom, mo.end - mo.start + 1);
    const payDn = mo.start + dom - 1, w = weekOf(cal, payDn);
    for (const pg of groups) {
      add('P_PAYROLL', w, pg.monthly * uplift, pg.l3, pg.label, { branchId: pg.branchId, regionId: pg.regionId },
        { date: isoOf(payDn), note: { en: 'Payroll ' + mo.key + ' (salary + overtime + GOSI)', ar: 'رواتب ' + mo.key + ' (راتب + إضافي + تأمينات)' } });
    }
  }

  // -- fleet
  const fl = model.fleet;
  const diesel = fl.trucks * fl.daysPerWeek * fl.dieselLitresPerDay * fl.dieselPrice;
  const maint = fl.trucks * fl.maintPerTruckMonth * 12 / 52, ins = fl.trucks * fl.insurancePerTruckYear / 52, permits = fl.trucks * fl.permitsPerTruckYear / 52;
  for (const wk of cal.weeks) {
    add('P_DIESEL', wk.i, diesel, 'fleet:diesel', { en: 'Diesel for ' + fl.trucks + ' trucks', ar: 'ديزل ' + fl.trucks + ' شاحنة' }, {});
    add('P_FLEET', wk.i, maint, 'fleet:maint', { en: 'Maintenance & tyres', ar: 'الصيانة والإطارات' }, {});
    add('P_FLEET', wk.i, ins, 'fleet:ins', { en: 'Insurance', ar: 'التأمين' }, {});
    add('P_FLEET', wk.i, permits, 'fleet:permits', { en: 'Registration, permits & tracking', ar: 'الاستمارة والتصاريح والتتبع' }, {});
  }

  // -- premises: rent on the 1st, utilities and licences weekly
  const oh = model.overheads;
  let rentMonthly = 0;
  for (const b of branches) rentMonthly += b.rentMonthly;
  for (const mo of cal.months) {
    const w = weekOf(cal, mo.start);
    for (const b of branches) add('P_RENT', w, b.rentMonthly, 'branch:' + b.id, { en: b.en, ar: b.ar }, { branchId: b.id, regionId: b.regionId }, { date: isoOf(mo.start), note: { en: 'Rent ' + mo.key, ar: 'إيجار ' + mo.key } });
  }
  const util = oh.utilitiesPerBranchMonth * 12 / 52, lic = oh.licencesPerBranchYear / 52;
  for (const wk of cal.weeks) {
    for (const b of branches) {
      const d = { branchId: b.id, regionId: b.regionId };
      add('P_UTIL', wk.i, util, 'branch:' + b.id, { en: b.en, ar: b.ar }, d, { note: { en: 'Utilities', ar: 'المرافق' } });
      add('P_UTIL', wk.i, lic, 'branch:' + b.id, { en: b.en, ar: b.ar }, d, { note: { en: 'Licences (Baladiya, Civil Defence, HSE)', ar: 'التراخيص (البلدية، الدفاع المدني، السلامة)' } });
    }
  }

  // -- G&A, paid weekly as accrued (as in v2)
  const hqRent = oh.hqRentMonthly * 12 / 52, it = oh.itMonthly * 12 / 52, otherGA = oh.otherGAMonthly * 12 / 52;
  for (const wk of cal.weeks) {
    add('P_GA', wk.i, hqRent, 'ga:hqrent', { en: 'HQ rent & facilities', ar: 'إيجار المركز الرئيسي والمرافق' }, {});
    add('P_GA', wk.i, it, 'ga:it', { en: 'IT, ERP & Souq Gas app', ar: 'تقنية المعلومات وتطبيق سوق غاز' }, {});
    add('P_GA', wk.i, otherGA, 'ga:other', { en: 'Other G&A', ar: 'مصاريف عمومية أخرى' }, {});
    for (const b of branches) {
      const mk = perBranch[b.id].netRevenue[wk.i] * oh.marketingPct;
      D.marketing[wk.i] += mk;
      add('P_GA', wk.i, mk, 'ga:marketing', { en: 'Marketing & app promotions', ar: 'التسويق وعروض التطبيق' }, { branchId: b.id, regionId: b.regionId }, { note: { en: b.en, ar: b.ar } });
    }
  }
  const gaWeekly = cal.weeks.map((wk) => hqRent + it + otherGA + D.marketing[wk.i] + D.txnCosts[wk.i]);

  // -- cylinder shells (the template's capex; other capex is the core's)
  const shells = oh.shellPool * oh.shellLossWeekly * oh.shellCost;
  for (const wk of cal.weeks) add('P_CAPEX', wk.i, shells, 'capex:shells', { en: 'Replacement cylinder shells', ar: 'استبدال هياكل الأسطوانات' }, {});

  const fleetWeekly = diesel + maint + ins + permits;
  const storeWeekly = rentMonthly * 12 / 52 + branches.length * (util + lic);
  return {
    drivers: D,
    vat: { output: D.outputVat, inputPurchases: D.inputVatPurchases, opexBase: cal.weeks.map((wk) => fleetWeekly + storeWeekly + gaWeekly[wk.i]) },
    checks: lpgChecks(model, D),
    salesConservation: { sold: D.grossTotal.reduce((a, b) => a + b, 0), afterWindow: D.receiptsTail, categories: ['R_ONLINE', 'R_POS', 'R_CASH'] }
  };
}

function lpgChecks(model: LpgModel, D: { [k: string]: any }) {
  const N = D.grossTotal.length, out: Array<{ id: string; en: string; ar: string; diff: number }> = [];
  const maxAbs = (a: number[]) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const s1: number[] = [], s2: number[] = [];
  for (let j = 0; j < N; j++) {
    const ch = D.grossByChannel.app[j] + D.grossByChannel.field[j] + D.grossByChannel.store[j];
    s1.push(ch - (D.grossByStream.cylinders[j] + D.grossByStream.accessories[j] + D.grossByStream.deliveryFees[j]));
    s2.push(ch - (D.grossByMethod.online[j] + D.grossByMethod.pos[j] + D.grossByMethod.cash[j]));
  }
  out.push({ id: 'sales_streams', en: 'Sales by channel = sales by stream', ar: 'المبيعات حسب القناة = المبيعات حسب النوع', diff: maxAbs(s1) });
  out.push({ id: 'sales_methods', en: 'Sales by channel = sales by payment method', ar: 'المبيعات حسب القناة = حسب طريقة الدفع', diff: maxAbs(s2) });
  let inv = 0;
  for (const k of Object.keys(D.inventory)) {
    const x = D.inventory[k];
    for (let w = 0; w < N; w++) inv = Math.max(inv, Math.abs(x.opening[w] + x.purchases[w] - x.sales[w] - x.closing[w]));
  }
  out.push({ id: 'inventory', en: 'Stock: opening + purchases − sales = closing', ar: 'المخزون: افتتاحي + مشتريات − مبيعات = إقفال', diff: inv });
  let mix = 0; model.skus.forEach((s) => { mix += s.mix; });
  out.push({ id: 'sku_mix', en: 'Cylinder mix totals 100%', ar: 'مزيج الأسطوانات = ١٠٠٪', diff: mix - 1 });
  let pm = 0;
  for (const c of Object.keys(model.paymentMix) as Channel[]) { const p = model.paymentMix[c]; pm = Math.max(pm, Math.abs(p.online + p.pos + p.cash - 1)); }
  out.push({ id: 'payment_mix', en: 'Payment mix per channel totals 100%', ar: 'مزيج الدفع لكل قناة = ١٠٠٪', diff: pm });
  let st = 0;
  for (const m of Object.keys(model.settlement) as Method[]) st = Math.max(st, Math.abs(model.settlement[m].reduce((a, b) => a + b, 0) - 1));
  out.push({ id: 'settlement', en: 'Settlement timing per method totals 100%', ar: 'توقيت التسوية لكل طريقة = ١٠٠٪', diff: st });
  out.push({ id: 'gasko_opening', en: 'Opening Gasko payable schedule totals 100%', ar: 'جدول سداد ذمم جاسكو الافتتاحية = ١٠٠٪', diff: model.gasko.openingSchedule.reduce((a, b) => a + b, 0) - 1 });
  return out.map((c) => ({ ...c, ok: Math.abs(c.diff) < 0.005 }));
}

export const lpgDistribution: Template<LpgModel> = {
  id: 'lpg-distribution',
  name: { en: 'LPG distribution', ar: 'توزيع الغاز المسال' },
  categories: LPG_CATEGORIES,
  run
};

