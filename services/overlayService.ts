import { superpose, type Vec3 } from './superpose';
import { ONE_LETTER, WATERS } from './structureModel';
import { BoundedMap, memoize } from './http';
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
 * the other). Returns the aligned positions [i in a, j in b] and the score. The scores are kept a row
 * at a time and only the way back for every cell: 3 bytes a cell (it was 15, 240 MB for two chains of
 * 4,000 residues), with no small arrays made per cell.
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
  // Row i-1 (p) and row i (c) of: M, a[i-1] with b[j-1]; X, a[i-1] against a gap; Y, b[j-1] against a gap
  let Mp = new Float32Array(w).fill(NEG);
  let Xp = new Float32Array(w).fill(NEG);
  let Yp = new Float32Array(w).fill(NEG);
  let Mc = new Float32Array(w);
  let Xc = new Float32Array(w);
  let Yc = new Float32Array(w);
  // Which of M, X, Y each cell came from (0, 1, 2)
  const tM = new Uint8Array((n + 1) * w);
  const tX = new Uint8Array((n + 1) * w);
  const tY = new Uint8Array((n + 1) * w);
  // The last column of every row, where a trailing gap may start
  const lastM = new Float32Array(n + 1);
  const lastX = new Float32Array(n + 1);
  const lastY = new Float32Array(n + 1);
  Mp[0] = 0;
  for (let j = 1; j <= m; j++) Yp[j] = 0; // Leading gaps are free
  lastM[0] = Mp[m];
  lastX[0] = Xp[m];
  lastY[0] = Yp[m];
  for (let i = 1; i <= n; i++) {
    Mc[0] = NEG;
    Xc[0] = 0; // Leading gaps are free
    Yc[0] = NEG;
    const ai = a.charCodeAt(i - 1);
    const known = a[i - 1] !== 'X';
    const row = i * w;
    for (let j = 1; j <= m; j++) {
      const c = row + j;
      const s = known && ai === b.charCodeAt(j - 1) ? MATCH : MISMATCH;
      // Diagonal, from row i-1, column j-1
      let v = Mp[j - 1];
      let f = 0;
      if (Xp[j - 1] > v) { v = Xp[j - 1]; f = 1; }
      if (Yp[j - 1] > v) { v = Yp[j - 1]; f = 2; }
      Mc[j] = v + s;
      tM[c] = f;
      // Up, from row i-1, column j
      v = Mp[j] + OPEN;
      f = 0;
      if (Xp[j] + EXTEND > v) { v = Xp[j] + EXTEND; f = 1; }
      if (Yp[j] + OPEN > v) { v = Yp[j] + OPEN; f = 2; }
      Xc[j] = v;
      tX[c] = f;
      // Left, from row i, column j-1
      v = Mc[j - 1] + OPEN;
      f = 0;
      if (Xc[j - 1] + OPEN > v) { v = Xc[j - 1] + OPEN; f = 1; }
      if (Yc[j - 1] + EXTEND > v) { v = Yc[j - 1] + EXTEND; f = 2; }
      Yc[j] = v;
      tY[c] = f;
    }
    lastM[i] = Mc[m];
    lastX[i] = Xc[m];
    lastY[i] = Yc[m];
    [Mp, Mc] = [Mc, Mp];
    [Xp, Xc] = [Xc, Xp];
    [Yp, Yc] = [Yc, Yp];
  }
  // Trailing gaps are free too: the best end anywhere on the last row (now Mp, Xp, Yp) or column
  let end = { i: n, j: m, state: 0, score: NEG };
  const consider = (i: number, j: number, scores: readonly number[]) => {
    scores.forEach((score, state) => { if (score > end.score) end = { i, j, state, score }; });
  };
  for (let j = 0; j <= m; j++) consider(n, j, [Mp[j], Xp[j], Yp[j]]);
  for (let i = 0; i <= n; i++) consider(i, m, [lastM[i], lastX[i], lastY[i]]);
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

