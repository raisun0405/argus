// Opening a saved result (services/savedService.ts openPayload): what comes back from storage is checked
// field by field before anything reaches the viewer or the chat, as a plain share link's answer is.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const saved = await import(`${ROOT_URL}services/savedService.ts`);
const esm = await import(`${ROOT_URL}services/esmfoldService.ts`);
const cofold = await import(`${ROOT_URL}services/cofoldService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

// The ID ESMFold gives a sequence (esmfoldService's FNV-1a hash)
const esmId = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return `ESM-${(h >>> 0).toString(36).toUpperCase().padStart(7, '0')}`; };
const atom = (n, resi, b) => `ATOM  ${String(n).padStart(5)}  CA  ALA A${String(resi).padStart(4)}      11.104  13.207   2.100  1.00${b.toFixed(2).padStart(6)}           C`;
const PDB = [atom(1, 1, 90), atom(2, 2, 40), 'END'].join('\n');
const answer = (pdbId) => ({ pdbId, title: 'T', summary: 'S', highlights: [{ chain: 'A', resi: [1], label: 'one', category: 'other' }] });

console.log('[a view]');
let opened = saved.openPayload({ v: 1, kind: 'view', a: { ...answer('1TRZ'), actions: [{ kind: 'share' }], quiz: { question: 'q', options: ['a', 'b'], correctAnswerIndex: 0 } }, s: { colorScheme: 'chain', vizStyle: 'nonsense' } });
check('opens, without actions or a quiz', opened.analysis?.pdbId === '1TRZ' && !opened.analysis.actions && !opened.analysis.quiz, JSON.stringify(opened));
check('...keeping only valid view settings', opened.view?.colorScheme === 'chain' && opened.view.vizStyle === undefined);
check('another version is refused', 'error' in saved.openPayload({ v: 2, kind: 'view', a: answer('1TRZ'), s: {} }));
check('no structure ID is refused', 'error' in saved.openPayload({ v: 1, kind: 'view', a: { title: 'x' }, s: {} }));

console.log('\n[a folded sequence]');
const SEQ = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEV';
const id = esmId(SEQ);
opened = saved.openPayload({ v: 1, kind: 'esmfold', a: answer(id), s: {}, structures: [{ id, sequence: SEQ, pdb: PDB, length: 999, meanPlddt: 99, fractionVeryLow: 0 }] });
const p = esm.getPrediction(id);
check('opens, and the viewer can load it', opened.analysis?.pdbId === id && p?.pdb === PDB, JSON.stringify(opened).slice(0, 120));
check('...its confidence read from the file, not from what was saved', p?.length === 2 && p.meanPlddt === 65 && p.fractionVeryLow === 0.5, JSON.stringify({ length: p?.length, mean: p?.meanPlddt, low: p?.fractionVeryLow }));
const other = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEW';
check('an ID that is not its sequence\'s own is refused', 'error' in saved.openPayload({ v: 1, kind: 'esmfold', a: answer(esmId(other)), s: {}, structures: [{ id: esmId(other), sequence: SEQ, pdb: PDB }] }));
check('a file with no residues is refused', 'error' in saved.openPayload({ v: 1, kind: 'esmfold', a: answer(id), s: {}, structures: [{ id, sequence: SEQ, pdb: 'END' }] }));

console.log('\n[a co-folded complex]');
const contact = { chain: 'A', resi: 189, icode: '', resn: 'ASP', distance: 2.9 };
const RESULT = {
  id: 'COFOLD-TEST001',
  request: { source: { kind: 'pdb', pdbId: '3PTB', chains: ['A'] }, structureId: '3PTB', proteinName: 'Trypsin', ligandText: 'benzamidine', entryLigands: ['BEN'], cofactors: [] },
  ligand: { name: 'Benzamidine', code: 'BEN', source: 'pdb' },
  pdb: PDB, ligandChain: 'L', ligandResn: 'BEN', cofactors: [],
  scores: { confidence: 0.9, ptm: 0.9, iptm: 0.9, ligandIptm: 0.9, proteinIptm: null, plddt: 0.9, iplddt: 0.9, pde: 0.3, ipde: 0.3 },
  affinity: { log10Ic50: 2.25, binderProbability: 0.84 }, contacts: [contact], proteinRmsd: 0.4, meanPlddt: 92, template: '3PTB', seconds: 11,
};
const coPayload = (result, a = answer(result.id)) => ({ v: 1, kind: 'cofold', a, s: {}, structures: [result] });
opened = saved.openPayload(coPayload({ ...RESULT, evil: '<img onerror=x>' }));
check('opens, with its card and the structure to go back to', opened.cofold?.result.id === 'COFOLD-TEST001' && opened.cofold.origin.pdbId === '3PTB', JSON.stringify(opened).slice(0, 160));
check('...in memory for the viewer, without fields it does not know', cofold.getCofold('COFOLD-TEST001')?.pdb === PDB && !('evil' in cofold.getCofold('COFOLD-TEST001')));
const compareOf = { ...RESULT, id: 'COFOLD-TEST002', compare: { other: RESULT, chain: 'M', reference: null, centroidDistance: 1.2, shared: [contact], onlyA: [], onlyB: [], overlap: 1, fingerprint: [{ ...contact, a: ['hbond'], b: [] }] } };
check('a comparison (holding the other prediction) opens', saved.openPayload(coPayload(compareOf)).cofold?.result.compare?.other.id === 'COFOLD-TEST001');
for (const [label, broken] of [
  ['a residue number that is text', { ...RESULT, contacts: [{ ...contact, resi: '189' }] }],
  ['a score that is text', { ...RESULT, scores: { ...RESULT.scores, iptm: 'high' } }],
  ['a missing field', (({ ligand, ...rest }) => rest)(RESULT)],
  ['an unknown source', { ...RESULT, request: { ...RESULT.request, source: { kind: 'ftp', url: 'x' } } }],
  ['a chain ID that is not one', { ...RESULT, ligandChain: '<b>' }],
  ['a file with no atoms', { ...RESULT, pdb: 'HEADER only' }],
  ['a broken comparison inside', { ...compareOf, compare: { ...compareOf.compare, other: { ...RESULT, meanPlddt: 'x' } } }],
]) check(`${label} is refused`, 'error' in saved.openPayload(coPayload({ ...broken, id: 'COFOLD-BROKEN1' }, answer('COFOLD-BROKEN1'))));
check('an answer pointing at a prediction that is not in it is refused', 'error' in saved.openPayload(coPayload(RESULT, answer('COFOLD-OTHER99'))));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
