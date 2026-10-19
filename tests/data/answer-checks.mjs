// The counts behind the line under an answer, on real records (live PDBe/UniProt/RCSB):
// inspectAnswer's residues/ligands/missing/wrong, correctAnswer's renumbered count, inspectIdentity's verdict.
//   node tf-checks-real.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const g = await import(`${ROOT_URL}services/groundingService.ts`);
const { collectChecks } = await import(`${ROOT_URL}services/answerChecks.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const counts = i => i && `residues ${i.residues}, ligands ${i.ligands}, missing ${i.missing}, wrong ${i.wrong}, unchecked ${i.unchecked}, problems ${i.problems.length}, exists ${i.exists}`;
const answer = (pdbId, highlights, extra = {}) => ({ pdbId, title: 'Test', summary: '', highlights, ...extra });

console.log('[4HHB]');
let i = await g.inspectAnswer(answer('4HHB', [
  { chain: 'A', resi: [87], label: 'His87' },
  { chain: 'B', resi: [92], label: 'Proximal His92' },
  { chain: 'A', resi: [142], label: 'Heme', category: 'ligand' },
]), 20000);
check('2 residues + 1 ligand, nothing off', i && i.residues === 2 && i.ligands === 1 && i.missing === 0 && i.wrong === 0 && i.problems.length === 0, counts(i));

i = await g.inspectAnswer(answer('4HHB', [
  { chain: 'A', resi: [87], label: 'His87' },
  { chain: 'A', resi: [300], label: 'Asp300' },
  { chain: 'A', resi: [58], label: 'Asp58' }, // His58 in the file
]), 20000);
check('a missing residue and a mistyped one counted apart', i && i.residues === 1 && i.missing === 1 && i.wrong === 1 && i.problems.length === 2, counts(i));

i = await g.inspectAnswer(answer('4HHB', [{ chain: 'A', resi: [87], label: 'His87' }], {
  tour: [{ text: 'step', focus: [{ chain: 'A', resi: [87], label: 'the proximal histidine' }] }],
  measurements: [{ start: { chain: 'A', resi: 87 }, end: { chain: 'A', resi: 142 } }],
}), 20000);
check('the same place in a tour step and a measurement counts once; a measurement end on the heme counts as a ligand', i && i.residues === 1 && i.ligands === 1 && i.problems.length === 0, counts(i));

i = await g.inspectAnswer(answer('4HHB', [{ chain: 'A', resi: [87], label: 'His87' }, { chain: 'A', resi: [87], label: 'Asp87' }]), 20000);
check('two labels on one place: the worse outcome counts, once', i && i.residues === 0 && i.wrong === 1, counts(i));

i = await g.inspectAnswer(answer('0ZZZ', [{ chain: 'A', resi: [1] }]), 20000);
check('an entry that does not exist', i && i.exists === false && i.problems[0] === '0ZZZ is not an existing PDB entry', counts(i));

console.log('[1M17: UniProt numbering]');
const egfr = answer('1M17', [{ chain: 'A', resi: [793], label: 'Met793 (hinge)' }, { chain: 'A', resi: [745], label: 'Lys745' }]);
const before = await g.inspectAnswer(egfr, 20000);
const fixed = await g.correctAnswer(egfr, 20000);
const after = fixed && await g.inspectAnswer(fixed.analysis, 20000);
check('before: both read as file numbers are off', before && before.problems.length === 2, counts(before));
check('correctAnswer converts both and counts 2', fixed && fixed.renumbered === 2 && fixed.moved === 0, fixed && `renumbered ${fixed.renumbered}, moved ${fixed.moved}, notes ${fixed.conversions.join(' | ')}`);
check('...to Met769 and Lys721, which the file has', after && after.residues === 2 && after.problems.length === 0 && fixed.conversions.includes('UniProt Met793 = A:Met769') && fixed.conversions.includes('UniProt Lys745 = A:Lys721'), counts(after));

console.log('[2JDF: identity]');
const wrong = await g.inspectIdentity({ pdbId: '2JDF', title: 'Human Insulin Hexamer', summary: 'Insulin stored as a hexamer.', highlights: [] }, 20000);
check('mismatch, with what the entry is', wrong.status === 'mismatch' && wrong.name === 'Human gamma-B crystallin' && wrong.problem?.startsWith('the answer calls 2JDF "Human Insulin Hexamer"'), JSON.stringify(wrong));
const right = await g.inspectIdentity({ pdbId: '2JDF', title: 'Human gamma-B crystallin', summary: '', highlights: [] }, 20000);
check('match', right.status === 'match' && right.problem === null, JSON.stringify(right));
const vague = await g.inspectIdentity({ pdbId: '2JDF', title: 'An interesting structure', summary: '', highlights: [] }, 20000);
check('a heading that names nothing: unjudged', vague.status === 'unjudged', JSON.stringify(vague));
check('checkIdentity still returns just the problem', (await g.checkIdentity({ pdbId: '2JDF', title: 'Human Insulin Hexamer', summary: '', highlights: [] })) === wrong.problem);

console.log('[AF-P69905-F1: AlphaFold model]');
const af = await g.inspectAnswer(answer('AF-P69905-F1', [{ chain: 'A', resi: [88], label: 'Proximal histidine' }, { chain: 'A', resi: [200] }]), 20000);
check('a residue in the model and one past its 142 residues', af && af.residues === 1 && af.missing === 1, counts(af));

console.log('[collectChecks end to end]');
const line = await collectChecks(answer('4HHB', [{ chain: 'A', resi: [87], label: 'His87' }, { chain: 'A', resi: [142], label: 'Heme', category: 'ligand' }], { title: 'Human deoxyhemoglobin' }), {}, 20000);
check('4HHB answer: passed, "Checked against 4HHB: protein name, 1 residue, 1 ligand"', line?.status === 'passed' && line.summary === 'Checked against 4HHB: protein name, 1 residue, 1 ligand', JSON.stringify(line));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
