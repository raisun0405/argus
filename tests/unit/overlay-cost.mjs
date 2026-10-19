// services/overlayService.ts: laying one structure over another stays quick on complexes of many
// different chains (D1). No network: structures are made up here.
//  1. the leaner alignment gives exactly what the old one gave (pairs and score), on random sequences
//  2. a complex of 40 different chains lines up in well under a second, aligning only the pairs that
//     can be the same protein (the old way aligned all 1,600)
//  3. different proteins are still refused, with the closest match named
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const o = await import(`${ROOT_URL}services/overlayService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

// A seeded random source, so a failure can be run again
let seed = 7;
// mulberry32: a 32-bit generator (a plain LCG in doubles loses precision and repeats itself)
const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const AA = 'ACDEFGHIKLMNPQRSTVWY';
const THREE = { A: 'ALA', C: 'CYS', D: 'ASP', E: 'GLU', F: 'PHE', G: 'GLY', H: 'HIS', I: 'ILE', K: 'LYS', L: 'LEU', M: 'MET', N: 'ASN', P: 'PRO', Q: 'GLN', R: 'ARG', S: 'SER', T: 'THR', V: 'VAL', W: 'TRP', Y: 'TYR' };
const sequence = (n) => Array.from({ length: n }, () => AA[Math.floor(random() * 20)]).join('');
const mutate = (s, rate) => [...s].map(c => (random() < rate ? AA[Math.floor(random() * 20)] : c)).join('');

// The alignment as it was before (15 bytes a cell, a small array per cell), to compare against
const oldAlign = (a, b) => {
  const n = a.length, m = b.length, MATCH = 2, MISMATCH = -1, OPEN = -5, EXTEND = -1, NEG = -1e9, w = m + 1;
  const M = new Float32Array((n + 1) * w).fill(NEG), X = new Float32Array((n + 1) * w).fill(NEG), Y = new Float32Array((n + 1) * w).fill(NEG);
  const tM = new Uint8Array((n + 1) * w), tX = new Uint8Array((n + 1) * w), tY = new Uint8Array((n + 1) * w);
  M[0] = 0;
  for (let i = 1; i <= n; i++) X[i * w] = 0;
  for (let j = 1; j <= m; j++) Y[j] = 0;
  const best3 = (p, q, r) => (p >= q && p >= r ? [p, 0] : q >= r ? [q, 1] : [r, 2]);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = i * w + j, d = (i - 1) * w + (j - 1);
    const s = a[i - 1] === b[j - 1] && a[i - 1] !== 'X' ? MATCH : MISMATCH;
    const [vm, fm] = best3(M[d], X[d], Y[d]); M[c] = vm + s; tM[c] = fm;
    const up = (i - 1) * w + j; const [vx, fx] = best3(M[up] + OPEN, X[up] + EXTEND, Y[up] + OPEN); X[c] = vx; tX[c] = fx;
    const left = i * w + (j - 1); const [vy, fy] = best3(M[left] + OPEN, X[left] + OPEN, Y[left] + EXTEND); Y[c] = vy; tY[c] = fy;
  }
  let end = { i: n, j: m, state: 0, score: NEG };
  const consider = (i, j) => { const c = i * w + j; for (const [state, score] of [[0, M[c]], [1, X[c]], [2, Y[c]]]) if (score > end.score) end = { i, j, state, score }; };
  for (let j = 0; j <= m; j++) consider(n, j);
  for (let i = 0; i <= n; i++) consider(i, m);
  const pairs = []; let { i, j, state } = end;
  while (i > 0 && j > 0) { const c = i * w + j; if (state === 0) { pairs.push([i - 1, j - 1]); state = tM[c]; i--; j--; } else if (state === 1) { state = tX[c]; i--; } else { state = tY[c]; j--; } }
  return { pairs: pairs.reverse(), score: end.score };
};

console.log('[1. the leaner alignment gives what the old one gave]');
let same = 0;
const trials = [[40, 40], [120, 90], [300, 310], [15, 200], [250, 30]];
for (let t = 0; t < 30; t++) {
  const [n, m] = trials[t % trials.length];
  const a = sequence(n);
  const b = t % 3 === 0 ? sequence(m) : mutate(a.slice(0, Math.min(n, m)) + sequence(Math.max(0, m - n)), 0.15);
  const was = oldAlign(a, b);
  const now = o.alignSequences(a, b);
  if (was.score === now.score && JSON.stringify(was.pairs) === JSON.stringify(now.pairs)) same++;
}
check('30 random pairs (related and unrelated, equal and very different lengths): the same pairs and score', same === 30, `${same} of 30`);

// Chains as PDB text: N, CA and C of each residue along a random walk
const pdbOf = (chains) => {
  const lines = [];
  let serial = 1;
  for (const { id, seq, start } of chains) {
    let [x, y, z] = start;
    [...seq].forEach((code, k) => {
      x += 3.8 * (random() - 0.5) * 1.6; y += 3.8 * (random() - 0.5) * 1.6; z += 2.5;
      for (const [name, dx] of [['N', -1.2], ['CA', 0], ['C', 1.3]]) {
        lines.push(`ATOM  ${String(serial++).padStart(5)} ${name.padEnd(4)} ${THREE[code]} ${id}${String(k + 1).padStart(4)}    ${(x + dx).toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00           C`);
      }
    });
  }
  return `${lines.join('\n')}\nEND\n`;
};

console.log('\n[2. a complex of 40 different chains]');
const ids = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'.split('');
const chains = ids.map((id, k) => ({ id, seq: sequence(250), start: [k * 40, 0, 0] }));
seed = 11;
const main = pdbOf(chains);
seed = 11; // The same walk: the same complex, laid over itself
const other = pdbOf(chains);
const started = performance.now();
let result = null;
try { result = o.computeOverlay(main, other, 'TEST'); } catch (e) { result = { error: e.message }; }
const ms = performance.now() - started;
check('it lines up, chain A onto chain A, fully identical', result?.mainChain === 'A' && result?.otherChain === 'A' && result?.identity === 1, JSON.stringify({ main: result?.mainChain, other: result?.otherChain, identity: result?.identity, error: result?.error }));
check('...in well under a second (all 1,600 pairs aligned before)', ms < 1500, `${Math.round(ms)} ms`);
check('...and every chain is offered as a match for itself', result?.choices?.length === 40 && result.choices.every(c => c.main === c.other), `${result?.choices?.length} choices`);
const picked = o.computeOverlay(main, other, 'TEST', { mainChain: 'Q' });
check('a chain picked in the panel is the one used', picked.mainChain === 'Q' && picked.otherChain === 'Q');

console.log('\n[3. different proteins]');
seed = 23;
const unrelated = pdbOf([{ id: 'A', seq: sequence(200), start: [0, 0, 0] }, { id: 'B', seq: sequence(180), start: [50, 0, 0] }]);
let refused = '';
try { o.computeOverlay(main, unrelated, '9XYZ'); } catch (e) { refused = e.message; }
check('refused as another protein, with the closest match named', /^9XYZ isn't the same protein: at most \d+% of the sequences match$/.test(refused), refused);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
