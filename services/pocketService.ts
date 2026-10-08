import type { Pocket, PocketModel, PocketPrediction, PocketResidue } from '../types';
import { alphaFoldId, parseAlphaFoldId } from './alphafoldService';
import { isEsmFoldId } from './esmfoldService';

// --- POCKET RADAR (ligand-binding pockets predicted by P2Rank, served by PrankWeb) ---
// PrankWeb (ELIXIR CZ) runs P2Rank on PDB entries and AlphaFold DB models: keyless, CORS-enabled
// and free for any use with attribution. Asking about a structure it hasn't analysed queues a job
// on its server, so predictions are only requested when the user opens Pocket Radar, results are
// cached for the session and polling is gentle. PrankWeb's default, conservation-aware model is
// preferred; when it is still computing after a short wait, the quick model (no conservation) is
// shown first and replaced by the better result as soon as that arrives. Residues come in the
// file's author numbering ("A_184A"), the same numbering 3Dmol and the highlights use.

const PRANKWEB_API = 'https://prankweb.cz/api/v2/prediction';
const REQUEST_TIMEOUT_MS = 20000;
const QUICK_FALLBACK_MS = 25000; // How long to wait for the conservation model before also asking for the quick one
const QUICK_MAX_MS = 5 * 60000;
const CONSERVATION_MAX_MS = 10 * 60000;

export const MAX_SHOWN_POCKETS = 5;
const MIN_SHOWN_PROBABILITY = 0.1; // P2Rank's probabilities are calibrated: below 10% a pocket is rarely a real site. The best pocket is shown regardless
// One colour per shown pocket, in rank order: amber, cyan, violet, emerald, pink
export const POCKET_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6'];

const CONTACT_DISTANCE = 4.0; // Å between a ligand atom and an atom of a pocket residue
const MIN_CONTACT_RESIDUES = 3; // A ligand touching this many pocket residues sits in the pocket
// Waters, crystallisation additives and stray counter-ions: real atoms, but not what a pocket is "for"
const NOT_LIGANDS = new Set([
  'HOH', 'DOD', 'WAT', 'GOL', 'EDO', 'PEG', 'PGE', 'PG4', '1PE', '2PE', 'P6G', '12P', 'PE4', 'ACT', 'ACY',
  'DMS', 'FMT', 'MPD', 'MRD', 'TRS', 'EPE', 'MES', 'BME', 'IPA', 'EOH', 'MOH', 'SCN', 'NO3', 'IMD',
  'SO4', 'CL', 'BR', 'IOD',
]);

const THREE: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
};

/** "Asp25", "Ser184A", or "25" when the residue type is unknown. */
export const residueLabel = (r: PocketResidue) => `${(r.aa && THREE[r.aa]) ?? ''}${r.resi}${r.icode}`;

export class PocketError extends Error {}

// --- TARGETS ---

interface PocketTarget {
  key: string; // Viewer structure ID: "1HSG" or "AF-P68871-F1"
  code: string; // What PrankWeb is asked about: a PDB ID or a UniProt accession
  databases: Record<PocketModel, string>;
}

/** PrankWeb's databases for a PDB entry or AlphaFold model; null for anything else (an ESMFold prediction). */
const pocketTarget = (structureId: string): PocketTarget | null => {
  const id = structureId.trim();
  if (!id || isEsmFoldId(id)) return null;
  const accession = parseAlphaFoldId(id);
  if (accession) {
    return { key: alphaFoldId(accession), code: accession, databases: { conservation: 'v4-alphafold-conservation-hmm', quick: 'v4-alphafold' } };
  }
  if (/^[0-9][a-z0-9]{3}$/i.test(id)) {
    return { key: id.toUpperCase(), code: id.toUpperCase(), databases: { conservation: 'v4-conservation-hmm', quick: 'v4' } };
  }
  return null;
};

export const pocketsSupported = (structureId: string) => pocketTarget(structureId) !== null;

/** The viewer structure ID a prediction for this structure is stored under ("1HSG", "AF-P68871-F1"). */
export const pocketKey = (structureId: string) => pocketTarget(structureId)?.key ?? null;

// --- REQUESTS ---

const abortError = () => new DOMException('Aborted', 'AbortError');
const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';

