// themes.ts against WCAG 2.2 AA, in every theme: body and dim text 4.5:1 on every surface they sit on,
// and the keyboard focus (the focus colour, and the dim colour a focused text field's border takes) 3:1.
// The status colours as text 4.5:1, the accent as text 4.5:1 on surfaces and accent tints, the accent
// for icons 3:1 on the same, and no text set in that icon accent.
import { readFileSync, readdirSync } from 'node:fs';
import { ROOT_URL } from '../lib/env.mjs';

const src = readFileSync(new URL('themes.ts', ROOT_URL), 'utf8');
const themes = {};
for (const m of src.matchAll(/^  (\w+): \{\s*\n\s*id: '(\w+)'[\s\S]*?colors: \{([\s\S]*?)\n    \},/gm)) {
  const colors = {};
  for (const c of m[3].matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)) colors[c[1]] = c[2];
  themes[m[2]] = colors;
}
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// A colour laid over another at some opacity, as Tailwind's bg-brand/10 is
const blend = (top, alpha, under) => '#' + [1, 3, 5].map(i => Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(under.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`); if (!ok) failures++; };

check('six themes read', Object.keys(themes).length === 6, Object.keys(themes).join(', '));
const SURFACES = ['canvas', 'surface', 'elevated', 'chip', 'input'];
for (const [name, c] of Object.entries(themes)) {
  const worst = (color, on = SURFACES) => Math.min(...on.map(s => ratio(color, c[s])));
  for (const token of ['ink', 'inkMuted', 'inkDim']) {
    check(`${name}: ${token} text 4.5:1 on every surface`, worst(c[token]) >= 4.5, worst(c[token]).toFixed(2));
  }
  check(`${name}: keyboard focus 3:1 on every surface`, worst(c.focus) >= 3, worst(c.focus).toFixed(2));
  check(`${name}: a focused field's border (dim) 3:1 on the field and around it`, worst(c.inkDim, ['input', 'canvas', 'surface', 'elevated']) >= 3, worst(c.inkDim, ['input', 'canvas', 'surface', 'elevated']).toFixed(2));
  // Warnings, errors and "Correct" are text in these colours
  for (const token of ['good', 'warn', 'bad']) {
    check(`${name}: ${token} text 4.5:1 on every surface`, worst(c[token]) >= 4.5, worst(c[token]).toFixed(2));
  }
  // The accent as text sits on the surfaces and on accent-tinted chips (bg-brand/10, /15); the accent
  // for icons and highlights (brandFg) needs 3:1 on the same, as a graphic
  const tinted = ['canvas', 'surface', 'elevated'].flatMap(s => [0.1, 0.15].map(a => blend(c.brand, a, c[s])));
  const worstOn = (color, bgs) => Math.min(...bgs.map(bg => ratio(color, bg)));
  const accentBgs = [...SURFACES.map(s => c[s]), ...tinted];
  check(`${name}: accent text (brandText) 4.5:1 on every surface and accent tint`, worstOn(c.brandText, accentBgs) >= 4.5, worstOn(c.brandText, accentBgs).toFixed(2));
  check(`${name}: accent icons (brandFg) 3:1 on every surface and accent tint`, worstOn(c.brandFg, accentBgs) >= 3, worstOn(c.brandFg, accentBgs).toFixed(2));
}
check('crimson keeps its red', themes.crimson?.brand === '#C43036');

// brandFg is for icons and highlights: an element that sizes text must use brandText for the accent
const sources = readdirSync(new URL('components/', ROOT_URL), { recursive: true }).filter(f => f.endsWith('.tsx'));
const textInBrandFg = sources.flatMap(f => readFileSync(new URL(`components/${f.replaceAll('\\', '/')}`, ROOT_URL), 'utf8').split('\n')
  .map((line, i) => [line, i]).filter(([line]) => /text-brand-fg/.test(line) && /\btext-(\[\d|xs\b|sm\b|base\b)/.test(line)).map(([, i]) => `${f}:${i + 1}`));
check('no text is set in the icon accent (text-brand-fg with a text size)', textInBrandFg.length === 0, textInBrandFg.join(', '));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
