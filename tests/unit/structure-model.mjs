// Tests for services/structureModel.ts: parsing real entries into chains/residues/ligands, and the selection model.
import '../lib/ts-hooks.mjs';
import { FIXTURES, ROOT_URL } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';
const FX = FIXTURES;
const read = (f) => readFileSync(`${FX}/${f}`, 'utf8');
const m = await import(`${ROOT_URL}services/structureModel.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const hsg = m.parseStructure(read('1HSG.pdb'));
check('1HSG: two protein chains of 99', hsg.chains.length === 2 && hsg.chains.every(c => c.residues.length === 99 && c.kind === 'protein'), JSON.stringify(hsg.chains.map(c => [c.chain, c.residues.length])));
check('1HSG: sequence read correctly', hsg.chains[0].sequence.startsWith('PQITLWQRPLVTIKIGGQLKEALLDTGADD') && hsg.chains[0].sequence.length === 99, hsg.chains[0].sequence.slice(0, 32));
check('1HSG: chain name from COMPND', hsg.chains[0].name === 'HIV-1 protease', hsg.chains[0].name);
check('1HSG: MK1 is a ligand, waters counted not listed', hsg.ligands.some(l => l.resn === 'MK1' && l.kind === 'ligand') && !hsg.ligands.some(l => l.resn === 'HOH') && hsg.waters === 127, `${hsg.ligands.length} ligands, ${hsg.waters} waters`);
check('1HSG: residue lookup by key', m.residueKey(hsg.chains[0].residues[24]) === 'A|25|' && hsg.byKey.get('A|25|')?.resn === 'ASP', JSON.stringify(hsg.byKey.get('A|25|')));
check('1HSG: residue label', m.residueLabel(hsg.byKey.get('A|25|')) === 'Asp25', m.residueLabel(hsg.byKey.get('A|25|')));
check('1HSG: counts', hsg.residueCount === 198 && hsg.atomCount > 1500, `${hsg.residueCount} residues, ${hsg.atomCount} atoms`);

const ptb = m.parseStructure(read('3PTB.pdb'));
check('3PTB: insertion codes kept as their own residues', ptb.byKey.has('A|184|A') && ptb.byKey.has('A|188|A') && ptb.byKey.has('A|221|A'), [...ptb.byKey.keys()].filter(k => /\|\d+\|[A-Z]/.test(k)).join(' '));
check('3PTB: numbering starts at 16, 223 residues', ptb.chains[0].residues[0].resi === 16 && ptb.chains[0].residues.length === 223, `${ptb.chains[0].residues[0].resi}..${ptb.chains[0].residues.at(-1).resi}`);
check('3PTB: calcium is an ion, benzamidine a ligand', ptb.ligands.some(l => l.resn === 'CA' && l.kind === 'ion') && ptb.ligands.some(l => l.resn === 'BEN' && l.kind === 'ligand'), JSON.stringify(ptb.ligands.map(l => [l.resn, l.kind])));

const hhb = m.parseStructure(read('4HHB.pdb'));
check('4HHB: four chains, hemes as ligands', hhb.chains.length === 4 && hhb.ligands.filter(l => l.resn === 'HEM').length === 4, `${hhb.chains.length} chains`);
check('4HHB: alpha/beta chain names differ', new Set(hhb.chains.map(c => c.name)).size === 2 && hhb.chains[0].name === 'Hemoglobin subunit alpha', JSON.stringify([...new Set(hhb.chains.map(c => c.name))]));

const tup = m.parseStructure(read('1TUP.pdb') ?? '');
check('1TUP: DNA chains detected as nucleic', tup.chains.some(c => c.kind === 'nucleic'), JSON.stringify(tup.chains.map(c => [c.chain, c.kind, c.residues.length])));
check('1TUP: no false gaps (its missing residues are at the chain ends)', tup.chains.every(c => c.gaps.length === 0), JSON.stringify(tup.chains.map(c => c.gaps.length)));
const m17 = m.parseStructure(read('1M17.pdb'));
check('1M17: the real internal gap (964->977) is recorded', m17.chains[0].gaps.length === 1 && m17.chains[0].residues[m17.chains[0].gaps[0]].resi === 977, JSON.stringify(m17.chains[0].gaps));

// Modified residues keep their parent letter and stay in the chain
const mse = ['ATOM      1  N   ALA A   1      11.1   6.1  -6.5  1.00 20.00           N',
  'ATOM      2  CA  ALA A   1      11.1   6.1  -6.5  1.00 20.00           C',
  'ATOM      3  C   ALA A   1      11.1   6.1  -6.5  1.00 20.00           C',
  'HETATM    4  N   MSE A   2      12.1   6.1  -6.5  1.00 20.00           N',
  'HETATM    5  CA  MSE A   2      12.1   6.1  -6.5  1.00 20.00           C',
  'HETATM    6  C   MSE A   2      12.1   6.1  -6.5  1.00 20.00           C',
  'HETATM    7 ZN    ZN A 101      20.1   6.1  -6.5  1.00 20.00          ZN', 'END'].join('\n');
const small = m.parseStructure(mse);
check('modified residue (MSE) stays in the chain as M', small.chains[0].sequence === 'AM' && small.ligands.length === 1 && small.ligands[0].kind === 'ion', `${small.chains[0].sequence} + ${JSON.stringify(small.ligands)}`);

// --- Selection ---
{
  let sel = m.emptySelection();
  sel = m.applyPick(sel, hsg, 'A|25|');
  check('plain click selects one and focuses it', sel.keys.size === 1 && sel.focus === 'A|25|');
  sel = m.applyPick(sel, hsg, 'A|27|', { toggle: true });
  check('ctrl-click adds', sel.keys.size === 2 && sel.focus === 'A|27|');
  sel = m.applyPick(sel, hsg, 'A|30|', { range: true });
  check('shift-click extends along the chain (27..30)', sel.keys.size === 5 && ['A|27|', 'A|28|', 'A|29|', 'A|30|'].every(k => sel.keys.has(k)), m.describeSelection(sel, hsg));
  check('describeSelection collapses ranges', m.describeSelection(sel, hsg) === 'A:25, 27-30', m.describeSelection(sel, hsg));
  sel = m.applyPick(sel, hsg, 'A|27|', { toggle: true });
  check('ctrl-click removes', sel.keys.size === 4 && !sel.keys.has('A|27|'));
  sel = m.applyPick(m.applyPick(m.emptySelection(), hsg, 'A|25|'), hsg, 'A|25|');
  check('clicking the only selected residue clears it', sel.keys.size === 0 && sel.focus === null);
  const range = m.applyPick(m.applyPick(m.emptySelection(), hsg, 'A|25|'), hsg, 'B|25|', { range: true });
  check('shift across chains does not span them', range.keys.size === 1 && range.keys.has('B|25|'), m.describeSelection(range, hsg));
  const whole = m.selectChain(hsg, 'B');
  check('selectChain takes the chain', whole.keys.size === 99 && m.describeSelection(whole, hsg) === 'B:1-99', m.describeSelection(whole, hsg));
  const spec = m.toAtomSpec(new Set(['A|184|A']));
  check('toAtomSpec matches insertion codes exactly', spec.predicate({ chain: 'A', resi: 184, icode: 'A' }) && !spec.predicate({ chain: 'A', resi: 184, icode: ' ' }));
  const many = m.selectChain(hsg, 'A');
  check('describeSelection is capped', m.describeSelection({ keys: new Set([...many.keys].filter((_, i) => i % 2 === 0)), focus: null }, hsg, 40).length <= 40);
}

// --- Neighbours, centres, and a clean model shape ---
{
  const asp25 = hsg.byKey.get('A|25|');
  check('residue carries a centre and its atoms', asp25.positions.length === 8 && asp25.center.every(Number.isFinite), JSON.stringify(asp25.center.map(v => Math.round(v))));
  check('model objects have no scratch fields', !('backbone' in asp25) && !('bSum' in asp25), Object.keys(asp25).join(','));
  const near = m.neighboursOf(hsg, 'A|25|', 5);
  check('neighbours of catalytic Asp25 include the other Asp25 and the drug', near.some(n => n.residue.chain === 'B' && n.residue.resi === 25) && near.some(n => n.residue.resn === 'MK1'),
    near.slice(0, 6).map(n => `${n.residue.chain}:${m.residueLabel(n.residue)} ${n.distance}`).join(' '));
  check('neighbours are sorted by distance and exclude the residue itself', near.every((n, i) => i === 0 || n.distance >= near[i-1].distance) && !near.some(n => m.residueKey(n.residue) === 'A|25|'));
  const tight = m.neighboursOf(hsg, 'A|25|', 3.5);
  check('a smaller radius gives fewer neighbours', tight.length > 0 && tight.length < near.length, `${tight.length} vs ${near.length}`);
  const ligandNear = m.neighboursOf(hsg, hsg.ligands.find(l => l.resn === 'MK1').key, 4);
  check('a ligand can be picked and has its own neighbours', ligandNear.length > 15, `${ligandNear.length} residues near MK1`);
  const centre = m.centerOf(hsg, ['A|25|', 'B|25|']);
  check('centerOf averages the residues', centre && centre.every(Number.isFinite), JSON.stringify(centre?.map(v => Math.round(v * 10) / 10)));
  check('centerOf of nothing is null', m.centerOf(hsg, []) === null);
  const t0 = performance.now();
  for (const r of hsg.chains[0].residues.slice(0, 40)) m.neighboursOf(hsg, m.residueKey(r), 5);
  check('40 neighbour lookups stay fast', performance.now() - t0 < 400, `${Math.round(performance.now() - t0)} ms`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
