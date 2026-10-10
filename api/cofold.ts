// Argus — Serverless function: Boltz-2 co-folding
//
// Lives at /api/cofold on Vercel. Predicts how a small molecule binds a protein, and how strongly,
// with Boltz-2 (Passaro, Corso, Wohlwend et al., 2025; MIT licence) on NVIDIA's hosted API, using
// NVIDIA_NIM_KEY from the environment. The key never reaches the browser.
//
// The browser names the protein (a PDB entry and its chains, an AlphaFold model, or a folded
// sequence) and the molecule (PDB ligand code and/or SMILES). The server builds the input itself:
// each chain's sequence from RCSB, cut to the span the entry has coordinates for, with that chain
// of the entry as a structural template. NVIDIA's service runs single-sequence (no alignment), so
// the template is what keeps the protein in its experimental shape. The prediction comes back in
// PDB format with the entry's own chain IDs and residue numbers.
//
// GET  /api/cofold -> { available } (whether a key is configured)
// POST /api/cofold -> a JSON result, streamed: whitespace while Boltz-2 runs (Edge functions must
//                     start answering within 25 s; a prediction takes 10-60 s), then the JSON.

import { chainTemplates, observedResidues, parseAtomSite, type CifAtom } from '../services/mmcif';

export const config = { runtime: 'edge' };

// --- CONFIG ---
const BOLTZ_URL = 'https://health.api.nvidia.com/v1/biology/mit/boltz2/predict';
const STATUS_URL = 'https://health.api.nvidia.com/v1/status/'; // Long jobs: 202 + request ID to poll
const RCSB_GRAPHQL = 'https://data.rcsb.org/graphql';
const RCSB_FILES = 'https://files.rcsb.org/download';
const AFDB_API = 'https://alphafold.ebi.ac.uk/api/prediction';

const MAX_RESIDUES = 1200; // All chains together: keeps a prediction around a minute
const MAX_CHAINS = 8;
const MAX_COFACTORS = 8;
const MAX_POCKET_RESIDUES = 60;
const MAX_SMILES = 500;
const MAX_BODY = 20_000;
const MAX_TEMPLATE_FILE = 15_000_000; // mmCIF characters (Edge memory is 128 MB); bigger entries go without templates
const PREDICTION_TIMEOUT_MS = 240_000; // Edge streams may run 300 s
const FILE_TIMEOUT_MS = 20_000;
const KEEPALIVE_MS = 5000;

// Boltz's own defaults (recycling 3, 200 sampling steps, one sample; affinity: 200 steps, 5 samples)
const PREDICTION = { recycling_steps: 3, sampling_steps: 200, diffusion_samples: 1, sampling_steps_affinity: 200, diffusion_samples_affinity: 5 };

const ALLOWED_ORIGINS = new Set<string>([
  // Any other address the app is served from goes here (the page's own address always passes)
]);

// --- TYPES ---

type Source =
  | { kind: 'pdb'; pdbId: string; chains: string[] }
  | { kind: 'alphafold'; accession: string }
  | { kind: 'sequence'; sequence: string };

interface Ligand { ccd?: string; smiles?: string }

interface ChainInput {
  id: string; // Author chain ID, also Boltz's chain ID
  sequence: string;
  numbering: string[]; // Author residue number (+ insertion code) of each position: "25", "184A"
  template?: string; // That chain of the entry, as mmCIF
}

interface PocketResidue { chain: string; resi: number; icode: string }

interface Job {
  chains: ChainInput[];
  templateName: string | null;
  ligand: Ligand;
  cofactors: string[];
  pocket: { id: string; residue_index: number }[]; // Boltz-2 pocket contacts: chain + 1-based sequence position
}

