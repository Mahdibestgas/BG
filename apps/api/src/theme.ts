/**
 * Theme rules live in @cf13/theme, shared with the browser that derives the
 * theme from the logo, so what the browser makes is exactly what passes here.
 */
import { DEFAULT_THEME, normalizeTheme, themeProblem, type Theme } from '@cf13/theme';
import { AppError } from './http';

export { DEFAULT_THEME };

export function checkTheme(t: unknown): Theme {
  const problem = themeProblem(t);
  if (problem) throw new AppError(problem);
  return normalizeTheme(t as Theme);
}
