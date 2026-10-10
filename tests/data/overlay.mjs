// Overlay: the alignment, the pruned fit against an independent fit, and real pairs of whole files as
// the app loads them, checked against RCSB's own pairwise alignment service (TM-align, FATCAT).
import '../lib/ts-hooks.mjs';
import { OUT, ROOT_URL } from '../lib/env.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const O = await import(`${ROOT_URL}services/overlayService.ts`);
const S = await import(`${ROOT_URL}services/superpose.ts`);
const L = await import(`${ROOT_URL}services/alphafoldService.ts`);

const CACHE = `${OUT}/pdb-cache`;
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const pdbOf = async (id) => {
  const file = `${CACHE}/${id}.pdb`;
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const res = await fetch(`https://files.rcsb.org/download/${id}.pdb`);
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
};
const caOf = (pdb, chain) => {
  const out = new Map();
  for (const l of pdb.split('\n')) {
    if (l.startsWith('ENDMDL')) break;
    if (!/^(ATOM|HETATM)/.test(l) || l.slice(12, 16).trim() !== 'CA' || (l[16] !== ' ' && l[16] !== 'A')) continue;
    if (chain && l[21] !== chain) continue;
    out.set(`${parseInt(l.slice(22, 26))}${l[26].trim()}`, [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)]);
  }
  return out;
};
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// Independent least-squares fit: Kabsch through the eigenvectors of MᵀM (Jacobi), not Horn's quaternion
const kabschRmsd = (from, to) => {
  const n = from.length, cf = [0, 0, 0], ct = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { cf[k] += from[i][k] / n; ct[k] += to[i][k] / n; }
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) H[r][c] += (from[i][r] - cf[r]) * (to[i][c] - ct[c]);
  // RMSD from the singular values of H (sqrt of the eigenvalues of HᵀH), with the reflection sign
  const HtH = [0, 1, 2].map(r => [0, 1, 2].map(c => H[0][r] * H[0][c] + H[1][r] * H[1][c] + H[2][r] * H[2][c]));
  const a = HtH.map(r => r.slice());
  for (let sweep = 0; sweep < 60; sweep++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
    if (Math.abs(a[p][q]) < 1e-14) continue;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]); const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)); const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
    for (let k = 0; k < 3; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
  }
  const sv = [0, 1, 2].map(i => Math.sqrt(Math.max(0, a[i][i]))).sort((x, y) => y - x);
  const det = H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1]) - H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0]) + H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0]);
  let e0 = 0;
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) e0 += (from[i][k] - cf[k]) ** 2 + (to[i][k] - ct[k]) ** 2;
  const e = e0 - 2 * (sv[0] + sv[1] + (det < 0 ? -sv[2] : sv[2]));
  return Math.sqrt(Math.max(0, e / n));
};