/** GET JSON with a per-request timeout that also follows the caller's signal. */
const fetchJson = async (url: string, signal: AbortSignal): Promise<any> => {
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) throw new PocketError('PrankWeb has no prediction for this structure');
    if (!response.ok) throw new Error(`prankweb.cz responded ${response.status}`);
    return await response.json();
  } catch (e) {
    if (signal.aborted) throw abortError();
    if (isAbort(e)) throw new Error('prankweb.cz did not respond');
    throw e;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

export type PocketTaskStatus = 'queued' | 'running';

/** Polls until PrankWeb has the prediction. The first request for an unseen structure queues it. */
const waitForTask = async (
  database: string,
  code: string,
  signal: AbortSignal,
  maxMs: number,
  onStatus: (status: PocketTaskStatus) => void,
) => {
  const started = Date.now();
  let failures = 0;
  for (;;) {
    let status: unknown;
    try {
      status = (await fetchJson(`${PRANKWEB_API}/${database}/${encodeURIComponent(code)}`, signal))?.status;
      failures = 0;
    } catch (e) {
      if (isAbort(e) || e instanceof PocketError || ++failures >= 3) throw e; // Two network blips are tolerated
    }
    if (status === 'successful') return;
    if (status === 'failed') throw new PocketError('PrankWeb could not analyse this structure');
    if (status === 'queued' || status === 'running') onStatus(status);
    const elapsed = Date.now() - started;
    if (elapsed >= maxMs) throw new PocketError('PrankWeb is taking unusually long; try again later');
    await sleep(elapsed < 30000 ? 3000 : elapsed < 120000 ? 6000 : 10000, signal);
  }
};

// --- PREDICTIONS ---

const RESIDUE_ID = /^(.+)_(-?\d+)([A-Za-z]?)$/; // "A_25", "A_184A" (insertion code), "AA_7"

const compareResidues = (a: PocketResidue, b: PocketResidue) =>
  a.chain.localeCompare(b.chain) || a.resi - b.resi || a.icode.localeCompare(b.icode);

const fetchPrediction = async (
  target: PocketTarget,
  model: PocketModel,
  pdbText: string | null,
  signal: AbortSignal,
): Promise<PocketPrediction> => {
  const database = target.databases[model];
  const code = encodeURIComponent(target.code);
  const json = await fetchJson(`${PRANKWEB_API}/${database}/${code}/public/prediction.json`, signal);

  // structure.indices and structure.sequence run in parallel: residue ID -> one-letter type
  const indices: unknown[] = Array.isArray(json?.structure?.indices) ? json.structure.indices : [];
  const sequence: unknown[] = Array.isArray(json?.structure?.sequence) ? json.structure.sequence : [];
  const typeOf = new Map<string, string>();
  indices.forEach((id, i) => {
    const aa = sequence[i];
    if (typeof id === 'string' && typeof aa === 'string' && /^[A-Z]$/.test(aa)) typeOf.set(id, aa);
  });

  const pockets: Pocket[] = [];
  for (const raw of Array.isArray(json?.pockets) ? json.pockets : []) {
    const residues: PocketResidue[] = [];
    for (const id of Array.isArray(raw?.residues) ? raw.residues : []) {
      const m = typeof id === 'string' ? RESIDUE_ID.exec(id.trim()) : null;
      if (!m) continue;
      const aa = typeOf.get(id);
      residues.push({ chain: m[1], resi: Number(m[2]), icode: m[3], ...(aa ? { aa } : {}) });
    }
    const rank = Number(raw?.rank);
    const probability = Number(raw?.probability);
    const center = (Array.isArray(raw?.center) ? raw.center : []).map(Number);
    if (residues.length === 0 || !Number.isFinite(rank)) continue;
    pockets.push({
      rank,
      probability: Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0,
      residues: residues.sort(compareResidues),
      center: center.length === 3 && center.every(Number.isFinite) ? [center[0], center[1], center[2]] : null,
      ligands: [],
    });
  }
  pockets.sort((a, b) => a.rank - b.rank);

  const prediction: PocketPrediction = {
    structureId: target.key,
    model,
    p2rankVersion: typeof json?.metadata?.p2rank_version === 'string' ? json.metadata.p2rank_version : undefined,
    pockets,
    url: `https://prankweb.cz/analyze?database=${database}&code=${code}`,
  };
  if (pdbText) annotateLigands(shownPockets(prediction), pdbText);
  return prediction;
};

/**
 * A copy of the prediction whose shown pockets name the ligands sitting in them in `pdbText` — for
 * AlphaFold models, whose ligands (AlphaFill transplants) arrive after the pockets were loaded.
 */
export const withPocketLigands = (prediction: PocketPrediction, pdbText: string): PocketPrediction => {
  const copy: PocketPrediction = { ...prediction, pockets: prediction.pockets.map(p => ({ ...p, ligands: [] })) };
  annotateLigands(shownPockets(copy), pdbText);
  return copy;
};

/** The pockets worth showing: the best one, then any others above the probability floor, at most five. */
export const shownPockets = (prediction: PocketPrediction): Pocket[] =>
  prediction.pockets.filter((p, i) => i === 0 || p.probability >= MIN_SHOWN_PROBABILITY).slice(0, MAX_SHOWN_POCKETS);

// --- LIGANDS ALREADY SITTING IN A POCKET ---
// On an experimental structure the best evidence for a predicted pocket is a ligand bound in it.
// Ligands are HETATM groups that aren't polymer residues (modified amino acids keep N, CA and C)
// or additives; one sits in a pocket when it touches several of the pocket's residues.

interface Atom { x: number; y: number; z: number }
interface Group { name: string; atoms: Atom[]; center: Atom; radius: number }

const bounds = (atoms: Atom[]): { center: Atom; radius: number } => {
  const center = { x: 0, y: 0, z: 0 };
  for (const a of atoms) { center.x += a.x; center.y += a.y; center.z += a.z; }
  center.x /= atoms.length; center.y /= atoms.length; center.z /= atoms.length;
  let radius = 0;
  for (const a of atoms) radius = Math.max(radius, Math.hypot(a.x - center.x, a.y - center.y, a.z - center.z));
  return { center, radius };
};

const annotateLigands = (pockets: Pocket[], pdbText: string) => {
  const residues = new Map<string, { het: boolean; resn: string; names: Set<string>; atoms: Atom[] }>();
  for (const line of pdbText.split('\n')) {
    if (line.startsWith('ENDMDL')) break; // First model only
    const het = line.startsWith('HETATM');
    if (!het && !line.startsWith('ATOM')) continue;
    const atom = { x: parseFloat(line.slice(30, 38)), y: parseFloat(line.slice(38, 46)), z: parseFloat(line.slice(46, 54)) };
    if (!Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z)) continue;
    const key = `${line.slice(21, 22).trim()}|${parseInt(line.slice(22, 26), 10)}|${line.slice(26, 27).trim()}`;
    let residue = residues.get(key);
    if (!residue) {
      residue = { het, resn: line.slice(17, 20).trim(), names: new Set(), atoms: [] };
      residues.set(key, residue);
    }
    residue.names.add(line.slice(12, 16).trim());
    residue.atoms.push(atom);
  }

  const ligands: Group[] = [];
  for (const r of residues.values()) {
    if (!r.het || NOT_LIGANDS.has(r.resn) || (r.names.has('N') && r.names.has('CA') && r.names.has('C'))) continue;
    ligands.push({ name: r.resn, atoms: r.atoms, ...bounds(r.atoms) });
  }
  if (ligands.length === 0) return;

  const cutoff = CONTACT_DISTANCE * CONTACT_DISTANCE;
  const touches = (atoms: Atom[], ligand: Group) =>
    atoms.some(a => ligand.atoms.some(l => (a.x - l.x) ** 2 + (a.y - l.y) ** 2 + (a.z - l.z) ** 2 <= cutoff));

  for (const pocket of pockets) {
    const lining = pocket.residues
      .map(r => residues.get(`${r.chain}|${r.resi}|${r.icode}`)?.atoms ?? [])
      .filter(atoms => atoms.length > 0);
    if (lining.length === 0) continue;
    const area = bounds(lining.flat());
    const needed = Math.min(MIN_CONTACT_RESIDUES, lining.length);
    const found: { name: string; contacts: number }[] = [];
    for (const ligand of ligands) {
      const gap = Math.hypot(ligand.center.x - area.center.x, ligand.center.y - area.center.y, ligand.center.z - area.center.z);
      if (gap > ligand.radius + area.radius + CONTACT_DISTANCE) continue; // Too far apart to touch
      const contacts = lining.filter(atoms => touches(atoms, ligand)).length;
      if (contacts >= needed) found.push({ name: ligand.name, contacts });
    }
    found.sort((a, b) => b.contacts - a.contacts);
    pocket.ligands = [...new Set(found.map(f => f.name))].slice(0, 3);
  }
};