export interface CofoldResponse {
  pdb: string;
  chains: { id: string; length: number }[];
  ligand: { chain: string; resn: string };
  cofactors: { chain: string; resn: string }[]; // Kept cofactors that made it into the prediction
  scores: Record<'confidence' | 'ptm' | 'iptm' | 'ligandIptm' | 'proteinIptm' | 'plddt' | 'iplddt' | 'pde' | 'ipde', number | null>;
  affinity: { log10Ic50: number; binderProbability: number } | null;
  template: string | null; // What shaped the protein: "1HSG", "AF-P69905-F1", or null (sequence only)
  pocketResidues: number; // Pocket residues Boltz-2 was steered towards (0 without a pocket, or when it couldn't take it)
  seconds: number;
}

class CofoldError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const isTimeout = (e: unknown) => ['AbortError', 'TimeoutError'].includes((e as { name?: string } | null)?.name ?? '');

/** fetch() that gives up after `ms`. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = FILE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- RATE LIMIT ---
// Best effort, per Edge instance (instances are many and short-lived): a few predictions per visitor,
// and a daily ceiling per instance. A hard global quota needs shared storage (Upstash Redis, Heroku
// Redis); see the README. Answers served from the cache below don't count, nor do rejected inputs.
const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 4;
const DAY_MS = 24 * 3600_000;
const PER_DAY = 15;
const recentRuns = new Map<string, number[]>();
let instanceDay = { start: Date.now(), runs: 0 };

/** Seconds until the visitor may run another prediction, 0 when allowed (and counted). */
function rateLimitWait(visitor: string): number {
  const now = Date.now();
  if (now - instanceDay.start >= DAY_MS) instanceDay = { start: now, runs: 0 };
  const dailyLimit = Number(process.env.COFOLD_DAILY_LIMIT) || 60;
  if (instanceDay.runs >= dailyLimit) return Math.ceil((instanceDay.start + DAY_MS - now) / 1000);
  const times = (recentRuns.get(visitor) ?? []).filter(t => now - t < DAY_MS);
  const recent = times.filter(t => now - t < WINDOW_MS);
  if (recent.length >= PER_WINDOW) return Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
  if (times.length >= PER_DAY) return Math.max(1, Math.ceil((times[0] + DAY_MS - now) / 1000));
  times.push(now);
  recentRuns.set(visitor, times);
  instanceDay.runs++;
  if (recentRuns.size > 5000) {
    for (const [key, list] of recentRuns) if (list.every(t => now - t >= DAY_MS)) recentRuns.delete(key);
  }
  return 0;
}

/** Gives back the visitor's latest run (the input was rejected before or by Boltz-2). */
function refundRun(visitor: string) {
  recentRuns.get(visitor)?.pop();
  instanceDay.runs = Math.max(0, instanceDay.runs - 1);
}

// Same input, same prediction: kept for repeat requests on this instance
const MAX_CACHED = 12;
const cache = new Map<string, CofoldResponse>();
const running = new Map<string, Promise<CofoldResponse>>();

// --- INPUT ---