// Before aligning: the three-residue words two chains share, as a share of the fewer. Two chains of
// the same protein (90% identical over half the shorter) share well over a third; different proteins
// a few percent
const MIN_WORD_SHARE = 0.2;
const ALIGN_BUDGET = 40_000_000; // Cells aligned for one overlay at most (about a second)
const words = (sequence: string) => {
  const found = new Set<string>();
  for (let i = 0; i + 3 <= sequence.length; i++) {
    const word = sequence.slice(i, i + 3);
    if (!word.includes('X')) found.add(word);
  }
  return found;
};
const wordShare = (a: Set<string>, b: Set<string>) => {
  const [fewer, more] = a.size <= b.size ? [a, b] : [b, a];
  if (fewer.size === 0) return 0;
  let shared = 0;
  for (const word of fewer) if (more.has(word)) shared++;
  return shared / fewer.size;
};

// Alignments already made, so picking another chain (or the file gaining AlphaFill's ligands) doesn't
// redo them: the last few dozen pairs of sequences, the oldest dropped first
const alignments = new BoundedMap<string, ReturnType<typeof alignSequences>>(48);
const alignedPair = (a: string, b: string) => {
  const key = `${a}\n${b}`;
  const found = alignments.get(key) ?? alignSequences(a, b);
  alignments.set(key, found);
  return found;
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

  // Every pair of chains that may be the same protein, aligning each distinct pair of sequences once.
  // A look at their three-residue words first: the same protein shares most of them, and aligning every
  // pair of a complex of 60 different chains took minutes. The pair asked for, and the most alike, are
  // always aligned; the rest most alike first, within a budget
  const wanted = (a: Chain, b: Chain) => (!options.mainChain || a.chain === options.mainChain) && (!options.otherChain || b.chain === options.otherChain);
  const asked = (a: Chain, b: Chain) => Boolean(options.mainChain || options.otherChain) && wanted(a, b);
  const wordsOf = new Map([...mains, ...others].map(c => [c.sequence, words(c.sequence)]));
  const pairs = mains.flatMap(a => others.map(b => ({ a, b, key: `${a.sequence}\n${b.sequence}`, alike: wordShare(wordsOf.get(a.sequence)!, wordsOf.get(b.sequence)!) })));
  // Each distinct pair of sequences costs once (a homodimer's four chain pairs are one alignment)
  const taken = new Set<string>();
  let cells = 0;
  [...pairs].sort((x, y) => y.alike - x.alike).forEach((p, k) => {
    if (taken.has(p.key)) return;
    const cost = p.a.sequence.length * p.b.sequence.length;
    if (k === 0 || asked(p.a, p.b) || (p.alike >= MIN_WORD_SHARE && cells + cost <= ALIGN_BUDGET)) {
      taken.add(p.key);
      cells += cost;
    }
  });
  // In the chains' own order, so that between equally good pairs the same one is picked as before
  const thisTime = new Map<string, ReturnType<typeof alignSequences>>();
  const candidates = pairs.filter(p => taken.has(p.key)).map(({ a, b, key }) => {
    if (!thisTime.has(key)) thisTime.set(key, alignedPair(a.sequence, b.sequence));
    const { pairs: aligned, score } = thisTime.get(key)!;
    const same = aligned.filter(([i, j]) => a.sequence[i] === b.sequence[j]).length;
    const shorter = Math.min(a.residues.length, b.residues.length);
    return { a, b, pairs: aligned, score, identity: aligned.length ? same / aligned.length : 0, coverage: aligned.length / shorter, shared: same / shorter };
  });
  // The same protein: nearly identical where the chains align, over at least half of the shorter
  // one (a shared tag or a short identical stretch is not enough)
  const usable = candidates
    .filter(c => c.identity >= SAME_PROTEIN && c.coverage >= 0.5 && c.pairs.length >= MIN_PAIRS)
    .sort((x, y) => y.score - x.score || Number(y.a.chain === y.b.chain) - Number(x.a.chain === x.b.chain));
  if (usable.length === 0) {
    const closest = Math.max(...candidates.map(c => c.shared));
    throw new Error(`${id} isn't the same protein: at most ${Math.round(closest * 100)}% of the sequences match`);
  }
  const pick = usable.find(c => wanted(c.a, c.b))
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

const entriesCache = new BoundedMap<string, Promise<SameProteinEntry[]>>(20);
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

const onScreen = new BoundedMap<string, OverlayResult>(4); // Structure ID -> the overlay shown on it

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
