import { superpose, type Vec3 } from './superpose';
import { ONE_LETTER, WATERS } from './structureModel';
import { memoize } from './http';
import { parseAlphaFoldId } from './alphafoldService';
import { isEsmFoldId } from './esmfoldService';

// --- OVERLAY ---
// Another structure of the same protein laid over the one on screen: another PDB entry (an open and
// a closed form, another ligand), its AlphaFold model, or a prediction made in this session. The two
// chains' sequences are aligned, one point per residue (Cα, or
// C4′ for nucleotides) is fitted by least squares, and then, round after round, the pairs farther
// apart than 2 Å are pruned and the rest refitted (each round the lesser of the farthest 10% of all
// pairs or half of those over 2 Å) until none is over 2 Å. The fit sits on the parts that stay put,
// and what moved shows as distance. Only the same protein (at least 90% identical where the chains
// align): matching different proteins by sequence goes wrong for distant relatives.

export const SAME_PROTEIN = 0.9; // Identity where the two chains align
export const CUTOFF = 2; // Å: pairs farther apart are pruned from the fit
const MIN_PAIRS = 20;

interface Residue {
  key: string; // `${chain}|${resi}|${icode}`
  label: string; // "A:12" (with the insertion code)
  code: string; // One letter
  point: Vec3; // Cα, or C4′ for nucleotides
}
interface Chain { chain: string; residues: Residue[]; sequence: string }

/** Polymer chains of the first model, one point per residue (first alternate location). */
const chainsOf = (pdb: string): Chain[] => {
  const residues = new Map<string, { chain: string; resi: number; icode: string; resn: string; atoms: Map<string, Vec3> }>();
  const order: string[] = [];
  for (const line of pdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const altLoc = line[16];
    if (altLoc && altLoc !== ' ' && altLoc !== 'A') continue;
    const resi = parseInt(line.slice(22, 26), 10);
    const p: Vec3 = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    if (!Number.isFinite(resi) || !p.every(Number.isFinite)) continue;
    const chain = (line[21] ?? ' ').trim() || ' ';
    const icode = (line[26] ?? ' ').trim();
    const key = `${chain}|${resi}|${icode}`;
    let r = residues.get(key);
    if (!r) {
      r = { chain, resi, icode, resn: line.slice(17, 20).trim(), atoms: new Map() };
      residues.set(key, r);
      order.push(key);
    }
    r.atoms.set(line.slice(12, 16).trim(), p);
  }
  const chains = new Map<string, Chain>();
  for (const key of order) {
    const r = residues.get(key)!;
    const protein = r.atoms.has('N') && r.atoms.has('CA') && r.atoms.has('C');
    const point = protein ? r.atoms.get('CA') : r.atoms.get("C4'");
    if (!point) continue; // Ligands, ions and waters
    let chain = chains.get(r.chain);
    if (!chain) {
      chain = { chain: r.chain, residues: [], sequence: '' };
      chains.set(r.chain, chain);
    }
    chain.residues.push({ key, label: `${r.chain}:${r.resi}${r.icode}`, code: ONE_LETTER[r.resn] ?? 'X', point });
  }
  for (const chain of chains.values()) chain.sequence = chain.residues.map(r => r.code).join('');
  return [...chains.values()].filter(c => c.residues.length >= MIN_PAIRS);
};

/**
 * Global alignment with affine gaps (Gotoh), free at the ends (one construct can be longer than
 * the other). Returns the aligned positions [i in a, j in b] and the score.
 */
