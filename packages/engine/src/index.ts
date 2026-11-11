import { runForecast } from './core';
import { generic, type GenericModel } from './templates/generic';
import { lpgDistribution, type LpgModel } from './templates/lpg';
import { bankHistory, type HistoryModel, type HistoryLine } from './templates/history';
import { EngineError } from './calendar';
import type { CoreModel, ForecastResult, Template } from './types';

export * from './types';
export * from './calendar';
export { runForecast, rollupL3, expandSchedule, COMPAT_NOTES } from './core';
export { lpgDistribution, LPG_CATEGORIES } from './templates/lpg';
export { generic, GENERIC_CATEGORIES } from './templates/generic';
export { bankHistory, HISTORY_CATEGORIES } from './templates/history';
export type { LpgModel, GenericModel, HistoryModel, HistoryLine };

export const TEMPLATES: Record<string, Template<any>> = { [lpgDistribution.id]: lpgDistribution, [generic.id]: generic, [bankHistory.id]: bankHistory };

/** Runs a plan with the template it names. */
export function forecast(model: CoreModel): ForecastResult {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, model.template)) throw new EngineError('unknown_template');
  return runForecast(model, TEMPLATES[model.template]);
}

import lpgDemo from './starters/lpg-demo.json';
/** The plan a new company starts with: demo figures it replaces with its own. */
export function starterModel(templateId: string, startDate: string): CoreModel {
  if (templateId === 'lpg-distribution') {
    const m = JSON.parse(JSON.stringify(lpgDemo)) as CoreModel;
    m.meta.startDate = startDate;
    return m;
  }
  if (templateId === 'generic') {
    return {
      template: 'generic', meta: { name: 'First plan', demo: true, currency: 'SAR', startDate, weeks: 13 },
      tax: { vatRate: 0.15, vatFiling: 1, vatDueDays: 30, opexVatShare: 0 },
      financing: { openingCash: 0, openingVatPayable: 0, openingVatDueDate: null, facilityLimit: 0, facilityRate: 0, loanMonthly: 0, otherCapexMonthly: 0, minBuffer: 0 },
      openingReceivable: { amount: 0, schedule: [1] }, schedules: []
    };
  }
  throw new EngineError('unknown_template');
}
