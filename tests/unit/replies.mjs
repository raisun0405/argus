// Replies from the site's own functions are checked before the page uses them: the co-fold server's answer
// (services/cofoldService.ts readServerResult, D7) and a quality report (qualityService readQualityReport,
// D8). A reply that is fine passes whole; one with a field missing or of the wrong type is a readable
// failure instead of "Cannot read properties of undefined" in the page.
import '../lib/ts-hooks.mjs';
import { ROOT_URL, FIXTURES } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';
const cofold = await import(`${ROOT_URL}services/cofoldService.ts`);
const quality = await import(`${ROOT_URL}services/qualityService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const thrown = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

console.log('[the co-fold server\'s answer]');
// The answer api/cofold.ts gave for 3PTB with benzamidine (as the browser tests use it)
const SERVER = {
  pdb: readFileSync(`${FIXTURES}/cofold-3PTB-server.pdb`, 'utf8'),
  chains: [{ id: 'A', length: 223 }], ligand: { chain: 'L', resn: 'BEN' }, cofactors: [{ chain: 'X', resn: 'CA' }],
  scores: { confidence: 0.989, ptm: 0.994, iptm: 0.991, ligandIptm: 0.991, proteinIptm: 0, plddt: 0.989, iplddt: 0.985, pde: 0.257, ipde: 0.298 },
  affinity: { log10Ic50: 2.25, binderProbability: 0.8359375 }, template: '3PTB', pocketResidues: 0, seconds: 11.6,
};
const read = (value, status = 200) => cofold.readServerResult(typeof value === 'string' ? value : JSON.stringify(value), status);
check('a full answer passes, unchanged', JSON.stringify(read(SERVER)) === JSON.stringify(SERVER));
// Spaces first: the server streams them to keep the connection open while Boltz-2 works
check('...also after the spaces the server streams first', read(`   \n ${JSON.stringify(SERVER)}`).ligand.resn === 'BEN');
const { affinity: _a, template: _t, seconds: _s, pocketResidues: _p, ...lean } = SERVER;
check('fields the page has defaults for may be missing (affinity, template, seconds, pocket)', read(lean).chains[0].id === 'A');
check('the server\'s own failure comes through as its message', thrown(() => read({ error: 'Boltz-2 is busy; try again in a minute' })) === 'Boltz-2 is busy; try again in a minute');
check('a reply that is no JSON says so, with its status', thrown(() => read('<html>Gateway timeout</html>', 504)) === 'the co-folding server answered 504 without a result');
const INCOMPLETE = 'the co-folding server sent an incomplete result';
for (const [label, broken] of [
  ['no chains', (({ chains, ...rest }) => rest)(SERVER)],
  ['no ligand', (({ ligand, ...rest }) => rest)(SERVER)],
  ['no cofactors list', (({ cofactors, ...rest }) => rest)(SERVER)],
  ['a chain length that is text', { ...SERVER, chains: [{ id: 'A', length: '223' }] }],
  ['a score that is text', { ...SERVER, scores: { ...SERVER.scores, iptm: 'high' } }],
  ['a missing score', { ...SERVER, scores: (({ ipde, ...rest }) => rest)(SERVER.scores) }],
  ['a ligand chain that is no chain ID', { ...SERVER, ligand: { chain: '<b>', resn: 'BEN' } }],
  ['a file without atoms', { ...SERVER, pdb: 'HEADER    NOTHING\nEND\n' }],
  ['null', null],
]) check(`${label}: refused as incomplete`, thrown(() => read(broken)) === INCOMPLETE, thrown(() => read(broken)) ?? 'accepted');

console.log('\n[a quality report]');
// Shaped like api/quality.ts's answers (tests/data/quality-api.mjs checks real ones pass too)
const REPORT = {
  id: '2ocj', method: 'xray', resolution: 2.05, r: 0.199, rFree: 0.246, created: 'Mar 5, 2026', metrics: [
    { key: 'clashscore', value: 8.32, absolute: 30.6, absoluteOf: 154123, relative: 22.4, relativeOf: 4561 },
    { key: 'rama', value: 0, absolute: 100, absoluteOf: 154123, relative: 100, relativeOf: 4561 },
    { key: 'rfree', value: 0.2342, absolute: null, absoluteOf: null, relative: null, relativeOf: null },
  ],
};
const MISSING = { id: '1aaa', missing: true, method: 'other', resolution: null, r: null, rFree: null, created: null, metrics: [] };
check('a full report passes, unchanged', JSON.stringify(quality.readQualityReport(REPORT)) === JSON.stringify(REPORT));
check('an entry without a report passes', quality.readQualityReport(MISSING)?.missing === true);
check('fields it doesn\'t know are left out', !('note' in (quality.readQualityReport({ ...REPORT, note: 'x' }) ?? {})));
for (const [label, broken] of [
  ['no metrics (what crashed the panel)', (({ metrics, ...rest }) => rest)(REPORT)],
  ['a metric value that is text', { ...REPORT, metrics: [{ ...REPORT.metrics[0], value: '8.32' }] }],
  ['a metric the panel has no name for', { ...REPORT, metrics: [{ ...REPORT.metrics[0], key: 'twinning' }] }],
  ['an unknown method', { ...REPORT, method: 'xfel' }],
  ['a percentile over 100', { ...REPORT, metrics: [{ ...REPORT.metrics[0], absolute: 130 }] }],
  ['an ID that is no PDB ID', { ...REPORT, id: '../x' }],
  ['an HTML page parsed as text', '<html>'],
]) check(`${label}: refused`, quality.readQualityReport(broken) === null);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
