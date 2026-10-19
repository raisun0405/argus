// services/foldseekService.ts parseResults: "Find similar" groups PDB hits by sequence, quickly (D9).
// No network: Foldseek's results are made up here.
//  1. mutants of one protein share a row; a distant relative gets its own; the first row made wins
//  2. 6,000 hits of a well-known fold are grouped in a fraction of a second (each hit was compared with
//     every row so far: tens of millions of steps, on the main thread, just as the results arrived)
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { parseResults } = await import(`${ROOT_URL}services/foldseekService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

let seed = 5;
// mulberry32: a 32-bit generator (a plain LCG in doubles loses precision and repeats itself)
const random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const AA = 'ACDEFGHIKLMNPQRSTVWY';
const sequence = (n) => Array.from({ length: n }, () => AA[Math.floor(random() * 20)]).join('');
const mutate = (s, changes) => { const a = [...s]; for (let k = 0; k < changes; k++) a[Math.floor(random() * a.length)] = AA[Math.floor(random() * 20)]; return a.join(''); };
let n = 1000;
const id = () => `${(n++).toString(36).padStart(4, '1').slice(-4)}`.replace(/^0/, '1');
const hit = (tSeq, evalue, seqId = 40, title = 'SOME PROTEIN') => ({ target: `${id()}-assembly1.cif.gz_A ${title}`, prob: 1, eval: evalue, seqId, qStartPos: 1, qEndPos: 100, qLen: 120, taxId: 9606, taxName: 'Homo sapiens', tSeq });
const query = { label: 'TEST chain A', structureId: 'TEST', pdb: '', excludePdbIds: [], excludeAccessions: [] };
const rowsOf = (hits) => parseResults([{ db: 'pdb100', alignments: hits }], query).experimental;

console.log('[1. rows by sequence]');
{
  const kinase = sequence(280);
  const relative = mutate(kinase, 150); // About half its residues changed: a distant relative
  const hits = [
    hit(kinase, 1e-50, 45, 'KINASE A'),
    hit(mutate(kinase, 3), 1e-48, 44, 'KINASE A G12C'),
    hit(relative, 1e-30, 30, 'KINASE B'),
    hit(mutate(kinase, 5), 1e-45, 44, 'KINASE A, ANOTHER CONSTRUCT'),
    hit(sequence(150), 1e-10, 20, 'SOMETHING ELSE'),
  ];
  const rows = rowsOf(hits);
  check('the kinase and its two mutants share a row (3 structures)', rows[0]?.members === 3, JSON.stringify(rows.map(r => [r.name, r.members])));
  check('...the distant relative and the unrelated protein get their own rows', rows.length === 3 && rows[1].members === 1 && rows[2].members === 1, JSON.stringify(rows.map(r => r.name)));
}
{
  // Two rows that share two stretches (under half alike, so two rows), and a hit of just those stretches:
  // at least half alike to both, it joins the one made first
  const [p, q] = [sequence(100), sequence(100)];
  const rows = rowsOf([hit(p + q + sequence(120), 1e-40, 45, 'FIRST'), hit(p + q + sequence(120), 1e-39, 44, 'SECOND'), hit(p + q, 1e-30, 40, 'BOTH')]);
  const count = (name) => rows.find(r => r.name === name)?.members;
  check('a hit alike to two rows joins the first one made', count('First') === 2 && count('Second') === 1, JSON.stringify(rows.map(r => [r.name, r.members])));
}

console.log('\n[2. a well-known fold: 6,000 hits]');
{
  const families = Array.from({ length: 400 }, () => sequence(250));
  const hits = [];
  for (let k = 0; k < 6000; k++) {
    const family = families[Math.floor(random() * families.length)];
    // Most are mutants or constructs of 400 proteins; some are proteins of their own
    hits.push(hit(k % 5 === 0 ? sequence(250) : mutate(family, Math.floor(random() * 8)), 10 ** -(1 + random() * 60), 25 + random() * 50));
  }
  const started = performance.now();
  const result = parseResults([{ db: 'pdb100', alignments: hits }], query);
  const ms = performance.now() - started;
  check('grouped in well under a second', ms < 1000, `${Math.round(ms)} ms`);
  check('...into rows, the best first, as before', result.experimental.length === 20 && result.experimental.every((r, i, all) => i === 0 || all[i - 1].evalue <= r.evalue), `${result.experimental.length} rows`);
  check('...with the mutants together (rows of many structures)', result.experimental.filter(r => r.members > 1).length >= 10, JSON.stringify(result.experimental.map(r => r.members)));
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
