import type {
  AmClass,
  KnownVariant,
  ResidueVariant,
  VariantLensData,
  VariantProtein,
} from '../types';
import { fetchOrNull, memoize } from './http';
import { alphaFoldId, parseAlphaFoldId } from './alphafoldService';

// --- VARIANT LENS DATA LAYER ---
// Maps a structure's residues onto UniProt positions — PDB entries through
// PDBe SIFTS + residue listing, AlphaFold models directly (they use UniProt
// numbering) — then joins AlphaMissense predictions (AlphaFold DB per-protein
// files) and UniProt natural variants. Every source is free, keyless and
// CORS-enabled, so this runs in the browser and never touches /api/analyze
// or the AI credit.

const PDBE_API = 'https://www.ebi.ac.uk/pdbe/api';
const AFDB_FILES = 'https://alphafold.ebi.ac.uk/files';
const UNIPROT_API = 'https://rest.uniprot.org/uniprotkb';
const MAX_PROTEINS = 6; // Large complexes: only the first few human proteins

// AlphaMissense class thresholds (Cheng et al., Science 2023)
export const AM_BENIGN_MAX = 0.34;
export const AM_PATHOGENIC_MIN = 0.564;

export const AM_CLASS_LABEL: Record<AmClass, string> = {
  likely_benign: 'Likely benign',
  ambiguous: 'Ambiguous',
  likely_pathogenic: 'Likely pathogenic',
};

export const classifyAm = (score: number): AmClass =>
  score >= AM_PATHOGENIC_MIN ? 'likely_pathogenic' : score <= AM_BENIGN_MAX ? 'likely_benign' : 'ambiguous';

// --- COLOUR SCALE (shared by the 3D colouring and the legend) ---
// Diverging blue -> grey -> red, with stops on the class thresholds.
const AM_STOPS: [number, [number, number, number]][] = [
  [0, [59, 130, 246]],
  [AM_BENIGN_MAX, [147, 197, 253]],
  [0.45, [228, 228, 231]],
  [AM_PATHOGENIC_MIN, [252, 165, 165]],
  [1, [239, 68, 68]],
];

export const AM_NO_DATA_COLOR = '#52525b';

export const AM_GRADIENT_CSS = `linear-gradient(90deg, ${AM_STOPS.map(
  ([t, c]) => `rgb(${c.join(',')}) ${+(t * 100).toFixed(1)}%`
).join(', ')})`;

