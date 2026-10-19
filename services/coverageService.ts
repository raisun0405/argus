import { BoundedMap, fetchOrNull, memoize } from './http';
import { fetchSiftsMapping, fetchUniProtSequence, loadUniProtResidueMap, variantKey } from './variantService';
import type { StructureModel } from './structureModel';

// --- COVERAGE ---
// Which part of its protein the structure on screen holds. An experimental entry often holds only part
// of it (a domain, a fragment, a mature chain), and the 3D view doesn't say so. Counted from the residues
// actually present in the file, matched to UniProt positions through SIFTS (the residue map the AlphaFold
// switch already uses), never from an entry's construct: PDBe's summaries count every residue of the
// sample, resolved or not (one cryo-EM entry of p53 "covers" all 393 residues while showing far fewer).
// For an AlphaFold model: the residues resolved in any PDB entry of its protein, from PDBe-KB's
// residue-level mapping (observed residues of each entry's best chain).

const PDBE_GRAPH = 'https://www.ebi.ac.uk/pdbe/graph-api';

export type Range = [number, number];

export interface EntryCoverage {
  accession: string;
  identifier: string; // UniProt entry name, e.g. P53_HUMAN
  length: number; // The protein's full length (UniProt)
  chains: string[]; // Its chains in the entry
  present: number; // Its residues in the file
  ranges: Range[]; // UniProt positions in the file
  missing: Range[]; // ...and not
  renumbered: boolean; // The file numbers its residues differently from UniProt
}

export interface ExperimentalCoverage {
  accession: string;
  length: number;
  entries: number; // PDB entries that resolve at least one of its residues
  resolved: number;
  ranges: Range[]; // UniProt positions resolved in at least one entry
  missing: Range[]; // ...and in none
}

/** Sorted positions as runs: [3, 4, 5, 9] -> [[3, 5], [9, 9]]. */
export function rangesOf(sorted: number[]): Range[] {
  const ranges: Range[] = [];
  for (const p of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else if (!last || p > last[1]) ranges.push([p, p]);
  }
  return ranges;
}

/** The positions from 1 to length that the ranges leave out. */
export function complement(ranges: Range[], length: number): Range[] {
  const out: Range[] = [];
  let next = 1;
  for (const [a, b] of ranges) {
    if (a > next) out.push([next, Math.min(a - 1, length)]);
    next = Math.max(next, b + 1);
  }
  if (next <= length) out.push([next, length]);
  return out;
}

export const rangeText = ([a, b]: Range) => (a === b ? `${a}` : `${a}–${b}`);

/** "94–312, 319–360 and 2 more stretches" */
export function rangesText(ranges: Range[], max = 6): string {
  if (ranges.length <= max) return ranges.map(rangeText).join(', ');
  const rest = ranges.length - max;
  return `${ranges.slice(0, max).map(rangeText).join(', ')} and ${rest} more stretch${rest === 1 ? '' : 'es'}`;
}

/** A share in whole percent that never rounds a partial coverage up to 100%. */
export const percent = (part: number, whole: number) => (part >= whole ? 100 : Math.floor((100 * part) / whole));

const entryCache = new BoundedMap<string, Promise<EntryCoverage[]>>(20);

/** For each UniProt protein in an experimental entry, the part of it the file holds (most residues first). */
export const entryCoverage = (pdbId: string, model: StructureModel): Promise<EntryCoverage[]> =>
  memoize(entryCache, pdbId.toLowerCase(), async () => {
    const proteins = await fetchSiftsMapping(pdbId);
    const found = await Promise.all(proteins.map(async (protein): Promise<EntryCoverage | null> => {
      const [map, sequence] = await Promise.all([loadUniProtResidueMap(pdbId, protein.accession), fetchUniProtSequence(protein.accession)]);
      const length = sequence.length;
      if (!length) return null; // Without UniProt's length, "of how many" can't be said exactly
      const positions = new Set<number>();
      const chains = new Set<string>();
      let renumbered = false;
      for (const chain of model.chains) {
        for (const r of chain.residues) {
          const position = map[variantKey(r.chain, r.resi, r.icode)];
          if (position === undefined || position < 1 || position > length) continue;
          positions.add(position);
          chains.add(r.chain);
          if (position !== r.resi) renumbered = true;
        }
      }
      if (positions.size === 0) return null;
      const ranges = rangesOf([...positions].sort((a, b) => a - b));
      return {
        accession: protein.accession,
        identifier: protein.identifier,
        length,
        chains: [...chains].sort(),
        present: positions.size,
        ranges,
        missing: complement(ranges, length),
        renumbered,
      };
    }));
    return found.filter((c): c is EntryCoverage => c !== null).sort((a, b) => b.present - a.present);
  });

const experimentalCache = new BoundedMap<string, Promise<ExperimentalCoverage | null>>(20);

/** The residues of a protein resolved in any PDB entry of it (PDBe-KB); null when PDBe has nothing for it. */
export const experimentalCoverage = (accession: string): Promise<ExperimentalCoverage | null> => {
  const acc = accession.trim().toUpperCase();
  return memoize(experimentalCache, acc, async () => {
    const response = await fetchOrNull(`${PDBE_GRAPH}/uniprot/unipdb/${acc}`);
    if (!response) return null;
    const top = (await response.json())?.[acc];
    const length = Number(top?.length);
    if (!Number.isInteger(length) || length <= 0 || !Array.isArray(top?.data)) return null;
    const resolved = new Uint8Array(length + 1);
    const entries = new Set<string>();
    for (const item of top.data) {
      for (const r of item?.residues ?? []) {
        // Resolved stretches only: the same list also marks unresolved ones and point mutations
        if (r?.observed !== 'Y' || r?.indexType !== 'UNIPROT' || !Number.isInteger(r?.startIndex) || !Number.isInteger(r?.endIndex)) continue;
        const from = Math.max(1, r.startIndex);
        const to = Math.min(length, r.endIndex);
        for (let p = from; p <= to; p++) resolved[p] = 1;
        if (to >= from && typeof item?.accession === 'string') entries.add(item.accession);
      }
    }
    const positions: number[] = [];
    for (let p = 1; p <= length; p++) if (resolved[p]) positions.push(p);
    const ranges = rangesOf(positions);
    return { accession: acc, length, entries: entries.size, resolved: positions.length, ranges, missing: complement(ranges, length) };
  });
};

// --- For the chat ---

const known = new BoundedMap<string, ExperimentalCoverage>(20); // AlphaFold model ID -> what experiments resolve of its protein

/** What experiments resolve of the protein of an AlphaFold model on screen, for the facts sent with a question. */
export const rememberExperimentalCoverage = (structureId: string, coverage: ExperimentalCoverage | null) => {
  if (coverage) known.set(structureId.trim().toUpperCase(), coverage);
  else known.delete(structureId.trim().toUpperCase());
};

export function experimentalFactsLine(structureId: string): string | null {
  const c = known.get(structureId.trim().toUpperCase());
  if (!c) return null;
  const head = 'Experimental structures of this protein (PDBe-KB: residues resolved in the best chain of each PDB entry):';
  if (c.entries === 0) return `${head} none; the whole model is known only from prediction.`;
  return [
    `${head} ${c.entries} PDB entr${c.entries === 1 ? 'y resolves' : 'ies resolve'} residues ${rangesText(c.ranges, 8)} (${percent(c.resolved, c.length)}% of ${c.length}).`,
    c.missing.length ? ` Not resolved in any of them, so known only from this prediction: ${rangesText(c.missing, 8)}.` : ' Every residue is resolved in at least one entry.',
  ].join('');
}