// --- LOADING ---

const results = new Map<string, PocketPrediction>(); // `${key}|${model}` -> prediction (successful ones only)

/** The best prediction already loaded for a structure this session, without asking PrankWeb. */
export const cachedPockets = (structureId: string): PocketPrediction | null => {
  const key = pocketKey(structureId);
  return key ? results.get(`${key}|conservation`) ?? results.get(`${key}|quick`) ?? null : null;
};

export interface PocketProgress {
  status: PocketTaskStatus;
  quick: boolean; // The conservation model is slow, so the quick model was requested too
}

/**
 * Pocket predictions for a PDB entry or AlphaFold model. pdbText (the loaded file) lets ligands
 * bound in a pocket be named. Resolves with the conservation-aware prediction, or with the quick
 * one when that arrives first; the conservation-aware result then follows through onUpgrade
 * unless the signal was aborted. Rejects with an AbortError once the signal aborts.
 */
export const loadPockets = async (
  structureId: string,
  pdbText: string | null,
  signal: AbortSignal,
  { onProgress, onUpgrade }: { onProgress?: (progress: PocketProgress) => void; onUpgrade?: (prediction: PocketPrediction) => void } = {},
): Promise<PocketPrediction> => {
  const target = pocketTarget(structureId);
  if (!target) throw new PocketError('Pocket Radar works on PDB entries and AlphaFold models');
  const best = results.get(`${target.key}|conservation`);
  if (best) return best;

  let quickRequested = false;
  const load = async (model: PocketModel, maxMs: number, modelSignal: AbortSignal) => {
    await waitForTask(target.databases[model], target.code, modelSignal, maxMs, status => onProgress?.({ status, quick: quickRequested }));
    const prediction = await fetchPrediction(target, model, pdbText, modelSignal);
    results.set(`${target.key}|${model}`, prediction);
    return prediction;
  };

  const conservation = load('conservation', CONSERVATION_MAX_MS, signal);
  conservation.catch(() => {}); // Awaited below or left to finish in the background: never an unhandled rejection

  // A quick prediction from earlier in the session is shown at once; otherwise wait a little for the better model
  const quickCached = results.get(`${target.key}|quick`);
  const early = await Promise.race([
    conservation.then(p => p, () => null), // null: it failed, so fall back to the quick model
    sleep(quickCached ? 0 : QUICK_FALLBACK_MS, signal).then(() => undefined),
  ]);
  if (early) return early;
  if (signal.aborted) throw abortError();

  quickRequested = true;
  const quickController = new AbortController(); // Stops polling the quick model if the conservation one wins
  const stopQuick = () => quickController.abort();
  signal.addEventListener('abort', stopQuick, { once: true });
  const quick = quickCached ? Promise.resolve(quickCached) : load('quick', QUICK_MAX_MS, quickController.signal);
  quick.catch(() => {});

  try {
    const winner = await Promise.any([
      conservation.then(prediction => ({ prediction, final: true })),
      quick.then(prediction => ({ prediction, final: false })),
    ]);
    if (winner.final) stopQuick();
    else conservation.then(prediction => { if (!signal.aborted) onUpgrade?.(prediction); }, () => {});
    return winner.prediction;
  } catch (e) {
    if (signal.aborted) throw abortError();
    const errors: unknown[] = e instanceof AggregateError ? e.errors : [e];
    throw errors.find(err => err instanceof PocketError) ?? errors.find(err => !isAbort(err)) ?? e;
  } finally {
    signal.removeEventListener('abort', stopQuick);
  }
};