export const amColor = (score: number): string => {
  const s = Math.min(1, Math.max(0, score));
  for (let i = 1; i < AM_STOPS.length; i++) {
    const [t1, c1] = AM_STOPS[i];
    if (s <= t1) {
      const [t0, c0] = AM_STOPS[i - 1];
      const k = (s - t0) / (t1 - t0);
      return `#${c0.map((v, j) => Math.round(v + (c1[j] - v) * k).toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return '#ef4444';
};

/** Lookup key matching 3Dmol atoms: author chain + author residue number + insertion code. */
export const variantKey = (chain: string, resi: number, icode?: string | null) => {
  const ic = (icode ?? '').trim();
  return `${chain}|${resi}${ic ? `^${ic}` : ''}`;
};

// --- HELPERS ---

const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G',
  HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S',
  THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U', PYL: 'O',
};

const DISEASE_HINT =
  /cancer|carcinoma|tumou?r|leuka?emia|lymphoma|syndrome|disease|ana?emia|deficiency|dystrophy|thalass|myopathy|ataxia|epilepsy|neuropathy|dysplasia/i;

const unique = <T,>(items: T[]) => [...new Set(items)];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cache key for a structure: "AF-P04637-F1" for AlphaFold models, lower-case PDB ID otherwise. */
export const normalizeStructureId = (structureId: string) => {
  const accession = parseAlphaFoldId(structureId);
  return accession ? alphaFoldId(accession) : structureId.trim().toLowerCase();
};

// --- SIFTS: which UniProt proteins (and residue ranges) are in the entry ---

interface SiftsSegment {
  chain: string; // Author chain ID
  structAsymId: string; // Label chain ID (joins with the residue listing)
  unpStart: number;
  unpEnd: number;
  resStart: number; // PDBe sequential residue numbers (label_seq_id)
  resEnd: number;
}

export interface SiftsAccession {
  accession: string;
  identifier: string;
  isHuman: boolean;
  segments: SiftsSegment[];
}

const siftsCache = new Map<string, Promise<SiftsAccession[]>>();

export const fetchSiftsMapping = (pdbId: string): Promise<SiftsAccession[]> => {
  const id = pdbId.toLowerCase();
  return memoize(siftsCache, id, async () => {
    const response = await fetchOrNull(`${PDBE_API}/mappings/uniprot/${id}`);
    if (!response) return [];
    const json = await response.json();
    const proteins = json?.[id]?.UniProt ?? {};
    return Object.entries<any>(proteins).map(([accession, entry]) => {
      const identifier: string = entry?.identifier ?? entry?.name ?? accession;
      const segments: SiftsSegment[] = (entry?.mappings ?? [])
        .map((m: any) => ({
          chain: m?.chain_id,
          structAsymId: m?.struct_asym_id,
          unpStart: m?.unp_start,
          unpEnd: m?.unp_end,
          resStart: m?.start?.residue_number,
          resEnd: m?.end?.residue_number,
        }))
        .filter((s: SiftsSegment) =>
          s.chain && s.structAsymId && [s.unpStart, s.unpEnd, s.resStart, s.resEnd].every(Number.isInteger)
        );
      return { accession, identifier, isHuman: /_HUMAN$/.test(identifier), segments };
    });
  });
};

// --- PDBe residue listing: exact label <-> author numbering, incl. insertion codes ---

interface ListedResidue {
  residueNumber: number;
  authorNumber: number;
  insCode: string;
  name: string;
  observed: boolean;
}

const listingCache = new Map<string, Promise<Map<string, ListedResidue[]>>>();

/** Residues of every polymer chain, keyed by label chain ID (struct_asym_id). */
export const fetchResidueListing = (id: string) =>
  memoize(listingCache, id, async () => {
    const byAsym = new Map<string, ListedResidue[]>();
    const response = await fetchOrNull(`${PDBE_API}/pdb/entry/residue_listing/${id}`);
    if (!response) return byAsym;
    const json = await response.json();
    for (const molecule of json?.[id]?.molecules ?? []) {
      for (const chain of molecule?.chains ?? []) {
        const residues: ListedResidue[] = (chain?.residues ?? [])
          .filter((r: any) => Number.isInteger(r?.residue_number) && Number.isInteger(r?.author_residue_number))
          .map((r: any) => ({
            residueNumber: r.residue_number,
            authorNumber: r.author_residue_number,
            insCode: String(r.author_insertion_code ?? '').trim(),
            name: String(r.residue_name ?? ''),
            observed: (r.observed_ratio ?? 0) > 0,
          }));
        byAsym.set(chain.struct_asym_id, residues);
      }
    }
    return byAsym;
  });

// --- Residue -> UniProt position ---

const sequenceCache = new Map<string, Promise<string>>();

const fetchUniProtSequence = (accession: string) =>
  memoize(sequenceCache, accession, async () => {
    const response = await fetchOrNull(`${UNIPROT_API}/${accession}.json?fields=sequence`);
    if (!response) return '';
    const json = await response.json();
    return typeof json?.sequence?.value === 'string' ? json.sequence.value : '';
  });

/**
 * UniProt position of each residue (label numbering) in one SIFTS segment. PDBe
 * reports a construct with a deletion or insertion as ONE segment whose UniProt and
 * residue ranges differ in length (KIT in 1T46 lacks the kinase insert, 695-752), so
 * a plain offset misnumbers everything after the gap. Such a segment is split where
 * numbering from its start and numbering from its end best agree with the sequence.
 */
const segmentPositions = (segment: SiftsSegment, residues: ListedResidue[], sequence: string) => {
  const positions = new Map<number, number>();
  const inSegment = residues
    .filter(r => r.residueNumber >= segment.resStart && r.residueNumber <= segment.resEnd)
    .sort((a, b) => a.residueNumber - b.residueNumber);
  const fromStart = (r: ListedResidue) => segment.unpStart + (r.residueNumber - segment.resStart);

  if (segment.unpEnd - segment.unpStart === segment.resEnd - segment.resStart) {
    for (const r of inSegment) positions.set(r.residueNumber, fromStart(r));
    return positions;
  }
  if (!sequence) return positions; // Can't place the gap: better unmapped than misnumbered

  const fromEnd = (r: ListedResidue) => segment.unpEnd - (segment.resEnd - r.residueNumber);
  const matches = (r: ListedResidue, position: number) => THREE_TO_ONE[r.name] === sequence[position - 1];
  // Residues before the split use start numbering, the rest end numbering; pick the split
  // that makes the most residues match their UniProt residue
  const n = inSegment.length;
  const prefix = new Array<number>(n + 1).fill(0);
  const suffix = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + Number(matches(inSegment[i], fromStart(inSegment[i])));
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + Number(matches(inSegment[i], fromEnd(inSegment[i])));
  let split = 0;
  for (let i = 1; i <= n; i++) if (prefix[i] + suffix[i] > prefix[split] + suffix[split]) split = i;

  inSegment.forEach((r, i) => {
    const position = i < split ? fromStart(r) : fromEnd(r);
    if (position >= segment.unpStart && position <= segment.unpEnd) positions.set(r.residueNumber, position);
  });
  return positions;
};

/** UniProt position of every residue of one protein in an entry: label chain ID -> residue number -> position. */
export const loadSegmentPositions = async (
  entry: SiftsAccession,
  listing: Map<string, ListedResidue[]>
): Promise<Map<string, Map<number, number>>> => {
  const gapped = entry.segments.some(s => s.unpEnd - s.unpStart !== s.resEnd - s.resStart);
  const sequence = gapped ? await fetchUniProtSequence(entry.accession) : '';
  const byAsym = new Map<string, Map<number, number>>();
  for (const segment of entry.segments) {
    const positions = byAsym.get(segment.structAsymId) ?? new Map<number, number>();
    for (const [residueNumber, position] of segmentPositions(segment, listing.get(segment.structAsymId) ?? [], sequence)) {
      positions.set(residueNumber, position);
    }
    byAsym.set(segment.structAsymId, positions);
  }
  return byAsym;
};

/** Author chain ID of each label chain of a protein, from its SIFTS segments. */
const chainsByAsym = (entry: SiftsAccession) => new Map(entry.segments.map(s => [s.structAsymId, s.chain] as const));

// --- AlphaMissense: per-protein substitution scores from AlphaFold DB ---

interface AmPosition {
  wt: string;
  subs: Record<string, number>;
  mean: number;
  worstAlt: string;
  worstScore: number;
}

const amCache = new Map<string, Promise<Map<number, AmPosition> | null>>();

const fetchAlphaMissense = (accession: string) =>
  memoize(amCache, accession, async () => {
    const response = await fetchOrNull(`${AFDB_FILES}/AF-${accession}-F1-aa-substitutions.csv`);
    if (!response) return null; // Not human, or not in AlphaFold DB
    const lines = (await response.text()).split(/\r?\n/);
    const header = lines[0]?.split(',') ?? [];
    const iVariant = header.indexOf('protein_variant');
    const iScore = header.indexOf('am_pathogenicity');
    if (iVariant < 0 || iScore < 0) return null;

    const byPosition = new Map<number, AmPosition>();
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const cols = lines[i].split(',');
      const variant = cols[iVariant] ?? '';
      const score = parseFloat(cols[iScore]);
      const position = parseInt(variant.slice(1, -1), 10);
      if (!Number.isFinite(position) || !Number.isFinite(score)) continue;
      let entry = byPosition.get(position);
      if (!entry) {
        entry = { wt: variant[0], subs: {}, mean: 0, worstAlt: '', worstScore: -1 };
        byPosition.set(position, entry);
      }
      const alt = variant[variant.length - 1];
      entry.subs[alt] = score;
      if (score > entry.worstScore) {
        entry.worstScore = score;
        entry.worstAlt = alt;
      }
    }
    for (const entry of byPosition.values()) {
      const scores = Object.values(entry.subs);
      entry.mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
    return byPosition;
  });

// --- UniProt: gene name + natural variants with disease annotations ---

interface UniProtVariants {
  identifier?: string; // UniProt entry name, e.g. P53_HUMAN
  gene?: string;
  proteinName?: string;
  variants: Map<number, KnownVariant[]>;
}

const uniprotCache = new Map<string, Promise<UniProtVariants | null>>();

/** "in LFS; germline mutation..." -> ["LFS"]; "in Hb C; ..." -> ["Hb C"] */
const firstClauseTags = (description: string): string[] => {
  const clause = description
    .split(';')
    .map(c => c.trim())
    .find(c => /^in\s/i.test(c));
  if (!clause) return [];
  return clause
    .replace(/^in\s+(?:an?\s+)?/i, '')
    .split(/\s*,\s*|\s+and\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 0 && t.length <= 32)
    .slice(0, 2);
};

const fetchUniProtVariants = (accession: string) =>
  memoize(uniprotCache, accession, async () => {
    const response = await fetchOrNull(
      `${UNIPROT_API}/${accession}.json?fields=id,ft_variant,cc_disease,gene_names,protein_name`
    );
    if (!response) return null;
    const json = await response.json();

    const diseaseMatchers: { name: string; pattern: RegExp }[] = [];
    for (const comment of json?.comments ?? []) {
      const disease = comment?.disease;
      if (comment?.commentType === 'DISEASE' && disease?.acronym && disease?.diseaseId) {
        diseaseMatchers.push({
          name: disease.diseaseId,
          pattern: new RegExp(`(^|[^A-Za-z0-9-])${escapeRegExp(disease.acronym)}(?![A-Za-z0-9-])`),
        });
      }
    }

    const variants = new Map<number, KnownVariant[]>();
    for (const feature of json?.features ?? []) {
      if (feature?.type !== 'Natural variant') continue;
      const position = feature.location?.start?.value;
      if (!Number.isInteger(position) || feature.location?.end?.value !== position) continue;
      const wt = feature.alternativeSequence?.originalSequence;
      if (typeof wt !== 'string' || wt.length !== 1) continue;

      const description = String(feature.description ?? '').replace(/;?\s*dbSNP:rs\d+/g, '').trim();
      const tags = firstClauseTags(description);
      const diseaseNames = unique(diseaseMatchers.filter(m => m.pattern.test(description)).map(m => m.name));
      const diseaseLinked = diseaseNames.length > 0 || DISEASE_HINT.test(description);

      for (const alt of feature.alternativeSequence?.alternativeSequences ?? []) {
        if (typeof alt !== 'string' || alt.length !== 1) continue;
        const atPosition = variants.get(position) ?? [];
        const existing = atPosition.find(k => k.alt === alt);
        if (existing) {
          // Same substitution reported in several features: merge annotations
          existing.tags = unique([...existing.tags, ...tags]).slice(0, 3);
          existing.diseaseNames = unique([...existing.diseaseNames, ...diseaseNames]);
          existing.diseaseLinked ||= diseaseLinked;
        } else {
          atPosition.push({ position, wt, alt, tags, diseaseNames, diseaseLinked });
        }
        variants.set(position, atPosition);
      }
    }

    return {
      identifier: json?.uniProtkbId,
      gene: json?.genes?.[0]?.geneName?.value,
      proteinName: json?.proteinDescription?.recommendedName?.fullName?.value,
      variants,
    };
  });

// --- ASSEMBLY ---

// Named diseases (UniProt disease entries) first, then other disease mentions,
// then the AlphaMissense score of the exact substitution.
const byRelevance = (a: KnownVariant, b: KnownVariant) =>
  Number(b.diseaseNames.length > 0) - Number(a.diseaseNames.length > 0) ||
  Number(b.diseaseLinked) - Number(a.diseaseLinked) ||
  (b.amScore ?? -1) - (a.amScore ?? -1) ||
  a.position - b.position;

const residueVariant = (
  accession: string,
  protein: string,
  position: number,
  prediction: AmPosition,
  uniprot: UniProtVariants | null
): ResidueVariant => ({
  accession,
  protein,
  position,
  wt: prediction.wt,
  mean: prediction.mean,
  amClass: classifyAm(prediction.mean),
  worstAlt: prediction.worstAlt,
  worstScore: prediction.worstScore,
  known: (uniprot?.variants.get(position) ?? [])
    .map(k => ({ ...k, amScore: prediction.subs[k.alt] }))
    .sort(byRelevance),
});

// Lens data built while UniProt was failing (no known variants): shown, but not cached
const incomplete = new WeakSet<VariantLensData>();

// AlphaFold models: one chain "A" in UniProt numbering, so the mapping is direct.
const buildAlphaFoldVariantLens = async (structureId: string, accession: string): Promise<VariantLensData> => {
  const data: VariantLensData = { structureId, proteins: [], residues: {}, mismatches: {}, sites: {}, skipped: [] };
  const [am, uniprot] = await Promise.all([
    fetchAlphaMissense(accession),
    fetchUniProtVariants(accession).catch(() => {
      incomplete.add(data);
      return null;
    }),
  ]);
  const identifier = uniprot?.identifier ?? accession;
  if (!am && !/_HUMAN$/.test(identifier)) {
    data.skipped.push({ accession, identifier }); // AlphaMissense covers human proteins only
    return data;
  }

  const protein: VariantProtein = {
    accession,
    identifier,
    gene: uniprot?.gene,
    proteinName: uniprot?.proteinName,
    chains: ['A'],
    available: Boolean(am),
    mappedResidues: 0,
    pathogenicResidues: 0,
    knownVariants: [],
  };
  data.proteins.push(protein);
  if (!am) return data;

  const label = uniprot?.gene ?? identifier.replace(/_HUMAN$/, '');
  for (const [position, prediction] of am) {
    const rv = residueVariant(accession, label, position, prediction, uniprot);
    data.residues[variantKey('A', position)] = rv;
    data.sites[`${accession}|${position}`] = [{ chain: 'A', resi: position, icode: '' }];
    if (rv.amClass === 'likely_pathogenic') protein.pathogenicResidues++;
    protein.knownVariants.push(...rv.known);
  }
  protein.mappedResidues = am.size;
  protein.knownVariants.sort(byRelevance);
  return data;
};

const buildPdbVariantLens = async (id: string): Promise<VariantLensData> => {
  const sifts = await fetchSiftsMapping(id);
  const human = sifts.filter(a => a.isHuman && a.segments.length > 0).slice(0, MAX_PROTEINS);
  const data: VariantLensData = {
    structureId: id,
    proteins: [],
    residues: {},
    mismatches: {},
    sites: {},
    skipped: sifts.filter(a => !a.isHuman).map(({ accession, identifier }) => ({ accession, identifier })),
  };
  if (human.length === 0) return data;

  const [listing, sources] = await Promise.all([
    fetchResidueListing(id),
    Promise.all(
      human.map(a =>
        Promise.all([
          fetchAlphaMissense(a.accession),
          fetchUniProtVariants(a.accession).catch(() => {
            incomplete.add(data);
            return null;
          }),
        ])
      )
    ),
  ]);
  const positions = await Promise.all(human.map(entry => loadSegmentPositions(entry, listing)));

  human.forEach((entry, idx) => {
    const [am, uniprot] = sources[idx];
    const protein: VariantProtein = {
      accession: entry.accession,
      identifier: entry.identifier,
      gene: uniprot?.gene,
      proteinName: uniprot?.proteinName,
      chains: unique(entry.segments.map(s => s.chain)),
      available: Boolean(am),
      mappedResidues: 0,
      pathogenicResidues: 0,
      knownVariants: [],
    };
    data.proteins.push(protein);
    if (!am) return;

    const label = uniprot?.gene ?? entry.identifier.replace(/_HUMAN$/, '');
    const byPosition = new Map<number, ResidueVariant>();
    const observed = new Set<number>();

    const asymChains = chainsByAsym(entry);
    for (const [asym, byResidue] of positions[idx]) {
      const chain = asymChains.get(asym)!;
      for (const residue of listing.get(asym) ?? []) {
        const position = byResidue.get(residue.residueNumber);
        if (position === undefined) continue;
        const prediction = am.get(position);
        if (!prediction) continue;

        let rv = byPosition.get(position);
        if (!rv) {
          rv = residueVariant(entry.accession, label, position, prediction, uniprot);
          byPosition.set(position, rv);
        }

        const key = variantKey(chain, residue.authorNumber, residue.insCode);
        data.residues[key] = rv;
        const inStructure = THREE_TO_ONE[residue.name];
        if (inStructure && inStructure !== prediction.wt) data.mismatches[key] = inStructure;

        if (residue.observed) {
          observed.add(position);
          (data.sites[`${entry.accession}|${position}`] ??= []).push({
            chain,
            resi: residue.authorNumber,
            icode: residue.insCode,
          });
        }
      }
    }

    protein.mappedResidues = observed.size;
    protein.pathogenicResidues = [...observed].filter(
      p => byPosition.get(p)?.amClass === 'likely_pathogenic'
    ).length;
    protein.knownVariants = [...observed].flatMap(p => byPosition.get(p)?.known ?? []).sort(byRelevance);
  });

  return data;
};

const lensCache = new Map<string, Promise<VariantLensData>>();

/** Build (or reuse) the Variant Lens data for a PDB entry or an AlphaFold model ("AF-P04637-F1"). */
export const loadVariantLens = (structureId: string): Promise<VariantLensData> => {
  const id = normalizeStructureId(structureId);
  const accession = parseAlphaFoldId(id);
  const pending = memoize(lensCache, id, () =>
    accession ? buildAlphaFoldVariantLens(id, accession) : buildPdbVariantLens(id)
  );
  // Built during a UniProt outage: use it now, but fetch again next time
  pending.then(data => { if (incomplete.has(data) && lensCache.get(id) === pending) lensCache.delete(id); }, () => {});
  return pending;
};

const residueMapCache = new Map<string, Promise<Record<string, number>>>();

/**
 * PDB residue (variantKey: chain + author number + insertion code) -> UniProt
 * position, for one protein of the entry. Used to carry highlights from an
 * experimental entry onto its AlphaFold model.
 */
export const loadUniProtResidueMap = (pdbId: string, accession: string): Promise<Record<string, number>> => {
  const id = pdbId.toLowerCase();
  return memoize(residueMapCache, `${id}|${accession}`, async () => {
    const [sifts, listing] = await Promise.all([fetchSiftsMapping(id), fetchResidueListing(id)]);
    const map: Record<string, number> = {};
    const entry = sifts.find(a => a.accession === accession);
    if (!entry) return map;
    const asymChains = chainsByAsym(entry);
    for (const [asym, byResidue] of await loadSegmentPositions(entry, listing)) {
      for (const residue of listing.get(asym) ?? []) {
        const position = byResidue.get(residue.residueNumber);
        if (position !== undefined) map[variantKey(asymChains.get(asym)!, residue.authorNumber, residue.insCode)] = position;
      }
    }
    return map;
  });
};
