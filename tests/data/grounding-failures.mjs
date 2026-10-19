// The answer checks when a source fails, on live records with failures injected into fetch. Each
// scenario uses its own entry, so one's cached data can't help another. Counts and codes only.
//   node tf-grounding-failures.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

// --- Fault injection: rules decide what a matching request gets ---
const realFetch = globalThis.fetch;
let rules = [];
const hung = [];
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const rule = rules.find(r => url.includes(r.match));
  if (rule?.act === 'fail') return Promise.resolve(new Response('server error', { status: 500 }));
  if (rule?.act === '404') return Promise.resolve(new Response('not found', { status: 404 }));
  if (rule?.act === 'hang') return new Promise((_, reject) => hung.push(reject));
  return realFetch(input, init);
};
const releaseHangs = () => { while (hung.length) hung.pop()(new TypeError('Failed to fetch')); };

const g = await import(`${ROOT_URL}services/groundingService.ts`);
const { collectChecks } = await import(`${ROOT_URL}services/answerChecks.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const H = (chain, resi, label, category = 'active_site') => ({ chain, resi, label, category });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const brief = i => i && { problems: i.problems.length, exists: i.exists, residues: i.residues, ligands: i.ligands, missing: i.missing, unchecked: i.unchecked, named: i.named, misnamed: i.misnamed };

console.log('[P1: the ligand list fails to load (4HHB)]');
rules = [{ match: 'ligand_monomers/4hhb', act: 'fail' }];
let i = await g.inspectAnswer({ pdbId: '4HHB', title: 'Test', summary: '', highlights: [H('A', [87], 'His87'), H('A', [142], 'Fe of heme')], measurements: [{ start: { chain: 'A', resi: 87 }, end: { chain: 'A', resi: 142 } }] }, 25000);
check('a mark on the heme is not called "not in this file"', i && i.problems.length === 0 && i.missing === 0, brief(i));
check('...it is counted as not checked, the residue as present', i && i.unchecked === 1 && i.residues === 1, brief(i));
const line = await collectChecks({ pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: '', highlights: [H('A', [87], 'His87'), H('A', [142], 'Fe of heme')] }, {}, 25000);
check('the line says so: "1 marked part not checked: ... ligand list didn\'t load"', line?.rows.some(r => r.state === 'skipped' && r.text === "1 marked part not checked: 4HHB's ligand list didn't load") && line.status !== 'issues', line && { status: line.status, rows: line.rows.map(r => r.text) });
// An answer in UniProt numbering ("His88" is UniProt's number for the file's His87) must not move a
// measurement end that may be the heme onto a residue
const fixed = await g.correctAnswer({ pdbId: '4HHB', title: 'Test', summary: '', highlights: [H('A', [88], 'His88')], measurements: [{ start: { chain: 'A', resi: 88 }, end: { chain: 'A', resi: 142 } }] }, 25000);
check('the UniProt number is still converted (88 -> 87)', fixed && fixed.analysis.highlights[0].resi[0] === 87, fixed && JSON.stringify(fixed.analysis.highlights));
check('...but the end that may be the heme stays at A:142', fixed && fixed.analysis.measurements[0].end.resi === 142, fixed && JSON.stringify(fixed.analysis.measurements));

console.log('\n[P2: an entry PDBe has nothing on, but RCSB has (1HHO)]');
rules = [{ match: 'residue_listing/1hho', act: '404' }, { match: 'molecules/1hho', act: '404' }];
i = await g.inspectAnswer({ pdbId: '1HHO', title: 'Test', summary: '', highlights: [H('A', [87], 'His87')] }, 25000);
check('not called "not an existing PDB entry": it can\'t be checked', i === null, brief(i));

// 0ZZZ: no PDB ID starts with 0, so it never will exist (9ZZZ, used before, was released in October 2026)
console.log('\n[P2: an entry that really doesn\'t exist (0ZZZ)]');
rules = [];
i = await g.inspectAnswer({ pdbId: '0ZZZ', title: 'Test', summary: '', highlights: [H('A', [1], 'x')] }, 25000);
check('still called "not an existing PDB entry"', i && i.exists === false && i.problems[0] === '0ZZZ is not an existing PDB entry', brief(i));

console.log('\n[P2: the molecule list fails and the residue list comes back empty (2HHB)]');
rules = [{ match: 'molecules/2hhb', act: 'fail' }, { match: 'residue_listing/2hhb', act: '404' }];
i = await g.inspectAnswer({ pdbId: '2HHB', title: 'Test', summary: '', highlights: [H('A', [87], 'His87')] }, 25000);
check('not called "not an existing PDB entry": it can\'t be checked', i === null, brief(i));
rules = [{ match: 'residue_listing/2hhb', act: '404' }]; // The molecules come back; the empty residue list is still cached
i = await g.inspectAnswer({ pdbId: '2HHB', title: 'Test', summary: '', highlights: [H('A', [87], 'His87')] }, 25000);
check('chains listed but no residues: still "can\'t be checked", never "not in this file"', i === null, brief(i));

console.log('\n[P3: a protein\'s UniProt record fails (1M17)]');
const wrongName = { pdbId: '1M17', title: 'EGFR kinase', summary: 'The hinge residue is Cys793.', highlights: [] };
rules = [{ match: 'uniprotkb/P00533', act: 'fail' }];
i = await g.inspectAnswer(wrongName, 25000);
check('built without that record, a named amino acid isn\'t called wrong', i && i.misnamed === 0 && !i.problems.some(p => p.includes('Cys793')), brief(i));
rules = [{ match: 'uniprotkb/P00533', act: 'hang' }];
i = await g.inspectAnswer(wrongName, 1500);
check('while a rebuild is under way, the incomplete copy isn\'t used: "can\'t be checked"', i === null, brief(i));
releaseHangs();
await sleep(300);
rules = [];
i = await g.inspectAnswer(wrongName, 25000);
check('once the record loads, the same wrong name is caught', i && i.misnamed === 1 && i.problems.some(p => p.includes('says Cys793')), brief(i));

console.log('\n[P18: an AlphaFold model\'s UniProt record fails once (AF-P01308-F1, a protein no part above touched)]');
const model = { pdbId: 'AF-P01308-F1', title: 'Insulin', summary: '', highlights: [] };
rules = [{ match: 'uniprotkb/P01308', act: 'fail' }];
let who = await g.inspectIdentity(model, 25000);
check('while it fails, the protein is not judged', who.status === 'unavailable', who.status);
rules = [];
who = await g.inspectIdentity(model, 25000);
check('the next answer asks again and is judged (no wait for the failure to expire)', who.status === 'match', who.status);
rules = [{ match: 'uniprotkb/P0DTC9', act: '404' }];
const absent = await g.loadIdentity('AF-P0DTC9-F1');
check('a record that really isn\'t there is still "no such protein"', absent === null, JSON.stringify(absent));
rules = [];

console.log('\n[P7: the tour and quiz are read even after a renumbering note]');
rules = [];
const renumbered = { pdbId: '1M17', title: 'EGFR kinase', summary: "Erlotinib binds here. (Highlights use this file's residue numbers: UniProt Met793 = A:Met769.)", highlights: [],
  tour: [{ text: 'Here Pro745 holds the C-helix.', focus: [] }] };
i = await g.inspectAnswer(renumbered, 25000);
check('a wrong name in a tour step is still caught', i && i.problems.some(p => p.includes('says Pro745')), brief(i));
check('...while the note itself is not read as a claim', i && !i.problems.some(p => /Met793|Met769/.test(p)), i?.problems);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
