import { deriveTheme, THEME_KEYS, type Theme } from '@cf13/theme';

/** Puts a company's theme on the page. Only brand chrome; data and alert colours are fixed in CSS. */
export function applyTheme(t: Theme | null) {
  const s = document.documentElement.style;
  if (!t) { THEME_KEYS.forEach((k) => s.removeProperty('--' + cssName(k))); return; }
  THEME_KEYS.forEach((k) => s.setProperty('--' + cssName(k), t[k]));
}
const cssName = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_MAX = 512 * 1024;

/** Reads a logo file: its pixels become the theme, its bytes are what gets uploaded. */
export async function themeFromFile(file: File): Promise<{ theme: Theme; adjusted: string[]; base64: string; type: string; url: string }> {
  if (!TYPES.includes(file.type)) throw new Error('logo_type');
  if (file.size > LOGO_MAX) throw new Error('logo_size');
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('logo_type')); i.src = url; });
  const c = document.createElement('canvas'), n = 96;
  c.width = c.height = n;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, n, n);
  const d = deriveTheme(g.getImageData(0, 0, n, n).data);
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { theme: d.theme, adjusted: d.adjusted, base64: btoa(bin), type: file.type, url };
}

// ---- colour scheme: follows the system until the person picks one on this device
export type Scheme = 'light' | 'dark';
const SCHEME_KEY = 'cf13_scheme';
const systemScheme = (): Scheme => (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
/** The scheme on screen now. */
export function currentScheme(): Scheme {
  const a = document.documentElement.getAttribute('data-scheme');
  return a === 'dark' || a === 'light' ? a : systemScheme();
}
/** Applies the saved choice, if any (called once at start-up). */
export function initScheme() {
  let saved = '';
  try { saved = localStorage.getItem(SCHEME_KEY) || ''; } catch { /* private mode */ }
  if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-scheme', saved);
}
/** Calls back when the system scheme changes and no choice is saved on this device. */
export function onSystemScheme(cb: (s: Scheme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const h = () => { if (!document.documentElement.getAttribute('data-scheme')) cb(mq.matches ? 'dark' : 'light'); };
  mq.addEventListener('change', h);
  return () => mq.removeEventListener('change', h);
}
/** Auto (follow the device), Day or Night, as chosen on this device. */
export type SchemeChoice = 'auto' | Scheme;
export function schemeChoice(): SchemeChoice { const a = document.documentElement.getAttribute('data-scheme'); return a === 'dark' || a === 'light' ? a : 'auto'; }
export function chooseScheme(c: SchemeChoice) {
  if (c === 'auto') { document.documentElement.removeAttribute('data-scheme'); try { localStorage.removeItem(SCHEME_KEY); } catch { /* private mode */ } }
  else setScheme(c);
}
export function setScheme(s: Scheme) {
  document.documentElement.setAttribute('data-scheme', s);
  try { localStorage.setItem(SCHEME_KEY, s); } catch { /* private mode */ }
}
