// Live test of services/partnerService.ts against STRING, UniProt, RCSB search/GraphQL and PDBe SIFTS.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

const { findPartners, complexInterface, partnerFactsLine, PartnerError } = await import(`${ROOT_URL}services/partnerService.ts`);
const { getStructureFacts } = await import(`${ROOT_URL}services/groundingService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; console.log('UNHANDLED', e); });
const show = (r) => r.partners.map(p => `${p.name}${p.accession ? `(${p.accession})` : '(?)'} ${p.score.toFixed(3)} [${p.evidence.join('/')}]${p.bestComplex ? ` PDB ${p.bestComplex}×${p.complexes}${p.bestComplexResolution ? ` ${p.bestComplexResolution}Å` : ''}` : p.complexes === 0 ? ' no complex' : ''}`).join('\n    ');
const q = (accession, label, keys = [], chainsHere = {}) => ({ accession, label, structureKeys: keys, chainsHere });

// TP53
{
  const statuses = [];
  const t0 = Date.now();
  const r = await findPartners(q('P04637', 'P53_HUMAN', ['1TUP']), s => statuses.push(s));
  console.log(`  TP53 (${Date.now() - t0} ms, ${r.partners.length} partners, taxon ${r.taxId}):\n    ${show(r)}`);
  check('TP53 named by STRING', r.name === 'TP53', r.name);
  check('human taxon', r.taxId === 9606);
  check('5-10 partners', r.partners.length >= 5 && r.partners.length <= 10, String(r.partners.length));
  check('scores sorted, within 0.4-1', r.partners.every((p, i, a) => p.score >= 0.4 && p.score <= 1 && (i === 0 || a[i - 1].score >= p.score)));
  check('every partner mapped to UniProt', r.partners.every(p => /^[A-Z0-9]{6,10}$/.test(p.accession ?? '')), r.partners.filter(p => !p.accession).map(p => p.name).join(','));
  check('evidence labels present', r.partners.every(p => p.evidence.length >= 1));
  check('at least one solved complex with a title', r.partners.some(p => p.bestComplex && p.bestComplexTitle));
  check('status messages in order', statuses[0]?.startsWith('Asking STRING') && statuses.some(s => s.startsWith('Looking for solved complexes')), statuses.join(' > '));
  check('STRING link', r.stringUrl.startsWith('https://string-db.org/network/9606.'), r.stringUrl);
  const again = await findPartners(q('P04637', 'P53_HUMAN', ['AF-P04637-F1']));
  check('second search served from memory', again.partners === r.partners);
  const facts = partnerFactsLine('1tup');
  console.log('  facts:', facts);
  check('facts line short, names TP53 and a PDB complex', facts.startsWith('Interaction partners of TP53') && /PDB \w{4}/.test(facts) && facts.length <= 380, `${facts.length} chars`);
  check('facts stored under every structure key', partnerFactsLine('AF-P04637-F1') !== null && partnerFactsLine('4HHB') === null);
  const all = await getStructureFacts('1TUP', 'Does R175H change the interaction with MDM2?', 15000);
  const lines = all.split('\n');
  const hintAt = lines.findIndex(l => l.startsWith('Residues named in the question'));
  const partnersAt = lines.findIndex(l => l.startsWith('Interaction partners'));
  check('grounding facts: question hint before the partner line', hintAt >= 0 && partnersAt > hintAt, `hint line ${hintAt}, partners line ${partnersAt}`);
}

// Haemoglobin beta: HBA1 and HBA2 encode the same protein -> one row
{
  const r = await findPartners(q('P68871', 'HBB_HUMAN', ['4HHB'], { P69905: ['A', 'C'], P68871: ['B', 'D'] }));
  console.log(`  HBB:\n    ${show(r)}`);
  const alpha = r.partners.filter(p => p.accession === 'P69905');
  check('HBA1/HBA2 merged into one row', alpha.length === 1 && /HBA1/.test(alpha[0].name) && /HBA2/.test(alpha[0].name), alpha.map(p => p.name).join(' | '));
  check('alpha-beta complexes counted (>100), best one named', alpha[0]?.complexes > 100 && /^\w{4}$/.test(alpha[0]?.bestComplex ?? ''), `${alpha[0]?.complexes} ${alpha[0]?.bestComplex}`);
  check('chains in the searched entry kept on the query', r.query.chainsHere.P69905?.join(',') === 'A,C');
}

// Chicken lysozyme (non-human; gene-name fallback where UniProt lacks the STRING cross-reference)
{
  const r = await findPartners(q('P00698', 'LYSC_CHICK'));
  console.log(`  LYSC_CHICK (taxon ${r.taxId}):\n    ${show(r)}`);
  check('chicken taxon', r.taxId === 9031);
  check('partners found', r.partners.length > 0);
}

// E. coli DHFR
{
  const r = await findPartners(q('P0ABQ4', 'DYR_ECOLI'));
  console.log(`  DYR_ECOLI:\n    ${show(r)}`);
  const thyA = r.partners.find(p => p.name === 'thyA');
  check('thyA mapped to P0A884', thyA?.accession === 'P0A884', thyA?.accession);
}

// HIV-1 Gag-Pol: STRING has no viral proteins
{
  try { await findPartners(q('P03367', 'POL_HV1BR')); check('HIV rejects', false); }
  catch (e) { check('HIV protein -> PartnerError naming the reason', e instanceof PartnerError && /viruses/.test(e.message), e.message); }
}

// Interfaces
{
  const p53mdm2 = await complexInterface('1YCR', { accession: 'P04637', name: 'TP53' }, { accession: 'Q00987', name: 'MDM2' });
  console.log('  1YCR interface:', JSON.stringify(p53mdm2));
  const p53 = p53mdm2.find(h => h.label.startsWith('TP53'));
  check('1YCR: p53 side has the Phe19/Trp23/Leu26 triad', p53 && [19, 23, 26].every(n => p53.resi.includes(n)), p53?.resi.join(','));
  check('1YCR: MDM2 side non-empty, other chain', p53mdm2.length === 2 && p53mdm2[0].chain !== p53mdm2[1].chain && p53mdm2[1].resi.length > 5);
  const hb = await complexInterface('4HHB', { accession: 'P68871', name: 'HBB' }, { accession: 'P69905', name: 'HBA1/HBA2' });
  console.log('  4HHB interface chains:', hb.map(h => `${h.chain}:${h.resi.length}`).join(' '));
  check('4HHB: beta chain (B/D) against an alpha chain (A/C)', hb.length === 2 && ['B', 'D'].includes(hb[0].chain) && ['A', 'C'].includes(hb[1].chain));
  check('interface capped at 40 residues per side', hb.every(h => h.resi.length <= 40));
  const none = await complexInterface('1YCR', { accession: 'P04637', name: 'TP53' }, { accession: 'P69905', name: 'HBA' });
  check('protein absent from the entry -> no highlights', none.length === 0);
}

check('no unhandled rejections', unhandled === 0, String(unhandled));
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
