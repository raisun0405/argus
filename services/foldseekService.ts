import type { SimilarSearchQuery, SimilarSearchResult, SimilarStructureHit } from '../types';

// --- FOLDSEEK STRUCTURE SEARCH ---
// Free public server (van Kempen et al., Nat Biotechnol 2024). Searches by 3D
// shape, so it finds relatives that sequence search misses. Keyless and
// CORS-enabled; the server is GPLv3, which is fine because we only call its API.

const FOLDSEEK_API = 'https://search.foldseek.com/api';
const DATABASES = ['afdb-swissprot', 'pdb100'];
const POLL_MS = 2000;
const MAX_WAIT_MS = 150000;
const SAME_PROTEIN_IDENTITY = 80; // PDB hits at/above this are the query protein or a close ortholog
const MAX_ROWS = 20;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- QUERY PREPARATION ---

// Columns 18-27 of an ATOM/HETATM record: residue name, chain, number, insertion code
const residueKey = (line: string) => line.slice(17, 27);

/**
 * Modified amino acids stored as HETATM (selenomethionine, phosphothreonine,
 * phosphoserine...): residues of the first model that have a backbone N, CA and C.
 * Leaving them out would cut gaps into the chain.
 */
const modifiedResidues = (lines: string[]) => {
  const atoms = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('HETATM')) continue;
    const names = atoms.get(residueKey(line)) ?? new Set<string>();
    names.add(line.slice(12, 16).trim());
    atoms.set(residueKey(line), names);
  }
  return new Set([...atoms].filter(([, names]) => names.has('N') && names.has('CA') && names.has('C')).map(([key]) => key));
};

const isChainAtom = (line: string, modified: Set<string>) =>
  line.startsWith('ATOM') || (line.startsWith('HETATM') && modified.has(residueKey(line)));

/** Protein chains of the first model (those with CA atoms) and their residue counts, in file order. */
export const proteinChains = (pdb: string): { chain: string; residues: number }[] => {
  const lines = pdb.split('\n');
  const modified = modifiedResidues(lines);
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.startsWith('ENDMDL')) break;
    const altLoc = line[16];
    if (isChainAtom(line, modified) && line.slice(12, 16).trim() === 'CA' && (altLoc === ' ' || altLoc === 'A')) {
      counts.set(line[21], (counts.get(line[21]) ?? 0) + 1);
    }
  }
  return [...counts].map(([chain, residues]) => ({ chain, residues }));
};

/** Shape search needs a real domain: prefer the given chain unless it is a short peptide. */
export const pickSearchChain = (chains: { chain: string; residues: number }[], preferred?: string): string | null => {
  if (chains.length === 0) return null;
  const wanted = chains.find(c => c.chain === preferred);
  if (wanted && wanted.residues >= 40) return wanted.chain;
  return chains.reduce((best, c) => (c.residues > best.residues ? c : best)).chain;
};

/** One chain of the first model as a standalone PDB file (keeps modified amino acids, drops ligands). */
export const extractChain = (pdb: string, chain: string): string => {
  const all = pdb.split('\n');
  const modified = modifiedResidues(all);
  const lines: string[] = [];
  for (const line of all) {
    if (line.startsWith('ENDMDL')) break;
    if (isChainAtom(line, modified) && line[21] === chain) lines.push(line);
  }
  return `${lines.join('\n')}\nEND\n`;
};

// --- RESULT PARSING ---

interface RawHit {
  target: string;
  prob: number;
  eval: number;
  seqId: number;
  qStartPos: number;
  qEndPos: number;
  qLen: number;
  taxId?: number;
  taxName?: string;
  tSeq?: string; // Full target sequence
}

// Same-protein test for PDB hits: share of 3-letter sequence fragments. Mutants or
// different constructs of one protein share most (~0.6-1.0); paralogs such as
// p63 vs p73 (~55% identical) share few (~0.2).
const SAME_SEQUENCE_JACCARD = 0.5;

const kmers = (seq: string, k = 3) => {
  const set = new Set<string>();
  for (let i = 0; i + k <= seq.length; i++) set.add(seq.slice(i, i + k));
  return set;
};

const jaccard = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union > 0 ? shared / union : 0;
};