export const alignSequences = (a: string, b: string) => {
  const n = a.length;
  const m = b.length;
  const MATCH = 2;
  const MISMATCH = -1;
  const OPEN = -5;
  const EXTEND = -1;
  const NEG = -1e9;
  const w = m + 1;
  const M = new Float32Array((n + 1) * w).fill(NEG); // a[i-1] with b[j-1]
  const X = new Float32Array((n + 1) * w).fill(NEG); // a[i-1] against a gap
  const Y = new Float32Array((n + 1) * w).fill(NEG); // b[j-1] against a gap
  const tM = new Uint8Array((n + 1) * w);
  const tX = new Uint8Array((n + 1) * w);
  const tY = new Uint8Array((n + 1) * w);
  M[0] = 0;
  for (let i = 1; i <= n; i++) X[i * w] = 0; // Leading gaps are free
  for (let j = 1; j <= m; j++) Y[j] = 0;
  const best3 = (p: number, q: number, r: number): [number, number] => (p >= q && p >= r ? [p, 0] : q >= r ? [q, 1] : [r, 2]);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = i * w + j;
      const d = (i - 1) * w + (j - 1);
      const s = a[i - 1] === b[j - 1] && a[i - 1] !== 'X' ? MATCH : MISMATCH;
      const [vm, fm] = best3(M[d], X[d], Y[d]);
      M[c] = vm + s;
      tM[c] = fm;
      const up = (i - 1) * w + j;
      const [vx, fx] = best3(M[up] + OPEN, X[up] + EXTEND, Y[up] + OPEN);
      X[c] = vx;
      tX[c] = fx;
      const left = i * w + (j - 1);
      const [vy, fy] = best3(M[left] + OPEN, X[left] + OPEN, Y[left] + EXTEND);
      Y[c] = vy;
      tY[c] = fy;
    }
  }
  // Trailing gaps are free too: the best end anywhere on the last row or column
  let end = { i: n, j: m, state: 0, score: NEG };
  const consider = (i: number, j: number) => {
    const c = i * w + j;
    for (const [state, score] of [[0, M[c]], [1, X[c]], [2, Y[c]]] as const) if (score > end.score) end = { i, j, state, score };
  };
  for (let j = 0; j <= m; j++) consider(n, j);
  for (let i = 0; i <= n; i++) consider(i, m);
  const pairs: [number, number][] = [];
  let { i, j, state } = end;
  while (i > 0 && j > 0) {
    const c = i * w + j;
    if (state === 0) {
      pairs.push([i - 1, j - 1]);
      state = tM[c];
      i--;
      j--;
    } else if (state === 1) {
      state = tX[c];
      i--;
    } else {
      state = tY[c];
      j--;
    }
  }
  return { pairs: pairs.reverse(), score: end.score };
};

// --- The fit ---

const distance = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * Least-squares fit of `moving` onto `fixed` (paired points), pruned: while any pair is more than
 * CUTOFF apart, drop the lesser of the farthest 10% of all pairs or half of the pairs over the
 * cutoff, and fit again.
 */
export const fitPruned = (fixed: Vec3[], moving: Vec3[]) => {
  let kept = fixed.map((_, i) => i);
  let fit = superpose(moving, fixed);
  for (let round = 0; round < 500; round++) {
    const far = kept
      .map(i => ({ i, d: distance(fit.apply(moving[i]), fixed[i]) }))
      .filter(p => p.d > CUTOFF)
      .sort((x, y) => y.d - x.d);
    if (far.length === 0 || kept.length <= 3) break;
    const drop = Math.max(1, Math.min(Math.floor(0.1 * kept.length), Math.floor(0.5 * far.length)));
    const dropped = new Set(far.slice(0, drop).map(p => p.i));
    kept = kept.filter(i => !dropped.has(i));
    fit = superpose(kept.map(i => moving[i]), kept.map(i => fixed[i]));
  }
  const distances = fixed.map((p, i) => distance(fit.apply(moving[i]), p));
  const rms = (list: number[]) => Math.sqrt(list.reduce((s, d) => s + d * d, 0) / Math.max(1, list.length));
  return { fit, kept, distances, keptRmsd: rms(kept.map(i => distances[i])), allRmsd: rms(distances) };
};

// --- The whole overlay ---

export interface OverlayRegion { keys: string[]; label: string; max: number }