const CHAIN_ID = /^[A-Za-z0-9]{1,4}$/;
const CCD_CODE = /^[A-Z0-9]{1,5}$/;
const SMILES = /^[A-Za-z0-9@+\-[\]()=#$:.%/\\*]+$/;
const PROTEIN = /^[ACDEFGHIKLMNPQRSTVWY]+$/;

function parseRequest(body: any): { source: Source; ligand: Ligand; cofactors: string[]; pocket: PocketResidue[] } | string {
  const s = body?.source;
  let source: Source;
  if (s?.kind === 'pdb') {
    const pdbId = typeof s.pdbId === 'string' ? s.pdbId.trim().toUpperCase() : '';
    const chains = Array.isArray(s.chains) ? [...new Set(s.chains.filter((c: unknown) => typeof c === 'string' && CHAIN_ID.test(c)))] as string[] : [];
    if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) return 'Invalid PDB ID';
    if (chains.length === 0 || chains.length > MAX_CHAINS) return `Pick 1 to ${MAX_CHAINS} protein chains`;
    source = { kind: 'pdb', pdbId, chains };
  } else if (s?.kind === 'alphafold') {
    const accession = typeof s.accession === 'string' ? s.accession.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{6,10}$/.test(accession)) return 'Invalid UniProt accession';
    source = { kind: 'alphafold', accession };
  } else if (s?.kind === 'sequence') {
    const sequence = typeof s.sequence === 'string' ? s.sequence.trim().toUpperCase() : '';
    if (sequence.length < 10 || !PROTEIN.test(sequence)) return 'The sequence must be 10 or more standard amino acids';
    if (sequence.length > MAX_RESIDUES) return `Co-folding takes up to ${MAX_RESIDUES} residues`;
    source = { kind: 'sequence', sequence };
  } else {
    return 'Missing protein';
  }

  const ccd = typeof body?.ligand?.ccd === 'string' ? body.ligand.ccd.trim().toUpperCase() : '';
  const smiles = typeof body?.ligand?.smiles === 'string' ? body.ligand.smiles.trim() : '';
  if (ccd && !CCD_CODE.test(ccd)) return 'Invalid ligand code';
  if (smiles && (smiles.length > MAX_SMILES || !SMILES.test(smiles))) return 'Invalid SMILES';
  if (!ccd && !smiles) return 'Missing ligand';

  const cofactors = Array.isArray(body?.cofactors)
    ? (body.cofactors.filter((c: unknown) => typeof c === 'string' && CCD_CODE.test(c)) as string[]).slice(0, MAX_COFACTORS)
    : [];
  // Optional pocket: residues (author numbering) the molecule should bind among
  const rawPocket: any[] = Array.isArray(body?.pocket) ? body.pocket : [];
  if (rawPocket.length > MAX_POCKET_RESIDUES) return `A pocket takes up to ${MAX_POCKET_RESIDUES} residues`;
  const pocket: PocketResidue[] = [];
  for (const r of rawPocket) {
    const chain = typeof r?.chain === 'string' ? r.chain : '';
    const icode = typeof r?.icode === 'string' ? r.icode.trim() : '';
    if (!CHAIN_ID.test(chain) || !Number.isInteger(r?.resi) || Math.abs(r.resi) > 99999 || !/^[A-Za-z]?$/.test(icode)) return 'Invalid pocket residue';
    pocket.push({ chain, resi: r.resi, icode });
  }
  return { source, ligand: { ...(ccd ? { ccd } : {}), ...(smiles ? { smiles } : {}) }, cofactors, pocket };
}

// --- BUILDING THE PREDICTION INPUT ---

const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};

/** An mmCIF file, or null when it is too big to use or can't be fetched. */
async function fetchCif(url: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    if (Number(response.headers.get('content-length')) > MAX_TEMPLATE_FILE) return null;
    const text = await response.text();
    return text.length > MAX_TEMPLATE_FILE ? null : text;
  } catch {
    return null;
  }
}

const ENTRY_QUERY = `query($id: String!) { entry(entry_id: $id) { polymer_entities {
  entity_poly { rcsb_entity_polymer_type pdbx_seq_one_letter_code_can }
  polymer_entity_instances { rcsb_polymer_entity_instance_container_identifiers { auth_asym_id auth_to_entity_poly_seq_mapping } } } } }`;

