// Tests for Boltz-2 co-folding: services/mmcif.ts, api/cofold.ts (upstreams mocked: no NVIDIA credits),
// and services/cofoldService.ts (setup, placement, descriptions; live RCSB/PubChem lookups for ligands).
import '../lib/ts-hooks.mjs';
import { FIXTURES, ROOT_URL } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';

const FX = FIXTURES;
const read = (f) => readFileSync(`${FX}/${f}`, 'utf8');
const { chainTemplates, observedResidues, parseAtomSite } = await import(`${ROOT_URL}services/mmcif.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
process.on('unhandledRejection', (e) => { failures++; console.log('UNHANDLED', e); });

// ---------- mmcif.ts ----------
{
  const cif = read('1HSG.cif');
  const t = chainTemplates(cif, ['A', 'B', 'Z']);
  const a = t.get('A');
  check('chainTemplates: one template per existing chain', t.size === 2 && !t.has('Z'), [...t.keys()].join(','));
  const atomsA = parseAtomSite(a);
  check('chain A template holds only chain A polymer atoms', atomsA.length > 700 && atomsA.every(x => x.authAsym === 'A' && !x.het), `${atomsA.length} atoms`);
  check('template keeps entity sequence categories', a.includes('_entity_poly_seq.') && a.includes('_struct_asym.') && a.includes('_entity_poly.'));
  check('template has no water or ligand rows', !/^HETATM/m.test(a));
  const obs = observedResidues(cif);
  check('observedResidues: 1HSG A has 99 residues', obs.get('A')?.size === 99, `${obs.get('A')?.size}`);
  check('observedResidues ignores ligand MK1 and waters', !obs.has('C') || [...(obs.get('A') ?? [])].every(k => /^\d+$/.test(k)));

  const cif3 = read('3PTB.cif');
  const obs3 = observedResidues(cif3);
  const icodes = [...(obs3.get('A') ?? [])].filter(k => /[A-Z]$/.test(k));
  check('observedResidues keeps insertion codes (3PTB 184A, 188A, 221A)', ['184A', '188A', '221A'].every(k => icodes.includes(k)), icodes.join(','));
  const t3 = chainTemplates(cif3, ['A']).get('A');
  check('3PTB template drops anisotropic B-factors if any', !t3.includes('_atom_site_anisotrop.'));
  check('3PTB template has no calcium or benzamidine rows', !/^HETATM/m.test(t3));
}

// ---------- api/cofold.ts (fetch mocked) ----------
const realFetch = globalThis.fetch;
const calls = [];
let boltzScript = []; // Queue of responses for NVIDIA calls: functions (body) -> Response
const boltzOutput = read('boltz-1hsg-output.cif');
const boltzJson = (extra = {}) => ({
  structures: [{ format: 'mmcif', structure: boltzOutput }],
  confidence_scores: [0.97], ptm_scores: [0.98], iptm_scores: [0.979], ligand_iptm_scores: [0.979], protein_iptm_scores: [0.979],
  complex_plddt_scores: [0.971], complex_iplddt_scores: [0.964], complex_pde_scores: [0.316], complex_ipde_scores: [0.413],
  affinities: { L: { affinity_pred_value: [-1.695], affinity_probability_binary: [0.92], affinity_pic50: [10.5] } }, metrics: {}, ...extra,
});
const SEQ = 'PQITLWQRPLVTIKIGGQLKEALLDTGADDTVLEEMSLPGRWKPKMIGGIGGFIKVRQYDQILIEICGHKAIGTVLVGPTPVNIIGRNLLTQIGCTLNF';
let mappingA = SEQ.split('').map((_, i) => String(i + 1));
const graphql = () => ({ data: { entry: { polymer_entities: [{
  entity_poly: { rcsb_entity_polymer_type: 'Protein', pdbx_seq_one_letter_code_can: SEQ },
  polymer_entity_instances: [
    { rcsb_polymer_entity_instance_container_identifiers: { auth_asym_id: 'A', auth_to_entity_poly_seq_mapping: mappingA } },
    { rcsb_polymer_entity_instance_container_identifiers: { auth_asym_id: 'B', auth_to_entity_poly_seq_mapping: SEQ.split('').map((_, i) => String(i + 1)) } },
  ] }] } } });
let cifForEntry = read('1HSG.cif');
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, body: init.body ? String(init.body) : '' });
  if (u === 'https://data.rcsb.org/graphql') return new Response(JSON.stringify(graphql()), { status: 200 });
  if (u.startsWith('https://files.rcsb.org/download/')) return new Response(cifForEntry, { status: 200 });
  if (u.startsWith('https://health.api.nvidia.com/')) {
    const next = boltzScript.shift();
    if (!next) return new Response(JSON.stringify(boltzJson()), { status: 200 });
    return next(init.body ? JSON.parse(init.body) : null, u);
  }
  return new Response('not mocked', { status: 500 });
};

process.env.NVIDIA_NIM_KEY = 'test-key';
const { default: handler } = await import(`${ROOT_URL}api/cofold.ts`);
const ORIGIN = 'https://argus.example';
const post = (body, ip = '1.1.1.1', origin = ORIGIN) => handler(new Request('https://argus.example/api/cofold', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'x-real-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
}));
const readAll = async (response) => {
  const text = await response.text();
  return { text, json: JSON.parse(text) };
};
const okBody = { source: { kind: 'pdb', pdbId: '1hsg', chains: ['A', 'B'] }, ligand: { ccd: 'MK1', smiles: 'CC(C)(C)NC(=O)C1CN(CCN1)C' }, cofactors: [] };

{
  const r = await handler(new Request('https://argus.example/api/cofold'));
  check('GET reports availability', (await r.json()).available === true);
  delete process.env.NVIDIA_NIM_KEY;
  const r2 = await handler(new Request('https://argus.example/api/cofold'));
  check('GET without key: unavailable', (await r2.json()).available === false);
  const r3 = await post(okBody, '9.9.9.1');
  check('POST without key: 503', r3.status === 503, String(r3.status));
  process.env.NVIDIA_NIM_KEY = 'test-key';
}
{
  check('foreign origin: 403', (await post(okBody, '9.9.9.2', 'https://evil.example')).status === 403);
  check('bad JSON: 400', (await post('{nope', '9.9.9.3')).status === 400);
  const bad = [
    [{ ...okBody, source: { kind: 'pdb', pdbId: 'XXXXX', chains: ['A'] } }, 'Invalid PDB ID'],
    [{ ...okBody, source: { kind: 'pdb', pdbId: '1HSG', chains: [] } }, 'Pick 1 to'],
    [{ ...okBody, ligand: {} }, 'Missing ligand'],
    [{ ...okBody, ligand: { smiles: 'CC O' } }, 'Invalid SMILES'],
    [{ ...okBody, ligand: { ccd: 'TOOLONG' } }, 'Invalid ligand code'],
    [{ ...okBody, source: { kind: 'sequence', sequence: 'ACDB' } }, 'standard amino acids'],
    [{ ...okBody, source: { kind: 'alphafold', accession: 'x' } }, 'Invalid UniProt'],
  ];
  for (const [body, expected] of bad) {
    const r = await post(body, '9.9.9.4');
    const j = await r.json();
    check(`validation: ${expected}`, r.status === 400 && j.error.includes(expected), `${r.status} ${j.error}`);
  }
}
{
  // Full flow with renumbering (chain A numbered 101..199 with an insertion code) and streaming
  mappingA = SEQ.split('').map((_, i) => (i === 49 ? '149A' : String(i + 101)));
  calls.length = 0;
  const r = await post(okBody, '2.2.2.2');
  const { text, json } = await readAll(r);
  check('streamed answer starts with keepalive whitespace', r.status === 200 && text.startsWith(' '), JSON.stringify(text.slice(0, 3)));
  check('answer has a PDB, scores and affinity', typeof json.pdb === 'string' && json.scores.ligandIptm > 0.9 && json.affinity?.log10Ic50 === -1.695, JSON.stringify(json.scores).slice(0, 80));
  const nv = calls.find(c => c.url.startsWith('https://health.api.nvidia.com/'));
  const sent = JSON.parse(nv.body);
  check('NVIDIA request: chains A and B with mmCIF templates', sent.polymers.length === 2 && sent.polymers.every(p => p.structural_templates?.[0]?.format === 'cif' && p.structural_templates[0].structure.includes('_atom_site.')), sent.polymers.map(p => p.id).join(','));
  check('NVIDIA request: ligand by CCD with affinity, chain L', sent.ligands[0].ccd === 'MK1' && sent.ligands[0].predict_affinity === true && sent.ligands[0].id === 'L' && !sent.ligands[0].smiles);
  check('NVIDIA request: Boltz default sampling (200 steps)', sent.sampling_steps === 200 && sent.recycling_steps === 3 && sent.output_format === 'mmcif');
  check('template name is clean', /^[A-Za-z0-9_-]{1,64}$/.test(sent.polymers[0].structural_templates[0].name), sent.polymers[0].structural_templates[0].name);
  const lines = json.pdb.split('\n');
  const caA = lines.filter(l => l.startsWith('ATOM') && l.slice(12, 16) === ' CA ' && l[21] === 'A');
  const first = caA[0], icode = caA.find(l => l.slice(22, 27) === ' 149A');
  check('chain A renumbered to the entry numbering (101...)', first.slice(22, 26).trim() === '101' && caA.length === 99, first.slice(17, 27));
  check('insertion code carried into the PDB (149A)', Boolean(icode), icode?.slice(17, 27));
  const lig = lines.filter(l => l.startsWith('HETATM'));
  check('ligand HETATM: resn MK1, chain L, residue 1', lig.length === 45 && lig.every(l => l.slice(17, 20) === 'MK1' && l[21] === 'L' && l.slice(22, 26).trim() === '1'), lig[0]);
  check('PDB has TER per chain and END', lines.filter(l => l === 'TER').length === 2 && lines.includes('END'));
  check('B-factor carries pLDDT', parseFloat(first.slice(60, 66)) > 50, first.slice(60, 66));
  check('template reported', json.template === '1HSG');
  check('record columns line up (x at 31-38)', Math.abs(parseFloat(first.slice(30, 38))) < 1000 && first.length >= 78, String(first.length));

  // Cache: the same request again doesn't call NVIDIA
  const before = calls.filter(c => c.url.startsWith('https://health.api.nvidia.com/')).length;
  const again = await post(okBody, '2.2.2.2');
  const j2 = await again.json();
  const after = calls.filter(c => c.url.startsWith('https://health.api.nvidia.com/')).length;
  check('repeat request served from cache', after === before && j2.pdb === json.pdb);
}
{
  // Observed span: chain B without residues 1-3 and 97-99 in the file -> sequence cut to 4..96
  mappingA = SEQ.split('').map((_, i) => String(i + 1));
  const full = read('1HSG.cif');
  cifForEntry = full.split('\n').filter(l => {
    if (!l.startsWith('ATOM')) return true;
    const f = l.split(/\s+/);
    // auth_asym_id and auth_seq_id columns in RCSB files: find by header order
    return true;
  }).join('\n');
  // Remove chain B residues 1-3 and 97-99 by matching the PDB-like columns of RCSB's atom_site rows
  const header = full.split('\n').filter(l => l.startsWith('_atom_site.')).map(l => l.trim());
  const ci = header.indexOf('_atom_site.auth_asym_id'), si = header.indexOf('_atom_site.auth_seq_id');
  cifForEntry = full.split('\n').filter(l => {
    if (!l.startsWith('ATOM')) return true;
    const f = l.trim().split(/\s+/);
    const n = Number(f[si]);
    return !(f[ci] === 'B' && (n <= 3 || n >= 97));
  }).join('\n');
  calls.length = 0;
  const r = await post({ ...okBody, ligand: { smiles: 'CC(=O)Oc1ccccc1C(=O)O' } }, '3.3.3.3');
  const { json } = await readAll(r);
  const sent = JSON.parse(calls.find(c => c.url.startsWith('https://health.api.nvidia.com/')).body);
  const b = sent.polymers.find(p => p.id === 'B');
  check('unmodelled ends trimmed (chain B 4..96 = 93 residues)', b.sequence.length === 93 && b.sequence === SEQ.slice(3, 96), `${b.sequence.length}`);
  check('chain A untouched (99)', sent.polymers.find(p => p.id === 'A').sequence.length === 99);
  check('SMILES ligand sent as smiles, residue LIG', sent.ligands[0].smiles && !sent.ligands[0].ccd && json.ligand.resn === 'LIG', JSON.stringify(json.ligand));
  cifForEntry = full;
}
{
  // Pocket steering: author numbering -> Boltz's 1-based sequence positions
  mappingA = SEQ.split('').map((_, i) => (i === 49 ? '149A' : String(i + 101)));
  calls.length = 0;
  const pocket = [{ chain: 'A', resi: 125, icode: '' }, { chain: 'A', resi: 149, icode: 'A' }, { chain: 'B', resi: 25, icode: '' }, { chain: 'A', resi: 125, icode: '' }];
  const r = await post({ ...okBody, ligand: { ccd: 'ATP' }, pocket }, 'p.1.1.1');
  const { json } = await readAll(r);
  const sent = JSON.parse(calls.find(c => c.url.startsWith('https://health.api.nvidia.com/')).body);
  const constraint = sent.constraints?.[0];
  check('pocket sent as one constraint bound to the ligand chain', constraint?.constraint_type === 'pocket' && constraint.binder === 'L', JSON.stringify(sent.constraints));
  check('author numbers -> 1-based sequence positions, duplicates dropped', JSON.stringify(constraint?.contacts) === JSON.stringify([{ id: 'A', residue_index: 25 }, { id: 'A', residue_index: 50 }, { id: 'B', residue_index: 25 }]), JSON.stringify(constraint?.contacts));
  check('answer reports the pocket residues used', json.pocketResidues === 3, String(json.pocketResidues));

  const outside = await post({ ...okBody, source: { kind: 'pdb', pdbId: '1HSG', chains: ['A'] }, ligand: { ccd: 'ATP' }, pocket: [{ chain: 'B', resi: 25, icode: '' }] }, 'p.1.1.2');
  const j2 = (await readAll(outside)).json;
  check("pocket outside the chosen chains -> clear 400", j2.status === 400 && /isn't in the chains being predicted/.test(j2.error), j2.error);

  const bad = await post({ ...okBody, pocket: [{ chain: 'A', resi: 1.5, icode: '' }] }, 'p.1.1.3');
  check('non-integer pocket residue rejected', bad.status === 400 && /Invalid pocket residue/.test((await bad.json()).error));
  const many = await post({ ...okBody, pocket: Array.from({ length: 61 }, (_, i) => ({ chain: 'A', resi: i + 1, icode: '' })) }, 'p.1.1.4');
  check('over-long pocket rejected', many.status === 400 && /up to 60 residues/.test((await many.json()).error));

  // The pocket is the last thing dropped when Boltz-2 can't read the input
  const unreadable = () => new Response(JSON.stringify({ error: 'Failed to parse input response' }), { status: 422 });
  boltzScript = [unreadable, unreadable, unreadable, (b) => new Response(JSON.stringify(boltzJson()), { status: 200 })];
  calls.length = 0;
  const r3 = await post({ ...okBody, ligand: { ccd: 'GTP' }, cofactors: ['ZN'], pocket: [{ chain: 'A', resi: 125, icode: '' }, { chain: 'A', resi: 126, icode: '' }] }, 'p.1.1.5');
  const j3 = (await readAll(r3)).json;
  const nv = calls.filter(c => c.url.startsWith('https://health.api.nvidia.com/')).map(c => JSON.parse(c.body));
  check('ladder keeps the pocket until the last step', nv.length === 4 && nv.slice(0, 3).every(b => b.constraints?.length === 1) && !nv[3].constraints, nv.map(b => (b.constraints ? 'pocket' : 'none')).join(','));
  check('pocket dropped -> pocketResidues 0, prediction still returned', j3.pocketResidues === 0 && typeof j3.pdb === 'string', JSON.stringify(j3).slice(0, 80));
  boltzScript = [];
  mappingA = SEQ.split('').map((_, i) => String(i + 1));
}
{
  // Unreadable input: CCD -> SMILES -> no templates -> no cofactors, then a clear error
  const unreadable = () => new Response(JSON.stringify({ error: 'Error processing request: RuntimeError: Prediction failed: Failed to parse input response' }), { status: 422 });
  boltzScript = [unreadable, (body) => new Response(JSON.stringify(boltzJson()), { status: 200 })];
  calls.length = 0;
  const r = await post({ ...okBody, cofactors: ['ZN'] }, '4.4.4.4');
  const { json } = await readAll(r);
  const nv = calls.filter(c => c.url.startsWith('https://health.api.nvidia.com/')).map(c => JSON.parse(c.body));
  check('422 -> retried with SMILES instead of the PDB code', nv.length === 2 && nv[0].ligands[0].ccd === 'MK1' && nv[1].ligands[0].smiles && !nv[1].ligands[0].ccd, nv.map(b => JSON.stringify(b.ligands[0]).slice(0, 40)).join(' | '));
  check('retry kept templates and cofactor', nv[1].polymers[0].structural_templates && nv[1].ligands.length === 2 && nv[1].ligands[1].ccd === 'ZN' && nv[1].ligands[1].id === 'X');
  check('answer after fallback: LIG, template kept, cofactor kept', json.ligand.resn === 'LIG' && json.template === '1HSG' && json.cofactors.length === 1, JSON.stringify(json.cofactors));

  boltzScript = [unreadable, unreadable, unreadable, unreadable, unreadable];
  calls.length = 0;
  const r2 = await post({ ...okBody, ligand: { ccd: 'MK1', smiles: 'CCN' }, cofactors: ['ZN'] }, '5.5.5.5');
  const j2 = (await readAll(r2)).json;
  const nv2 = calls.filter(c => c.url.startsWith('https://health.api.nvidia.com/')).map(c => JSON.parse(c.body));
  check('ladder: 4 attempts (code, SMILES, no templates, no cofactors)', nv2.length === 4 && !nv2[2].polymers[0].structural_templates && nv2[3].ligands.length === 1, `${nv2.length} attempts`);
  check('ladder exhausted: clear molecule error with status 400', j2.status === 400 && /couldn't read this molecule/.test(j2.error), j2.error);
  boltzScript = [];
}
{
  // 202 queued -> status polling
  boltzScript = [
    () => new Response('', { status: 202, headers: { 'nvcf-reqid': 'req-123' } }),
    (_b, url) => (url.includes('/v1/status/req-123') ? new Response(JSON.stringify(boltzJson()), { status: 200 }) : new Response('wrong url', { status: 500 })),
  ];
  const t0 = Date.now();
  const r = await post({ ...okBody, ligand: { ccd: 'ATP' } }, '6.6.6.6');
  const { json } = await readAll(r);
  check('202 + NVCF request ID: polled the status URL', Boolean(json.pdb) && Date.now() - t0 >= 3500, `${Date.now() - t0} ms ${json.error ?? ''}`);
  boltzScript = [];
}
{
  // Upstream errors map to clean messages
  boltzScript = [() => new Response('{"detail":"Unauthorized"}', { status: 401 })];
  const j = (await readAll(await post({ ...okBody, ligand: { ccd: 'ADP' } }, '7.7.7.7'))).json;
  check('401 -> key rejected message (no upstream detail)', /rejected this server's key/.test(j.error) && !j.error.includes('Unauthorized'), j.error);
  boltzScript = [() => new Response('quota', { status: 429 })];
  const j2 = (await readAll(await post({ ...okBody, ligand: { ccd: 'GDP' } }, '7.7.7.8'))).json;
  check('429 upstream -> busy/credits message', /busy or out of credits/.test(j2.error), j2.error);
  boltzScript = [() => new Response('oops', { status: 500 })];
  const j3 = (await readAll(await post({ ...okBody, ligand: { ccd: 'GTP' } }, '7.7.7.9'))).json;
  check('500 upstream -> try again message', /had a problem \(500\)/.test(j3.error), j3.error);
  boltzScript = [];
}
{
  // Rate limit: 12 predictions per 10 minutes per visitor (six comparisons); a rejected input is given back
  const ip = '8.8.8.8';
  const statuses = [];
  for (const code of Array.from({ length: 13 }, (_, i) => 'A' + String.fromCharCode(65 + i) + '1')) {
    const r = await post({ ...okBody, ligand: { ccd: code } }, ip);
    statuses.push(r.status);
    await r.text();
  }
  check('12 predictions in 10 min go through, the 13th: 429 with Retry-After', statuses.slice(0, 12).every(s => s === 200) && statuses[12] === 429, statuses.join(','));
  const ip2 = '8.8.8.9';
  boltzScript = [];
  // An entry without that chain: rejected before Boltz-2, and the run is given back
  for (let i = 0; i < 13; i++) await (await post({ ...okBody, source: { kind: 'pdb', pdbId: '1HSG', chains: ['Q'] }, ligand: { ccd: `B${String.fromCharCode(65 + i)}1` } }, ip2)).text();
  const r = await post({ ...okBody, ligand: { ccd: 'CC1' } }, ip2);
  check('rejected inputs do not use up the quota', r.status === 200, String(r.status));
  await r.text();
}
globalThis.fetch = realFetch;

// ---------- cofoldService.ts ----------
const svc = await import(`${ROOT_URL}services/cofoldService.ts`);
{
  const yes = ['CCO', 'CC(=O)Oc1ccccc1C(=O)O', 'c1ccccc1', '[Zn+2]', 'C1CC1', 'NC(=N)c1ccccc1', 'O=C(O)C%10CC%10', 'Clc1ccccc1Br'];
  const no = ['aspirin', 'imatinib', '5-fluorouracil', 'caffeine', 'ATP synthase', 'benzene', '(C)C', 'C(C', 'C)C', ''];
  check('looksLikeSmiles accepts SMILES', yes.every(s => svc.looksLikeSmiles(s)), yes.filter(s => !svc.looksLikeSmiles(s)).join(' '));
  check('looksLikeSmiles rejects names and broken strings', no.every(s => !svc.looksLikeSmiles(s)), no.filter(s => svc.looksLikeSmiles(s)).join(' '));
  const cmds = [['cofold aspirin', 'aspirin'], ['co-fold ATP.', 'ATP'], ['dock imatinib into this structure', 'imatinib'], ['Please cofold CCO', 'CCO'],
    ['dock aspirin into COX-2', null], ['dock this protein', null], ['co-fold the drug', null], ['fold MKV...', null], ['what is cofold?', null], ['dock acetaminophen', 'acetaminophen']];
  for (const [text, expected] of cmds) check(`parseCofoldCommand("${text}")`, svc.parseCofoldCommand(text) === expected, String(svc.parseCofoldCommand(text)));
  check('formatIc50', svc.formatIc50(-1.695) === '20 nM' && svc.formatIc50(2.25) === '180 µM' && svc.formatIc50(-4.2) === '63 pM' && svc.formatIc50(3.5) === '3.2 mM',
    [-1.695, 2.25, -4.2, 3.5].map(svc.formatIc50).join(', '));
  check('poseConfidence bands', svc.poseConfidence({ ligandIptm: 0.85 }) === 'high' && svc.poseConfidence({ ligandIptm: 0.7 }) === 'medium' && svc.poseConfidence({ ligandIptm: 0.3 }) === 'low' && svc.poseConfidence({ ligandIptm: null, iptm: null }) === null);
  check('isCofoldId / cofoldSourceKind', svc.isCofoldId('COFOLD-1ABC234') && !svc.isCofoldId('1HSG') && svc.cofoldSourceKind('1hsg') === 'pdb' && svc.cofoldSourceKind('AF-P69905-F1') === 'alphafold' && svc.cofoldSourceKind('ESM-ABCDEF1') === 'sequence' && svc.cofoldSourceKind('COFOLD-1ABC234') === null);
}
{
  const s1 = svc.cofoldSetup(read('1HSG.pdb'));
  check('1HSG setup: chains A, B both by default (198 residues)', s1.defaultChains.join() === 'A,B' && s1.chains.length === 2, JSON.stringify(s1.chains));
  check('1HSG setup: chain names from COMPND', s1.chains[0].name === 'HIV-1 protease', s1.chains[0].name);
  const mk1 = s1.ligands.find(l => l.code === 'MK1');
  check('1HSG setup: MK1 offered, touching A and B; no water', Boolean(mk1) && mk1.chains.join() === 'A,B' && !s1.ligands.some(l => l.code === 'HOH'), JSON.stringify(s1.ligands.map(l => [l.code, l.chains.join('')])));
  const s4 = svc.cofoldSetup(read('4HHB.pdb'));
  const hem = s4.cofactors.filter(c => c.code === 'HEM');
  check('4HHB setup: four heme copies keepable, one per chain', hem.length === 4 && hem.every(h => h.chains.length >= 1), JSON.stringify(hem.map(h => h.chains.join(''))));
  check('4HHB setup: phosphate not a cofactor, all 4 chains default (574 res)', !s4.cofactors.some(c => c.code === 'PO4') && s4.defaultChains.length === 4, s4.defaultChains.join(','));
  check('keptCofactors for chains A,B -> 2 hemes (not the ligand itself)', svc.keptCofactors(s4, ['A', 'B']).length === 2 && svc.keptCofactors(s4, ['A'], 'HEM').length === 0);
  check('cofoldProteinName: "Hemoglobin" for alpha and beta chains', svc.cofoldProteinName(s4, ['A', 'B']) === 'Hemoglobin', svc.cofoldProteinName(s4, ['A', 'B']));
  const s3 = svc.cofoldSetup(read('3PTB.pdb'));
  check('3PTB setup: BEN offered, calcium keepable, not offered', s3.ligands.some(l => l.code === 'BEN') && !s3.ligands.some(l => l.code === 'CA') && s3.cofactors.some(c => c.code === 'CA'), JSON.stringify(s3.ligands.map(l => l.code)) + JSON.stringify(s3.cofactors.map(c => c.code)));
  // Sites to steer into: the structure's own ligand sites, plus Pocket Radar's pockets when it has run
  const mk1Site = s1.sites.find(s => s.id.startsWith('ligand:'));
  check('1HSG sites: where MK1 binds, spanning both chains', mk1Site?.label === 'Where MK1 binds' && new Set(mk1Site.residues.map(r => r.chain)).size === 2 && mk1Site.residues.length >= 20,
    `${mk1Site?.label} ${mk1Site?.residues.length} residues`);
  check('site residues are in the file\'s own numbering (Asp25 present)', mk1Site.residues.some(r => r.chain === 'A' && r.resi === 25) && mk1Site.residues.some(r => r.chain === 'B' && r.resi === 25));
  check('4HHB: at most 2 sites per ligand (4 hemes -> 2), labelled by chain', s4.sites.filter(s => s.label.startsWith('Where Heme')).length === 2 && /chain [A-D]\)$/.test(s4.sites[0].label), JSON.stringify(s4.sites.map(s => s.label)));
  check('no pockets offered before Pocket Radar has run', s1.sites.every(s => !s.id.startsWith('pocket:')));
  const forA = svc.siteForChains(mk1Site, ['A']);
  check('siteForChains cuts a site to the chosen chains', forA.residues.every(r => r.chain === 'A') && forA.residues.length < mk1Site.residues.length, `${forA.residues.length} of ${mk1Site.residues.length}`);
  check('siteForChains returns null when too little is left', svc.siteForChains({ label: 'x', residues: [{ chain: 'A', resi: 1, icode: '' }, { chain: 'B', resi: 2, icode: '' }] }, ['B']) === null);
  const sT = svc.cofoldSetup(read('1TRZ.pdb'));
  check('1TRZ setup: zinc keepable, four insulin chains', sT.chains.length === 4 && sT.cofactors.filter(c => c.code === 'ZN').length >= 1, JSON.stringify(sT.cofactors.map(c => c.code + c.chains.join(''))));
}
{
  // placePrediction with the live 3PTB prediction (server output saved earlier)
  const server = { pdb: read('cofold-3PTB-server.pdb'), chains: [{ id: 'A', length: 223 }], ligand: { chain: 'L', resn: 'BEN' }, cofactors: [{ chain: 'X', resn: 'CA' }],
    scores: { ligandIptm: 0.99, iptm: 0.99 }, affinity: { log10Ic50: 2.25, binderProbability: 0.84 }, template: '3PTB', seconds: 11.6 };
  const request = { source: { kind: 'pdb', pdbId: '3PTB', chains: ['A'] }, structureId: '3PTB', proteinName: 'Beta-trypsin', ligandText: 'BEN', entryLigands: ['BEN', 'CA'], cofactors: ['CA'] };
  const ligand = { name: 'Benzamidine', code: 'BEN', smiles: 'NC(=N)c1ccccc1', source: 'pdb' };
  const placed = svc.placePrediction(server, ligand, request, read('3PTB.pdb'));
  check('placed onto 3PTB: protein RMSD small', placed.proteinRmsd !== null && placed.proteinRmsd < 0.6, String(placed.proteinRmsd));
  check('contacts include Asp189 (S1 pocket)', placed.contacts.some(c => c.resi === 189 && c.resn === 'ASP'), placed.contacts.slice(0, 6).map(c => c.resn + c.resi + c.icode).join(' '));
  check('reference: crystal BEN within 0.5 Å, most contacts shared', placed.reference?.centroidDistance < 0.5 && placed.reference.sharedContacts >= placed.reference.crystalContacts - 1, JSON.stringify(placed.reference));
  const ref = placed.pdb.split('\n').filter(l => l.startsWith('HETATM') && l[21] === placed.reference.chain);
  check('reference atoms appended on their own chain before END', ref.length === 9 && placed.pdb.trim().endsWith('END'), `${ref.length} atoms, chain ${placed.reference.chain}`);
  const serials = placed.pdb.split('\n').filter(l => /^(ATOM|HETATM)/.test(l)).map(l => l.slice(6, 11).trim());
  check('atom serials unique', new Set(serials).size === serials.length);
  check('mean pLDDT on a 0-100 scale', placed.meanPlddt > 90 && placed.meanPlddt <= 100, placed.meanPlddt.toFixed(1));
  const result = { id: 'COFOLD-TEST123', request, ligand, pdb: placed.pdb, ligandChain: 'L', ligandResn: 'BEN', cofactors: server.cofactors, reference: placed.reference,
    scores: { ligandIptm: 0.99, iptm: 0.99 }, affinity: server.affinity, contacts: placed.contacts, proteinRmsd: placed.proteinRmsd, meanPlddt: placed.meanPlddt, template: '3PTB', seconds: 11.6 };
  const analysis = svc.cofoldAnalysis(result);
  check('analysis: ligand highlight first, then binding site', analysis.highlights[0].chain === 'L' && analysis.highlights[0].category === 'ligand' && analysis.highlights[1]?.category === 'binding_site');
  check('analysis summary mentions confidence, IC50 and crystal comparison', /high/.test(analysis.summary) && /IC50 ≈ 180 µM/.test(analysis.summary) && /crystal structure 3PTB/.test(analysis.summary), analysis.summary.slice(0, 160));
  check('analysis pdbId is the co-fold ID; title readable', analysis.pdbId === 'COFOLD-TEST123' && analysis.title === 'Benzamidine · Beta-trypsin', analysis.title);
}
{
  // Live lookups (RCSB chemical dictionary, PubChem)
  const r1 = await svc.resolveLigand('indinavir', ['MK1', 'HOH']);
  check('"indinavir" with MK1 in the entry -> PDB code MK1 (InChIKey match) + SMILES', r1.code === 'MK1' && Boolean(r1.smiles) && r1.name === 'Indinavir', JSON.stringify(r1).slice(0, 120));
  const r2 = await svc.resolveLigand('aspirin', []);
  check('"aspirin" -> PubChem SMILES', r2.source === 'pubchem' && r2.smiles === 'CC(=O)OC1=CC=CC=C1C(=O)O' && r2.name === 'Aspirin', JSON.stringify(r2));
  const r3 = await svc.resolveLigand('ATP', []);
  check('"ATP" -> PDB code with name', r3.code === 'ATP' && r3.source === 'pdb' && r3.heavyAtoms === 31, JSON.stringify(r3).slice(0, 120));
  const r4 = await svc.resolveLigand('CC(=O)Oc1ccccc1C(=O)O', []);
  check('aspirin SMILES -> named Aspirin, SMILES kept as typed', r4.name === 'Aspirin' && r4.smiles === 'CC(=O)Oc1ccccc1C(=O)O' && r4.source === 'smiles', JSON.stringify(r4));
  const r5 = await svc.resolveLigand('CC(C)(C)c1ccc(cc1)C(=O)N2CCC(CC2)n3cnc4ccc(F)cc43', []);
  check('novel SMILES -> "your molecule"', r5.name === 'your molecule' && r5.source === 'smiles', JSON.stringify(r5));
  const r6 = await svc.resolveLigand('mk1', ['MK1']);
  check('"mk1" lowercase, in the entry -> MK1', r6.code === 'MK1', r6.name);
  let e1 = '';
  try { await svc.resolveLigand('notarealmoleculexyz', []); } catch (e) { e1 = e.message; }
  check('unknown name -> helpful error', /couldn't find a molecule called "notarealmoleculexyz"/.test(e1), e1);
  let e2 = '';
  try { await svc.resolveLigand('insulin', []); } catch (e) { e2 = e.message; }
  check('insulin -> too large for co-folding', /heavy atoms/.test(e2) || /couldn't find/.test(e2), e2);
  const r7 = await svc.resolveLigand('benzamidine', ['BEN', 'CA']);
  check('"benzamidine" with BEN in the entry -> BEN', r7.code === 'BEN', JSON.stringify(r7).slice(0, 100));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
