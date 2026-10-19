// Live test of services/alphafillService.ts: transplants placed into AlphaFold DB v6 models, checked
// against chemistry (heme iron on the proximal histidine, zinc on its cysteines).
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

const { loadAlphaFill, alphaFillFactsLine, FIRST_TRANSPLANT_RESIDUE } = await import(`${ROOT_URL}services/alphafillService.ts`);
const { superpose } = await import(`${ROOT_URL}services/superpose.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; console.log('UNHANDLED', e); });

// superpose(): a known rotation + translation is recovered exactly
{
  const pts = [[1, 2, 3], [4, -1, 0.5], [-2, 0, 7], [3, 3, -3], [0, -4, 2]];
  const c = Math.cos(0.7), s = Math.sin(0.7);
  const moved = pts.map(([x, y, z]) => [c * x - s * y + 10, s * x + c * y - 5, z + 2]);
  const fit = superpose(pts, moved);
  const err = Math.max(...pts.map((p, i) => { const q = fit.apply(p); return Math.hypot(q[0] - moved[i][0], q[1] - moved[i][1], q[2] - moved[i][2]); }));
  check('superpose recovers a rigid motion', fit.rmsd < 1e-6 && err < 1e-6, `rmsd ${fit.rmsd.toExponential(1)}`);
}

// First model only, as 3Dmol and the app's parsers read it (AlphaFold files wrap atoms in MODEL/ENDMDL)
const firstModel = (pdb) => { const lines = pdb.split('\n'); const end = lines.findIndex(l => l.startsWith('ENDMDL')); return end >= 0 ? lines.slice(0, end) : lines; };
const atomsOf = (pdb) => firstModel(pdb).filter(l => l.startsWith('ATOM') || l.startsWith('HETATM')).map(l => ({
  het: l.startsWith('HETATM'), name: l.slice(12, 16).trim(), resn: l.slice(17, 20).trim(), chain: l.slice(21, 22), resi: parseInt(l.slice(22, 26), 10),
  p: [parseFloat(l.slice(30, 38)), parseFloat(l.slice(38, 46)), parseFloat(l.slice(46, 54))], element: l.slice(76, 78).trim(), line: l,
}));
const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
const show = (r) => r.transplants.map(t => `${t.compound} ${t.name} from ${t.sourcePdb} (${Math.round(t.identity * 100)}%, ${t.confidence}, lrmsd ${t.localRmsd.toFixed(2)}, TCS ${t.clashScore.toFixed(2)}) @${t.resi} contacts ${t.contacts.slice(0, 6).join(' ')}`).join('\n    ');
const model = (acc) => fetch(`https://alphafold.ebi.ac.uk/files/AF-${acc}-F1-model_v6.pdb`).then(r => r.text());

// Haemoglobin beta: heme + a gas at the distal site
{
  const base = await model('P68871');
  const t0 = Date.now();
  const r = await loadAlphaFill('P68871');
  console.log(`  HBB (${Date.now() - t0} ms, skipped ${r.skipped}):\n    ${show(r)}`);
  const heme = r.transplants.find(t => t.compound === 'HEM');
  check('heme placed, high confidence', heme?.confidence === 'high');
  check('at most 6 transplants, residues numbered from 9001', r.transplants.length <= 6 && r.transplants.every((t, i) => t.resi === FIRST_TRANSPLANT_RESIDUE + i));
  check('one ligand per space (duplicate hemes merged)', r.transplants.filter(t => t.compound === 'HEM').length === 1);
  const atoms = atomsOf(r.pdb);
  const fe = atoms.find(a => a.het && a.resn === 'HEM' && a.name === 'FE');
  const ne2 = atoms.find(a => !a.het && a.resi === 93 && a.name === 'NE2');
  const d = fe && ne2 ? dist(fe, ne2) : NaN;
  check('heme iron sits on proximal His93 (Fe-NE2 about 2 Å)', d > 1.7 && d < 2.8, `${d.toFixed(2)} Å`);
  check('heme contacts include His93', heme?.contacts.includes('A:His93'), heme?.contacts.join(' '));
  check('protein atoms untouched', atoms.filter(a => !a.het).length === atomsOf(base).filter(a => !a.het).length);
  const het = atoms.filter(a => a.het);
  check('HETATM records well formed (chain A, element column)', het.length > 0 && het.every(a => a.chain === 'A' && a.resi >= 9001 && a.element.length > 0 && a.line.length >= 78));
  check('END record still last', r.pdb.trimEnd().split('\n').pop().startsWith('END'));
  const merged = r.pdb.split('\n');
  check('transplants sit inside the first model (before ENDMDL)', merged.findIndex(l => l.startsWith('HETATM')) < merged.findIndex(l => l.startsWith('ENDMDL')));
  const ironLigands = r.transplants.filter(t => ['OXY', 'CMO', 'NO', 'CYN', 'NO2', 'H2S'].includes(t.compound));
  check('one small ligand on the heme iron, and it is O2', ironLigands.length === 1 && ironLigands[0].compound === 'OXY', ironLigands.map(t => t.compound).join(','));
  check('at most two drug/probe ligands', r.transplants.filter(t => !['HEM', 'DG2', 'OXY', 'CMO', 'NO', 'CYN', 'NO2', 'H2S'].includes(t.compound)).length <= 2);
  const gas = ironLigands[0] && atoms.filter(a => a.het && a.resi === ironLigands[0].resi);
  const feToGas = gas && fe ? Math.min(...gas.map(g => dist(g, fe))) : NaN;
  check('that ligand sits on the iron (< 2.6 Å)', feToGas < 2.6, `${feToGas.toFixed(2)} Å`);
  const bpg = r.transplants.find(t => t.compound === 'DG2');
  if (bpg) check('2,3-BPG named and between the beta N-terminus and Lys83', bpg.name === '2,3-Bisphosphoglycerate' && bpg.contacts.includes('A:Lys83'), bpg.contacts.join(' '));
  const again = await loadAlphaFill('p68871');
  check('second call served from memory', again === r);
  const facts = alphaFillFactsLine('AF-P68871-F1');
  console.log('  facts:', facts);
  check('facts line names heme and its contacts', /Heme \(HEM, from \w{4}, high confidence\) touching/.test(facts ?? '') && facts.length <= 420);
}

// p53: the structural zinc on Cys176, His179, Cys238, Cys242
{
  const base = await model('P04637');
  const r = await loadAlphaFill('P04637');
  console.log(`  TP53 (skipped ${r.skipped}):\n    ${show(r)}`);
  const atoms = atomsOf(r.pdb);
  const zn = atoms.filter(a => a.het && a.resn === 'ZN');
  const ligands = [[176, 'SG'], [179, 'ND1'], [238, 'SG'], [242, 'SG']].map(([resi, name]) => atoms.find(a => !a.het && a.resi === resi && a.name === name));
  const best = zn.map(z => ligands.map(l => (l ? dist(z, l) : 99))).sort((a, b) => Math.max(...a) - Math.max(...b))[0];
  check('zinc placed in the Cys176/His179/Cys238/Cys242 site (all within 2.9 Å)', best && Math.max(...best) < 2.9, best?.map(x => x.toFixed(2)).join(', '));
  check('only metals from close homologs (no zinc from the 59% template)', r.transplants.filter(t => t.compound === 'ZN').every(t => t.identity >= 0.7));
}

// EGFR: a multi-domain protein (v4 and v6 differ by ~15 Å overall); sites must still be fitted locally
{
  const base = await model('P00533');
  const t0 = Date.now();
  const r = await loadAlphaFill('P00533');
  console.log(`  EGFR (${Date.now() - t0} ms, skipped ${r.skipped}):\n    ${show(r)}`);
  check('EGFR: transplants placed despite the different frame', r.transplants.length > 0);
  const nucleotide = r.transplants.find(t => ['ATP', 'ADP', 'ANP', 'ACP'].includes(t.compound));
  check('EGFR: nucleotide in the kinase ATP site (Lys745, hinge Met793/Leu792)', nucleotide && nucleotide.contacts.includes('A:Lys745') && nucleotide.contacts.some(c => /A:(Met793|Leu792|Gln791)/.test(c)), nucleotide?.contacts.join(' '));
  check('EGFR: no heavy-atom soaks (yttrium)', !r.transplants.some(t => t.compound === 'YT3'));
  check('EGFR: metals held by three groups', r.transplants.filter(t => ['ZN', 'MG'].includes(t.compound)).every(t => t.contacts.length >= 2));
}

// No AlphaFill entry (SARS-CoV-2 polyprotein)
{
  const r = await loadAlphaFill('P0DTD1');
  check('protein without an AlphaFill entry -> null', r === null);
}

check('no unhandled rejections', unhandled === 0, String(unhandled));
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