export interface OverlayResult {
  id: string; // The structure laid over
  mainChain: string;
  otherChain: string;
  shownChain: string; // Its chain ID in the 3D view: one the structure on screen doesn't use
  pdb: string; // That chain (and its ligands) moved onto the structure on screen
  identity: number; // Where the chains align, 0–1
  pairs: number; // Aligned residues
  mainLength: number;
  otherLength: number;
  core: number; // Pairs the fit kept (within 2 Å)
  coreRmsd: number; // Å, over them
  allRmsd: number; // Å, over every aligned pair
  distances: Map<string, number>; // Main residue key -> Å from its partner
  shownDistances: Map<string, number>; // The same, keyed by the laid-over residue (its key under shownChain)
  partnerOf: Map<string, string>; // Main residue key -> its partner's key under shownChain
  regions: OverlayRegion[]; // Where they differ most, largest first
  changed: OverlayChange[]; // Aligned residues that differ (a mutation, another construct)
  choices: { main: string; other: string; identity: number }[]; // Chain pairs that would also work
}

export interface OverlayChange { key: string; label: string; from: string; to: string } // "A:12", G here, D there

/** How a structure laid over is named: "1AKE", "AlphaFold P69441", "your ESMFold prediction". */
export const overlayName = (id: string) => {
  const accession = parseAlphaFoldId(id);
  return accession ? `AlphaFold ${accession}` : isEsmFoldId(id) ? 'your ESMFold prediction' : id.trim().toUpperCase();
};

/** "A:122–159" for keys in one chain, in order. */
const rangeLabel = (residues: Residue[]) => (residues.length === 1 ? residues[0].label : `${residues[0].label}–${residues[residues.length - 1].label.split(':')[1]}`);

/** A chain ID the structure on screen doesn't use, so selections by chain never reach the overlay. */
const freeChain = (used: Set<string>) => [...'zyxwvutsrqponmlkjihgfedcba9876543210'].find(c => !used.has(c)) ?? '~';

/**
 * Lays `otherPdb` over `mainPdb`: one chain onto one chain (the given ones, else the best match,
 * preferring `mainChain` and then the same chain ID). Throws a readable error when it isn't the same
 * protein or there is nothing to match.
 */