const AFDB_TARGET = /^AF-([A-Z0-9]+)(?:-\d+)?-F\d+-model_v\d+\s*(.*)$/;
const PDB_TARGET = /^([0-9][a-z0-9]{3})-assembly\d+\.cif\.gz_([^\s-]+)\S*\s*(.*)$/i;

/** "HEN EGG WHITE LYSOZYME" -> "Hen egg white lysozyme" (PDB titles are often all caps). */
const tidyTitle = (title: string) => {
  const t = title.trim();
  return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

const coverageOf = (h: RawHit) => (h.qLen > 0 ? (h.qEndPos - h.qStartPos + 1) / h.qLen : 0);

const isFragment = (name: string) => /\(fragment\)/i.test(name);

/**
 * Protein family key: "Lysozyme C-3", "Lysozyme C II", "Lysozyme C, milk isozyme",
 * "Lysozyme C (Fragment)" and "Hemoglobin subunit alpha-A/Q/R/T" lose their
 * variant suffixes. Plain numbers are kept ("Tumor protein 63" is not
 * "Tumor protein 73"), and so are longer hyphen words ("Lysozyme-like").
 */
const familyKey = (name: string) => {
  let key = name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(',')[0].trim();
  for (let prev = ''; prev !== key; ) {
    prev = key;
    key = key.replace(/(-[a-z0-9]{1,3}(?:\/[a-z0-9]{1,3})*|\s+[ivx]+)$/i, '').trim();
  }
  return key.replace(/\s+/g, ' ');
};

interface Group {
  key: string;
  best: RawHit;
  representative: { hit: RawHit; structureId: string; label: string };
  members: number;
  minId: number;
  maxId: number;
  name: string;
  sameProtein?: boolean;
  kmers?: Set<string>; // PDB groups: sequence fingerprint of the first member
}

const toHit = (g: Group): SimilarStructureHit => ({
  structureId: g.representative.structureId,
  label: g.representative.label,
  name: g.name,
  organism: g.representative.hit.taxName,
  probability: g.representative.hit.prob,
  evalue: g.representative.hit.eval,
  identity: g.representative.hit.seqId,
  coverage: coverageOf(g.representative.hit),
  members: g.members,
  identityRange: [g.minId, g.maxId],
  ...(g.sameProtein ? { sameProtein: true } : {}),
});

const addToGroup = (
  groups: Map<string, Group>,
  key: string,
  name: string,
  hit: RawHit,
  candidate: { structureId: string; label: string },
  preferHuman: boolean
) => {
  const g = groups.get(key);
  if (!g) {
    groups.set(key, { key, best: hit, representative: { hit, ...candidate }, members: 1, minId: hit.seqId, maxId: hit.seqId, name });
    return;
  }
  g.members++;
  g.minId = Math.min(g.minId, hit.seqId);
  g.maxId = Math.max(g.maxId, hit.seqId);
  if (hit.eval < g.best.eval) g.best = hit;
  // Representative to open: the human protein if present (more relevant, and Variant Lens
  // works), then a full-length entry over a fragment, then the best match.
  const rank = (h: RawHit, label: string) =>
    (preferHuman && h.taxId === 9606 ? 2 : 0) + (isFragment(label) ? 0 : 1);
  const current = rank(g.representative.hit, g.name);
  const challenger = rank(hit, name);
  if (challenger > current || (challenger === current && hit.eval < g.representative.hit.eval)) {
    g.representative = { hit, ...candidate };
    g.name = name;
  }
};

const byEvalue = (a: Group, b: Group) => a.best.eval - b.best.eval;

const parseResults = (results: { db: string; alignments: RawHit[] | RawHit[][] }[], query: SimilarSearchQuery): SimilarSearchResult => {
  const excludeAcc = new Set(query.excludeAccessions.map(a => a.toUpperCase()));
  const excludePdb = new Set(query.excludePdbIds.map(p => p.toUpperCase()));
  const proteinGroups = new Map<string, Group>();
  const pdbGroups = new Map<string, Group>();
  const seenPdb = new Set<string>();
  let sameProtein = 0;
  let total = 0;

  for (const db of results ?? []) {
    const hits = ((db.alignments ?? []) as unknown[]).flat() as RawHit[];
    total += hits.length;

    if (db.db === 'afdb-swissprot') {
      const queryFamilies = new Set<string>();
      for (const hit of hits) {
        const m = String(hit.target).match(AFDB_TARGET);
        if (m && excludeAcc.has(m[1])) queryFamilies.add(familyKey(m[2] || m[1]));
      }
      for (const hit of hits) {
        const m = String(hit.target).match(AFDB_TARGET);
        if (!m || excludeAcc.has(m[1])) continue;
        const name = m[2].trim() || m[1];
        const key = familyKey(name);
        addToGroup(proteinGroups, key, name, hit, { structureId: `AF-${m[1]}-F1`, label: m[1] }, true);
        if (queryFamilies.has(key)) proteinGroups.get(key)!.sameProtein = true;
      }
    } else if (db.db === 'pdb100') {
      for (const hit of [...hits].sort((a, b) => a.eval - b.eval)) {
        const m = String(hit.target).match(PDB_TARGET);
        if (!m) continue;
        const pdbId = m[1].toUpperCase();
        if (excludePdb.has(pdbId) || seenPdb.has(pdbId)) continue;
        seenPdb.add(pdbId);
        if (hit.seqId >= SAME_PROTEIN_IDENTITY) {
          sameProtein++;
          continue;
        }
        // Mutants / other constructs of the same relative collapse into one row
        const fingerprint = hit.tSeq ? kmers(hit.tSeq) : null;
        let key = `${hit.taxName ?? ''}|${Math.round(hit.seqId)}`;
        if (fingerprint) {
          const match = [...pdbGroups.values()].find(g => g.kmers && jaccard(g.kmers, fingerprint) >= SAME_SEQUENCE_JACCARD);
          key = match ? match.key : `seq:${pdbId}`;
        }
        addToGroup(pdbGroups, key, tidyTitle(m[3]) || pdbId, hit, { structureId: pdbId, label: `${pdbId} · ${m[2]}` }, false);
        const group = pdbGroups.get(key)!;
        group.kmers ??= fingerprint ?? undefined;
      }
    }
  }

  return {
    queryLabel: query.label,
    queryStructureId: query.structureId,
    proteins: [...proteinGroups.values()].sort(byEvalue).slice(0, MAX_ROWS).map(toHit),
    experimental: [...pdbGroups.values()].sort(byEvalue).slice(0, MAX_ROWS).map(toHit),
    sameProteinStructures: sameProtein,
    totalHits: total,
  };
};

// --- SEARCH ---

/** Submit a single-chain structure, wait for the server, return grouped hits. */
export const searchSimilarStructures = async (
  query: SimilarSearchQuery,
  onStatus?: (status: string) => void
): Promise<SimilarSearchResult> => {
  const form = new FormData();
  form.append('q', new Blob([query.pdb], { type: 'text/plain' }), 'query.pdb');
  form.append('mode', '3diaa');
  for (const db of DATABASES) form.append('database[]', db);

  const submitted = await fetch(`${FOLDSEEK_API}/ticket`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!submitted.ok) throw new Error(`Foldseek rejected the search (${submitted.status})`);
  const ticket = await submitted.json();
  if (!ticket?.id) throw new Error('Foldseek did not accept the structure');

  const started = Date.now();
  let status: string = ticket.status;
  while (status !== 'COMPLETE') {
    if (status === 'ERROR') throw new Error('Foldseek could not process this structure');
    if (Date.now() - started > MAX_WAIT_MS) throw new Error('Foldseek is busy — try again in a minute');
    onStatus?.(status === 'RUNNING' ? 'Comparing shapes across PDB and AlphaFold DB…' : 'Waiting in the Foldseek queue…');
    await sleep(POLL_MS);
    // A failed status check (network blip, slow reply) just means "ask again"; MAX_WAIT_MS still ends the wait
    try {
      const poll = await fetch(`${FOLDSEEK_API}/ticket/${ticket.id}`, { signal: AbortSignal.timeout(15000) });
      status = (poll.ok ? (await poll.json())?.status : null) ?? 'PENDING';
    } catch {
      status = 'PENDING';
    }
  }

  onStatus?.('Grouping similar proteins…');
  const result = await fetch(`${FOLDSEEK_API}/result/${ticket.id}/0`, { signal: AbortSignal.timeout(60000) });
  if (!result.ok) throw new Error(`Foldseek results unavailable (${result.status})`);
  return parseResults((await result.json())?.results, query);
};
