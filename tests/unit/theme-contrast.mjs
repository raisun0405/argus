// themes.ts against WCAG 2.2 AA, in every theme: body and dim text 4.5:1 on every surface they sit on,
// and the keyboard focus (the focus colour, and the dim colour a focused text field's border takes) 3:1.
import { readFileSync } from 'node:fs';
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
}
check('crimson keeps its red', themes.crimson?.brand === '#C43036');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
