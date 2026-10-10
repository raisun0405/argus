// Tests for comparing two co-folded molecules (services/cofoldService.ts): the combined complex,
// shared and unique contacts, the interaction fingerprint, the affinity gap and its tenfold rule,
// the written comparison, the chat command. Offline: the server and RCSB are answered from fixtures.
import '../lib/ts-hooks.mjs';
import { FIXTURES, ROOT_URL } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';

const FX = FIXTURES;
const read = (f) => readFileSync(`${FX}/${f}`, 'utf8');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
process.on('unhandledRejection', (e) => { failures++; console.log('UNHANDLED', e); });

const serverPdb = read('cofold-3PTB-server.pdb');
// The same prediction with its molecule moved: a second molecule in the same site, or far away
const shifted = (dx, resn = 'LIG') => serverPdb.split('\n').map((l) => {
  if (!(l.startsWith('HETATM') && l[21] === 'L')) return l;
  const x = parseFloat(l.slice(30, 38)) + dx;
  return `${l.slice(0, 17)}${resn.padStart(3)}${l.slice(20, 30)}${x.toFixed(3).padStart(8)}${l.slice(38)}`;
}).join('\n');
const server = (pdb, resn, log10Ic50, iptm) => ({
  pdb, chains: [{ id: 'A', length: 223 }], ligand: { chain: 'L', resn }, cofactors: [{ chain: 'X', resn: 'CA' }],
  scores: { confidence: 0.98, ptm: 0.99, iptm, ligandIptm: iptm, proteinIptm: 0, plddt: 0.98, iplddt: 0.98, pde: 0.3, ipde: 0.3 },
  affinity: { log10Ic50, binderProbability: 0.8 }, template: '3PTB', seconds: 12,
});
const ANSWERS = {
  BEN: server(serverPdb, 'BEN', 2.25, 0.99),
  'NC(=N)c1ccc(N)cc1': server(shifted(1.0), 'LIG', 0.9, 0.95), // Same site, 1 Å over, ~22x tighter
  'NC(=N)c1ccccc1C': server(shifted(0.6), 'LIG', 2.0, 0.5), // Same site, similar affinity, low confidence
  CCO: server(shifted(30), 'LIG', 3.5, 0.4), // Far from the protein
};
const posted = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('/api/cofold')) {
    const body = JSON.parse(String(init.body));
    posted.push(body);
    const answer = ANSWERS[body.ligand.smiles && !body.ligand.ccd ? body.ligand.smiles : body.ligand.ccd];
    return new Response(`   ${JSON.stringify(answer)}`, { status: 200 });
  }
  if (u === 'https://files.rcsb.org/download/3PTB.pdb') return new Response(read('3PTB.pdb'), { status: 200 });
  return new Response('offline', { status: 404 }); // RCSB chemistry, PubChem: names fall back offline
};

const S = await import(`${ROOT_URL}services/cofoldService.ts`);
const base = { source: { kind: 'pdb', pdbId: '3PTB', chains: ['A'] }, structureId: '3PTB', proteinName: 'Beta-trypsin', entryLigands: ['BEN', 'CA'], cofactors: ['CA'] };
const run = (ligandText) => S.runCofold({ ...base, ligandText }, () => {});

// ---------- the chat command ----------
{
  const p = S.parseCompareCommand;
  check('"cofold imatinib vs nilotinib"', JSON.stringify(p('cofold imatinib vs nilotinib')) === '["imatinib","nilotinib"]', JSON.stringify(p('cofold imatinib vs nilotinib')));
  check('"dock aspirin and ibuprofen into this protein"', JSON.stringify(p('dock aspirin and ibuprofen into this protein')) === '["aspirin","ibuprofen"]');
  check('"co-fold BEN versus CCO."', JSON.stringify(p('co-fold BEN versus CCO.')) === '["BEN","CCO"]');
  check('"cofold A against B"', JSON.stringify(p('Cofold caffeine against theophylline')) === '["caffeine","theophylline"]');
  check('one molecule is not a comparison', p('cofold aspirin') === null);
  check('the same molecule twice is not a comparison', p('cofold aspirin vs Aspirin') === null);
  check('"the drug vs aspirin" is left to the AI', p('cofold the drug vs aspirin') === null);
  check('a plain question is not hijacked ("compare hemoglobin and myoglobin")', p('compare hemoglobin and myoglobin') === null);
  check('single co-fold still parses', S.parseCofoldCommand('cofold aspirin') === 'aspirin');
}

