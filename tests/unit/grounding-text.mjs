// What a question's residues turn into before the AI sees them, offline: the scanner that finds residue
// names in a question (P13), the hint that converts them for every protein of a complex (P12), and the
// cut that keeps every text sent within its budget without splitting a residue number (P17).
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { cutText } = await import(`${ROOT_URL}services/textCut.ts`);
const g = await import(`${ROOT_URL}services/groundingService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

console.log('[cutting text: never inside a word or a number]');
check('short text is left whole', cutText('Lys745, Thr790', 50) === 'Lys745, Thr790');
check('whole lines when a line break comes late enough', cutText('first line here\nsecond line here\nthird', 34) === 'first line here\nsecond line here');
const list = Array.from({ length: 40 }, (_, i) => `A:Lys${700 + i * 7}`).join(', ');
const names = new Set(list.split(', '));
let bad = [];
for (let max = 12; max <= 260; max++) {
  const cut = cutText(list, max);
  const tokens = cut.replace(/…$/, '').split(', ');
  if (cut.length > max || !cut.endsWith('…') || !tokens.every(t => names.has(t))) bad.push(`${max}: ${cut.slice(-24)}`);
}
check('a residue list cut at every length from 12 to 260: within the limit, ends in "…", every residue whole', bad.length === 0, bad.slice(0, 3).join(' | '));
check('a single word longer than the limit is cut hard, still within it', cutText('x'.repeat(30), 10).length === 10);

console.log('\n[residue names in a question]');
const found = q => g.namedResidues(q).map(r => `${r.aa}${r.position}`).join(' ');
check('mutations: T790M, R175H, E6V (single digit too), G12C', found('Does T790M or R175H matter? And E6V, G12C?') === 'T790 R175 E6 G12');
check('three-letter names, with or without a space, and His-57', found('Is Thr790 near Ser 195 and His-57?') === 'T790 S195 H57');
check('a frameshift or deletion counts as a mutation (Q61fs, E746del)', found('What about Q61fs and E746del?') === 'Q61 E746');
for (const [label, q] of [
  ['"T7 RNA polymerase"', 'How does T7 RNA polymerase grip the DNA?'],
  ['"the S1 pocket"', 'What lines the S1 pocket of trypsin?'],
  ['a cell line ("K562 cells", "A549")', 'Is it expressed in K562 cells or A549?'],
  ['"Ser-1 from the tag" (negative numbering)', 'Does Ser-1 from the tag reach the site?'],
  ['state names (T6, R6)', 'The T6 and R6 forms differ.'],
]) check(`not a residue: ${label}`, found(q) === '', found(q));

console.log('\n[the hint: every protein of a complex is tried]');
const residue = (chain, resi, name) => ({ chain, resi, name });
// A two-protein complex: the large subunit (chain A, listed first) has a Thr at 50 in the file's numbering,
// the small one (chain B) has a Thr at UniProt position 50, which the file numbers 49
const large = { sequence: 'M'.repeat(200), locate: () => null, residues: [residue('A', 50, 'Thr'), residue('A', 51, 'Gly')] };
const small = { sequence: `${'G'.repeat(49)}T${'G'.repeat(50)}`, locate: p => (p === 50 ? residue('B', 49, 'Thr') : null), residues: [residue('B', 49, 'Thr')] };
let hint = g.questionHintLine([large, small], 'What does Thr50 do?') ?? '';
check('both readings given: the large subunit\'s file numbering and the small one\'s UniProt numbering', hint.includes('A:Thr50') && hint.includes('B:Thr49'), hint);
// The large subunit has a Thr at UniProt 50 that the file doesn't hold; the small one has it in the file
const unresolved = { sequence: `${'G'.repeat(49)}T${'G'.repeat(150)}`, locate: () => null, residues: [] };
const holds = { sequence: 'G'.repeat(100), locate: () => null, residues: [residue('B', 50, 'Thr')] };
hint = g.questionHintLine([unresolved, holds], 'What does Thr50 do?') ?? '';
check('"not in this structure" never wins over a subunit that holds it', hint.includes('B:Thr50') && !hint.includes('not in this structure'), hint);
hint = g.questionHintLine([unresolved], 'What does Thr50 do?') ?? '';
check('...and is said when no subunit holds it', hint.includes('Thr50 (UniProt numbering) is not in this structure'), hint);
check('a name no protein has: no hint', g.questionHintLine([large, small], 'What does Trp50 do?') === null);

console.log('\n[the hint stays within its budget, in whole notes]');
// Six named residues, each found in several subunits: far more than 500 characters of notes
const many = Array.from({ length: 6 }, (_, k) => ({
  sequence: 'G'.repeat(400),
  locate: () => null,
  residues: [100, 200, 300, 110, 210, 310].map(n => residue(String.fromCharCode(65 + k), n, 'Lys')),
}));
hint = g.questionHintLine(many, 'Lys100, Lys200, Lys300, Lys110, Lys210 and Lys310?') ?? '';
const notes = hint.replace(/^[^:]+: /, '').replace(/; and \d+ more$/, '').split(/; (?=Lys\d+ = )/);
check('at most 500 characters', hint.length <= 500, String(hint.length));
check('...ends by saying how many more were left out', /; and \d more$/.test(hint), hint.slice(-40));
check('...and every note it keeps is whole (all six subunits\' readings)', notes.length > 0 && notes.every(n => (n.match(/[A-F]:Lys\d+/g) ?? []).length === 6), notes.map(n => n.slice(0, 40)).join(' | '));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