/** Chains of a PDB entry: RCSB's sequence for each, cut to the span with coordinates, plus templates. */
async function pdbChains(pdbId: string, chainIds: string[]): Promise<ChainInput[]> {
  const [graph, cif] = await Promise.all([
    fetchWithTimeout(RCSB_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ENTRY_QUERY, variables: { id: pdbId } }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetchCif(`${RCSB_FILES}/${pdbId}.cif`),
  ]);
  const entities: any[] | undefined = graph?.data?.entry?.polymer_entities;
  if (!entities) {
    throw graph?.data
      ? new CofoldError(`${pdbId} is not a PDB entry`, 400)
      : new CofoldError(`Couldn't read ${pdbId} from RCSB. Try again in a moment.`);
  }
  // RCSB numbers every position, modelled or not; the file says which ones have coordinates
  const observed = cif ? observedResidues(cif) : null;
  const templates = cif ? chainTemplates(cif, chainIds) : new Map<string, string>();

  return chainIds.map(id => {
    let found: { sequence: string; numbering: string[] } | null = null;
    for (const entity of entities) {
      for (const instance of entity?.polymer_entity_instances ?? []) {
        const ids = instance?.rcsb_polymer_entity_instance_container_identifiers;
        if (ids?.auth_asym_id !== id) continue;
        if (entity?.entity_poly?.rcsb_entity_polymer_type !== 'Protein') throw new CofoldError(`Chain ${id} of ${pdbId} is not a protein`, 400);
        found = {
          sequence: String(entity.entity_poly.pdbx_seq_one_letter_code_can ?? '').replace(/\s/g, '').toUpperCase(),
          numbering: Array.isArray(ids.auth_to_entity_poly_seq_mapping) ? ids.auth_to_entity_poly_seq_mapping.map(String) : [],
        };
      }
    }
    if (!found || !found.sequence) throw new CofoldError(`${pdbId} has no chain ${id}`, 400);
    let { sequence, numbering } = found;
    if (numbering.length !== sequence.length) numbering = sequence.split('').map((_, i) => String(i + 1));
    // Only the stretch with coordinates: unmodelled tails (tags, disordered ends) would only add cost
    const seen = observed?.get(id);
    if (seen && seen.size > 0) {
      const start = numbering.findIndex(n => seen.has(n));
      let end = numbering.length - 1;
      while (end > start && !seen.has(numbering[end])) end--;
      if (start >= 0) {
        sequence = sequence.slice(start, end + 1);
        numbering = numbering.slice(start, end + 1);
      }
    }
    // Unknown residues (X) as glycine: Boltz takes the standard amino acids, and X is rare
    sequence = sequence.replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, 'G');
    return { id, sequence, numbering, template: templates.get(id) };
  });
}

