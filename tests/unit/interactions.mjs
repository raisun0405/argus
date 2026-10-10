// Tests for services/interactionService.ts: agreement with PDBe Arpeggio, well-known contacts, a synthetic
// halogen bond, facts line, and the co-fold comparison (cofoldService placePrediction + interactions).
import '../lib/ts-hooks.mjs';
import { FIXTURES, ROOT_URL } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';

const FX = FIXTURES;
const read = (f) => readFileSync(`${FX}/${f}`, 'utf8');
const ix = await import(`${ROOT_URL}services/interactionService.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const site = (id, code, chain, resi) => ix.analyzeInteractions(read(`${id}.pdb`)).find(s => s.code === code && (!chain || s.chain === chain) && (resi === undefined || s.resi === resi));
const has = (s, type, resn, resi, atom) => s.interactions.some(i => i.type === type && i.partner.resn === resn && i.partner.resi === resi && (!atom || i.partner.atom === atom));
const residues = (s, type) => [...new Set(s.interactions.filter(i => i.type === type).map(i => `${i.partner.resn}${i.partner.resi}`))];

// --- Arpeggio agreement (hydrogen bonds and metals, waters excluded) ---
{
  const cases = [['3PTB', 'A', 1, 'BEN'], ['1HSG', 'B', 902, 'MK1'], ['4HHB', 'A', 142, 'HEM'], ['1M17', 'A', 999, 'AQ4'], ['2HYY', 'A', 600, 'STI'],
    ['3HTB', 'A', 167, 'JZ4'], ['4OBE', 'A', 201, 'GDP'], ['4OBE', 'A', 202, 'MG'], ['1STP', 'A', 300, 'BTN'], ['1A28', 'A', 1, 'STR']];
  const totals = { hbond: [0, 0, 0], metal: [0, 0, 0] };
  for (const [id, chain, resi, code] of cases) {
    const s = site(id, code, chain, resi);
    const arp = JSON.parse(read(`arpeggio-${id}-${chain}-${resi}.json`))[id.toLowerCase()][0].interactions.filter(x => x.end.chem_comp_id !== 'HOH');
    for (const [type, test] of [['hbond', d => d.includes('hbond')], ['metal', d => d.includes('metal_complex')]]) {
      const ours = new Set(s.interactions.filter(i => i.type === type && i.partner.resn !== 'HOH').map(i => `${i.partner.chain}${i.partner.resi}`));
      const theirs = new Set(arp.filter(x => test(x.interaction_details)).map(x => `${x.end.chain_id}${x.end.author_residue_number}`));
      totals[type][0] += ours.size; totals[type][1] += theirs.size; totals[type][2] += [...ours].filter(x => theirs.has(x)).length;
    }
  }
  const [ho, ht, hs] = totals.hbond, [mo, mt, ms] = totals.metal;
  check('hydrogen bonds vs Arpeggio: precision ≥ 75%, recall ≥ 90%', hs / ho >= 0.75 && hs / ht >= 0.9, `precision ${(100 * hs / ho).toFixed(0)}%, recall ${(100 * hs / ht).toFixed(0)}%`);
  check('metal coordination vs Arpeggio: all agree', ms === mo && ms === mt, `${mo}/${mt}/${ms}`);
}

// --- Well-known contacts ---
{
  const ben = site('3PTB', 'BEN');
  check('trypsin-benzamidine: salt bridge to Asp189', has(ben, 'salt_bridge', 'ASP', 189), JSON.stringify(residues(ben, 'salt_bridge')));
  check('trypsin-benzamidine: H-bonds to Ser190 and Gly219', has(ben, 'hbond', 'SER', 190) && has(ben, 'hbond', 'GLY', 219), JSON.stringify(residues(ben, 'hbond')));
  const aq4 = site('1M17', 'AQ4');
  check('EGFR-erlotinib: hinge H-bond Met769 N', has(aq4, 'hbond', 'MET', 769, 'N'));
  const sti = site('2HYY', 'STI', 'A', 600);
  check('Abl-imatinib: H-bonds Met318, Thr315, Glu286, Asp381, Ile360', ['MET318', 'THR315', 'GLU286', 'ASP381', 'ILE360'].every(r => residues(sti, 'hbond').includes(r)), JSON.stringify(residues(sti, 'hbond')));
  check('Abl-imatinib: T-shaped stacking with Tyr253', sti.interactions.some(i => i.type === 'pi_stacking' && i.partner.resi === 253 && i.detail === 'T-shaped'));
  const hem = site('4HHB', 'HEM', 'A', 142);
  check('hemoglobin heme: Fe coordinated by proximal His87 NE2 (2.1 Å)', hem.interactions.some(i => i.type === 'metal' && i.partner.resi === 87 && i.partner.atom === 'NE2' && i.distance < 2.4));
  check('hemoglobin heme: no false H-bond between His87 and the pyrrole nitrogens', !has(hem, 'hbond', 'HIS', 87));
  const btn = site('1STP', 'BTN');
  check('streptavidin-biotin: 8 H-bond residues incl. Thr90 to the sulfur', residues(btn, 'hbond').length >= 8 && btn.interactions.some(i => i.type === 'hbond' && i.partner.resi === 90 && i.ligandAtom === 'S1'), JSON.stringify(residues(btn, 'hbond')));
  const mg = site('4OBE', 'MG');
  check('KRAS Mg: coordinated by GDP, Ser17 and waters', mg.kind === 'metal' && has(mg, 'metal', 'GDP', 201) && has(mg, 'metal', 'SER', 17) && mg.interactions.filter(i => i.partner.resn === 'HOH').length >= 3);
  const gdp = site('4OBE', 'GDP');
  check('KRAS GDP: P-loop Lys16 salt bridge, Phe28 stacking, Mg contact', has(gdp, 'salt_bridge', 'LYS', 16) && has(gdp, 'pi_stacking', 'PHE', 28) && has(gdp, 'metal', 'MG', 202));
  const zn = site('1TRZ', 'ZN', 'B', 31);
  check('insulin Zn: coordinated by His10', zn && has(zn, 'metal', 'HIS', 10));
  const jz4 = site('3HTB', 'JZ4');
  check('T4L L99A 2-propylphenol: mostly hydrophobic (≥ 8 residues), phenol H-bond to Gln102', residues(jz4, 'hydrophobic').length >= 8 && has(jz4, 'hbond', 'GLN', 102));
  const mk1 = site('1HSG', 'MK1');
  check('HIV protease-indinavir: both catalytic Asp25 H-bond, flap Ile50 via water', has(mk1, 'hbond', 'ASP', 25) && [...new Set(mk1.interactions.filter(i => i.type === 'hbond' && i.partner.resi === 25).map(i => i.partner.chain))].sort().join('') === 'AB'
    && mk1.interactions.some(i => i.type === 'water_bridge' && i.partner.resi === 50), JSON.stringify(mk1.interactions.filter(i => i.type === 'water_bridge').map(i => i.partner.chain + i.partner.resi)));
  check('ligand order: drug before metal', ix.analyzeInteractions(read('3PTB.pdb'))[0].code === 'BEN');
  check('waters and additives are not ligands', !ix.analyzeInteractions(read('1HSG.pdb')).some(s => s.code === 'HOH') && !ix.analyzeInteractions(read('3HTB.pdb')).some(s => s.code === 'BME'));
  check('hasLigands', ix.hasLigands(read('3PTB.pdb')) && !ix.hasLigands('ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N\nEND\n'));
}

// --- Synthetic halogen bond: C-Br pointing at a carbonyl oxygen ---
{
  const atom = (serial, name, resn, chain, resi, x, y, z, el, het = false) =>
    `${het ? 'HETATM' : 'ATOM  '}${String(serial).padStart(5)} ${name.length >= 4 ? name : ` ${name}`.padEnd(4)} ${resn} ${chain}${String(resi).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00          ${el.padStart(2)}`;
  // Protein carbonyl C=O along +x; ligand Br at 3.1 Å from O, C-Br...O linear (180°), Br...O=C 120°
  const o = [0, 0, 0], c = [-1.23, 0, 0];
  const br = [3.1 * Math.cos(Math.PI / 3), 3.1 * Math.sin(Math.PI / 3), 0]; // 120° at O between C and Br
  const dir = [br[0] - o[0], br[1] - o[1], br[2] - o[2]].map(v => v / 3.1);
  const cl = [br[0] + 1.9 * dir[0], br[1] + 1.9 * dir[1], br[2] + 1.9 * dir[2]];
  const ring = [0, 1, 2, 3, 4, 5].map(k => [cl[0] + 1.39 * dir[0] + 1.39 * Math.cos(k * Math.PI / 3) * 0, cl[1], cl[2]]);
  const lines = [
    atom(1, 'CA', 'GLY', 'A', 10, -1.9, -1.2, 0, 'C'), atom(2, 'C', 'GLY', 'A', 10, ...c, 'C'), atom(3, 'O', 'GLY', 'A', 10, ...o, 'O'),
    atom(4, 'BR', 'BRB', 'L', 1, ...br, 'BR', true), atom(5, 'C1', 'BRB', 'L', 1, ...cl, 'C', true),
    atom(6, 'C2', 'BRB', 'L', 1, cl[0] + 1.5 * dir[0], cl[1] + 1.5 * dir[1] + 0.2, cl[2], 'C', true),
  ];
  void ring;
  const s = ix.analyzeInteractions(lines.join('\n') + '\nEND\n').find(x => x.code === 'BRB');
  check('synthetic halogen bond detected (C-Br…O=C, 3.1 Å)', s && s.interactions.some(i => i.type === 'halogen' && i.partner.resi === 10 && Math.abs(i.distance - 3.1) < 0.01), JSON.stringify(s?.interactions.map(i => i.type)));
}

// --- Facts line ---
{
  const line = ix.interactionFactsLine(read('1HSG.pdb'));
  check('facts line: MK1 with H-bonds to Asp25, within 520 chars', line && /MK1 B:902/.test(line) && /hydrogen bonds .*A:Asp25/.test(line) && line.length <= 520, `${line?.length} chars`);
  const mg = ix.interactionFactsLine(read('4OBE.pdb'));
  check('facts line: waters summarised, not listed', /\+ \d waters/.test(mg) && !/HOH/.test(mg), mg.slice(-120));
  check('facts line: none for a protein without ligands', ix.interactionFactsLine('ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00  0.00           N\nEND\n') === null);
}

// --- Co-fold: predicted pose interactions and crystal comparison ---
{
  const svc = await import(`${ROOT_URL}services/cofoldService.ts`);
  const server = { pdb: read('cofold-3PTB-server.pdb'), chains: [{ id: 'A', length: 223 }], ligand: { chain: 'L', resn: 'BEN' }, cofactors: [{ chain: 'X', resn: 'CA' }],
    scores: { ligandIptm: 0.99, iptm: 0.99 }, affinity: { log10Ic50: 2.25, binderProbability: 0.84 }, template: '3PTB', seconds: 11.6 };
  const request = { source: { kind: 'pdb', pdbId: '3PTB', chains: ['A'] }, structureId: '3PTB', proteinName: 'Beta-trypsin', ligandText: 'BEN', entryLigands: ['BEN', 'CA'], cofactors: ['CA'] };
  const placed = svc.placePrediction(server, { name: 'Benzamidine', code: 'BEN', source: 'pdb' }, request, read('3PTB.pdb'));
  const salt = placed.interactions?.find(x => x.type === 'salt_bridge');
  check('co-fold pose: salt bridge with Asp189 found', salt?.partners.includes('Asp189'), JSON.stringify(placed.interactions));
  check('co-fold pose: crystal interactions reproduced counted', placed.reference?.interactionsTotal > 0 && placed.reference.interactionsShared >= placed.reference.interactionsTotal - 1, JSON.stringify(placed.reference));
  const sites = ix.analyzeInteractions(placed.pdb, [placed.reference.chain]);
  check('co-fold analysis leaves the crystal pose (reference chain) out', !sites.some(s => s.chain === placed.reference.chain) && sites.some(s => s.chain === 'L'), sites.map(s => s.code + s.chain).join(' '));
  const sentence = svc.interactionSentence(placed.interactions);
  check('co-fold summary sentence names the salt bridge and H-bonds', /a salt bridge with Asp189/.test(sentence) && /hydrogen bonds with/.test(sentence), sentence);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