// RCSB's pairwise alignment service, for an independent superposition
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rcsbAlign = async (method, a, b) => {
  const f = new FormData();
  f.append('query', JSON.stringify({ options: {}, context: { mode: 'pairwise', method: { name: method }, structures: [{ entry_id: a[0], selection: { asym_id: a[1] } }, { entry_id: b[0], selection: { asym_id: b[1] } }] } }));
  const ticket = (await (await fetch('https://alignment.rcsb.org/api/v1/structures/submit', { method: 'POST', body: f })).text()).trim().replace(/"/g, '');
  for (let i = 0; i < 150; i++) { // TM-align jobs can queue for minutes
    await sleep(2000);
    const r = await fetch(`https://alignment.rcsb.org/api/v1/structures/results?uuid=${ticket}`).catch(() => null); // A dropped poll is retried
    if (!r?.ok) continue;
    const json = await r.json().catch(() => null);
    if (json?.info?.status === 'COMPLETE') return json.results[0];
    if (json?.info?.status === 'ERROR') throw new Error(JSON.stringify(json).slice(0, 200));
  }
  throw new Error('RCSB alignment timed out');
};
const applyColumnMajor = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

console.log('\n[1] the sequence alignment');
{
  const a = 'MRIILLGAPGAGKGTQAQFIMEKYGIPQISTGDMLRAAVKSGSELGKQAKDIMDAGKLVTDELVIALVKERIAQEDCRNGFLLDGFPRTIPQADAMKEAG';
  const same = O.alignSequences(a, a).pairs;
  check('identical sequences: every position with itself', same.length === a.length && same.every(([i, j]) => i === j));
  const trimmed = a.slice(10, -5);
  const t = O.alignSequences(a, trimmed).pairs;
  check('a shorter construct: offset found, end gaps free', t.length === trimmed.length && t.every(([i, j]) => i === j + 10));
  const gapped = a.slice(0, 40) + a.slice(52);
  const g = O.alignSequences(a, gapped).pairs;
  check('a missing loop (12 residues): one gap, the rest in place', g.length === gapped.length && g.every(([i, j]) => (j < 40 ? i === j : i === j + 12)), JSON.stringify(g.slice(38, 42)));
  const mutated = a.slice(0, 11) + 'D' + a.slice(12, 60) + 'W' + a.slice(61);
  const mm = O.alignSequences(a, mutated).pairs;
  check('point changes stay aligned one to one', mm.length === a.length && mm.every(([i, j]) => i === j));
}

console.log('\n[2] the pruned fit (ChimeraX matchmaker rules) against an independent least-squares fit');
{
  const ca = [...caOf(await pdbOf('4AKE'), 'A').values()];
  // A copy turned and moved, a little noise, and one stretch (residues 120-160) swung away by 8 Å
  const ang = 0.7, c = Math.cos(ang), s = Math.sin(ang);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
  const moved = ca.map((p, i) => { const q = [c * p[0] - s * p[1] + 12, s * p[0] + c * p[1] - 5, p[2] + 30]; return i >= 120 && i < 160 ? [q[0] + 8, q[1], q[2]] : [q[0] + rnd(), q[1] + rnd(), q[2] + rnd()]; });
  const r = O.fitPruned(ca, moved);
  const keptSet = new Set(r.kept);
  const swungKept = [...keptSet].filter(i => i >= 120 && i < 160).length;
  check('the swung stretch is pruned, the rest kept', swungKept === 0 && r.kept.length >= 170, `${r.kept.length} kept of ${ca.length}, ${swungKept} from the swung stretch`);
  const independent = kabschRmsd(r.kept.map(i => moved[i]), r.kept.map(i => ca[i]));
  check('core RMSD matches an independent Kabsch fit on the same pairs (to 1e-6 Å)', Math.abs(independent - r.keptRmsd) < 1e-6, `${r.keptRmsd.toFixed(6)} vs ${independent.toFixed(6)} Å`);
  check('no kept pair is over 2 Å, as the rule requires', r.kept.every(i => r.distances[i] <= 2), `max kept ${Math.max(...r.kept.map(i => r.distances[i])).toFixed(2)} Å`);
}

console.log('\n[3] real pairs, whole files as the app loads them');
const realPairs = {};
{
  const open = await pdbOf('4AKE'), closed = await pdbOf('1AKE');
  const r = O.computeOverlay(open, closed, '1AKE');
  realPairs.adk = r;
  check('adenylate kinase open (4AKE) + closed (1AKE): chain A onto chain A, same protein', r.mainChain === 'A' && r.otherChain === 'A' && r.identity === 1, `${r.mainChain}↔${r.otherChain}, ${Math.round(r.identity * 100)}% over ${r.pairs}`);
  check('the core lines up closely; the whole is far apart', r.coreRmsd < 1.5 && r.core >= 100 && r.allRmsd > 5, `${r.coreRmsd.toFixed(2)} Å over ${r.core} kept · ${r.allRmsd.toFixed(2)} Å over all ${r.pairs}`);
  const lid = r.regions.find(g => g.keys.some(k => { const n = +k.split('|')[1]; return n >= 125 && n <= 155; }));
  const nmp = r.regions.find(g => g.keys.some(k => { const n = +k.split('|')[1]; return n >= 35 && n <= 55; }));
  check('it differs most where the LID and the NMP domain close', !!lid && !!nmp && r.regions[0] === lid, r.regions.slice(0, 3).map(g => `${g.label} up to ${g.max.toFixed(1)} Å`).join(' · '));
  check('no residue changed between the two', r.changed.length === 0, r.changed.map(c => c.label).join(', '));
  check('every aligned residue has a distance both ways (the laid-over one under its shown chain)', r.distances.size === r.pairs && r.shownDistances.size === r.pairs && [...r.shownDistances.keys()].every(k => k.startsWith(`${r.shownChain}|`)));
  const sameSpot = [...r.distances].every(([k, d]) => Math.abs((r.shownDistances.get(`${r.shownChain}${k.slice(1)}`) ?? -1) - d) < 1e-9);
  check('...and a residue and its partner carry the same distance (same numbering here)', sameSpot);
  check('the overlay chain gets a chain ID 4AKE does not use, its waters left out', r.shownChain !== 'A' && r.shownChain !== 'B' && !/HOH/.test(r.pdb) && /^ATOM.{17}z/m.test(r.pdb), `chain "${r.shownChain}"`);
  check('...and its ligand (Ap5A) comes along', /^HETATM.{11}AP5/m.test(r.pdb));
  // The moved file: a core residue of 1AKE now sits on 4AKE's
  const shown = caOf(r.pdb, r.shownChain), mainCa = caOf(open, 'A');
  const coreKey = [...mainCa.keys()].find(k => r.distances.get(`A|${k.replace(/[A-Z]$/, '')}|`) < 0.6);
  check('in the written file, a core residue lands on its partner', coreKey && dist(shown.get(coreKey), mainCa.get(coreKey)) < 0.6, `A:${coreKey} ${coreKey ? dist(shown.get(coreKey), mainCa.get(coreKey)).toFixed(2) : '?'} Å`);

  // RCSB: FATCAT-rigid fits the whole chain (no pruning); TM-align fits the conserved core
  try {
    const fatcat = await rcsbAlign('fatcat-rigid', ['4AKE', 'A'], ['1AKE', 'A']);
    const rcsbRmsd = fatcat.structure_alignment[0].summary.scores.find(s => s.type === 'RMSD').value;
    const pairs = [...mainCa.keys()].filter(k => caOf(closed, 'A').has(k));
    const whole = S.superpose(pairs.map(k => caOf(closed, 'A').get(k)), pairs.map(k => mainCa.get(k))).rmsd;
    check('a whole-chain fit (no pruning) matches RCSB FATCAT-rigid', Math.abs(whole - rcsbRmsd) < 0.15, `ours ${whole.toFixed(2)} Å vs RCSB ${rcsbRmsd} Å`);
    const tm = await rcsbAlign('tm-align', ['4AKE', 'A'], ['1AKE', 'A']);
    const m = tm.structure_alignment[0].transformations[1];
    const theirs = new Map([...caOf(closed, 'A')].map(([k, p]) => [k, applyColumnMajor(m, p)]));
    const coreKeys = [...mainCa.keys()].filter(k => { const d = r.distances.get(`A|${k.replace(/[A-Z]$/, '')}|`); return d !== undefined && d <= 2; });
    const gaps = coreKeys.filter(k => theirs.has(k) && shown.has(k)).map(k => dist(theirs.get(k), shown.get(k)));
    const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    check('our overlay sits where RCSB TM-align puts it (core residues within 1 Å on average)', mean < 1, `mean ${mean.toFixed(2)} Å, max ${Math.max(...gaps).toFixed(2)} Å over ${gaps.length} core residues · TM-score ${tm.structure_alignment[0].summary.scores.find(s => s.type === 'TM-score')?.value ?? tm.summary?.scores?.find(s => s.type === 'TM-score')?.value}`);
  } catch (e) { check('RCSB alignment service reachable', false, e.message); }
}
{
  // Experimental against AlphaFold: haemoglobin α (4HHB chain A) and its AlphaFold model
  const hb = await pdbOf('4HHB');
  const af = await L.fetchAlphaFoldStructure('P69905').catch(e => null);
  if (af?.pdb) {
    const r = O.computeOverlay(hb, af.pdb, 'AF-P69905-F1', { mainChain: 'A' });
    check('haemoglobin α vs its AlphaFold model: the extra Met1 aligned around, 100% identical', r.mainChain === 'A' && r.identity === 1 && r.pairs >= 140, `${r.mainChain}↔${r.otherChain}, ${r.pairs} pairs, ${Math.round(r.identity * 100)}%`);
    check('...and AlphaFold matches the crystal closely', r.coreRmsd < 1 && r.core >= 130, `${r.coreRmsd.toFixed(2)} Å over ${r.core} · ${r.allRmsd.toFixed(2)} Å over all`);
  } else check('AlphaFold DB reachable', false);
  const r2 = O.computeOverlay(hb, await pdbOf('2HHB'), '2HHB');
  check('haemoglobin 4HHB vs 2HHB: chain choices offered (α on α, β on β)', r2.choices.length >= 4 && r2.choices.every(c => ['A', 'C'].includes(c.main) === ['A', 'C'].includes(c.other)), r2.choices.map(c => `${c.main}↔${c.other}`).join(' '));
  check('...with no chain asked for, the best-scoring pair (ChimeraX\'s default: the longer β chains), nearly identical', r2.mainChain === 'B' && r2.otherChain === 'B' && r2.coreRmsd < 0.6, `${r2.mainChain}↔${r2.otherChain} · ${r2.coreRmsd.toFixed(2)} Å over ${r2.core}`);
  const onA = O.computeOverlay(hb, await pdbOf('2HHB'), '2HHB', { mainChain: 'A' });
  check('...and the chain you are looking at when the app passes it (A onto A)', onA.mainChain === 'A' && onA.otherChain === 'A' && onA.coreRmsd < 0.6, `${onA.coreRmsd.toFixed(2)} Å over ${onA.core}`);
  const onB = O.computeOverlay(hb, await pdbOf('2HHB'), '2HHB', { mainChain: 'B' });
  check('a chosen chain is used (B onto B)', onB.mainChain === 'B' && onB.otherChain === 'B');
  const cross = O.computeOverlay(await pdbOf('4AKE'), await pdbOf('1AKE'), '1AKE', { mainChain: 'B', otherChain: 'A' });
  check('...and both chains can be chosen (B onto A)', cross.mainChain === 'B' && cross.otherChain === 'A');
}
{
  // Changed residues: KRAS G12C (6OIM) against wild-type KRAS (4OBE)
  const r = O.computeOverlay(await pdbOf('6OIM'), await pdbOf('4OBE'), '4OBE');
  check('KRAS G12C vs wild type: the change at 12 is listed', r.changed.some(c => c.label === 'A:12' && c.from === 'C' && c.to === 'G' && c.key === 'A|12|'), r.changed.map(c => `${c.label} ${c.from}→${c.to}`).join(', '));
  check('...still the same protein, lined up closely', r.identity >= 0.9 && r.coreRmsd < 1.5, `${Math.round(r.identity * 100)}% · ${r.coreRmsd.toFixed(2)} Å over ${r.core}`);
}
{
  let threw = null;
  try { O.computeOverlay(await pdbOf('4AKE'), await pdbOf('1LYZ'), '1LYZ'); } catch (e) { threw = e.message; }
  check('a different protein is refused, saying why', /isn't the same protein: at most \d+% of the sequences match/.test(threw ?? ''), threw);
  // A short identical stretch (here: 30 residues of adenylate kinase grafted onto lysozyme's chain) isn't enough
  const graft = (await pdbOf('1LYZ')).split('\n').filter(l => !/^(ATOM|HETATM)/.test(l) || l[21] === 'A').join('\n') + '\n' + (await pdbOf('4AKE')).split('\n').filter(l => /^ATOM/.test(l) && l[21] === 'A' && +l.slice(22, 26) >= 1 && +l.slice(22, 26) <= 30).map(l => l.slice(0, 22) + String(+l.slice(22, 26) + 500).padStart(4) + l.slice(26)).join('\n');
  let grafted = null;
  try { O.computeOverlay(await pdbOf('4AKE'), graft, 'graft'); } catch (e) { grafted = e.message; }
  check('a short identical stretch is not "the same protein"', /isn't the same protein/.test(grafted ?? ''), grafted ?? 'accepted');
  const t0 = Date.now();
  O.computeOverlay(await pdbOf('6VXX'), await pdbOf('6VXX'), '6VXX');
  check('a large structure (spike trimer on itself) is quick', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
}

console.log('\n[4] other entries of the same protein (RCSB, live)');
{
  const list = await O.sameProteinEntries('P69441');
  check('adenylate kinase (P69441): 1AKE and 4AKE among them, best resolved first', list.some(e => e.id === '1AKE') && list.some(e => e.id === '4AKE') && list.every((e, i) => i === 0 || (e.resolution ?? 99) >= (list[i - 1].resolution ?? 99) - 1e-9), list.slice(0, 5).map(e => `${e.id} ${e.resolution ?? '?'} Å`).join(' · '));
  check('...with titles', list.every(e => e.title.length > 0), list[0]?.title);
}

console.log('\n[5] the facts line for the chat');
{
  O.rememberOverlay('4ake', realPairs.adk);
  const line = O.overlayFactsLine('4AKE');
  check('names the overlay, the fit and where they differ', /1AKE chain A on this structure's chain A/.test(line ?? '') && /differ most at A:/.test(line ?? ''), line);
  O.rememberOverlay('4AKE', null);
  check('...and is gone when the overlay closes', O.overlayFactsLine('4AKE') === null);
  check('names: a PDB entry, an AlphaFold model', O.overlayName('1ake') === '1AKE' && O.overlayName('AF-P69441-F1') === 'AlphaFold P69441');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
