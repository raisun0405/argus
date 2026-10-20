// A ligand mark must be the ligand its label names: "GTP" on a GDP is wrong, and the local fix never moves
// a mark onto a ligand other than the one named. Only ligands known here by name are compared, and a
// heme's iron or the oxygen on it counts as the heme. Live records: 4Q21 (Ras with GDP at A:274, Mg at
// A:273), 5P21 (Ras with GNP, a GTP analogue, at A:167) and 4HHB (heme at A:142).
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const g = await import(`${ROOT_URL}services/groundingService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const a = (pdbId, highlights) => ({ pdbId, title: 'Test', summary: 'A short answer.', highlights });
const L = (chain, resi, label, category = 'ligand') => ({ chain, resi: [resi], label, category });
const n = i => i && `ligands ${i.ligands}, wrong ${i.wrong}, missing ${i.missing}, problems ${i.problems.join(' | ') || 0}`;

console.log('[a ligand called something else]');
let i = await g.inspectAnswer(a('4Q21', [L('A', 274, 'GTP in the nucleotide pocket')]), 25000);
check('"GTP" on 4Q21\'s GDP: wrong, and said so', i && i.wrong === 1 && i.ligands === 0 && i.problems.some(p => /A:274 is GDP in this file/.test(p)), n(i));
i = await g.inspectAnswer(a('4Q21', [L('A', 274, 'GDP')]), 25000);
check('"GDP" on the GDP: right', i && i.ligands === 1 && i.wrong === 0 && i.problems.length === 0, n(i));
i = await g.inspectAnswer(a('5P21', [L('A', 167, 'GTP (as the analogue GppNHp)')]), 25000);
check('"GTP" on 5P21\'s GNP, a GTP analogue: right', i && i.ligands === 1 && i.wrong === 0, n(i));
i = await g.inspectAnswer(a('4Q21', [L('A', 273, 'Zinc ion', 'metal')]), 25000);
check('"Zinc" on a magnesium: wrong', i && i.wrong === 1, n(i));

console.log('\n[what is not a contradiction]');
i = await g.inspectAnswer(a('4HHB', [L('A', 142, 'Iron', 'metal')]), 25000);
check('"Iron" on the heme: the heme\'s iron, right', i && i.ligands === 1 && i.wrong === 0, n(i));
i = await g.inspectAnswer(a('4HHB', [L('A', 142, 'O2 binding', 'ligand')]), 25000);
check('"O2 binding" on the heme: right', i && i.ligands === 1 && i.wrong === 0, n(i));
i = await g.inspectAnswer(a('4Q21', [L('A', 274, 'GTP-binding pocket')]), 25000);
check('"GTP-binding pocket" describes the site, not the molecule: no contradiction', i && i.ligands === 1 && i.wrong === 0, n(i));
i = await g.inspectAnswer(a('4Q21', [L('A', 274, 'Bound nucleotide')]), 25000);
check('a label naming no known ligand is never called wrong', i && i.ligands === 1 && i.wrong === 0, n(i));

console.log('\n[the local fix moves a mark only onto the ligand it names]');
let c = await g.correctAnswer(a('4Q21', [L('A', 999, 'GTP in the nucleotide pocket')]), 25000);
const spots = c => c?.analysis.highlights.map(h => `${h.chain}:${h.resi.join(',')}`).join(' ') ?? 'unchanged';
check('"GTP" at a place that isn\'t there: not moved onto the GDP', !c || c.moved === 0, spots(c));
c = await g.correctAnswer(a('4Q21', [L('A', 999, 'GDP in the nucleotide pocket')]), 25000);
check('"GDP" at a place that isn\'t there: moved onto the GDP at A:274', c?.moved === 1 && spots(c) === 'A:274', spots(c));
c = await g.correctAnswer(a('4HHB', [L('A', 999, 'Iron', 'metal')]), 25000);
check('"Iron" at a place that isn\'t there: moved onto a heme', c?.moved === 1 && c.analysis.highlights.some(h => h.resi.includes(142)), spots(c));

console.log('\n[one misplaced mark moves onto one copy (P11)]');
// 4HHB holds four hemes, one in each chain; chain E doesn't exist
c = await g.correctAnswer(a('4HHB', [L('E', 145, 'The heme group')]), 25000);
check('"the heme" at a chain with none: one highlight on one heme, not all four', c?.moved === 1 && c.analysis.highlights.length === 1 && c.analysis.highlights[0].resi.length === 1, spots(c));
c = await g.correctAnswer(a('4HHB', [L('A', 999, 'The heme group')]), 25000);
check('...in a chain that has one: that chain\'s heme', c?.moved === 1 && spots(c) === 'A:142', spots(c));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
