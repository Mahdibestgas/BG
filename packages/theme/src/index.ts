/**
 * A company's theme, made from its logo. Shared by the browser (which reads the
 * logo's pixels) and the server (which checks what the browser sends), so the
 * two always agree: deriveTheme() only ever returns a theme checkTheme() accepts.
 *
 * The theme dresses brand chrome only. Data colours (receipts/payments) and
 * alert colours are fixed for every company and are not part of it.
 */

export const THEME_KEYS = ['brand', 'brandDeep', 'brandSoft', 'paper', 'surface', 'ink', 'ink2', 'rule'] as const;
export type Theme = Record<(typeof THEME_KEYS)[number], string>;

/** The minimum contrast each pairing must reach (WCAG): AA for UI text, AAA for body ink. */
export const RULES = { brandOnWhite: 4.5, brandDeepOnWhite: 4.5, inkOnPaper: 7, ink2OnSurface: 4.5 } as const;

export const DEFAULT_THEME: Theme = {
  brand: '#2F5D50', brandDeep: '#1F3D35', brandSoft: '#E3ECE8', paper: '#F5F4EF',
  surface: '#FFFFFF', ink: '#1E2522', ink2: '#56605B', rule: '#E2E2DA'
};

// ---- colour maths: sRGB <-> OKLCH, so derived steps keep the logo's hue
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const delin = (c: number) => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, c)) * 255); };
export interface Oklch { L: number; C: number; H: number }
export function toOklch(r: number, g: number, b: number): Oklch {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.sqrt(A * A + Bb * Bb), H: Math.atan2(Bb, A) };
}
export function fromOklch(L: number, C: number, H: number): string {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return '#' + [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((c) => delin(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export function contrast(a: string, b: string): number { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

/** Darkens (L down) until `hex(L)` reaches `ratio` against `against`. */
function darkenTo(L: number, C: number, H: number, against: string, ratio: number): string {
  let hex = fromOklch(L, C, H);
  while (contrast(hex, against) < ratio && L > 0.05) { L -= 0.01; hex = fromOklch(L, C * Math.min(1, L / 0.3 + 0.2), H); }
  return hex;
}

export interface Derived { theme: Theme; found: { brand: string | null; paper: string | null }; adjusted: string[] }

/**
 * Builds a theme from a logo's RGBA pixels (as from canvas getImageData). The
 * brand is the logo's most common clearly coloured tone; the paper is its most
 * common light tone. Every pairing is then corrected until it passes RULES.
 */
export function deriveTheme(rgba: ArrayLike<number>): Derived {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue; // transparent background is not a colour
    const key = (rgba[i] >> 4) + ',' + (rgba[i + 1] >> 4) + ',' + (rgba[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgba[i]; b.g += rgba[i + 1]; b.b += rgba[i + 2];
    buckets.set(key, b);
  }
  const cols = [...buckets.values()].map((b) => ({ n: b.n, ...toOklch(b.r / b.n, b.g / b.n, b.b / b.n) }));
  const brandC = cols.filter((o) => o.C > 0.03 && o.L > 0.2 && o.L < 0.95).sort((a, b) => b.n * b.C - a.n * a.C)[0];
  const paperC = cols.filter((o) => o.L > 0.85 && o.C < 0.08).sort((a, b) => b.n - a.n)[0];
  const adjusted: string[] = [];
  const base = brandC || { L: 0.45, C: 0.05, H: 2.6, n: 0 }; // a logo with no colour gets a calm green-grey
  if (!brandC) adjusted.push('no_brand_colour');
  const H = base.H, C = Math.min(base.C, 0.16);

  const brand = darkenTo(Math.min(base.L, 0.62), base.C, H, '#FFFFFF', RULES.brandOnWhite);
  if (brand !== fromOklch(Math.min(base.L, 0.62), base.C, H) || base.L > 0.62) adjusted.push('brand_darkened');
  const brandDeep = darkenTo(Math.max(0.2, Math.min(base.L, 0.62) - 0.18), C * 0.9, H, '#FFFFFF', RULES.brandDeepOnWhite);
  const paper = fromOklch(paperC ? Math.min(0.975, Math.max(0.94, paperC.L)) : 0.97, Math.min(paperC ? paperC.C : 0.01, 0.02), paperC ? paperC.H : H);
  const surface = '#FFFFFF';
  const ink = darkenTo(0.25, Math.min(C * 0.35, 0.03), H, paper, RULES.inkOnPaper);
  const ink2 = darkenTo(0.47, Math.min(C * 0.3, 0.03), H, surface, RULES.ink2OnSurface);
  const theme: Theme = {
    brand, brandDeep, brandSoft: fromOklch(0.94, C * 0.25, H), paper, surface, ink, ink2,
    rule: fromOklch(0.9, Math.min(C * 0.2, 0.02), H)
  };
  return { theme, found: { brand: brandC ? fromOklch(brandC.L, brandC.C, brandC.H) : null, paper: paperC ? fromOklch(paperC.L, paperC.C, paperC.H) : null }, adjusted };
}

/** The server's check. Returns an error code, or null when the theme is acceptable. */
export function themeProblem(t: unknown): string | null {
  if (!t || typeof t !== 'object') return 'invalid_theme';
  const o = t as Record<string, unknown>;
  for (const k of THEME_KEYS) if (typeof o[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o[k] as string)) return 'invalid_theme:' + k;
  const x = o as Theme;
  if (contrast(x.brand, '#FFFFFF') < RULES.brandOnWhite) return 'theme_contrast:brand';
  if (contrast(x.brandDeep, '#FFFFFF') < RULES.brandDeepOnWhite) return 'theme_contrast:brandDeep';
  if (contrast(x.ink, x.paper) < RULES.inkOnPaper) return 'theme_contrast:ink';
  if (contrast(x.ink2, x.surface) < RULES.ink2OnSurface) return 'theme_contrast:ink2';
  return null;
}
export function normalizeTheme(t: Theme): Theme {
  const out = {} as Theme;
  for (const k of THEME_KEYS) out[k] = t[k].toUpperCase();
  return out;
}
