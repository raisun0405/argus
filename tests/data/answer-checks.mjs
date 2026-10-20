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

console.log('[1M17: a measurement end is converted only when its type agrees (P9)]');
const egfrMeasure = (label) => answer('1M17', [{ chain: 'A', resi: [793], label: 'Met793 (hinge)' }, { chain: 'A', resi: [745], label: 'Lys745' }],
  { measurements: [{ start: { chain: 'A', resi: 793 }, end: { chain: 'A', resi: 745 }, label }] });
let m = (await g.correctAnswer(egfrMeasure('Met793 to Lys745'), 20000))?.analysis.measurements?.[0];
check('the ends of "Met793 to Lys745" follow the UniProt reading: 769 and 721', m?.start.resi === 769 && m?.end.resi === 721, JSON.stringify(m));
m = (await g.correctAnswer(egfrMeasure('Cys793 to Lys745'), 20000))?.analysis.measurements?.[0];
check('...but an end its label calls something UniProt doesn\'t have there stays (Cys793: Met in UniProt)', m?.start.resi === 793 && m?.end.resi === 721, JSON.stringify(m));

console.log('[1M17: unnamed numbers move only when the whole answer reads as UniProt numbering (P10)]');
{
  // A residue the file doesn't resolve whose UniProt reading lands on a residue of the same type: what
  // an unnamed mark there could wrongly be moved onto
  const fileText = await (await fetch('https://files.rcsb.org/download/1M17.pdb')).text();
  const observed = new Map(fileText.split('\n').filter(l => l.startsWith('ATOM') && l.slice(12, 16).trim() === 'CA' && l[21] === 'A').map(l => [Number(l.slice(22, 26)), l.slice(17, 20)]));
  const sequence = (await (await fetch('https://rest.uniprot.org/uniprotkb/P00533.fasta')).text()).split('\n').slice(1).join('');
  const THREE = { A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL' };
  const gap = [...Array(500).keys()].map(k => 680 + k).find(n => !observed.has(n) && observed.get(n - 24) === THREE[sequence[n - 1]] && observed.get(n - 24) !== 'THR');
  check('a residue 1M17 doesn\'t resolve, to mark without a name', Boolean(gap), String(gap));
  if (gap) {
    const marks = (extra) => answer('1M17', [{ chain: 'A', resi: [745], label: 'Lys745' }, ...extra, { chain: 'A', resi: [gap], label: 'loop' }]);
    let fixed2 = await g.correctAnswer(marks([]), 20000);
    const at = f => f?.analysis.highlights.find(h => h.label === 'loop')?.resi.join(',');
    check(`only UniProt numbers named (Lys745): the unnamed ${gap} is read as UniProt too, onto ${gap - 24}`, at(fixed2) === String(gap - 24), at(fixed2) ?? 'unchanged');
    // Thr766 is this file's own number for the gatekeeper (UniProt Thr790): the answer mixes numberings
    fixed2 = await g.correctAnswer(marks([{ chain: 'A', resi: [766], label: 'Thr766 (gatekeeper)' }]), 20000);
    check('a mixed answer (Thr766 in the file\'s numbering too): the unnamed mark stays put, and isn\'t counted as renumbered', at(fixed2) === String(gap) && fixed2?.renumbered === 1, `${at(fixed2) ?? 'unchanged'}, renumbered ${fixed2?.renumbered}`);
    // A measurement end there, its label naming an amino acid UniProt doesn't have at that number (P9)
    const wrongName = THREE[sequence[gap - 1]] === 'CYS' ? 'Trp' : 'Cys';
    const measured = answer('1M17', [{ chain: 'A', resi: [745], label: 'Lys745' }], { measurements: [
      { start: { chain: 'A', resi: gap }, end: { chain: 'A', resi: 745 }, label: `${wrongName}${gap} to Lys745` },
      { start: { chain: 'A', resi: gap }, end: { chain: 'A', resi: 745 }, label: 'across the cleft' },
    ] });
    const ends = (await g.correctAnswer(measured, 20000))?.analysis.measurements ?? [];
    check(`an end missing from the file whose label calls it ${wrongName}${gap}: not moved onto UniProt's residue there`, ends[0]?.start.resi === gap && ends[0]?.end.resi === 721, JSON.stringify(ends[0]));
    check('...the same end with a label that names nothing: moved, the answer reading as UniProt numbering', ends[1]?.start.resi === gap - 24, JSON.stringify(ends[1]));
  }
}

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
