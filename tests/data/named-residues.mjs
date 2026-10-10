// Amino acids named in an answer's text, checked against live records. Counts and codes only.
//   node tf-named-real.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const g = await import(`${ROOT_URL}services/groundingService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const a = (pdbId, summary, highlights = [], extra = {}) => ({ pdbId, title: 'Test', summary, highlights, ...extra });
const n = i => i && `named ${i.named}, misnamed ${i.misnamed}, residues ${i.residues}, problems ${i.problems.length}`;

console.log('[the case from the screenshot: 3 of 5 named amino acids are wrong]');
let i = await g.inspectAnswer(a('4LDB',
  'Oligomers form through the N-terminal interface (Leu117, Ile124); the basic patch (Lys127, Lys135, Lys141) sits on the other face.',
  [{ chain: 'A', resi: [117, 124], label: 'Oligomerization interface', category: 'other' },
   { chain: 'A', resi: [127, 135, 141], label: 'Basic patch', category: 'binding_site' }]), 25000);
check('2 named right, 3 wrong', i && i.named === 2 && i.misnamed === 3, n(i));
check('the 5 marked places still count as present', i && i.residues === 5 && i.missing === 0 && i.wrong === 0, n(i));
check('each wrong one is named for the retry', i && [124, 135, 141].every(r => i.problems.some(p => p.includes(`residue ${r} is`))) && !i.problems.some(p => /residue 117|residue 127/.test(p)), i?.problems);

console.log('\n[right answers stay quiet]');
i = await g.inspectAnswer(a('4HHB', 'The proximal His87 on the alpha chain and His92 on beta anchor the iron; the distal His58 sits above it.',
  [{ chain: 'A', resi: [87], label: 'Proximal His', category: 'active_site' }]), 25000);
check('4HHB: 3 named, 0 wrong', i && i.named === 3 && i.misnamed === 0 && i.problems.length === 0, n(i));

console.log('\n[UniProt numbering in the text is not an error]');
i = await g.inspectAnswer(a('1M17', 'Erlotinib hydrogen-bonds to the hinge at Met793, and Lys745 holds the alpha-C helix in place.', []), 25000);
check('1M17: both accepted via the protein\'s own numbering', i && i.named === 2 && i.misnamed === 0, n(i));
// 793 is Trp in this file and Met in the protein's own numbering, 745 Val and Lys: Cys and Pro are neither
i = await g.inspectAnswer(a('1M17', 'The hinge residue is Cys793 and the catalytic one is Pro745.', []), 25000);
check('...but a type matching neither the file nor the protein is still caught', i && i.misnamed === 2 && i.named === 0, n(i));
i = await g.inspectAnswer(a('1M17', 'The hinge residue is Trp793, as the file numbers it.', []), 25000);
check('the file\'s own numbering is accepted as readily as the protein\'s', i && i.named === 1 && i.misnamed === 0, n(i));

console.log('\n[things that must never be read as residues]');
i = await g.inspectAnswer(a('4HHB', 'Solved at 1.74 Å in 1984; chains A, B, C and D each hold one heme. See figure 3 and table 2.', []), 25000);
check('resolutions, years, chain letters, figure numbers: nothing named', i && i.named === 0 && i.misnamed === 0, n(i));
i = await g.inspectAnswer(a('4HHB', 'The T-state and R-state differ; the T6 and R6 forms of insulin are a separate story.', []), 25000);
check('state names (T6, R6) are not read as residues', i && i.misnamed === 0, n(i));

console.log('\n[a number this file does not have is left alone]');
i = await g.inspectAnswer(a('4HHB', 'Unlike Thr790 of the kinase, this one has no gatekeeper.', []), 25000);
check('out-of-range numbers skipped', i && i.named === 0 && i.misnamed === 0, n(i));

console.log('\n[a tour step and a quiz are read too]');
i = await g.inspectAnswer(a('4HHB', 'An overview.', [], {
  tour: [{ text: 'Here Lys61 reaches across the interface.', focus: [] }],
  quiz: { question: 'Which residue is at 87?', options: [], correctAnswerIndex: 0, explanation: 'It is Asp87.' },
}), 25000);
check('a wrong one in a tour step or explanation is caught', i && i.misnamed >= 1 && i.problems.some(p => p.includes('residue 87 is')), n(i));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