export const computeOverlay = (mainPdb: string, otherPdb: string, id: string, options: { mainChain?: string; otherChain?: string } = {}): OverlayResult => {
  const mains = chainsOf(mainPdb);
  const others = chainsOf(otherPdb);
  if (mains.length === 0) throw new Error('the structure on screen has no protein chain to line up');
  if (others.length === 0) throw new Error(`${id} has no protein chain to line up`);

  // Every pair of chains, aligning each distinct pair of sequences once
  const aligned = new Map<string, ReturnType<typeof alignSequences>>();
  const candidates = mains.flatMap(a => others.map(b => {
    const key = `${a.sequence}\n${b.sequence}`;
    if (!aligned.has(key)) aligned.set(key, alignSequences(a.sequence, b.sequence));
    const { pairs, score } = aligned.get(key)!;
    const same = pairs.filter(([i, j]) => a.sequence[i] === b.sequence[j]).length;
    const shorter = Math.min(a.residues.length, b.residues.length);
    return { a, b, pairs, score, identity: pairs.length ? same / pairs.length : 0, coverage: pairs.length / shorter, shared: same / shorter };
  }));
  // The same protein: nearly identical where the chains align, over at least half of the shorter
  // one (a shared tag or a short identical stretch is not enough)
  const usable = candidates
    .filter(c => c.identity >= SAME_PROTEIN && c.coverage >= 0.5 && c.pairs.length >= MIN_PAIRS)
    .sort((x, y) => y.score - x.score || Number(y.a.chain === y.b.chain) - Number(x.a.chain === x.b.chain));
  if (usable.length === 0) {
    const closest = Math.max(...candidates.map(c => c.shared));
    throw new Error(`${id} isn't the same protein: at most ${Math.round(closest * 100)}% of the sequences match`);
  }
  const wanted = (c: (typeof usable)[number]) => (!options.mainChain || c.a.chain === options.mainChain) && (!options.otherChain || c.b.chain === options.otherChain);
  const pick = usable.find(wanted)
    ?? usable.find(c => c.a.chain === options.mainChain && c.b.chain === c.a.chain)
    ?? usable.find(c => c.a.chain === options.mainChain)
    ?? usable[0];

  const fixed = pick.pairs.map(([i]) => pick.a.residues[i].point);
  const moving = pick.pairs.map(([, j]) => pick.b.residues[j].point);
  const { fit, kept, distances, keptRmsd, allRmsd } = fitPruned(fixed, moving);

  // Where they differ most: runs of residues over the cutoff along the main chain (a gap of a
  // couple of residues doesn't split a run)
  const byIndex = new Map(pick.pairs.map(([i], p) => [i, distances[p]]));
  const regions: OverlayRegion[] = [];
  let run: Residue[] = [];
  let runMax = 0;
  let lastFar = -10;
  const close = () => {
    if (run.length > 0) regions.push({ keys: run.map(r => r.key), label: rangeLabel(run), max: runMax });
    run = [];
    runMax = 0;
  };
  pick.a.residues.forEach((residue, i) => {
    const d = byIndex.get(i);
    if (d === undefined || d <= CUTOFF) return;
    if (i - lastFar > 3) close();
    // Fill the short gap so the run reads as one region
    for (let k = lastFar + 1; k < i && run.length > 0; k++) run.push(pick.a.residues[k]);
    run.push(residue);
    runMax = Math.max(runMax, d);
    lastFar = i;
  });
  close();
  regions.sort((x, y) => y.max - x.max);

  // The chain laid over: its atoms (and ligands, not waters) moved into place, under a free chain ID
  const shownChain = freeChain(new Set(mains.map(c => c.chain).concat(mainPdb.split('\n').filter(l => /^(ATOM|HETATM)/.test(l)).map(l => (l[21] ?? ' ').trim() || ' '))));
  const lines: string[] = [];
  for (const line of otherPdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!/^(ATOM|HETATM)/.test(line)) continue;
    if (((line[21] ?? ' ').trim() || ' ') !== pick.b.chain) continue;
    const altLoc = line[16];
    if (altLoc && altLoc !== ' ' && altLoc !== 'A') continue;
    if (WATERS.has(line.slice(17, 20).trim())) continue;
    const p = fit.apply([parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))]);
    lines.push(`${line.slice(0, 21)}${shownChain}${line.slice(22, 30)}${p.map(v => v.toFixed(3).padStart(8)).join('')}${line.slice(54)}`);
  }

  const differing = pick.pairs.filter(([i, j]) => pick.a.sequence[i] !== pick.b.sequence[j]);
  const shownKey = (key: string) => `${shownChain}${key.slice(key.indexOf('|'))}`;
  return {
    id,
    mainChain: pick.a.chain,
    otherChain: pick.b.chain,
    shownChain,
    pdb: `${lines.join('\n')}\nEND\n`,
    identity: pick.identity,
    pairs: pick.pairs.length,
    mainLength: pick.a.residues.length,
    otherLength: pick.b.residues.length,
    core: kept.length,
    coreRmsd: keptRmsd,
    allRmsd,
    distances: new Map(pick.pairs.map(([i], p) => [pick.a.residues[i].key, distances[p]])),
    shownDistances: new Map(pick.pairs.map(([, j], p) => [shownKey(pick.b.residues[j].key), distances[p]])),
    partnerOf: new Map(pick.pairs.map(([i, j]) => [pick.a.residues[i].key, shownKey(pick.b.residues[j].key)])),
    regions,
    changed: differing.map(([i, j]) => ({ key: pick.a.residues[i].key, label: pick.a.residues[i].label, from: pick.a.sequence[i], to: pick.b.sequence[j] })),
    choices: usable.map(c => ({ main: c.a.chain, other: c.b.chain, identity: c.identity })),
  };
};

// --- Other entries of the same protein (RCSB), to pick from ---

const RCSB_SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query';
const RCSB_GRAPHQL = 'https://data.rcsb.org/graphql';

export interface SameProteinEntry { id: string; title: string; resolution: number | null; method: string }

const entriesCache = new Map<string, Promise<SameProteinEntry[]>>();
const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (response.status === 204) return null; // RCSB search: no hits
  if (!response.ok) throw new Error(`RCSB responded ${response.status}`);
  return response.json();
};
const terminal = (attribute: string, operator: string, value: unknown) => ({ type: 'terminal', service: 'text', parameters: { attribute, operator, value } });

