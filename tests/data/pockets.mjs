// Live test of services/pocketService.ts against PrankWeb (entries already analysed there) and RCSB / AlphaFold DB files.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

const { loadPockets, shownPockets, residueLabel, pocketFactsLine, cachedPockets, pocketsSupported, pocketKey } =
  await import(`${ROOT_URL}services/pocketService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++; };
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; console.log('UNHANDLED', e); });

const pdb = async (id) => (await fetch(`https://files.rcsb.org/download/${id}.pdb`)).text();
const summary = (prediction) => shownPockets(prediction).map(p =>
  `#${p.rank} ${(p.probability * 100).toFixed(0)}% ${p.residues.length} res [${p.ligands.join(',')}] ${p.residues.slice(0, 6).map(r => r.chain + ':' + residueLabel(r)).join(' ')}`).join('\n    ');

// Targets
check('PDB ID supported', pocketsSupported('1hsg') && pocketKey('1hsg') === '1HSG');
check('AlphaFold ID supported', pocketsSupported('AF-P68871-F1') && pocketKey('af-p68871-f1') === 'AF-P68871-F1');
check('ESMFold ID unsupported', !pocketsSupported('ESM-1a2b3c4d') && pocketKey('ESM-1a2b3c4d') === null);
check('garbage unsupported', !pocketsSupported('hello') && !pocketsSupported(''));

// 1HSG: HIV protease with the inhibitor MK1 in the active site
{
  const signal = new AbortController().signal;
  const t0 = Date.now();
  const p = await loadPockets('1HSG', await pdb('1HSG'), signal);
  console.log(`  1HSG (${p.model}, P2Rank ${p.p2rankVersion}, ${Date.now() - t0} ms):\n    ${summary(p)}`);
  const top = p.pockets[0];
  check('1HSG conservation model', p.model === 'conservation');
  check('1HSG top pocket holds MK1', top.ligands.includes('MK1'), top.ligands.join(','));
  check('1HSG top pocket spans both chains and has Asp25', top.residues.some(r => r.chain === 'A' && r.resi === 25 && r.aa === 'D') && top.residues.some(r => r.chain === 'B'));
  check('1HSG residues sorted', top.residues.every((r, i, a) => i === 0 || a[i - 1].chain < r.chain || (a[i - 1].chain === r.chain && a[i - 1].resi <= r.resi)));
  check('1HSG weaker pockets hold no MK1', p.pockets.slice(1).every(q => !q.ligands.includes('MK1')));
  check('1HSG shown pockets capped at 5', shownPockets(p).length <= 5);
  check('1HSG url', p.url === 'https://prankweb.cz/analyze?database=v4-conservation-hmm&code=1HSG', p.url);
  const again = await loadPockets('1hsg', null, signal);
  check('second call served from cache', again === p);
  const facts = pocketFactsLine('1HSG');
  console.log('  facts:', facts);
  check('facts line names MK1 and stays short', facts.includes('holds MK1') && facts.length <= 420, `${facts.length} chars`);
  check('facts line compacts runs', /A 8 10 23 25 27-30 32/.test(facts), facts.slice(0, 160));
}

// 2PTN: trypsin, chymotrypsin numbering with insertion codes (184A, 188A, 221A)
{
  const p = await loadPockets('2PTN', await pdb('2PTN'), new AbortController().signal);
  console.log(`  2PTN (${p.model}):\n    ${summary(p)}`);
  const s1 = p.pockets[0];
  check('2PTN S1 pocket has Asp189 and Ser195', s1.residues.some(r => r.resi === 189 && r.aa === 'D') && s1.residues.some(r => r.resi === 195 && r.aa === 'S'));
  const icodes = p.pockets.flatMap(q => q.residues).filter(r => r.icode);
  console.log('  insertion-code residues in pockets:', icodes.map(r => r.resi + r.icode).join(' ') || '(none)');
  check('2PTN only the strong pocket shown', shownPockets(p).length === 1, `${shownPockets(p).length}`);
}

// AlphaFold model of haemoglobin beta: the heme pocket, no ligands in a predicted model
{
  const af = await (await fetch('https://alphafold.ebi.ac.uk/files/AF-P68871-F1-model_v6.pdb')).text();
  const p = await loadPockets('AF-P68871-F1', af, new AbortController().signal);
  console.log(`  AF-P68871-F1 (${p.model}):\n    ${summary(p)}`);
  check('AF model uses the AlphaFold database', p.url.includes('database=v4-alphafold'), p.url);
  // UniProt numbering counts the initiator Met: the textbook distal His63 / proximal His92 are His64 / His93 here
  check('AF heme pocket has distal His64 and proximal His93', p.pockets[0].residues.some(r => r.resi === 64 && r.aa === 'H') && p.pockets[0].residues.some(r => r.resi === 93 && r.aa === 'H'),
    p.pockets[0].residues.map(r => residueLabel(r)).join(' '));
  check('AF model: no ligands', p.pockets.every(q => q.ligands.length === 0));
  check('AF facts keyed by accession', pocketFactsLine('AF-P68871-F1')?.startsWith('Predicted ligand-binding pockets') === true);
  check('PDB facts not mixed with AF facts', cachedPockets('4HHB') === null && pocketFactsLine('4HHB') === null);
}

// 1TUP: p53 core domains on DNA (DNA chains E/F carry label asym IDs A/B in mmCIF)
{
  const p = await loadPockets('1TUP', await pdb('1TUP'), new AbortController().signal);
  console.log(`  1TUP (${p.model}):\n    ${summary(p)}`);
  check('1TUP pockets only on protein chains A-C', p.pockets.every(q => q.residues.every(r => ['A', 'B', 'C'].includes(r.chain))));
}

check('no unhandled rejections', unhandled === 0, String(unhandled));
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
