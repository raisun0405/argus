// services/coverageService.ts against independent facts, live (RCSB files, PDBe, UniProt):
//  - 1TUP numbers p53 like UniProt: the residues in its file ARE the answer (no mapping involved)
//  - 4HHB starts at 1 where UniProt starts at 2 (initiator Met removed): 2-142 of 142, 2-147 of 147
//  - 1TRZ: insulin's two chains are two stretches of one 110-residue precursor (B = file + 24, A = file + 89)
//  - PDBe-KB's resolved stretches for real p53 entries vs the residues in those entries' own files
//   node tf-coverage-unit.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const cov = await import(`${ROOT_URL}services/coverageService.ts`);
const { parseStructure } = await import(`${ROOT_URL}services/structureModel.ts`);
const { loadUniProtResidueMap, variantKey } = await import(`${ROOT_URL}services/variantService.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const pdb = async id => { const r = await fetch(`https://files.rcsb.org/download/${id}.pdb`); if (!r.ok) throw new Error(`${id} ${r.status}`); return r.text(); };
const R = rs => JSON.stringify(rs);

console.log('[ranges]');
check('rangesOf', R(cov.rangesOf([3, 4, 5, 9, 11, 12])) === R([[3, 5], [9, 9], [11, 12]]));
check('complement', R(cov.complement([[3, 5], [9, 9]], 12)) === R([[1, 2], [6, 8], [10, 12]]) && R(cov.complement([[1, 12]], 12)) === '[]');
check('percent never rounds a partial coverage up to 100', cov.percent(392, 393) === 99 && cov.percent(393, 393) === 100 && cov.percent(219, 393) === 55);
check('rangesText caps long lists', cov.rangesText([[1, 2], [4, 4], [6, 7]], 2) === '1–2, 4 and 1 more stretch');

console.log('\n[an experimental entry: the residues in its file]');
{
  const model = parseStructure(await pdb('1TUP'));
  const c = await cov.entryCoverage('1TUP');
  const p53 = c.find(x => x.accession === 'P04637');
  // Independent answer: 1TUP numbers p53 like UniProt, so its protein chains' residue numbers are the positions
  const p53Chains = model.chains.filter(ch => ['A', 'B', 'C'].includes(ch.chain));
  const expected = cov.rangesOf([...new Set(p53Chains.flatMap(ch => ch.residues.map(r => r.resi)))].sort((a, b) => a - b));
  check('1TUP: p53 found, of 393, in chains A–C', !!p53 && p53.length === 393 && R(p53.chains) === R(['A', 'B', 'C']), p53 && `${p53.identifier} ${p53.chains}`);
  check('...its stretches are exactly the residues in the file', R(p53?.ranges) === R(expected) && !p53?.renumbered, `${cov.rangesText(p53?.ranges ?? [])} vs ${cov.rangesText(expected)}`);
  check('...and what is missing is the rest of 1–393', R(p53?.missing) === R(cov.complement(expected, 393)), cov.rangesText(p53?.missing ?? []));
  check('...DNA chains are no protein of it', c.every(x => !x.chains.includes('E') && !x.chains.includes('F')));
}
{
  const c = await cov.entryCoverage('4HHB');
  const hba = c.find(x => x.accession === 'P69905'), hbb = c.find(x => x.accession === 'P68871');
  check('4HHB: alpha holds 2–142 of 142, renumbered (file starts at 1)', R(hba?.ranges) === R([[2, 142]]) && hba.length === 142 && R(hba.missing) === R([[1, 1]]) && hba.renumbered, hba && `${cov.rangesText(hba.ranges)} of ${hba.length}, missing ${cov.rangesText(hba.missing)}`);
  check('...beta holds 2–147 of 147', R(hbb?.ranges) === R([[2, 147]]) && hbb.length === 147 && R(hbb.missing) === R([[1, 1]]), hbb && `${cov.rangesText(hbb.ranges)} of ${hbb.length}`);
}
{
  const model = parseStructure(await pdb('1TRZ'));
  const c = await cov.entryCoverage('1TRZ');
  const ins = c.find(x => x.accession === 'P01308');
  const byChain = id => model.chains.filter(ch => ch.chain === id).flatMap(ch => ch.residues.map(r => r.resi));
  const expected = cov.rangesOf([...new Set([...byChain('B').map(r => r + 24), ...byChain('D').map(r => r + 24), ...byChain('A').map(r => r + 89), ...byChain('C').map(r => r + 89)])].sort((a, b) => a - b));
  check('1TRZ: insulin is two stretches of its 110-residue precursor', ins?.length === 110 && R(ins.ranges) === R(expected) && ins.renumbered, ins && `${cov.rangesText(ins.ranges)} of ${ins.length} vs ${cov.rangesText(expected)}`);
}

console.log('\n[what experiments resolve: PDBe-KB vs the entries\' own files]');
{
  const all = await cov.experimentalCoverage('P04637');
  check('p53: of 393, from hundreds of entries', all?.length === 393 && all.entries > 100, all && `${all.entries} entries, ${cov.rangesText(all.ranges)} (${cov.percent(all.resolved, all.length)}%), never: ${cov.rangesText(all.missing)}`);
  // Every residue 1TUP holds must be among the resolved ones
  const tup = (await cov.entryCoverage('1TUP')).find(x => x.accession === 'P04637');
  const inAll = p => all.ranges.some(([a, b]) => p >= a && p <= b);
  check('...every residue of 1TUP is among them', tup.ranges.every(([a, b]) => { for (let p = a; p <= b; p++) if (!inAll(p)) return false; return true; }));
  // Per-entry: PDBe-KB's resolved stretches of an entry's best chain vs that chain's residues in the file
  const raw = await (await fetch('https://www.ebi.ac.uk/pdbe/graph-api/uniprot/unipdb/P04637')).json();
  const items = raw.P04637.data.filter(it => /^[1-9][a-z0-9]{3}$/.test(it.accession));
  const picked = ['2ocj', '1tsr', '3kmd', '2xwr', '4hje', '1aie', '1ycr'].map(id => items.find(it => it.accession === id)).filter(Boolean);
  let agree = 0, compared = 0;
  for (const it of picked) {
    let text;
    try { text = await pdb(it.accession.toUpperCase()); } catch { continue; }
    const model = parseStructure(text);
    const map = await loadUniProtResidueMap(it.accession, 'P04637');
    const chain = model.chains.find(ch => ch.chain === it.bestChainId);
    if (!chain) continue;
    const fromFile = cov.rangesOf([...new Set(chain.residues.map(r => map[variantKey(r.chain, r.resi, r.icode)]).filter(p => p !== undefined))].sort((a, b) => a - b));
    const fromKb = cov.rangesOf([...new Set(it.residues.filter(r => r.observed === 'Y' && r.indexType === 'UNIPROT').flatMap(r => Array.from({ length: r.endIndex - r.startIndex + 1 }, (_, k) => r.startIndex + k)))].sort((a, b) => a - b));
    compared++;
    const same = R(fromFile) === R(fromKb);
    if (same) agree++;
    console.log(`    ${it.accession} chain ${it.bestChainId}: file ${cov.rangesText(fromFile, 4)} | PDBe-KB ${cov.rangesText(fromKb, 4)} ${same ? '' : '<- differ'}`);
  }
  check('PDBe-KB\'s resolved stretches match the entries\' own files', compared >= 5 && agree === compared, `${agree} of ${compared}`);
}
{
  const none = await cov.experimentalCoverage('A0A000');
  check('a protein PDBe has nothing for: null, not an error', none === null || none.entries === 0);
}

console.log('\n[facts line]');
const p53 = await cov.experimentalCoverage('P04637');
cov.rememberExperimentalCoverage('AF-P04637-F1', p53);
const line = cov.experimentalFactsLine('af-p04637-f1');
console.log(`  ${line}`);
check('a line for the model it was remembered for, none for others', !!line && line.includes('PDBe-KB') && cov.experimentalFactsLine('1TUP') === null);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