/** PDB entries of this UniProt protein that the viewer can open, best resolved first. */
export const sameProteinEntries = (accession: string): Promise<SameProteinEntry[]> => memoize(entriesCache, accession.toUpperCase(), async () => {
  const found = await postJson(RCSB_SEARCH, {
    query: {
      type: 'group',
      logical_operator: 'and',
      nodes: [
        terminal('rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession', 'exact_match', accession.toUpperCase()),
        // PDB-format files exist below 100,000 atoms and 63 chains
        terminal('rcsb_entry_info.deposited_atom_count', 'less', 100000),
        terminal('rcsb_entry_info.deposited_polymer_entity_instance_count', 'less_or_equal', 62),
      ],
    },
    return_type: 'entry',
    request_options: { paginate: { start: 0, rows: 25 }, sort: [{ sort_by: 'rcsb_entry_info.resolution_combined', direction: 'asc' }] },
  });
  const ids: string[] = (found?.result_set ?? []).map((r: any) => String(r.identifier)).filter((id: string) => /^[1-9][A-Z0-9]{3}$/.test(id));
  if (ids.length === 0) return [];
  const details = await postJson(RCSB_GRAPHQL, {
    query: 'query($ids: [String!]!) { entries(entry_ids: $ids) { rcsb_id struct { title } rcsb_entry_info { resolution_combined } exptl { method } } }',
    variables: { ids },
  });
  const byId = new Map<string, any>((details?.data?.entries ?? []).map((e: any) => [e.rcsb_id, e]));
  return ids.map(id => {
    const e = byId.get(id);
    return {
      id,
      title: String(e?.struct?.title ?? ''),
      resolution: typeof e?.rcsb_entry_info?.resolution_combined?.[0] === 'number' ? e.rcsb_entry_info.resolution_combined[0] : null,
      method: String(e?.exptl?.[0]?.method ?? ''),
    };
  });
});

// --- Colours: how far each residue sits from its partner, blue (in place) through white (2 Å, the
// fit's cutoff) to red (4 Å or more); grey where there is no partner ---

const STOPS: [number, number, number][] = [[59, 130, 246], [229, 231, 235], [239, 68, 68]];
export const DISTANCE_GRADIENT = `linear-gradient(to right, ${STOPS.map(c => `rgb(${c.join(' ')})`).join(', ')})`;
export const distanceColor = (d: number) => {
  const t = Math.max(0, Math.min(1, d / (2 * CUTOFF))) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const [r, g, b] = STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};
/** "Two colours": the structure on screen and the one laid over it. */
export const PAIR_COLORS = { main: '#60a5fa', other: '#fb923c' };

// --- For the chat ---

const onScreen = new Map<string, OverlayResult>(); // Structure ID -> the overlay shown on it

/** The overlay now on this structure (null when it closes), for the facts sent with a question. */
export const rememberOverlay = (structureId: string, result: OverlayResult | null) => {
  if (result) onScreen.set(structureId.trim().toUpperCase(), result);
  else onScreen.delete(structureId.trim().toUpperCase());
};

export const overlayFactsLine = (structureId: string) => {
  const r = onScreen.get(structureId.trim().toUpperCase());
  if (!r) return null;
  const regions = r.regions.slice(0, 3).map(g => `${g.label} (up to ${g.max.toFixed(1)} Å)`).join(', ');
  return [
    `Overlay (another structure of the same protein, lined up in the app): ${r.id} chain ${r.otherChain} on this structure's chain ${r.mainChain}, ${Math.round(r.identity * 100)}% identical where they align (${r.pairs} residues).`,
    ` They line up within ${r.coreRmsd.toFixed(1)} Å over the ${r.core} residues that stay put, ${r.allRmsd.toFixed(1)} Å over all ${r.pairs}.`,
    regions ? ` They differ most at ${regions}.` : ' No part is more than 2 Å from its partner.',
    r.changed.length ? ` Different residues (here→there): ${r.changed.slice(0, 6).map(c => `${c.label} ${c.from}→${c.to}`).join(', ')}${r.changed.length > 6 ? ` and ${r.changed.length - 6} more` : ''}.` : '',
  ].join('');
};
