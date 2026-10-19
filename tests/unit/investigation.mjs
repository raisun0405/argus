// services/investigationPlan.ts + services/investigation.ts: plans, write-ups, and running the steps
// offline (every tool replaced by a stand-in; a small made-up structure for the 3D comparisons).
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const P = await import(`${ROOT_URL}services/investigationPlan.ts`);
const I = await import(`${ROOT_URL}services/investigation.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tools = (plan) => plan?.steps.map(s => s.tool === 'relate' ? `relate(${s.a},${s.b},${s.within})` : s.tool).join(' ');

console.log('\n[1] normalizePlan');
check('not an object -> null', P.normalizePlan(null, '1TRZ') === null && P.normalizePlan([], '1TRZ') === null && P.normalizePlan('x', '1TRZ') === null);
let plan = P.normalizePlan({ structure: '1trz', title: 'Zinc', steps: [{ tool: 'pockets', why: 'x' }, { tool: 'magic' }, { tool: 'pockets' }, { tool: 'ligands' }] }, '1TRZ');
check('facts first, unknown and repeated tools dropped', tools(plan) === 'facts pockets ligands', tools(plan));
check('structure kept', plan.structure === '1TRZ' && plan.title === 'Zinc');
check('another PDB ID canonicalised', P.normalizePlan({ structure: '4obe', steps: [] }, '1TRZ').structure === '4OBE');
check('AlphaFold ID canonicalised', P.normalizePlan({ structure: 'af-p04637-f1-model_v6', steps: [] }, '1TRZ').structure === 'AF-P04637-F1');
check('invalid ID -> the current structure', P.normalizePlan({ structure: 'XYZ', steps: [] }, '1TRZ').structure === '1TRZ'
  && P.normalizePlan({ structure: '0ABC', steps: [] }, '1TRZ').structure === '1TRZ'
  && P.normalizePlan({ steps: [] }, '1TRZ').structure === '1TRZ');
check('an in-memory structure on screen is kept as is', P.normalizePlan({ structure: 'esm-abc123', steps: [] }, 'ESM-ABC123').structure === 'ESM-ABC123');
check('no steps -> facts only, default title', tools(P.normalizePlan({}, '1TRZ')) === 'facts' && P.normalizePlan({}, '1TRZ').title === 'Investigation');
plan = P.normalizePlan({ steps: [
  { tool: 'variants' }, { tool: 'pockets' },
  { tool: 'relate', a: 'harmful', b: 'pocket1', within: 100 },
  { tool: 'relate', a: 'harmful', b: 'ligand' }, // ligands not in the plan
  { tool: 'relate', a: 'disease', b: 'disease' },
  { tool: 'relate', a: 'disease', b: 'pocket2', within: 1 },
  { tool: 'relate', a: 'sites', b: 'pocket1', within: 'x' }, // third valid relate: over the limit
] }, '1TRZ');
check('relate: inputs must be made by the plan, a != b, at most 2, within clamped', tools(plan) === 'facts variants pockets relate(harmful,pocket1,8) relate(disease,pocket2,3)', tools(plan));
plan = P.normalizePlan({ steps: [{ tool: 'variants' }, { tool: 'pockets' }, { tool: 'ligands' }, { tool: 'relate', a: 'harmful', b: 'pocket1', within: 4.3 }, { tool: 'relate', a: 'harmful_near_pocket1', b: 'ligand' }] }, '1TRZ');
check('relate on an earlier comparison, within rounded to 0.5', tools(plan) === 'facts variants pockets ligands relate(harmful,pocket1,4.5) relate(harmful_near_pocket1,ligand,5)', tools(plan));
plan = P.normalizePlan({ steps: [
  { tool: 'variants' }, { tool: 'pockets' }, { tool: 'ligands' }, { tool: 'partners' }, { tool: 'similar' },
  { tool: 'relate', a: 'harmful', b: 'pocket1' }, { tool: 'relate', a: 'disease', b: 'ligand' },
] }, '1TRZ');
check('over 6 steps: the comparisons and their inputs stay, other tools go', tools(plan) === 'facts variants pockets ligands relate(harmful,pocket1,5) relate(disease,ligand,5)', tools(plan));
plan = P.normalizePlan({ steps: [{ tool: 'similar' }, { tool: 'partners' }, { tool: 'variants' }, { tool: 'pockets' }, { tool: 'ligands' }, { tool: 'relate', a: 'harmful', b: 'pocket1' }] }, '1TRZ');
check('over 6 steps: inputs kept, then the earliest other tools', tools(plan) === 'facts similar variants pockets relate(harmful,pocket1,5)' || tools(plan) === 'facts similar partners variants pockets relate(harmful,pocket1,5)', tools(plan));
check('...and exactly 6 steps', plan.steps.length <= 6, String(plan.steps.length));
plan = P.normalizePlan({ steps: [{ tool: 'variants', why: 'w'.repeat(300) }] }, '1TRZ');
check('why capped at 140 characters', plan.steps[1].why.length === 140);
check('step labels', P.stepLabel({ tool: 'pockets' }) === 'Predicted pockets (P2Rank)' && P.stepLabel({ tool: 'relate', a: 'harmful', b: 'pocket1', within: 4 }) === 'Likely harmful positions within 4 Å of pocket 1', P.stepLabel({ tool: 'relate', a: 'harmful', b: 'pocket1', within: 4 }));
check('set labels and categories', P.setLabel('harmful_near_pocket1') === 'likely harmful positions near pocket 1' && P.setCategory('harmful_near_pocket1') === 'mutation' && P.setCategory('pocket2') === 'binding_site' && P.setCategory('sites') === 'active_site');

console.log('\n[2] fallbackPlan (no AI)');
const fb = (q) => tools(P.fallbackPlan(q, '4OBE'));
check('mutations near a pocket', fb('Are the disease mutations of KRAS near a druggable pocket?') === 'facts variants pockets relate(harmful,pocket1,5)', fb('Are the disease mutations of KRAS near a druggable pocket?'));
check('partners', fb('What does p53 interact with?') === 'facts partners', fb('What does p53 interact with?'));
check('similar folds', fb('Which proteins have a similar fold?') === 'facts similar', fb('Which proteins have a similar fold?'));
check('a held inhibitor + mutations: compared with the ligand contacts', fb('Which mutations change how the inhibitor is held?') === 'facts variants ligands relate(harmful,ligand,5)', fb('Which mutations change how the inhibitor is held?'));
check('nothing specific -> pockets and ligands', fb('Tell me about this protein') === 'facts pockets ligands', fb('Tell me about this protein'));
check('title from the question', P.fallbackPlan('what does p53 interact with?', '1TUP').title === 'What does p53 interact with' && P.fallbackPlan('x', '1TUP').structure === '1TUP');
check('Motion is parked: a plan naming it drops the step', tools(P.normalizePlan({ steps: [{ tool: 'motion' }, { tool: 'ligands' }] }, '4AKE')) === 'facts ligands');

console.log('\n[3] citations and normalizeWrite');
check('[1, 3] and [2-3] split', P.cleanCitations('A [1, 3]. B [2-3].', 5) === 'A [1][3]. B [2][3].', P.cleanCitations('A [1, 3]. B [2-3].', 5));
check('out of range dropped, repeats merged, space before punctuation closed', P.cleanCitations('A [9]. B [2][2] [2], C [0].', 5) === 'A. B [2], C.', P.cleanCitations('A [9]. B [2][2] [2], C [0].', 5));
check('"1 and 2"', P.cleanCitations('A [1 and 2].', 3) === 'A [1][2].');
check('splitCitations', same(P.splitCitations('Pocket 1 holds it [3]. Yes [1][2]'), [{ text: 'Pocket 1 holds it ' }, { cite: 3 }, { text: '. Yes ' }, { cite: 1 }, { cite: 2 }]), JSON.stringify(P.splitCitations('Pocket 1 holds it [3]. Yes [1][2]')));
check('stripCitations', P.stripCitations('Pocket 1 holds it [3]. Yes [1][2]') === 'Pocket 1 holds it. Yes');
check('normalizeWrite: no answer -> null', P.normalizeWrite({ title: 'x' }, [], 3) === null && P.normalizeWrite(null, [], 3) === null);
let w = P.normalizeWrite({ title: 'T', answer: 'Yes  it is [1, 7].\n\n\n\nSecond [2].', marks: [{ set: 'harmful' }, { set: 'nope', label: 'x' }, { set: 'harmful', label: 'again' }, { set: 'pocket1', label: 'P1' }], caveat: 'Predicted.' }, ['harmful', 'pocket1'], 3);
check('answer cleaned (citations, blank lines)', w.answer === 'Yes it is [1].\n\nSecond [2].', JSON.stringify(w.answer));
check('marks: known sets only, once each, default label', same(w.marks, [{ set: 'harmful', label: 'Likely harmful positions' }, { set: 'pocket1', label: 'P1' }]), JSON.stringify(w.marks));
check('caveat kept', w.caveat === 'Predicted.' && w.title === 'T');
w = P.normalizeWrite({ answer: 'x', marks: [1, 2, 3, 4, 5, 6].map(i => ({ set: `s${i}` })) }, ['s1', 's2', 's3', 's4', 's5', 's6'], 1);
check('at most 4 marks', w.marks.length === 4);

console.log('\n[4] running the steps (stand-in tools, a made-up structure)');
// Chain A: Gly1 Ala2 Ser3 Asp4 Lys5 Phe6 along x, 3.8 Å apart; ligand LIG 101 beside Asp4
const line = (rec, serial, name, resn, chain, resi, [x, y, z], el) =>
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.length < 4 ? ` ${name.padEnd(3)}` : name} ${resn.padStart(3)} ${chain}${String(resi).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${el.padStart(2)}`;
const RES = ['GLY', 'ALA', 'SER', 'ASP', 'LYS', 'PHE'];
let serial = 0;
const atoms = RES.flatMap((resn, i) => {
  const x = 3.8 * (i + 1);
  return [['N', [x - 1.2, 0, 0], 'N'], ['CA', [x, 0, 0], 'C'], ['C', [x + 1.2, 0.5, 0], 'C'], ['O', [x + 1.5, 1.6, 0], 'O'], ...(resn === 'GLY' ? [] : [['CB', [x, -1.5, 0], 'C']])]
    .map(([name, p, el]) => line('ATOM', ++serial, name, resn, 'A', i + 1, p, el));
});
// Glu7 folds back beside Asp4 (1.75 Å through space), far from it along the chain
const glu7 = [['N', [14.0, -4.0, 0], 'N'], ['CA', [15.2, -4.0, 0], 'C'], ['C', [16.4, -3.5, 0], 'C'], ['O', [16.7, -2.4, 0], 'O'], ['CB', [15.2, -5.5, 0], 'C']].map(([name, p, el]) => line('ATOM', ++serial, name, 'GLU', 'A', 7, p, el));
const PDB = [...atoms, ...glu7, line('HETATM', ++serial, 'C1', 'LIG', 'A', 101, [15.2, 3.5, 0], 'C'), line('HETATM', ++serial, 'O1', 'LIG', 'A', 101, [16.4, 3.8, 0], 'O'), 'END'].join('\n');

const FACTS = 'Test protein [TEST_HUMAN, UniProt P12345]: chain A, residues 1-6, file numbering = UniProt\n- active site: A:Asp4 (Proton donor)\n- binds Zn(2+): A:Ser3, A:Lys5, A:Trp99\nLigands in the file: LIG (test ligand) A:101';
const VARIANTS = {
  structureId: 'test', mismatches: {}, sites: {}, skipped: [],
  proteins: [{ accession: 'P12345', identifier: 'TEST_HUMAN', gene: 'TST', chains: ['A'], available: true, mappedResidues: 6, pathogenicResidues: 2, knownVariants: [] }],
  residues: {
    'A|2': { accession: 'P12345', protein: 'TST', position: 2, wt: 'A', mean: 0.91, amClass: 'likely_pathogenic', worstAlt: 'P', worstScore: 0.99, known: [] },
    'A|4': { accession: 'P12345', protein: 'TST', position: 4, wt: 'D', mean: 0.72, amClass: 'likely_pathogenic', worstAlt: 'N', worstScore: 0.9,
      known: [{ position: 4, wt: 'D', alt: 'N', tags: ['TS'], diseaseNames: ['Test syndrome'], diseaseLinked: true }] },
    'A|7': { accession: 'P12345', protein: 'TST', position: 7, wt: 'E', mean: 0.8, amClass: 'likely_pathogenic', worstAlt: 'K', worstScore: 0.95, known: [] },
    'A|6': { accession: 'P12345', protein: 'TST', position: 6, wt: 'F', mean: 0.1, amClass: 'likely_benign', worstAlt: 'L', worstScore: 0.2, known: [] },
  },
};
const POCKETS = { structureId: 'TEST', model: 'quick', url: 'x', pockets: [
  { rank: 1, probability: 0.8, center: null, ligands: ['LIG'], residues: [3, 4, 5].map(resi => ({ chain: 'A', resi, icode: '' })) },
  { rank: 2, probability: 0.04, center: null, ligands: [], residues: [{ chain: 'A', resi: 1, icode: '' }] },
] };
const LIGAND_SITES = [{ key: 'A|101|', code: 'LIG', name: 'LIG', chain: 'A', resi: 101, icode: '', heavyAtoms: 2, kind: 'organic', interactions: [
  { type: 'hbond', partner: { chain: 'A', resi: 4, icode: '', resn: 'ASP', atom: 'O' }, distance: 2.9, from: [0, 0, 0], to: [0, 0, 0] },
  { type: 'hydrophobic', partner: { chain: 'A', resi: 5, icode: '', resn: 'LYS' }, distance: 3.8, from: [0, 0, 0], to: [0, 0, 0] },
] }];
const PARTNERS = { query: {}, name: 'TST', taxId: 9606, stringUrl: 'x', partners: [{ name: 'ABC1', score: 0.99, evidence: [], bestComplex: '1ABC' }, { name: 'DEF2', score: 0.7, evidence: [] }] };
const SIMILAR = { queryLabel: 'q', queryStructureId: 'TEST', proteins: [{ structureId: 'AF-Q1-F1', label: 'Q1', name: 'Cousin protein', organism: 'Mouse', probability: 1, evalue: 0, identity: 35, coverage: 0.9, members: 1, identityRange: [35, 35] }], experimental: [], sameProteinStructures: 2, totalHits: 3 };
const asked = {};
const standIn = (overrides = {}) => ({
  structure: async () => PDB,
  facts: async () => FACTS,
  variants: async () => VARIANTS,
  pockets: async (id, pdb) => { asked.pocketsPdb = pdb.length; return POCKETS; },
  ligands: () => LIGAND_SITES,
  proteins: async () => [{ accession: 'P12345', identifier: 'TEST_HUMAN', isHuman: true, segments: [{ chain: 'A', structAsymId: 'A', unpStart: 1, unpEnd: 6, resStart: 1, resEnd: 6 }] }],
  partners: async (q) => { asked.partners = q; return PARTNERS; },
  similar: async (q) => { asked.similar = q; return SIMILAR; },
  ...overrides,
});
const run = async (steps, overrides, signal = new AbortController().signal) => {
  const updates = [];
  const plan = P.normalizePlan({ structure: '9TST', title: 'Test', steps }, '9TST');
  const done = await I.runInvestigationSteps('9TST', PDB, plan, s => updates.push(`${s.index}:${s.status}`), signal, standIn(overrides));
  return { done, updates, plan };
};

let { done, updates } = await run([
  { tool: 'variants' }, { tool: 'pockets' }, { tool: 'ligands' },
  { tool: 'relate', a: 'harmful', b: 'pocket1', within: 4 }, { tool: 'relate', a: 'disease', b: 'ligand', within: 4 },
]);
const byTool = (t, n = 0) => done.filter(s => s.plan.tool === t)[n];
check('every step done', done.every(s => s.status === 'done'), done.map(s => `${s.index}:${s.status}${s.note ? `(${s.note})` : ''}`).join(' '));
check('each step went running -> done', [1, 2, 3, 4, 5, 6].every(i => updates.indexOf(`${i}:running`) >= 0 && updates.indexOf(`${i}:running`) < updates.indexOf(`${i}:done`)), updates.join(' '));
check('comparisons ran after their inputs', updates.indexOf('5:running') > updates.indexOf('3:done') && updates.indexOf('6:running') > updates.indexOf('4:done'));
const facts = byTool('facts').result;
check('facts: sites from active-site and binding lines (residues not in the file dropped)', same(facts.sets[0].residues.map(r => r.name), ['Asp4', 'Ser3', 'Lys5']), JSON.stringify(facts.sets[0]?.residues.map(r => r.name)));
check('facts: summary', facts.summary === 'Test protein: 1 active-site residue and 2 binding residues annotated; ligands LIG', facts.summary);
const variants = byTool('variants').result;
check('variants: harmful sorted by score, with scores', same(variants.sets[0].residues.map(r => `${r.name} ${r.note}`), ['Ala2 0.91', 'Glu7 0.80', 'Asp4 0.72']), JSON.stringify(variants.sets[0].residues.map(r => `${r.name} ${r.note}`)));
check('variants: disease set and evidence', variants.sets[1].name === 'disease' && variants.evidence.includes('A:Asp4 (D4N; Test syndrome)') && variants.view === 'pathogenicity', variants.evidence);
check('variants: summary', variants.summary === '3 of 6 positions likely harmful when mutated; 1 position with known disease variants', variants.summary);
const pockets = byTool('pockets').result;
check('pockets: low-probability pockets left out, ligand named', pockets.sets.length === 1 && pockets.summary === '1 pocket found; pocket 1 is 80% likely to bind a ligand and holds LIG', pockets.summary);
check('pockets: got the file', asked.pocketsPdb === PDB.length);
const ligands = byTool('ligands').result;
check('ligands: contact set and summary', same(ligands.sets[0].residues.map(r => r.name), ['Asp4', 'Lys5']) && ligands.summary.startsWith('LIG: hydrogen bonds with 1 residue'), ligands.summary);
const relate1 = byTool('relate', 0).result;
check('relate: in the pocket first, then near it through space; a chain neighbour of the pocket does not count', same(relate1.sets[0].residues.map(r => `${r.name} ${r.note}`), ['Asp4 in pocket 1', 'Glu7 1.8 Å']), JSON.stringify(relate1.sets[0].residues.map(r => `${r.name} ${r.note}`)));
check('relate: set name and summary', relate1.sets[0].name === 'harmful_near_pocket1' && relate1.summary === '2 of 3 likely harmful positions lie within 4 Å of pocket 1: A:Asp4, A:Glu7', relate1.summary);
const relate2 = byTool('relate', 1).result;
check('relate: disease variants touching the ligand', relate2.sets[0]?.residues.map(r => r.name).join() === 'Asp4', relate2.summary);

console.log('\n[5] findings, marks and the fallback write-up');
const findings = I.findingsText(done);
check('findings numbered in step order', /^\[1\] UniProt and PDBe annotations: /.test(findings) && findings.includes('\n[5] Likely harmful positions within 4 Å of pocket 1: 2 of 3'), findings.slice(0, 200));
check('markable sets', same(I.markableSets(done).map(s => `${s.name}:${s.count}`), ['sites:3', 'harmful:3', 'disease:1', 'pocket1:3', 'ligand:2', 'harmful_near_pocket1:2', 'disease_near_ligand:1']), JSON.stringify(I.markableSets(done).map(s => `${s.name}:${s.count}`)));
const marks = I.highlightsFor([{ set: 'harmful_near_pocket1', label: 'Harmful, in the pocket' }, { set: 'nope', label: 'x' }, { set: 'pocket1', label: 'Pocket 1' }], done);
check('marks -> highlights', same(marks, [
  { chain: 'A', resi: [4, 7], label: 'Harmful, in the pocket', category: 'mutation' },
  { chain: 'A', resi: [3, 4, 5], label: 'Pocket 1', category: 'binding_site' },
]), JSON.stringify(marks));
check('a step\'s highlights', same(I.stepHighlights(byTool('ligands')), [{ chain: 'A', resi: [4, 5], label: 'Ligand contacts', category: 'binding_site' }]), JSON.stringify(I.stepHighlights(byTool('ligands'))));
const fallback = I.fallbackWriteUp(done, 'Test');
check('fallback write-up: each result cited, the last comparison marked', fallback.answer.split('\n').length === 6 && fallback.answer.endsWith('[6]') && fallback.marks[0]?.set === 'disease_near_ligand', JSON.stringify(fallback));
const long = done.map(s => ({ ...s, result: { ...s.result, evidence: 'x'.repeat(3000) } }));
check('findings fit 6000 characters', I.findingsText(long).length <= 6000, String(I.findingsText(long).length));

console.log('\n[6] failures, skips and stopping');
({ done } = await run([{ tool: 'variants' }, { tool: 'pockets' }, { tool: 'relate', a: 'harmful', b: 'pocket1' }], { pockets: async () => { throw new Error('prankweb.cz responded 503'); } }));
check('a failing tool: failed with its reason', byTool('pockets').status === 'failed' && byTool('pockets').note === 'prankweb.cz responded 503', `${byTool('pockets').status} ${byTool('pockets').note}`);
check('...and a comparison needing it is skipped', byTool('relate').status === 'skipped' && byTool('relate').note === 'nothing to compare without pocket 1', `${byTool('relate').status} ${byTool('relate').note}`);
check('...while the others finish', byTool('variants').status === 'done' && byTool('facts').status === 'done');
check('findings say so', /\[3\] Predicted pockets \(P2Rank\): FAILED \(prankweb\.cz responded 503\)/.test(I.findingsText(done)) && /\[4\] .*NOT RUN \(nothing to compare without pocket 1\)/.test(I.findingsText(done)), I.findingsText(done).split('\n').slice(2).join(' | '));

({ done } = await run([{ tool: 'variants' }], { variants: async () => ({ ...VARIANTS, proteins: [{ ...VARIANTS.proteins[0], available: false }], skipped: [{ accession: 'P1', identifier: 'X_MOUSE' }], residues: {} }) }));
check('not a human protein: variants skipped, not failed', byTool('variants').status === 'skipped' && byTool('variants').note === 'AlphaMissense covers human proteins only', `${byTool('variants').status} ${byTool('variants').note}`);
({ done } = await run([{ tool: 'ligands' }], { ligands: () => [] }));
check('no ligands: skipped with a reason', byTool('ligands').status === 'skipped' && /no ligands/.test(byTool('ligands').note));
({ done } = await run([], { facts: async () => null }));
check('no annotations: done, says so', byTool('facts').status === 'done' && byTool('facts').result.summary === 'No curated annotations for this structure' && byTool('facts').result.sets.length === 0);

({ done } = await run([{ tool: 'partners' }, { tool: 'similar' }]));
check('partners: largest protein asked, chains passed', asked.partners.accession === 'P12345' && same(asked.partners.chainsHere, { P12345: ['A'] }) && same(asked.partners.structureKeys, ['9TST']));
check('partners: summary', byTool('partners').result.summary === '2 partners in STRING; 1 solved together with TST in the PDB', byTool('partners').result.summary);
check('similar: chain A sent, own entry and protein excluded', asked.similar.label === '9TST chain A' && same(asked.similar.excludePdbIds, ['9TST']) && same(asked.similar.excludeAccessions, ['P12345']) && asked.similar.pdb.includes('ATOM'));
check('similar: summary', byTool('similar').result.summary === '1 protein family and 0 other structures share the fold; closest other protein: Cousin protein', byTool('similar').result.summary);
({ done } = await run([{ tool: 'similar' }], { similar: async () => ({ ...SIMILAR, proteins: [{ ...SIMILAR.proteins[0], name: 'Same protein', sameProtein: true }, ...SIMILAR.proteins] }) }));
check('similar: other proteins listed before the same protein in other species', byTool('similar').result.summary.endsWith('closest other protein: Cousin protein')
  && byTool('similar').result.evidence.startsWith('Other proteins with this fold (AlphaFold DB): Cousin protein (Mouse)') && byTool('similar').result.evidence.includes('The same protein in other species: 1 family.'), byTool('similar').result.evidence);

console.log('\n[7] several copies of a chain: positions count once');
// The same protein twice (chains A and B of a dimer): every position appears in both chains
const DIMER = { ...VARIANTS, residues: Object.fromEntries(Object.entries(VARIANTS.residues).flatMap(([key, v]) => [[key, v], [key.replace('A|', 'B|'), v]])) };
({ done } = await run([{ tool: 'variants' }, { tool: 'pockets' }, { tool: 'relate', a: 'harmful', b: 'pocket1', within: 4 }], { variants: async () => DIMER }));
check('variants: positions counted once, not per chain', byTool('variants').result.summary === '3 of 6 positions likely harmful when mutated; 1 position with known disease variants', byTool('variants').result.summary);
check('variants: the set keeps every chain\'s copy', byTool('variants').result.sets[0].residues.length === 6 && byTool('variants').result.sets[0].residues.filter(r => r.chain === 'B').length === 3);
check('variants: lists name each position once', (byTool('variants').result.evidence.match(/Ala2/g) ?? []).length === 1, byTool('variants').result.evidence);
check('relate: counts positions too', byTool('relate').result.summary === '2 of 3 likely harmful positions lie within 4 Å of pocket 1: A:Asp4, A:Glu7', byTool('relate').result.summary);

const controller = new AbortController();
setTimeout(() => controller.abort(), 150);
const t0 = Date.now();
({ done } = await run([{ tool: 'pockets' }, { tool: 'variants' }], { pockets: () => new Promise(r => setTimeout(() => r(POCKETS), 3000)) }, controller.signal));
check('stopping: the slow step is skipped as stopped, quickly', byTool('pockets').status === 'skipped' && byTool('pockets').note === 'stopped' && Date.now() - t0 < 1500, `${byTool('pockets').status} ${byTool('pockets').note} ${Date.now() - t0} ms`);
check('stopping: steps already done stay done', byTool('variants').status === 'done' && byTool('facts').status === 'done');

console.log('\n[8] the work under a stopped or timed-out step stops too (D10)');
// A tool that runs until its signal says stop, and says when it did
const untilStopped = (seen) => (...args) => new Promise((_, reject) => {
  const signal = args.at(-1);
  seen.got = signal instanceof AbortSignal;
  signal?.addEventListener('abort', () => { seen.stoppedAt = Date.now(); reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
});
{
  const seen = {};
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 100);
  const t = Date.now();
  ({ done } = await run([{ tool: 'similar' }], { similar: untilStopped(seen) }, stop.signal));
  check('Stop: the fold search gets a signal, and it fires', seen.got && seen.stoppedAt - t < 1000 && byTool('similar').note === 'stopped', JSON.stringify({ ...seen, ms: seen.stoppedAt - t }));
}
{
  // Step budgets are a minute or two: shorten every wait of 10 s or more to 50 ms for this check
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 10_000 ? 50 : ms, ...rest);
  try {
    const pockets = {}, similar = {};
    ({ done } = await run([{ tool: 'pockets' }, { tool: 'similar' }], { pockets: untilStopped(pockets), similar: untilStopped(similar) }));
    check('timed out: the step fails with its reason...', byTool('pockets').status === 'failed' && /no answer after 100 s/.test(byTool('pockets').note) && byTool('similar').status === 'failed', `${byTool('pockets').status} ${byTool('pockets').note}`);
    check('...and its work is told to stop (PrankWeb polling, Foldseek polling)', pockets.got && similar.got && Boolean(pockets.stoppedAt) && Boolean(similar.stoppedAt), JSON.stringify({ pockets, similar }));
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

console.log('\n[9] the investigate call has a time limit, and Stop still ends it (D11)');
{
  const realFetch = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  let sent = 0;
  // A server that never answers, except by giving up when the request's signal says so
  globalThis.fetch = (url, init) => new Promise((_, reject) => {
    sent++;
    init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
  });
  AbortSignal.timeout = ms => realTimeout.call(AbortSignal, ms >= 10_000 ? 80 : ms); // The 45 s limit, made short
  try {
    let t = Date.now();
    const plan = await I.requestPlan('why?', { pdbId: '1TRZ', title: 'Insulin' }).then(() => 'answered', e => e?.name);
    check('no answer: the call gives up at its limit (TimeoutError), so the investigation falls back', plan === 'TimeoutError' && Date.now() - t < 2000, `${plan} after ${Date.now() - t} ms`);
    AbortSignal.timeout = realTimeout; // Back to 45 s: only Stop can end it now
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    t = Date.now();
    const stopped = await I.requestPlan('why?', { pdbId: '1TRZ', title: 'Insulin' }, undefined, stop.signal).then(() => 'answered', e => e?.name);
    check('Stop ends a waiting call at once', stopped === 'AbortError' && Date.now() - t < 1000 && sent === 2, `${stopped} after ${Date.now() - t} ms, ${sent} sent`);
  } finally {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