// ---------- same site, ~22x apart ----------
const a = await run('BEN');
const b = await run('NC(=N)c1ccc(N)cc1');
const m = S.compareCofolds(a, b);
const c = m.compare;
{
  check('both requests sent with the same chains and cofactors', posted.length === 2 && JSON.stringify(posted[0].cofactors) === JSON.stringify(posted[1].cofactors) && JSON.stringify(posted[0].source) === JSON.stringify(posted[1].source));
  check('the comparison is a prediction of its own (new COFOLD id, kept in memory)', /^COFOLD-/.test(m.id) && m.id !== a.id && m.id !== b.id && S.getCofold(m.id) === m);
  check('asking again returns the same comparison', S.compareCofolds(a, b) === m);
  check('first molecule keeps its chain, second gets a free one', m.ligandChain === 'L' && c.chain && !['A', 'L', 'X', m.reference?.chain].includes(c.chain), `second on ${c.chain}, crystal on ${m.reference?.chain}`);
  const het = (pdb, chain) => pdb.split('\n').filter((l) => l.startsWith('HETATM') && l[21] === chain);
  check('second molecule copied whole', het(m.pdb, c.chain).length === het(b.pdb, 'L').length && het(m.pdb, c.chain).length === 9, `${het(m.pdb, c.chain).length} atoms`);
  const serials = m.pdb.split('\n').filter((l) => /^(ATOM|HETATM)/.test(l)).map((l) => l.slice(6, 11).trim());
  check('atom serials stay unique', new Set(serials).size === serials.length, `${serials.length} atoms`);
  check('the file ends once', (m.pdb.match(/^END$/gm) ?? []).length === 1);
  check('the crystal pose shown is the first molecule\'s (BEN in 3PTB)', c.reference === 'a' && m.reference?.from === '3PTB');
  check('the two molecules sit 1 Å apart', Math.abs(c.centroidDistance - 1.0) <= 0.05, `${c.centroidDistance} Å`);
  const all = c.shared.length + c.onlyA.length + c.onlyB.length;
  check('contacts split into shared and unique', c.shared.length > 0 && c.shared.length + c.onlyA.length === a.contacts.length && c.shared.length + c.onlyB.length === b.contacts.length, `${c.shared.length} shared, ${c.onlyA.length} + ${c.onlyB.length} unique`);
  check('overlap is shared over all', Math.abs(c.overlap - Math.round((c.shared.length / all) * 100) / 100) < 1e-9, `${c.overlap}`);
  check('same site', S.siteRelation(c) === 'same');
  const asp = c.fingerprint.find((f) => f.resn === 'ASP' && f.resi === 189);
  check('fingerprint: BEN salt-bridges Asp189', asp?.a.includes('salt_bridge'), JSON.stringify(asp));
  check('fingerprint: residues both use come first', c.fingerprint.length === 0 || (() => { const firstOnly = c.fingerprint.findIndex((f) => !(f.a.length && f.b.length)); return firstOnly === -1 || c.fingerprint.slice(firstOnly).every((f) => !(f.a.length && f.b.length)); })());
  check('fingerprint lists only specific interactions', c.fingerprint.every((f) => [...f.a, ...f.b].every((t) => ['hbond', 'salt_bridge', 'pi_stacking', 'pi_cation', 'halogen', 'metal'].includes(t))));

  const gap = S.affinityGap(a, b);
  check('affinity gap: the second binds ~22x tighter', gap?.tighter === 'b' && Math.abs(gap.fold - 10 ** 1.35) < 0.01 && S.foldText(gap.fold) === '22×', `${gap?.tighter} ${gap?.fold.toFixed(1)} ${S.foldText(gap?.fold ?? 0)}`);
  check('foldText rounds sensibly', S.foldText(8.3) === '8×' && S.foldText(180.4) === '180×' && S.foldText(1234) === '1200×');

  const an = S.compareAnalysis(m);
  check('analysis: an unnamed molecule goes by its SMILES, not "your molecule"', an.title === 'BEN vs NC(=N)c1ccc(N)cc1 · Beta-trypsin', an.title);
  check('analysis: same-site sentence', /bind the same site: \d+ of the \d+ residues/.test(an.summary));
  check('analysis: says which binds tighter, by how much, without starting a sentence with a SMILES', /By about 22×, NC\(=N\)c1ccc\(N\)cc1 is predicted to bind more tightly/.test(an.summary), an.summary.slice(0, 400));
  check('analysis: binder probabilities and the caveat', /Binder probability: 80% for BEN, 80% for NC\(=N\)c1ccc\(N\)cc1\./.test(an.summary) && an.summary.endsWith('These are predictions, not measurements.'));
  check('analysis: highlights both molecules and every residue holding either', an.highlights.filter((h) => h.category === 'ligand').map((h) => h.chain).join() === `L,${c.chain}` && an.highlights.filter((h) => h.category === 'binding_site').reduce((n, h) => n + h.resi.length, 0) === all);
  const facts = S.cofoldFactsLine(m.id, 900);
  check('chat facts mention the second molecule', /compared with NC\(=N\)c1ccc\(N\)cc1, chain [A-Z] residue 1 \(LIG\), ligand ipTM 0\.95, predicted IC50 ~/.test(facts ?? ''), facts?.slice(0, 300));
}