// --- FACTS FOR THE AI ---

/** "A 8 10 23 25 27-30; B 8 10" — residue numbers grouped by chain, consecutive runs collapsed. */
const compactResidues = (residues: PocketResidue[]) => {
  const byChain = new Map<string, string[]>();
  let run: { chain: string; start: number; end: number } | null = null;
  const flush = () => {
    if (!run) return;
    const list = byChain.get(run.chain) ?? [];
    list.push(run.start === run.end ? `${run.start}` : run.end === run.start + 1 ? `${run.start} ${run.end}` : `${run.start}-${run.end}`);
    byChain.set(run.chain, list);
    run = null;
  };
  for (const r of residues) {
    if (r.icode) {
      flush();
      const list = byChain.get(r.chain) ?? [];
      list.push(`${r.resi}${r.icode}`);
      byChain.set(r.chain, list);
    } else if (run && run.chain === r.chain && r.resi === run.end + 1) {
      run.end = r.resi;
    } else {
      flush();
      run = { chain: r.chain, start: r.resi, end: r.resi };
    }
  }
  flush();
  return [...byChain].map(([chain, list]) => `${chain} ${list.join(' ')}`).join('; ');
};

/**
 * One facts line with the pockets already predicted for a structure (nothing is requested here),
 * or null when Pocket Radar hasn't run on it this session.
 */
export const pocketFactsLine = (structureId: string, maxChars = 420): string | null => {
  const prediction = cachedPockets(structureId);
  if (!prediction) return null;
  const head = 'Predicted ligand-binding pockets (P2Rank computation, not experimental; residues in this file\'s numbering): ';
  const pockets = shownPockets(prediction).slice(0, 3);
  if (pockets.length === 0) return `${head}none found.`;
  let line = head;
  pockets.forEach((p, i) => {
    const ligands = p.ligands.length ? `, holds ${p.ligands.join('/')}` : '';
    const entry = `${i ? ' | ' : ''}#${p.rank} ${Math.round(p.probability * 100)}%${ligands}: ${compactResidues(p.residues)}`;
    if (line.length + entry.length <= maxChars) line += entry;
    else if (i === 0) line += `${entry.slice(0, maxChars - line.length - 1).replace(/[\s;|]+\S*$/, '')}…`;
  });
  return line;
};
