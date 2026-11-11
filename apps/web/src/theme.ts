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