// ---------- order swapped: the crystal pose comes from the second ----------
{
  const swapped = S.compareCofolds(b, a);
  check('swapped order is a different comparison', swapped.id !== m.id);
  check('crystal pose of the second molecule, on a chain of its own', swapped.compare.reference === 'b' && swapped.reference?.chain && ![swapped.ligandChain, swapped.compare.chain, 'A', 'X'].includes(swapped.reference.chain), `${swapped.reference?.chain}`);
  const refAtoms = swapped.pdb.split('\n').filter((l) => l.startsWith('HETATM') && l[21] === swapped.reference.chain).length;
  check('crystal copy has its atoms', refAtoms === 9, `${refAtoms}`);
  check('gap is mirrored', S.affinityGap(b, a)?.tighter === 'a');
}

// ---------- similar affinity, low confidence ----------
{
  const low = await run('NC(=N)c1ccccc1C');
  const sim = S.compareCofolds(a, low);
  check('under tenfold apart: similar, no winner', S.affinityGap(a, low)?.tighter === null);
  const an = S.compareAnalysis(sim);
  check('analysis: "similar" with the tenfold reason', /affinities are similar .* closer than the tenfold error/.test(an.summary));
  check('analysis: flags the low-confidence pose', /The pose of NC\(=N\)c1ccccc1C is low-confidence \(ligand ipTM 0\.50\)/.test(an.summary), an.summary.slice(-300));
  check('SMILES keep their case mid-sentence', !/nC\(=N\)|cC\(=N\)/.test(an.summary));
}

// ---------- different places ----------
{
  const far = await run('CCO');
  const apart = S.compareCofolds(a, far);
  check('30 Å apart, nothing shared: different sites', S.siteRelation(apart.compare) === 'different' && apart.compare.shared.length === 0 && apart.compare.centroidDistance > 25, `${apart.compare.centroidDistance} Å`);
  check('analysis: says the affinities are not like for like', /different places on the protein, [\d.]+ Å apart, so their affinities are not a like-for-like comparison/.test(S.compareAnalysis(apart).summary));
}

// ---------- names that would collide ----------
{
  const one = await run('NC(=N)c1ccc(N)cc1');
  const twin = S.compareCofolds({ ...one, id: 'COFOLD-TWIN001' }, { ...one, id: 'COFOLD-TWIN002', ligand: { ...one.ligand } });
  check('identical names get (first) / (second)', twin.ligand.name.endsWith('(first)') && twin.compare.other.ligand.name.endsWith('(second)'), `${twin.ligand.name} | ${twin.compare.other.ligand.name}`);
  const longSmiles = 'CC(C)Cc1ccc(cc1)C(C)C(O)=O';
  const named = S.compareCofolds(a, { ...one, id: 'COFOLD-LONG001', ligand: { ...one.ligand, smiles: longSmiles } });
  check('a long SMILES is shortened with an ellipsis', named.compare.other.ligand.name === `${longSmiles.slice(0, 16)}…`, named.compare.other.ligand.name);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
