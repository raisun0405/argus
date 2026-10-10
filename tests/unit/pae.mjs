// services/paeService.ts on real AlphaFold DB files (tests/fixtures/pae): reading the file,
// AlphaFold DB's colours, block means, the confidently placed parts and the chat's facts line.
import '../lib/ts-hooks.mjs';
import { FIXTURES, ROOT_URL } from '../lib/env.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const DIR = `${FIXTURES}/pae`;
const pae = await import(`${ROOT_URL}services/paeService.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

console.log('[reading the file]');
const files = {};
for (const acc of ['P69905', 'P04637', 'P00533']) {
  const file = `${DIR}/pae-${acc}.json`;
  const text = existsSync(file) ? readFileSync(file, 'utf8') : gunzipSync(readFileSync(`${file}.gz`)).toString('utf8');
  const t0 = performance.now();
  const d = pae.parsePae(text, `AF-${acc}-F1`);
  const ms = performance.now() - t0;
  const plain = JSON.parse(text)[0].predicted_aligned_error;
  let same = plain.length === d.n;
  for (let a = 0; same && a < d.n; a++) for (let s = 0; s < d.n; s++) if (pae.paeAt(d, a, s) !== plain[a][s]) { same = false; break; }
  check(`${acc}: ${d.n} × ${d.n}, every value as in the file, max ${d.max}`, same && d.max === 31.75, `${ms.toFixed(0)} ms`);
  files[acc] = d;
}
check('decimals and the old max are read too', (() => {
  const d = pae.parsePae('[{"predicted_aligned_error": [[0.25, 1.5], [2.75, 32]], "max_predicted_aligned_error": 30.0}]', 'X');
  return d.n === 2 && pae.paeAt(d, 0, 0) === 0.25 && pae.paeAt(d, 0, 1) === 1.5 && pae.paeAt(d, 1, 0) === 2.75 && pae.paeAt(d, 1, 1) === 32 && d.max === 30;
})());
check('a file without a map, or not square, is refused', (() => {
  const bad = ['{"x": 1}', '[{"predicted_aligned_error": [[1, 2], [3]]}]', '[{"predicted_aligned_error": [[]]}]'];
  return bad.every(t => { try { pae.parsePae(t, 'X'); return false; } catch { return true; } });
})());

console.log('\n[AlphaFold DB\'s colours]');
// Read off AlphaFold DB's own picture of P04637's map (pae-palette.mjs): value -> colour
const theirs = { 1: '#004f1f', 2: '#005723', 3: '#006227', 4: '#006c2b', 8: '#228a44', 16: '#73c375', 20: '#a3d99d', 24: '#c8e9c1', 28: '#e6f5e1', 31: '#f4faf1' };
const off = Object.entries(theirs).map(([v, hex]) => {
  const mine = pae.paeRgb(Number(v), 31.75);
  const want = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...mine.map((c, k) => Math.abs(c - want[k])));
});
check('each value\'s colour within 6 of 255 per channel of AlphaFold DB\'s', Math.max(...off) <= 6, `worst ${Math.max(...off)}`);
check('0 Å is the darkest green, the top of the scale near-white', pae.paeHex(0) === '#00441b' && pae.paeHex(31.75) === '#f7fcf5');

console.log('\n[block means]');
const d = files.P04637;
let sum = 0; for (let a = 10; a <= 20; a++) for (let s = 100; s <= 150; s++) sum += pae.paeAt(d, a, s);
check('boxMean is the plain mean of the block (rows aligned, columns scored)', Math.abs(pae.boxMean(d, [100, 150], [10, 20]) - sum / (11 * 51)) < 1e-9);
check('betweenMean is both ways round', Math.abs(pae.betweenMean(d, [100, 150], [10, 20]) - (pae.boxMean(d, [100, 150], [10, 20]) + pae.boxMean(d, [10, 20], [100, 150])) / 2) < 1e-9);

console.log('\n[parts]');
for (const [acc, data] of Object.entries(files)) {
  const parts = pae.paeParts(data);
  const between = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) between.push(`${parts[i].from + 1}-${parts[i].to + 1}|${parts[j].from + 1}-${parts[j].to + 1}: ${pae.betweenMean(data, [parts[i].from, parts[i].to], [parts[j].from, parts[j].to]).toFixed(1)}`);
  console.log(`  ${acc} (${data.n}): ${parts.map(p => `${p.from + 1}-${p.to + 1} (${p.within.toFixed(1)})`).join(', ') || 'none'}${between.length ? `\n      between: ${between.join('; ')}` : ''}`);
}

console.log('\n[facts line]');
pae.rememberPae('AF-P04637-F1', files.P04637);
const line = pae.paeFactsLine('af-p04637-f1');
console.log(`  ${line}`);
check('a line for the model it was remembered for (any case), none for others', !!line && line.startsWith('AlphaFold confidence map') && pae.paeFactsLine('1TUP') === null);
pae.rememberPae('AF-P04637-F1', null);
check('forgotten when the map goes', pae.paeFactsLine('AF-P04637-F1') === null);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
