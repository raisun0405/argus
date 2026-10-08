import { fetchOrNull, memoize } from './http';

// --- ALPHAFOLD DB ---
// Predicted models for (almost) every UniProt protein. Models use chain "A" and
// UniProt residue numbering, and store per-residue confidence (pLDDT, 0-100) in
// the B-factor column. Free, keyless, CORS-enabled; called from the browser.

const AFDB_API = 'https://alphafold.ebi.ac.uk/api/prediction';
const AFDB_FILES = 'https://alphafold.ebi.ac.uk/files';
const FALLBACK_VERSION = 6; // Used only if the API is unreachable

const AF_ID_PATTERN = /^AF-([A-Z0-9]{6,10})-F\d+$/i;

/** "AF-P04637-F1" -> "P04637"; anything else -> null. */
export const parseAlphaFoldId = (id: string | null | undefined): string | null => {
  const match = (id ?? '').trim().match(AF_ID_PATTERN);
  return match ? match[1].toUpperCase() : null;
};

/** Canonical full-length model ID for a UniProt accession. */
export const alphaFoldId = (accession: string) => `AF-${accession.toUpperCase()}-F1`;

export interface AlphaFoldModel {
  entryId: string; // e.g. AF-P04637-F1
  accession: string;
  uniprotId?: string; // e.g. P53_HUMAN
  description?: string; // e.g. Cellular tumor antigen p53
  gene?: string;
  organism?: string;
  taxId?: number;
  meanPlddt?: number;
  fractionVeryLow?: number; // Share of residues with pLDDT < 50 (often disordered)
  pdbUrl: string;
}

const modelCache = new Map<string, Promise<AlphaFoldModel | null>>();
// Guessed while the API was failing: no metadata, and some models use other file names
const fallbackModels = new WeakSet<AlphaFoldModel>();

/** Resolve the full-length (F1) model for an accession; null when AlphaFold DB has none. */
export const resolveAlphaFoldModel = (accession: string): Promise<AlphaFoldModel | null> => {
  const acc = accession.toUpperCase();
  const pending = memoize(modelCache, acc, async () => {
    const entryId = alphaFoldId(acc);
    let entries: any[] | null;
    try {
      const response = await fetchOrNull(`${AFDB_API}/${acc}`);
      entries = response ? await response.json() : null;
    } catch {
      // API hiccup: fall back to the conventional file name; the file fetch decides
      const guess: AlphaFoldModel = { entryId, accession: acc, pdbUrl: `${AFDB_FILES}/${entryId}-model_v${FALLBACK_VERSION}.pdb` };
      fallbackModels.add(guess);
      return guess;
    }
    if (!Array.isArray(entries) || entries.length === 0) return null;

    // The API also returns isoform models; keep the canonical full-length one
    const e =
      entries.find(x => (x?.modelEntityId ?? x?.entryId) === entryId) ??
      entries.find(x => x?.uniprotAccession === acc) ??
      entries[0];
    if (!e?.pdbUrl) return null;
    return {
      entryId: e.modelEntityId ?? e.entryId ?? entryId,
      accession: acc,
      uniprotId: e.uniprotId,
      description: e.uniprotDescription,
      gene: e.gene,
      organism: e.organismScientificName,
      taxId: e.taxId,
      meanPlddt: e.globalMetricValue,
      fractionVeryLow: e.fractionPlddtVeryLow,
      pdbUrl: e.pdbUrl,
    };
  });
  // A guess is used once; the next call asks the API again
  pending.then(model => {
    if (model && fallbackModels.has(model) && modelCache.get(acc) === pending) modelCache.delete(acc);
  }, () => {});
  return pending;
};

const structureCache = new Map<string, Promise<{ model: AlphaFoldModel; pdb: string } | null>>();

/** Model metadata plus its PDB-format coordinates; null when no model exists. */
export const fetchAlphaFoldStructure = (accession: string) => {
  const acc = accession.toUpperCase();
  const pending = memoize(structureCache, acc, async () => {
    const model = await resolveAlphaFoldModel(acc);
    if (!model) return null;
    const response = await fetchOrNull(model.pdbUrl);
    if (!response) {
      // A guessed file name that doesn't exist says nothing about whether a model exists
      if (fallbackModels.has(model)) throw new Error('AlphaFold DB is not responding. Try again in a moment.');
      return null;
    }
    const pdb = await response.text();
    if (!pdb.includes('ATOM')) throw new Error('Invalid AlphaFold model file');
    return { model, pdb };
  });
  pending.then(result => {
    if (result && fallbackModels.has(result.model) && structureCache.get(acc) === pending) structureCache.delete(acc);
  }, () => {});
  return pending;
};

// --- pLDDT CONFIDENCE COLOURS (AlphaFold DB's standard bands) ---

export const PLDDT_BANDS = [
  { min: 90, color: '#0053D6', label: 'Very high', range: '> 90' },
  { min: 70, color: '#65CBF3', label: 'Confident', range: '70 – 90' },
  { min: 50, color: '#FFDB13', label: 'Low', range: '50 – 70' },
  { min: -Infinity, color: '#FF7D45', label: 'Very low', range: '< 50' },
] as const;

/** pLDDT on a 0-100 scale, whether the file stores 0-100 (AlphaFold) or 0-1 (ESMFold). */
export const plddtValue = (value: number) => (value <= 1 ? value * 100 : value);

export const plddtBand = (value: number) => {
  const v = plddtValue(value);
  return PLDDT_BANDS.find(b => v > b.min) ?? PLDDT_BANDS[PLDDT_BANDS.length - 1];
};

export const plddtColor = (value: number) => plddtBand(value).color;
