import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, deriveTheme, themeProblem, RULES, DEFAULT_THEME } from '../src';

/** A fake logo: `parts` of [hex, share] painted onto an RGBA buffer, plus optional transparency. */
function logo(parts: Array<[string, number]>, transparentShare = 0): Uint8ClampedArray {
  const n = 4096, out = new Uint8ClampedArray(n * 4);
  let i = 0;
  const paint = (hex: string, count: number, alpha = 255) => {
    const v = parseInt(hex.slice(1), 16);
    for (let k = 0; k < count && i < n; k++, i++) { out[i * 4] = v >> 16; out[i * 4 + 1] = (v >> 8) & 255; out[i * 4 + 2] = v & 255; out[i * 4 + 3] = alpha; }
  };
  paint('#000000', Math.round(n * transparentShare), 0);
  for (const [hex, share] of parts) paint(hex, Math.round(n * share));
  return out;
}

const LOGOS: Record<string, Uint8ClampedArray> = {
  'Best Gas (sage on cream)': logo([['#4D6D51', 0.55], ['#F2EEE4', 0.45]]),
  'blue water company': logo([['#1D5FA8', 0.6], ['#F3F7FB', 0.4]]),
  'orange food company': logo([['#E8701E', 0.5], ['#FFFFFF', 0.5]]),
  'pale yellow on white': logo([['#F5E58C', 0.5], ['#FFFFFF', 0.5]]),
  'neon green': logo([['#39FF14', 0.7], ['#111111', 0.3]]),
  'black and white only': logo([['#000000', 0.5], ['#FFFFFF', 0.5]]),
  'transparent PNG, red mark': logo([['#C8102E', 0.3]], 0.7),
  'empty image': logo([], 1)
};

test('every logo yields a theme the server accepts', () => {
  for (const [name, px] of Object.entries(LOGOS)) {
    const d = deriveTheme(px);
    assert.equal(themeProblem(d.theme), null, `${name}: ${themeProblem(d.theme)} ${JSON.stringify(d.theme)}`);
    assert.ok(contrast(d.theme.brand, '#FFFFFF') >= RULES.brandOnWhite, name);
    assert.ok(contrast(d.theme.ink, d.theme.paper) >= RULES.inkOnPaper, name);
  }
});

test('the brand keeps the logo’s hue', () => {
  const blue = deriveTheme(LOGOS['blue water company']).theme.brand;
  const n = parseInt(blue.slice(1), 16);
  assert.ok((n & 255) > (n >> 16), 'blue stays blue: ' + blue);
  const orange = deriveTheme(LOGOS['orange food company']).theme.brand;
  const o = parseInt(orange.slice(1), 16);
  assert.ok((o >> 16) > (o & 255), 'orange stays warm: ' + orange);
  assert.ok(deriveTheme(LOGOS['pale yellow on white']).adjusted.includes('brand_darkened'), 'a pale logo is darkened, and says so');
  assert.ok(deriveTheme(LOGOS['black and white only']).adjusted.includes('no_brand_colour'));
});

test('Best Gas comes out sage on cream', () => {
  const d = deriveTheme(LOGOS['Best Gas (sage on cream)']);
  assert.equal(d.found.brand?.slice(0, 3), '#4D', 'found the sage: ' + d.found.brand);
  const p = parseInt(d.theme.paper.slice(1), 16);
  assert.ok((p >> 16) >= (p & 255), 'warm paper: ' + d.theme.paper);
});

test('the server refuses unreadable or malformed themes', () => {
  assert.equal(themeProblem(DEFAULT_THEME), null);
  assert.equal(themeProblem({ ...DEFAULT_THEME, brand: '#F5E58C' }), 'theme_contrast:brand');
  assert.equal(themeProblem({ ...DEFAULT_THEME, ink: '#999999' }), 'theme_contrast:ink');
  assert.equal(themeProblem({ ...DEFAULT_THEME, rule: 'red' }), 'invalid_theme:rule');
  assert.equal(themeProblem({ ...DEFAULT_THEME, brand: '#2F5D50;background:url(x)' }), 'invalid_theme:brand');
  assert.equal(themeProblem(null), 'invalid_theme');
});