/** An AlphaFold DB model: its sequence, with the model itself as template (chain A, UniProt numbering). */
async function alphaFoldChain(accession: string): Promise<ChainInput> {
  const meta = await fetchWithTimeout(`${AFDB_API}/${accession}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const entry = Array.isArray(meta) ? meta.find((e: any) => e?.uniprotAccession === accession) ?? meta[0] : null;
  const cifUrl = typeof entry?.cifUrl === 'string' && entry.cifUrl.startsWith('https://alphafold.ebi.ac.uk/') ? entry.cifUrl : null;
  if (!cifUrl) throw new CofoldError(`AlphaFold DB has no model for ${accession}`, 400);
  const cif = await fetchCif(cifUrl);
  if (!cif) throw new CofoldError(`Couldn't download the AlphaFold model for ${accession}`);
  const residues = parseAtomSite(cif).filter(a => !a.het && a.name === 'CA' && a.authAsym === 'A');
  const sequence = residues.map(a => THREE_TO_ONE[a.compound] ?? 'G').join('');
  if (sequence.length > MAX_RESIDUES) {
    throw new CofoldError(`This AlphaFold model has ${sequence.length} residues; co-folding takes up to ${MAX_RESIDUES}. Open an experimental structure of the domain instead.`, 400);
  }
  return { id: 'A', sequence, numbering: residues.map(a => String(a.resi)), template: chainTemplates(cif, ['A']).get('A') };
}

/** Pocket residues (author numbering) as Boltz-2 contacts: chain + 1-based position in the submitted sequence. */
const pocketContacts = (chains: ChainInput[], pocket: PocketResidue[]) => {
  const contacts: { id: string; residue_index: number }[] = [];
  for (const r of pocket) {
    const chain = chains.find(c => c.id === r.chain);
    const index = chain ? chain.numbering.indexOf(`${r.resi}${r.icode}`) : -1;
    if (chain && index >= 0 && !contacts.some(c => c.id === chain.id && c.residue_index === index + 1)) {
      contacts.push({ id: chain.id, residue_index: index + 1 });
    }
  }
  return contacts;
};

async function buildJob(source: Source, ligand: Ligand, cofactors: string[], pocket: PocketResidue[]): Promise<Job> {
  let chains: ChainInput[];
  let templateName: string | null;
  if (source.kind === 'pdb') {
    chains = await pdbChains(source.pdbId, source.chains);
    templateName = source.pdbId;
  } else if (source.kind === 'alphafold') {
    chains = [await alphaFoldChain(source.accession)];
    templateName = `AF-${source.accession}-F1`;
  } else {
    chains = [{ id: 'A', sequence: source.sequence, numbering: source.sequence.split('').map((_, i) => String(i + 1)) }];
    templateName = null;
  }
  const contacts = pocketContacts(chains, pocket);
  if (pocket.length > 0 && contacts.length === 0) {
    throw new CofoldError("The chosen pocket isn't in the chains being predicted. Tick the chains that line it.", 400);
  }
  return { chains, templateName, ligand, cofactors, pocket: contacts };
}

// --- BOLTZ-2 ---

/** Chain IDs for the ligands that no protein chain uses (PDB format allows one character). */
const ligandChainIds = (taken: string[], count: number) =>
  [...'LXYZWVUTSRQPONMKJIHGFEDCBA'].filter(c => !taken.includes(c)).slice(0, count);

const firstNumber = (value: unknown): number | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const UNREADABLE = 'unreadable-input'; // Boltz-2 couldn't parse the input (its message doesn't say which part)

/** One call to NVIDIA's Boltz-2; polls when the service answers 202 (queued). */
async function callBoltz(body: object, apiKey: string, deadline: number): Promise<any> {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const remaining = () => Math.max(1000, deadline - Date.now());
  let response = await fetchWithTimeout(BOLTZ_URL, { method: 'POST', headers, body: JSON.stringify(body) }, remaining());
  while (response.status === 202) {
    const requestId = response.headers.get('nvcf-reqid');
    if (!requestId || Date.now() > deadline) throw new CofoldError('Boltz-2 took too long (over 4 minutes). Try again later, or with fewer chains.', 504);
    await new Promise(r => setTimeout(r, 4000));
    response = await fetchWithTimeout(STATUS_URL + encodeURIComponent(requestId), { headers }, remaining());
  }
  if (response.ok) return response.json();

  // Details stay in the server log
  const detail = await response.text().catch(() => '');
  console.error(`[cofold] Boltz-2 ${response.status}: ${detail.slice(0, 500)}`);
  if (response.status === 401 || response.status === 403) throw new CofoldError("The co-folding service rejected this server's key", 503);
  if (response.status === 402 || response.status === 429) throw new CofoldError('The co-folding service is busy or out of credits right now. Try again later.', 429);
  if (response.status === 400 || response.status === 422) throw new CofoldError(UNREADABLE, 400);
  throw new CofoldError(`The co-folding service had a problem (${response.status}). Try again in a minute.`);
}

/** "184A" -> 184 + "A" */
const authNumber = (label: string | undefined, fallback: number) => {
  const m = /^(-?\d+)([A-Za-z]?)$/.exec(label ?? '');
  return m ? { resi: Number(m[1]), icode: m[2] } : { resi: fallback, icode: '' };
};

/** A PDB ATOM/HETATM record (atom names of one-letter elements start in column 14, as in the PDB). */
const pdbRecord = (het: boolean, serial: number, atom: CifAtom, resn: string, chain: string, resi: number, icode: string) => {
  const element = (atom.element || atom.name.charAt(0)).toUpperCase();
  const name = atom.name.length >= 4 || element.length === 2 ? atom.name.padEnd(4).slice(0, 4) : ` ${atom.name}`.padEnd(4);
  const b = Number.isFinite(atom.bfactor) ? atom.bfactor : 0;
  const [x, y, z] = atom.position;
  return `${het ? 'HETATM' : 'ATOM  '}${String(serial % 100000).padStart(5)} ${name} ${resn.slice(0, 3).padStart(3)} ${chain}${String(resi).padStart(4)}${(icode || ' ').slice(0, 1)}   ` +
    `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00${b.toFixed(2).padStart(6)}          ${element.padStart(2)}`;
};

async function predict(job: Job, apiKey: string): Promise<CofoldResponse> {
  const started = Date.now();
  const deadline = started + PREDICTION_TIMEOUT_MS;

  // When Boltz-2 can't parse the input, its message doesn't say why: retry without the likeliest
  // culprit each time (a PDB code missing from its chemical dictionary, a template, a cofactor code,
  // the pocket hint)
  const attempt = { ligand: (job.ligand.ccd ? { ccd: job.ligand.ccd } : { smiles: job.ligand.smiles }) as Ligand, templates: true, cofactors: job.cofactors, pocket: job.pocket };
  const simplify = (): boolean => {
    if (attempt.ligand.ccd && job.ligand.smiles) {
      attempt.ligand = { smiles: job.ligand.smiles };
      return true;
    }
    if (attempt.templates && job.chains.some(c => c.template)) {
      attempt.templates = false;
      return true;
    }
    if (attempt.cofactors.length > 0) {
      attempt.cofactors = [];
      return true;
    }
    if (attempt.pocket.length > 0) {
      attempt.pocket = [];
      return true;
    }
    return false;
  };

  let result: any;
  let ligandChain = '';
  let cofactorChains: string[] = [];
  for (;;) {
    [ligandChain, ...cofactorChains] = ligandChainIds(job.chains.map(c => c.id), 1 + attempt.cofactors.length);
    const body = {
      polymers: job.chains.map(c => ({
        id: c.id,
        molecule_type: 'protein',
        sequence: c.sequence,
        ...(attempt.templates && c.template
          ? { structural_templates: [{ structure: c.template, format: 'cif', name: `${job.templateName}_${c.id}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) }] }
          : {}),
      })),
      ligands: [
        { id: ligandChain, ...attempt.ligand, predict_affinity: true },
        ...attempt.cofactors.map((ccd, i) => ({ id: cofactorChains[i], ccd })),
      ],
      ...(attempt.pocket.length > 0 ? { constraints: [{ constraint_type: 'pocket', binder: ligandChain, contacts: attempt.pocket }] } : {}),
      ...PREDICTION,
      output_format: 'mmcif',
    };
    try {
      result = await callBoltz(body, apiKey, deadline);
      break;
    } catch (e) {
      if (isTimeout(e)) throw new CofoldError('Boltz-2 took too long (over 4 minutes). Try again later, or with fewer chains.', 504);
      if (!(e instanceof CofoldError) || e.message !== UNREADABLE) throw e;
      if (!simplify()) {
        throw new CofoldError("Boltz-2 couldn't read this molecule. Check the SMILES, or try the compound's name or PDB code.", 400);
      }
    }
  }

  const cif = result?.structures?.[0]?.structure;
  if (typeof cif !== 'string') throw new CofoldError('Boltz-2 returned no structure');
  const atoms = parseAtomSite(cif);
  const ligandResn = new Map<string, string>([
    [ligandChain, attempt.ligand.ccd ?? 'LIG'],
    ...attempt.cofactors.map((ccd, i) => [cofactorChains[i], ccd] as [string, string]),
  ]);
  if (!atoms.some(a => a.authAsym === ligandChain)) throw new CofoldError('Boltz-2 returned the protein without the ligand');

  // Protein chains in input order with the entry's numbering, then the ligands
  const lines: string[] = [];
  let serial = 1;
  for (const chain of job.chains) {
    const own = atoms.filter(a => a.authAsym === chain.id);
    for (const a of own) {
      const { resi, icode } = authNumber(chain.numbering[a.resi - 1], a.resi);
      lines.push(pdbRecord(false, serial++, a, a.compound, chain.id, resi, icode));
    }
    if (own.length) lines.push('TER');
  }
  for (const [chain, resn] of ligandResn) {
    for (const a of atoms.filter(x => x.authAsym === chain)) lines.push(pdbRecord(true, serial++, a, resn, chain, 1, ''));
  }
  lines.push('END');

  const affinity = result?.affinities?.[ligandChain];
  const log10Ic50 = firstNumber(affinity?.affinity_pred_value);
  const binderProbability = firstNumber(affinity?.affinity_probability_binary);
  return {
    pdb: `${lines.join('\n')}\n`,
    chains: job.chains.map(c => ({ id: c.id, length: c.sequence.length })),
    ligand: { chain: ligandChain, resn: ligandResn.get(ligandChain)! },
    cofactors: attempt.cofactors.map((ccd, i) => ({ chain: cofactorChains[i], resn: ccd })),
    scores: {
      confidence: firstNumber(result?.confidence_scores),
      ptm: firstNumber(result?.ptm_scores),
      iptm: firstNumber(result?.iptm_scores),
      ligandIptm: firstNumber(result?.ligand_iptm_scores),
      proteinIptm: firstNumber(result?.protein_iptm_scores),
      plddt: firstNumber(result?.complex_plddt_scores),
      iplddt: firstNumber(result?.complex_iplddt_scores),
      pde: firstNumber(result?.complex_pde_scores),
      ipde: firstNumber(result?.complex_ipde_scores),
    },
    affinity: log10Ic50 !== null && binderProbability !== null ? { log10Ic50, binderProbability } : null,
    template: attempt.templates && job.chains.some(c => c.template) ? job.templateName : null,
    pocketResidues: attempt.pocket.length,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

// --- HANDLER ---

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

export default async function handler(req: Request): Promise<Response> {
  const apiKey = process.env.NVIDIA_NIM_KEY;
  if (req.method === 'GET') return jsonResponse({ available: Boolean(apiKey) }, 200);
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  // Origin check, as in /api/analyze: other websites can't spend this server's quota from their visitors' browsers
  const origin = req.headers.get('origin') || '';
  const sameOrigin = origin !== '' && origin === new URL(req.url).origin;
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin) return jsonResponse({ error: 'Forbidden origin' }, 403);
  if (!apiKey) return jsonResponse({ error: 'Co-folding is not set up on this server' }, 503);

  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY) return jsonResponse({ error: 'Request too large' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = parseRequest(body);
  if (typeof parsed === 'string') return jsonResponse({ error: parsed }, 400);

  const key = JSON.stringify(parsed);
  const cached = cache.get(key);
  if (cached) return jsonResponse(cached, 200);
  let job = running.get(key);
  if (!job) {
    const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
    const wait = rateLimitWait(visitor);
    if (wait > 0) {
      const later = wait >= 3600 ? `${Math.ceil(wait / 3600)} h` : `${Math.ceil(wait / 60)} min`;
      return jsonResponse({ error: `Co-folding is limited to a few predictions per visitor; try again in ${later}` }, 429, { 'Retry-After': String(wait) });
    }
    job = (async () => {
      const built = await buildJob(parsed.source, parsed.ligand, parsed.cofactors, parsed.pocket);
      const residues = built.chains.reduce((n, c) => n + c.sequence.length, 0);
      if (residues > MAX_RESIDUES) throw new CofoldError(`These chains have ${residues} residues; co-folding takes up to ${MAX_RESIDUES}. Pick fewer chains.`, 400);
      return predict(built, apiKey);
    })();
    running.set(key, job);
    job.then(
      result => {
        cache.set(key, result);
        if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
      },
      e => { if (e instanceof CofoldError && e.status === 400) refundRun(visitor); },
    ).finally(() => running.delete(key));
  }

  // Stream: a space now and every few seconds (JSON allows leading whitespace), then the answer
  const encoder = new TextEncoder();
  const pending = job;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* the client went away */ }
      };
      send(' ');
      const keepAlive = setInterval(() => send(' '), KEEPALIVE_MS);
      let answer: string;
      try {
        answer = JSON.stringify(await pending);
      } catch (e) {
        if (!(e instanceof CofoldError)) console.error('[cofold]', e);
        answer = JSON.stringify({
          error: e instanceof CofoldError ? e.message : 'Co-folding failed unexpectedly',
          status: e instanceof CofoldError ? e.status : 502,
        });
      } finally {
        clearInterval(keepAlive);
      }
      send(answer);
      try { controller.close(); } catch { /* already closed */ }
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
