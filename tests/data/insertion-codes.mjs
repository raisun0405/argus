// Residues with an insertion code (antibodies' 52A, 100C): named in an answer, they are read as those
// residues, never as residue 52 or 100. Live records of 12E8 (heavy chain H: 52 Asp, 52A Pro, 100 Arg,
// 100A Gly, 100C Phe; no UniProt mapping, so the file alone decides) and 4HHB.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const g = await import(`${ROOT_URL}services/groundingService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const a = (pdbId, summary, highlights = []) => ({ pdbId, title: 'Test', summary, highlights });
const n = i => i && `named ${i.named}, loose ${i.loose}, misnamed ${i.misnamed}, wrong ${i.wrong}, residues ${i.residues}, problems ${i.problems.length}`;

console.log('[a right answer about an antibody]');
let i = await g.inspectAnswer(a('12E8', 'Pro52A and Phe100C of the heavy chain line the antigen pocket.'), 25000);
check('Pro52A and Phe100C: both named right, no problem raised', i && i.named === 2 && i.misnamed === 0 && i.problems.length === 0, n(i));
i = await g.inspectAnswer(a('12E8', 'Asp52 and Arg100 sit beside them.'), 25000);
// They are the heavy chain's, and the light chain has other residues at those numbers: unmarked, they fit
// without being confirmed (P8)
check('...and the residues without a code at the same numbers too: not wrong, fitting the heavy chain', i && i.loose === 2 && i.misnamed === 0, n(i));
i = await g.inspectAnswer(a('12E8', 'Pro52 sits at the tip of the loop.'), 25000);
check('a code left out ("Pro52" for Pro52A) is not called wrong', i && i.misnamed === 0, n(i));

console.log('\n[a wrong one is still caught]');
i = await g.inspectAnswer(a('12E8', 'Trp52A sits at the tip of the loop.'), 25000);
check('Trp52A, where 52A is Pro: wrong, and said so', i && i.misnamed === 1 && i.problems.some(p => /residue 52A is Pro/.test(p)), i?.problems.join(' | ') || n(i));

console.log('\n[a label with a code says nothing about the residue without one]');
i = await g.inspectAnswer(a('12E8', 'The loop tip.', [{ chain: 'H', resi: [52], label: 'Pro52A', category: 'binding_site' }]), 25000);
check('a mark on H:52 labelled Pro52A is not "Asp, not Pro"', i && i.wrong === 0 && i.residues === 1, n(i));

console.log('\n[a letter that is a chain]');
i = await g.inspectAnswer(a('4HHB', 'His87A holds the iron of the alpha chain\'s heme.'), 25000);
check('His87A in 4HHB (no residue 87A): His87 of chain A, named right', i && i.named === 1 && i.misnamed === 0, n(i));
i = await g.inspectAnswer(a('4HHB', 'Gly87A holds the iron.'), 25000);
check('...and Gly87A is wrong there, said as A:87', i && i.misnamed === 1 && i.problems.some(p => /residue A:87 is His/.test(p)), i?.problems.join(' | ') || n(i));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
