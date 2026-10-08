import type { CofoldComparison, CofoldContact, CofoldPocket, CofoldRequest, CofoldResult, CofoldScores, Highlight, ProteinAnalysis, ResolvedLigand } from '../types';
import { memoize } from './http';
import { fetchPdbFile } from './structureFiles';
import { fetchAlphaFoldStructure, parseAlphaFoldId } from './alphafoldService';
import { getPrediction } from './esmfoldService';
import { LIGAND_NAMES, NOT_SHOWN } from './alphafillService';
import { proteinChains } from './foldseekService';
import { superpose, type Vec3 } from './superpose';
import { analyzeInteractions, interactionSummary, partnerLabel, specificContacts } from './interactionService';
import { cachedPockets, shownPockets } from './pocketService';

// --- CO-FOLD (Boltz-2, via /api/cofold) ---
// How a small molecule binds the protein on screen, and how strongly. The molecule is looked up in
// the browser (RCSB's chemical dictionary, PubChem; both keyless with CORS), Boltz-2 runs on the
// server (it holds the NVIDIA key), and the prediction comes back numbered like the structure on
// screen. Here it is superposed onto that structure, its contacts are listed and, when the
// experimental structure holds the same ligand, the crystal pose is added for comparison.
// Predictions live in memory and are addressed by a "COFOLD-<hash>" ID, like ESMFold's.

const API = '/api/cofold';
const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const RCSB_GRAPHQL = 'https://data.rcsb.org/graphql';
export const COFOLD_MAX_RESIDUES = 1200; // Same limit as the server
const QUICK_RESIDUES = 600; // Below this, every chain is included by default
const MAX_COFACTORS = 8;
const MAX_HEAVY_ATOMS = 100; // Boltz-2's affinity head is for drug-sized molecules
const CONTACT_DISTANCE = 4.0; // Å: residues this close to the ligand hold it
const SITE_DISTANCE = 5.0; // Å: residues lining the site of a ligand already in the structure
const MIN_SITE_RESIDUES = 3; // Fewer than this is a surface contact, not a site
const MAX_SITES_PER_LIGAND = 2; // Haemoglobin has four hemes: offer the first couple
const MAX_SITES = 8;
const NEAR_CHAIN_DISTANCE = 4.5; // Å: a ligand or cofactor this close to a chain belongs with it
const LOOKUP_TIMEOUT_MS = 10000;
const PREDICTION_TIMEOUT_MS = 300000;

// Metals and tightly bound cofactors: kept when co-folding by default (the molecule usually binds
// next to them). Nucleotides are not: in kinases and ATPases they sit where inhibitors bind.
const KEEP_METALS = new Set(['ZN', 'MG', 'MN', 'CA', 'FE', 'FE2', 'CU', 'CU1', 'CO', 'NI', 'MO']);
const KEEP_COFACTORS = new Set([
  'HEM', 'HEC', 'HEA', 'HEB', 'FAD', 'FMN', 'NAD', 'NAI', 'NAP', 'NDP', 'SF4', 'FES', 'F3S', 'PLP', 'TPP', 'B12',
  'CLA', 'CHL', 'BCL', 'RET', 'BTN', 'H4B', 'MTE',
]);

const COFOLD_ID = /^COFOLD-[0-9A-Z]{6,8}$/i;
export const isCofoldId = (id: string | null | undefined) => COFOLD_ID.test((id ?? '').trim());

// --- AVAILABILITY ---

let availability: Promise<boolean> | null = null;

/** Whether this deployment can co-fold (the server has a key). Asked once per session. */
export const cofoldAvailable = (): Promise<boolean> => {
  availability ??= fetch(API, { signal: AbortSignal.timeout(8000) })
    .then(r => (r.ok ? r.json() : null))
    .then(json => json?.available === true)
    .catch(() => {
      availability = null; // Network hiccup: ask again next time
      return false;
    });
  return availability;
};

// --- THE STRUCTURE ON SCREEN ---

interface PdbAtom { line: string; het: boolean; name: string; resn: string; chain: string; resi: number; icode: string; element: string; position: Vec3 }

/** ATOM/HETATM records of the first model (heavy atoms, first alternate location). */
const pdbAtoms = (pdb: string): PdbAtom[] => {
  const atoms: PdbAtom[] = [];
  for (const line of pdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const altLoc = line[16];
    if (altLoc !== ' ' && altLoc !== 'A' && altLoc !== undefined) continue;
    const name = line.slice(12, 16).trim();
    const element = (line.slice(76, 78).trim() || name.replace(/[^A-Za-z]/g, '').charAt(0)).toUpperCase();
    if (element === 'H' || element === 'D') continue;
    const position: Vec3 = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    const resi = parseInt(line.slice(22, 26), 10);
    if (!Number.isFinite(resi) || position.some(v => !Number.isFinite(v))) continue;
    atoms.push({ line, het: line.startsWith('HETATM'), name, resn: line.slice(17, 20).trim(), chain: line[21], resi, icode: (line[26] ?? ' ').trim(), element, position });
  }
  return atoms;
};

const residueKey = (a: { chain: string; resi: number; icode: string }) => `${a.chain}|${a.resi}|${a.icode}`;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centroid = (points: Vec3[]): Vec3 => {
  const sum = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
};

/** Protein atoms in a grid, for "which residues are near these points" questions. */
const atomGrid = (atoms: PdbAtom[], cell: number) => {
  const cells = new Map<string, PdbAtom[]>();
  const at = (p: Vec3) => p.map(v => Math.floor(v / cell));
  for (const a of atoms) {
    const k = at(a.position).join(',');
    const list = cells.get(k);
    if (list) list.push(a);
    else cells.set(k, [a]);
  }
  return (p: Vec3, radius: number): PdbAtom[] => {
    const [x, y, z] = at(p);
    const near: PdbAtom[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const a of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) if (distance(a.position, p) <= radius) near.push(a);
    }
    return near;
  };
};

/** Residues within `cutoff` of any ligand point, closest first. */
const contactsOf = (ligand: Vec3[], protein: PdbAtom[], cutoff = CONTACT_DISTANCE): CofoldContact[] => {
  const near = atomGrid(protein, cutoff);
  const best = new Map<string, CofoldContact>();
  for (const p of ligand) {
    for (const a of near(p, cutoff)) {
      const key = residueKey(a);
      const d = distance(a.position, p);
      const known = best.get(key);
      if (!known || d < known.distance) best.set(key, { chain: a.chain, resi: a.resi, icode: a.icode, resn: a.resn, distance: Math.round(d * 100) / 100 });
    }
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance);
};

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** "HIV-1 PROTEASE" -> "HIV-1 protease": words with digits, and short ones (DNA, ABL), keep their capitals. */
const readableName = (text: string) => {
  const words = text.trim().split(/\s+/).map(w => (/\d/.test(w) || w.replace(/[^A-Za-z]/g, '').length <= 3 ? w : w.toLowerCase()));
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
};

/** Molecule names of a PDB file's chains, from its COMPND records. */
export const chainNames = (pdb: string): Map<string, string> => {
  const text = pdb.split('\n').filter(l => l.startsWith('COMPND')).map(l => l.slice(10, 80).trimEnd()).join(' ');
  const names = new Map<string, string>();
  for (const block of text.split(/MOL_ID:/).slice(1)) {
    const molecule = /MOLECULE:\s*([^;]+);?/.exec(block)?.[1];
    const chains = /CHAIN:\s*([^;]+);?/.exec(block)?.[1];
    if (!molecule || !chains) continue;
    for (const chain of chains.split(',').map(c => c.trim()).filter(Boolean)) names.set(chain, readableName(molecule));
  }
  return names;
};

/** Ligand names from a PDB file's HETNAM records ("MK1" -> "N-[2(R)-HYDROXY-1(S)-INDANYL]-..."). */
const hetNames = (pdb: string): Map<string, string> => {
  const names = new Map<string, string>();
  for (const line of pdb.split('\n')) {
    if (!line.startsWith('HETNAM')) continue;
    const code = line.slice(11, 14).trim();
    const continued = line.slice(8, 10).trim() !== '';
    names.set(code, continued ? `${names.get(code) ?? ''}${line.slice(15).trimEnd()}` : line.slice(15).trim());
  }
  return names;
};

/** A short readable name for a PDB ligand code, from what the file says about it. */
const shortLigandName = (code: string, hetName?: string) =>
  LIGAND_NAMES[code] ?? (hetName && hetName.length <= 28 ? titleCase(hetName) : code);

export interface EntryLigand {
  code: string;
  name: string; // Short name for the picker ("Heme", or the code)
  fullName?: string; // HETNAM
  chains: string[]; // Protein chains its first copy touches
}

export interface CofoldSite extends CofoldPocket {
  id: string; // 'anywhere', 'pocket:2', 'ligand:B|902|'
  detail?: string; // "12 residues · 37% probability"
}

export interface CofoldSetup {
  chains: { chain: string; residues: number; name?: string }[]; // Protein chains (residues with coordinates)
  defaultChains: string[];
  ligands: EntryLigand[]; // What can be picked: everything but waters, additives and lone ions
  cofactors: { code: string; name: string; chains: string[] }[]; // Copies of metals and cofactors that can be kept
  sites: CofoldSite[]; // Where the molecule can be steered: known ligand sites, then Pocket Radar's pockets
}

/**
 * What the Co-fold form offers for a structure: its protein chains (all of them by default when small,
 * else those holding the structure's drug or the highlighted chains), its ligands, the metals and
 * cofactors that can stay in place, and the sites the molecule can be steered into.
 * `structureId` adds the pockets Pocket Radar has already found for it this session.
 */
export const cofoldSetup = (pdb: string, preferredChains: string[] = [], structureId?: string): CofoldSetup => {
  const names = chainNames(pdb);
  const chains = proteinChains(pdb).map(c => ({ ...c, ...(names.get(c.chain) ? { name: names.get(c.chain) } : {}) }));
  const atoms = pdbAtoms(pdb);
  const proteinIds = new Set(chains.map(c => c.chain));
  const near = atomGrid(atoms.filter(a => !a.het && proteinIds.has(a.chain)), NEAR_CHAIN_DISTANCE);
  const hetName = hetNames(pdb);

  // Every hetero group (one copy each) with the protein chains it touches. Modified amino acids
  // (MSE, SEP...) are HETATM records too, but have a backbone: they are part of the chain.
  const groups = new Map<string, { code: string; atoms: PdbAtom[] }>();
  for (const a of atoms) {
    if (!a.het || a.resn === 'HOH' || a.resn === 'DOD' || a.resn === 'WAT') continue;
    const key = residueKey(a);
    const group = groups.get(key);
    if (group) group.atoms.push(a);
    else groups.set(key, { code: a.resn, atoms: [a] });
  }
  const isResidue = (group: { atoms: PdbAtom[] }) => ['N', 'CA', 'C'].every(name => group.atoms.some(a => a.name === name));
  const copies = [...groups.values()]
    .filter(g => !isResidue(g))
    .map(g => ({ code: g.code, chains: [...new Set(g.atoms.flatMap(a => near(a.position, NEAR_CHAIN_DISTANCE).map(n => n.chain)))].sort() }))
    .filter(c => c.chains.length > 0);

  const ligands: EntryLigand[] = [];
  for (const copy of copies) {
    const ion = copy.code.length <= 2 || KEEP_METALS.has(copy.code);
    if (ion || NOT_SHOWN.has(copy.code) || ligands.some(l => l.code === copy.code)) continue;
    ligands.push({ code: copy.code, name: shortLigandName(copy.code, hetName.get(copy.code)), ...(hetName.get(copy.code) ? { fullName: hetName.get(copy.code) } : {}), chains: copy.chains });
  }
  const cofactors = copies
    .filter(c => KEEP_METALS.has(c.code) || KEEP_COFACTORS.has(c.code))
    .map(c => ({ code: c.code, name: shortLigandName(c.code, hetName.get(c.code)), chains: c.chains }));

  const total = (ids: string[]) => chains.filter(c => ids.includes(c.chain)).reduce((n, c) => n + c.residues, 0);
  const all = chains.map(c => c.chain);
  const drug = ligands.find(l => !KEEP_COFACTORS.has(l.code));
  const preferred = preferredChains.filter(c => proteinIds.has(c));
  const defaultChains =
    total(all) <= QUICK_RESIDUES ? all
    : drug && total(drug.chains) <= COFOLD_MAX_RESIDUES ? drug.chains
    : preferred.length > 0 && total(preferred) <= COFOLD_MAX_RESIDUES ? [...new Set(preferred)]
    : chains.length > 0 ? [chains.reduce((a, b) => (b.residues > a.residues ? b : a)).chain]
    : [];

  // Where the molecule can be steered: the sites the structure's own ligands sit in, then the
  // pockets Pocket Radar has already predicted this session
  const proteinAtoms = atoms.filter(a => !a.het && proteinIds.has(a.chain));
  const sites: CofoldSite[] = [];
  const copiesOf = (code: string) => [...groups.entries()].filter(([, g]) => g.code === code && !isResidue(g));
  for (const ligand of ligands) {
    const copies = copiesOf(ligand.code);
    for (const [key, group] of copies.slice(0, MAX_SITES_PER_LIGAND)) {
      const residues = contactsOf(group.atoms.map(a => a.position), proteinAtoms, SITE_DISTANCE);
      if (residues.length < MIN_SITE_RESIDUES) continue;
      const where = copies.length > 1 ? ` (chain ${group.atoms[0].chain})` : '';
      sites.push({
        id: `ligand:${key}`,
        label: `Where ${ligand.name} binds${where}`,
        detail: `${residues.length} residues · from this structure`,
        residues: residues.map(r => ({ chain: r.chain, resi: r.resi, icode: r.icode })),
      });
    }
  }
  const prediction = structureId ? cachedPockets(structureId) : null;
  for (const pocket of prediction ? shownPockets(prediction) : []) {
    if (pocket.residues.length < MIN_SITE_RESIDUES) continue;
    sites.push({
      id: `pocket:${pocket.rank}`,
      label: `Pocket ${pocket.rank}${pocket.ligands.length ? ` · ${pocket.ligands.join(', ')}` : ''}`,
      detail: `${pocket.residues.length} residues · ${Math.round(pocket.probability * 100)}% predicted`,
      residues: pocket.residues.map(r => ({ chain: r.chain, resi: r.resi, icode: r.icode })),
    });
  }
  return { chains, defaultChains, ligands, cofactors, sites: sites.slice(0, MAX_SITES) };
};

/** A site's residues, cut to the chains being predicted (the server rejects a pocket outside them). */
export const siteForChains = (site: CofoldSite, chains: string[]): CofoldPocket | null => {
  const residues = site.residues.filter(r => chains.includes(r.chain));
  return residues.length >= MIN_SITE_RESIDUES ? { label: site.label, residues } : null;
};

/** The kept cofactors for a set of chains: one code per copy that touches them. */
export const keptCofactors = (setup: CofoldSetup, chains: string[], ligandCode?: string) =>
  setup.cofactors
    .filter(c => c.code !== ligandCode && c.chains.some(chain => chains.includes(chain)))
    .map(c => c.code)
    .slice(0, MAX_COFACTORS);

/** What the picked chains are called: "HIV-1 protease"; "Hemoglobin" for "Hemoglobin subunit alpha" and "... beta". */
export const cofoldProteinName = (setup: CofoldSetup, chains: string[]): string | null => {
  const names = [...new Set(setup.chains
    .filter(c => chains.includes(c.chain) && c.name)
    .map(c => c.name!.replace(/\s*\([^)]*\)/g, '').trim())
    .filter(Boolean))];
  if (names.length <= 1) return names[0] ?? null;
  // Subunits of one protein share the start of their names
  const words = names.map(n => n.split(' '));
  const shared: string[] = [];
  for (let i = 0; words.every(w => i < w.length - 1 && w[i].toLowerCase() === words[0][i].toLowerCase()); i++) shared.push(words[0][i]);
  while (shared.length && /^(subunit|chain|domain|fragment|isoform)s?$/i.test(shared[shared.length - 1])) shared.pop();
  if (shared.join(' ').length >= 4) return shared.join(' ');
  return names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`;
};

/**
 * A request for the structure an answer shows, with the form's defaults: what "cofold <molecule>"
 * typed in the chat runs. Naming one of the structure's ligands picks the chains around it.
 */
export const defaultCofoldRequest = async (analysis: ProteinAnalysis, ligandText: string): Promise<CofoldRequest> => {
  const structureId = analysis.pdbId.trim().toUpperCase();
  const kind = cofoldSourceKind(structureId);
  if (!kind) {
    throw new Error(isCofoldId(structureId) ? 'go back to the original structure first, then co-fold from there' : 'co-folding needs a protein structure on screen');
  }
  let pdb: string | null = null;
  let proteinName: string | null = null;
  let source: CofoldRequest['source'] | null = null;
  if (kind === 'pdb') {
    pdb = await fetchPdbFile(structureId);
  } else if (kind === 'alphafold') {
    const accession = parseAlphaFoldId(structureId)!;
    const model = await fetchAlphaFoldStructure(accession);
    pdb = model?.pdb ?? null;
    proteinName = model?.model.description ?? accession;
    source = { kind: 'alphafold', accession };
  } else {
    const folded = getPrediction(structureId);
    pdb = folded?.pdb ?? null;
    proteinName = folded?.name ?? 'your protein';
    if (folded) source = { kind: 'sequence', sequence: folded.sequence };
  }
  if (!pdb) throw new Error("the structure on screen couldn't be loaded");
  const setup = cofoldSetup(pdb, analysis.highlights.map(h => h.chain), structureId);
  const picked = setup.ligands.find(l => l.code === ligandText.trim().toUpperCase());
  const around = picked?.chains.filter(c => setup.chains.some(s => s.chain === c)) ?? [];
  const chains = around.length > 0 ? around : setup.defaultChains;
  if (chains.length === 0) throw new Error('the structure on screen has no protein chain to co-fold');
  return {
    source: source ?? { kind: 'pdb', pdbId: structureId, chains },
    structureId,
    proteinName: proteinName ?? cofoldProteinName(setup, chains) ?? analysis.title,
    ligandText: ligandText.trim(),
    entryLigands: [...new Set([...setup.ligands.map(l => l.code), ...setup.cofactors.map(c => c.code)])],
    cofactors: keptCofactors(setup, chains, picked?.code),
  };
};

/**
 * "cofold aspirin", "dock imatinib into this structure": the molecule, or null for anything else
 * (including docking into another protein, which the AI answers with a solved complex).
 */
export const parseCofoldCommand = (text: string): string | null => {
  const match = /^(?:please\s+)?(?:co-?fold|dock)\s+(.+?)(?:\s+(?:into|in|with|to|onto)\s+(?:it|(?:this|the)(?:\s+current)?(?:\s+(?:structure|protein|model|one))?))?\s*[.!?]*$/i.exec(text.trim());
  if (!match) return null;
  const molecule = match[1].trim();
  // "dock this protein", "co-fold the drug": not a molecule's name; the AI answers those
  if (!molecule || /^(?:this|that|it|the|a|an|my|some)\b/i.test(molecule) || /\s(?:into|onto|with|to|in)\s/i.test(` ${molecule} `) || molecule.length > 500) return null;
  return molecule;
};

// --- THE MOLECULE ---

interface ChemComp { code: string; name: string; smiles?: string; heavyAtoms?: number; inchiKey?: string }

const CHEM_COMP_QUERY = `query($ids: [String!]!) { chem_comps(comp_ids: $ids) {
  chem_comp { id name }
  rcsb_chem_comp_info { atom_count_heavy }
  rcsb_chem_comp_descriptor { SMILES SMILES_stereo InChIKey }
  rcsb_chem_comp_synonyms { name provenance_source type }
  drugbank { drugbank_info { name } } } }`;

/** RCSB's chemical dictionary entries for PDB ligand codes (missing codes are left out). */
const chemComps = async (codes: string[]): Promise<Map<string, ChemComp>> => {
  const found = new Map<string, ChemComp>();
  if (codes.length === 0) return found;
  const response = await fetch(RCSB_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CHEM_COMP_QUERY, variables: { ids: codes } }),
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`RCSB responded ${response.status}`);
  const json = await response.json();
  for (const c of json?.data?.chem_comps ?? []) {
    const code = c?.chem_comp?.id;
    if (typeof code !== 'string') continue;
    const name: string = c.chem_comp.name ?? code;
    const drugbank: string | undefined = c.drugbank?.drugbank_info?.name;
    const synonym: string | undefined = (c.rcsb_chem_comp_synonyms ?? [])
      .find((s: any) => s?.provenance_source === 'PDB Reference Data' && s?.type === 'Synonym' && /^[A-Za-z][A-Za-z0-9 -]{2,28}$/.test(s?.name ?? ''))?.name;
    found.set(code, {
      code,
      name: LIGAND_NAMES[code] ?? (drugbank && drugbank.length <= 40 ? drugbank : synonym ? titleCase(synonym) : name.length <= 30 ? titleCase(name) : code),
      smiles: c.rcsb_chem_comp_descriptor?.SMILES_stereo ?? c.rcsb_chem_comp_descriptor?.SMILES ?? undefined,
      heavyAtoms: c.rcsb_chem_comp_info?.atom_count_heavy ?? undefined,
      inchiKey: c.rcsb_chem_comp_descriptor?.InChIKey ?? undefined,
    });
  }
  return found;
};

interface PubChemCompound { CID?: number; Title?: string; SMILES?: string; HeavyAtomCount?: number; InChIKey?: string }

/** PubChem properties for a name or a SMILES; null when PubChem doesn't know it, 'invalid' for an unreadable SMILES. */
const pubchem = async (by: 'name' | 'smiles', query: string): Promise<PubChemCompound | null | 'invalid'> => {
  const properties = 'property/Title,SMILES,HeavyAtomCount,InChIKey/JSON';
  let response: Response;
  try {
    response = by === 'name'
      ? await fetch(`${PUBCHEM}/compound/name/${encodeURIComponent(query)}/${properties}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
      : await fetch(`${PUBCHEM}/compound/smiles/${properties}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `smiles=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        });
  } catch (e: any) {
    // The browser's own wording ("Failed to fetch") means nothing to a reader
    throw new Error(e?.name === 'TimeoutError' ? "PubChem didn't answer in time" : "PubChem couldn't be reached");
  }
  if (response.status === 404) return null;
  if (response.status === 400) return by === 'smiles' ? 'invalid' : null;
  if (!response.ok) throw new Error(`PubChem responded ${response.status}`);
  const compound: PubChemCompound | undefined = (await response.json())?.PropertyTable?.Properties?.[0];
  return compound && compound.CID ? compound : null;
};

/**
 * Whether text reads as a SMILES string: atoms (organic subset, or [bracketed]), bonds, branches and
 * ring closures only. Names fail on letters SMILES doesn't use unbracketed ("aspirin": a, i, r).
 */
export const looksLikeSmiles = (text: string): boolean => {
  if (!text || /\s/.test(text) || text.length > 500) return false;
  let atoms = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (c === '[') {
      const end = text.indexOf(']', i);
      if (end < 0 || end === i + 1) return false;
      i = end;
      atoms++;
    } else if (two === 'Cl' || two === 'Br') {
      i++;
      atoms++;
    } else if ('BCNOPSFIbcnops*'.includes(c)) {
      atoms++;
    } else if (/[0-9%(]/.test(c)) {
      if (atoms === 0) return false; // Ring closures and branches come after an atom ("5-fluorouracil" is a name)
      if (c === '%') i += 2;
      if (c === '(') depth++;
    } else if (c === ')') {
      if (--depth < 0) return false;
    } else if (!'=#-:/\\.$'.includes(c)) {
      return false;
    }
  }
  return atoms > 0 && depth === 0;
};

const sameMolecule = (a?: string, b?: string) => Boolean(a && b && a.slice(0, 14) === b.slice(0, 14)); // InChIKey skeleton

/**
 * The molecule a user means: a ligand of the structure by its PDB code, any PDB code, a SMILES string,
 * or a name (PubChem). A named molecule that is one of the structure's ligands takes its PDB code, so
 * Boltz-2 gets the exact chemistry and the crystal pose can be compared.
 */
export const resolveLigand = async (text: string, entryCodes: string[]): Promise<ResolvedLigand> => {
  const query = text.trim();
  if (!query) throw new Error('name a molecule first');
  const upper = query.toUpperCase();
  const fromChemComp = (c: ChemComp): ResolvedLigand => ({ name: c.name, code: c.code, smiles: c.smiles, heavyAtoms: c.heavyAtoms, source: 'pdb' });
  const checked = (ligand: ResolvedLigand) => {
    if ((ligand.heavyAtoms ?? 0) > MAX_HEAVY_ATOMS) {
      throw new Error(`${ligand.name} has ${ligand.heavyAtoms} heavy atoms; co-folding here is for drug-sized molecules (up to ${MAX_HEAVY_ATOMS})`);
    }
    return ligand;
  };
  // The structure's own ligands, by code: also matched against PubChem answers below
  const entry = entryCodes.length ? await chemComps(entryCodes).catch(() => new Map<string, ChemComp>()) : new Map<string, ChemComp>();
  const entryMatch = (inchiKey?: string) => [...entry.values()].find(c => sameMolecule(c.inchiKey, inchiKey));

  if (entryCodes.includes(upper)) return checked(entry.get(upper) ? fromChemComp(entry.get(upper)!) : { name: upper, code: upper, source: 'pdb' });
  // A PDB code: short and capitalised ("ATP", "STI"), or up to three characters in any case
  if (/^[A-Za-z0-9]{1,5}$/.test(query) && (query === upper || query.length <= 3)) {
    const found = (await chemComps([upper]).catch(() => new Map<string, ChemComp>())).get(upper);
    if (found) return checked(fromChemComp(found));
  }
  if (looksLikeSmiles(query)) {
    const compound = await pubchem('smiles', query).catch(() => null);
    if (compound !== 'invalid') {
      const known = compound ? entryMatch(compound.InChIKey) : undefined;
      if (known) return checked({ ...fromChemComp(known), smiles: query });
      return checked({
        name: compound?.Title ?? 'your molecule',
        smiles: query,
        ...(compound?.HeavyAtomCount ? { heavyAtoms: compound.HeavyAtomCount } : {}),
        source: 'smiles',
      });
    }
    // Not a readable SMILES after all: try it as a name
  }
  const compound = await pubchem('name', query).catch((e: Error) => {
    throw new Error(`couldn't look up "${query}": ${e.message}. Try a PDB ligand code (e.g. ATP) or a SMILES string`);
  });
  if (!compound || compound === 'invalid' || !compound.SMILES) {
    throw new Error(`couldn't find a molecule called "${query}". Try its PubChem name, a PDB ligand code (e.g. ATP) or a SMILES string`);
  }
  const known = entryMatch(compound.InChIKey);
  if (known) return checked({ ...fromChemComp(known), smiles: compound.SMILES });
  return checked({ name: compound.Title ?? query, smiles: compound.SMILES, heavyAtoms: compound.HeavyAtomCount, source: 'pubchem' });
};

// --- RUNNING A PREDICTION ---

interface ServerResult {
  pdb: string;
  chains: { id: string; length: number }[];
  ligand: { chain: string; resn: string };
  cofactors: { chain: string; resn: string }[];
  scores: CofoldScores;
  affinity: { log10Ic50: number; binderProbability: number } | null;
  template: string | null;
  pocketResidues?: number; // Pocket residues Boltz-2 was steered towards (0 when the hint was dropped)
  seconds: number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
};

const predictions = new Map<string, CofoldResult>();
const runs = new Map<string, Promise<CofoldResult>>();

/** A prediction made earlier in this session (they live in memory only). */
export const getCofold = (id: string) => predictions.get(id.trim().toUpperCase());

/** The structure on screen the request was made from, as PDB text. */
const sourceStructure = async (request: CofoldRequest): Promise<string | null> => {
  if (request.source.kind === 'pdb') return fetchPdbFile(request.source.pdbId).catch(() => null);
  if (request.source.kind === 'alphafold') return (await fetchAlphaFoldStructure(request.source.accession).catch(() => null))?.pdb ?? null;
  return getPrediction(request.structureId)?.pdb ?? null;
};

const withPosition = (line: string, p: Vec3) =>
  `${line.slice(0, 30)}${p[0].toFixed(3).padStart(8)}${p[1].toFixed(3).padStart(8)}${p[2].toFixed(3).padStart(8)}${line.slice(54)}`;

/**
 * The server's prediction placed onto the structure on screen: superposed on its Cα atoms (same
 * chain IDs and numbering), with the ligand's contacts and, when the experimental structure holds the
 * same ligand, that copy appended as a reference.
 */
export const placePrediction = (server: ServerResult, ligand: ResolvedLigand, request: CofoldRequest, source: string | null) => {
  const predicted = pdbAtoms(server.pdb);
  const sourceAtoms = source ? pdbAtoms(source) : [];
  const proteinIds = new Set(server.chains.map(c => c.id));

  let move = (p: Vec3) => p;
  let proteinRmsd: number | null = null;
  const sourceCa = new Map(sourceAtoms.filter(a => !a.het && a.name === 'CA').map(a => [residueKey(a), a.position]));
  const from: Vec3[] = [];
  const to: Vec3[] = [];
  for (const a of predicted) {
    if (a.het || a.name !== 'CA') continue;
    const target = sourceCa.get(residueKey(a));
    if (target) {
      from.push(a.position);
      to.push(target);
    }
  }
  if (from.length >= 3) {
    const fit = superpose(from, to);
    move = fit.apply;
    proteinRmsd = Math.round(fit.rmsd * 100) / 100;
  }
  const placed = predicted.map(a => ({ ...a, position: move(a.position) }));
  const ligandPoints = placed.filter(a => a.het && a.chain === server.ligand.chain).map(a => a.position);
  const protein = placed.filter(a => !a.het && proteinIds.has(a.chain));
  const contacts = contactsOf(ligandPoints, protein);

  // The same ligand in the experimental structure: the copy nearest the prediction
  let reference: CofoldResult['reference'];
  let crystalCopy: { chain: string; resi: number; icode: string } | null = null;
  const referenceLines: string[] = [];
  const code = ligand.code;
  if (request.source.kind === 'pdb' && code && ligandPoints.length > 0) {
    const copies = new Map<string, PdbAtom[]>();
    for (const a of sourceAtoms) {
      if (!a.het || a.resn !== code) continue;
      const list = copies.get(residueKey(a));
      if (list) list.push(a);
      else copies.set(residueKey(a), [a]);
    }
    const predictedCentre = centroid(ligandPoints);
    const nearest = [...copies.values()]
      .map(atoms => ({ atoms, d: distance(centroid(atoms.map(a => a.position)), predictedCentre) }))
      .sort((a, b) => a.d - b.d)[0];
    const used = new Set([...proteinIds, server.ligand.chain, ...server.cofactors.map(c => c.chain)]);
    const chain = [...'RQPONMKJIHGFEDCBAZYXWVUTSL'].find(c => !used.has(c));
    if (nearest && chain) {
      const crystal = contactsOf(nearest.atoms.map(a => a.position), sourceAtoms.filter(a => !a.het && proteinIds.has(a.chain)));
      const predictedKeys = new Set(contacts.map(residueKey));
      reference = {
        chain,
        resn: code,
        from: request.source.pdbId,
        centroidDistance: Math.round(nearest.d * 100) / 100,
        sharedContacts: crystal.filter(c => predictedKeys.has(residueKey(c))).length,
        crystalContacts: crystal.length,
      };
      crystalCopy = { chain: nearest.atoms[0].chain, resi: nearest.atoms[0].resi, icode: nearest.atoms[0].icode };
      // As HETATM records of their own chain, numbered after the prediction's atoms
      nearest.atoms.forEach((a, i) => {
        const serial = String((predicted.length + i + 1) % 100000).padStart(5);
        referenceLines.push(`HETATM${serial}${a.line.slice(11, 16)} ${code.slice(0, 3).padStart(3)} ${chain}   1 ${a.line.slice(27)}`);
      });
    }
  }

  const lines: string[] = [];
  let index = 0;
  for (const line of server.pdb.split('\n')) {
    if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
      const atom = predicted[index];
      // pdbAtoms skips hydrogens; the server sends none, so lines and atoms line up
      if (atom && atom.line === line) {
        lines.push(withPosition(line, placed[index].position));
        index++;
      }
    } else if (line.startsWith('TER')) {
      lines.push(line);
    }
  }
  lines.push(...referenceLines, 'END');
  const pdb = `${lines.join('\n')}\n`;

  // What holds the predicted pose, and how many of the crystal ligand's specific interactions it reproduces
  let interactions: CofoldResult['interactions'];
  try {
    const site = analyzeInteractions(pdb, reference ? [reference.chain] : []).find(s => s.chain === server.ligand.chain);
    if (site) {
      const multiChain = new Set(site.interactions.map(i => i.partner.chain)).size > 1;
      interactions = interactionSummary(site).map(({ type, partners }) => ({ type, partners: partners.map(p => partnerLabel(p, multiChain)) }));
      const crystalSite = crystalCopy && source
        ? analyzeInteractions(source).find(s => s.chain === crystalCopy!.chain && s.resi === crystalCopy!.resi && s.icode === crystalCopy!.icode)
        : undefined;
      if (crystalSite && reference) {
        const predictedSet = specificContacts(site);
        const crystalSet = specificContacts(crystalSite);
        reference.interactionsTotal = crystalSet.size;
        reference.interactionsShared = [...crystalSet].filter(k => predictedSet.has(k)).length;
      }
    }
  } catch {
    // Interactions are extra: the prediction stands without them
  }

  const ca = protein.filter(a => a.name === 'CA');
  const plddt = ca.map(a => parseFloat(a.line.slice(60, 66))).filter(Number.isFinite);
  return {
    pdb,
    contacts,
    reference,
    interactions,
    proteinRmsd,
    meanPlddt: plddt.length ? plddt.reduce((s, v) => s + v, 0) / plddt.length : 0,
  };
};

/**
 * Co-fold a molecule with the protein on screen. Same request, same prediction (kept for the session).
 * onStatus reports each step; the prediction itself counts its seconds.
 */
export const runCofold = (request: CofoldRequest, onStatus: (status: string) => void): Promise<CofoldResult> =>
  memoize(runs, JSON.stringify([request.source, request.ligandText.trim().toLowerCase(), request.cofactors, request.pocket?.residues]), async () => {
    const short = request.ligandText.length > 40 ? `${request.ligandText.slice(0, 38)}…` : request.ligandText;
    onStatus(`Looking up ${short}…`);
    const ligand = await resolveLigand(request.ligandText, request.entryLigands);

    const started = Date.now();
    const tick = () => onStatus(`Boltz-2 is predicting ${ligand.name} with ${request.proteinName}… ${Math.round((Date.now() - started) / 1000)} s`);
    tick();
    const timer = setInterval(tick, 1000);
    let text: string;
    let status: number;
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: request.source,
          ligand: { ...(ligand.code ? { ccd: ligand.code } : {}), ...(ligand.smiles ? { smiles: ligand.smiles } : {}) },
          cofactors: request.cofactors,
          ...(request.pocket ? { pocket: request.pocket.residues } : {}),
        }),
        signal: AbortSignal.timeout(PREDICTION_TIMEOUT_MS),
      });
      status = response.status;
      text = await response.text();
    } catch (e: any) {
      throw new Error(e?.name === 'TimeoutError' ? 'no answer from Boltz-2 after 5 minutes' : 'the co-folding server could not be reached');
    } finally {
      clearInterval(timer);
    }
    let server: any;
    try {
      server = JSON.parse(text);
    } catch {
      throw new Error(`the co-folding server answered ${status} without a result`);
    }
    if (!server || server.error || typeof server.pdb !== 'string') throw new Error(server?.error ?? 'the co-folding server sent no structure');

    onStatus('Placing the prediction onto the structure…');
    const placed = placePrediction(server as ServerResult, ligand, request, await sourceStructure(request));
    const id = `COFOLD-${hash(JSON.stringify([request.source, ligand.code ?? ligand.smiles, request.cofactors, request.pocket?.residues]))}`;
    // Did the pose land where it was steered?
    const asked = request.pocket;
    const pocketKeys = new Set((asked?.residues ?? []).map(r => `${r.chain}|${r.resi}|${r.icode}`));
    const pocket = asked
      ? {
          label: asked.label,
          residues: asked.residues.length,
          touched: placed.contacts.filter(c => pocketKeys.has(`${c.chain}|${c.resi}|${c.icode}`)).length,
          applied: (server.pocketResidues ?? 0) > 0,
        }
      : undefined;
    const result: CofoldResult = {
      id,
      request,
      ligand,
      pdb: placed.pdb,
      ligandChain: server.ligand.chain,
      ligandResn: server.ligand.resn,
      cofactors: server.cofactors ?? [],
      ...(placed.reference ? { reference: placed.reference } : {}),
      ...(placed.interactions ? { interactions: placed.interactions } : {}),
      scores: server.scores,
      affinity: server.affinity ?? null,
      contacts: placed.contacts,
      proteinRmsd: placed.proteinRmsd,
      meanPlddt: placed.meanPlddt,
      template: server.template ?? null,
      ...(pocket ? { pocket } : {}),
      seconds: server.seconds ?? Math.round((Date.now() - started) / 1000),
    };
    predictions.set(id, result);
    return result;
  });

// --- DESCRIBING A PREDICTION ---

/** IC50 from log10(IC50 / µM), in readable units: "20 nM", "180 µM". */
export const formatIc50 = (log10uM: number) => {
  const uM = 10 ** log10uM;
  const [value, unit] = uM < 1e-3 ? [uM * 1e6, 'pM'] : uM < 1 ? [uM * 1e3, 'nM'] : uM < 1000 ? [uM, 'µM'] : [uM / 1000, 'mM'];
  return `${Number(value.toPrecision(2))} ${unit}`;
};

/** pIC50 (molar) from log10(IC50 / µM). */
export const pIc50 = (log10uM: number) => 6 - log10uM;

export type PoseConfidence = 'high' | 'medium' | 'low';

/** Bands used for AlphaFold 3 / Boltz interface scores: above 0.8 confident, below 0.6 likely wrong. */
export const poseConfidence = (scores: CofoldScores): PoseConfidence | null => {
  const iptm = scores.ligandIptm ?? scores.iptm;
  if (iptm === null || iptm === undefined) return null;
  return iptm >= 0.8 ? 'high' : iptm >= 0.6 ? 'medium' : 'low';
};

const THREE_LETTER: Record<string, string> = {
  ALA: 'Ala', ARG: 'Arg', ASN: 'Asn', ASP: 'Asp', CYS: 'Cys', GLN: 'Gln', GLU: 'Glu', GLY: 'Gly', HIS: 'His', ILE: 'Ile',
  LEU: 'Leu', LYS: 'Lys', MET: 'Met', PHE: 'Phe', PRO: 'Pro', SER: 'Ser', THR: 'Thr', TRP: 'Trp', TYR: 'Tyr', VAL: 'Val',
};

/** "Asp25 (A)" style label; the chain is left out when the prediction has one chain. */
export const contactLabel = (c: CofoldContact, withChain: boolean) =>
  `${THREE_LETTER[c.resn] ?? c.resn}${c.resi}${c.icode}${withChain ? ` (${c.chain})` : ''}`;

/** A name inside a sentence: "Benzamidine" -> "benzamidine"; acronyms ("ATP", "HIV-1 protease") stay. */
const inSentence = (name: string) => (/^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name);

/** What the source structure is called in sentences: "1HSG", "the AlphaFold model", "the ESMFold prediction". */
const sourceName = (request: CofoldRequest) =>
  request.source.kind === 'pdb' ? request.source.pdbId : request.source.kind === 'alphafold' ? 'the AlphaFold model' : 'the ESMFold prediction';

const listed = (items: string[]) => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** "It makes a salt bridge with Asp189 and hydrogen bonds with Gly219, Ser190 and Asp189." */
export const interactionSentence = (interactions?: { type: string; partners: string[] }[]) => {
  if (!interactions) return '';
  const of = (type: string) => interactions.find(x => x.type === type)?.partners ?? [];
  const some = (items: string[]) => (items.length > 3 ? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more` : listed(items));
  const parts: string[] = [];
  if (of('metal').length) parts.push(`metal contacts with ${some(of('metal'))}`);
  if (of('salt_bridge').length) parts.push(`${of('salt_bridge').length > 1 ? 'salt bridges' : 'a salt bridge'} with ${some(of('salt_bridge'))}`);
  if (of('hbond').length) parts.push(`${of('hbond').length > 1 ? 'hydrogen bonds' : 'a hydrogen bond'} with ${some(of('hbond'))}`);
  if (of('halogen').length) parts.push(`a halogen bond with ${some(of('halogen'))}`);
  if (of('pi_stacking').length) parts.push(`π-stacking with ${some(of('pi_stacking'))}`);
  if (of('pi_cation').length) parts.push(`cation-π contacts with ${some(of('pi_cation'))}`);
  return parts.length ? `It makes ${listed(parts)}. ` : '';
};

/** The answer the viewer shows for a prediction: the ligand and the residues holding it, highlighted. */
export const cofoldAnalysis = (result: CofoldResult): ProteinAnalysis => {
  const { ligand, contacts, scores, affinity, reference, request } = result;
  const chains = [...new Set(contacts.map(c => c.chain))];
  const multiChain = result.request.source.kind === 'pdb' && result.request.source.chains.length > 1;
  const confidence = poseConfidence(scores);
  const iptm = scores.ligandIptm ?? scores.iptm;
  const where = chains.length > 1 ? `between chains ${chains.slice(0, -1).join(', ')} and ${chains[chains.length - 1]}` : chains.length === 1 && multiChain ? `on chain ${chains[0]}` : 'in';
  const closest = contacts.slice(0, 3).map(c => contactLabel(c, multiChain)).join(', ');
  const molecule = inSentence(ligand.name);
  const protein = inSentence(request.proteinName);

  let summary = contacts.length > 0
    ? `Boltz-2 places ${molecule} ${where}${where === 'in' ? '' : ' of'} ${protein} (${sourceName(request)}), held by ${contacts.length} residue${contacts.length === 1 ? '' : 's'}; the closest are ${closest}. `
    : `Boltz-2 placed ${molecule} without touching ${protein}, so this pose is not reliable. `;
  if (confidence && iptm !== null) summary += `Confidence in the pose is ${confidence} (ligand ipTM ${iptm.toFixed(2)}). `;
  if (affinity) {
    summary += `Predicted affinity: IC50 ≈ ${formatIc50(affinity.log10Ic50)} (pIC50 ${pIc50(affinity.log10Ic50).toFixed(1)}), with a ${Math.round(affinity.binderProbability * 100)}% probability of being a binder. `;
  }
  const pocket = result.pocket;
  if (pocket) {
    summary += !pocket.applied
      ? `Boltz-2 couldn't take the hint to bind at ${pocket.label.toLowerCase()}, so it chose the site itself. `
      : pocket.touched === 0
        ? `It was steered towards ${pocket.label.toLowerCase()} but settled elsewhere, which usually means that site doesn't suit this molecule. `
        : `It was steered towards ${pocket.label.toLowerCase()} and ${pocket.touched === contacts.length ? 'every contact is' : `${pocket.touched} of its ${contacts.length} contacts are`} inside it. `;
  }
  summary += interactionSentence(result.interactions);
  if (reference) {
    summary += `In the crystal structure ${reference.from}, the same ligand sits ${reference.centroidDistance.toFixed(1)} Å from the predicted one` +
      (reference.crystalContacts > 0 ? `, ${reference.sharedContacts} of its ${reference.crystalContacts} contacts are shared` : '') +
      (reference.interactionsTotal ? ` and ${reference.interactionsShared} of its ${reference.interactionsTotal} specific interactions reproduced` : '') +
      ' (grey sticks). ';
  }
  summary += 'These are predictions, not measurements.';

  const byChain = new Map<string, number[]>();
  for (const c of contacts) byChain.set(c.chain, [...(byChain.get(c.chain) ?? []), c.resi]);
  const highlights: Highlight[] = [
    { chain: result.ligandChain, resi: [1], label: `${ligand.name} (predicted pose)`, category: 'ligand' },
    ...[...byChain].map(([chain, resi]) => ({ chain, resi: [...new Set(resi)].sort((a, b) => a - b), label: `Holds ${ligand.name}`, category: 'binding_site' as const })),
  ];
  return {
    pdbId: result.id,
    title: `${ligand.name} · ${request.proteinName}`.slice(0, 200),
    summary,
    highlights,
  };
};

/** One facts line describing the co-folded complex on screen, for the chat. */
export const cofoldFactsLine = (structureId: string, maxChars = 480): string | null => {
  if (!isCofoldId(structureId)) return null;
  const result = getCofold(structureId);
  if (!result) return null;
  const { ligand, request, affinity, reference } = result;
  const multiChain = request.source.kind === 'pdb' && request.source.chains.length > 1;
  const chains = request.source.kind === 'pdb' ? request.source.chains.join(', ') : 'A';
  const iptm = result.scores.ligandIptm ?? result.scores.iptm;
  let line = `Co-folded complex on screen (a Boltz-2 prediction, not an experimental structure): ${ligand.name} is chain ${result.ligandChain} residue 1 (${result.ligandResn}), ` +
    `with ${request.proteinName} chain${multiChain ? 's' : ''} ${chains}, numbered as in ${sourceName(request)}`;
  if (result.cofactors.length) line += `; kept: ${result.cofactors.map(c => `${c.resn} (chain ${c.chain})`).join(', ')}`;
  if (result.pocket?.applied) line += `; steered towards ${result.pocket.label.toLowerCase()} (${result.pocket.touched} of ${result.contacts.length} contacts inside it)`;
  if (iptm !== null) line += `; ligand ipTM ${iptm.toFixed(2)}`;
  if (affinity) line += `; predicted IC50 ~${formatIc50(affinity.log10Ic50)}, binder probability ${affinity.binderProbability.toFixed(2)}`;
  if (reference) line += `; the crystal ligand from ${reference.from} is chain ${reference.chain}, ${reference.centroidDistance.toFixed(1)} Å away`;
  const compare = result.compare;
  if (compare) {
    const other = compare.other;
    const otherIptm = other.scores.ligandIptm ?? other.scores.iptm;
    line += `; compared with ${other.ligand.name}, chain ${compare.chain} residue 1 (${other.ligandResn})`;
    if (otherIptm !== null) line += `, ligand ipTM ${otherIptm.toFixed(2)}`;
    if (other.affinity) line += `, predicted IC50 ~${formatIc50(other.affinity.log10Ic50)}`;
    line += `; ${compare.shared.length} of ${compare.shared.length + compare.onlyA.length + compare.onlyB.length} contact residues shared`;
  }
  line += `; residues within 4 Å of ${compare ? ligand.name : 'the ligand'}:`;
  for (const c of result.contacts) {
    const entry = ` ${c.chain}:${contactLabel(c, false)}`;
    if (line.length + entry.length > maxChars) break;
    line += entry;
  }
  return line;
};

// --- COMPARING TWO MOLECULES ---
// Two predictions made from the same structure land in the same frame (each is superposed onto it),
// so the second molecule can join the first one's complex as one more chain. They are compared the
// way docking tools compare poses: the residues each touches, the specific interactions each makes
// (an interaction fingerprint), and their scores side by side. Boltz-2's affinities often miss by
// tenfold, so a smaller gap is reported as "similar", never as a winner.

/**
 * The two molecules of a comparison: their carbon colours in the 3D view (3Dmol schemes) and the
 * matching swatches. Blue against orange stays distinct for the common colour-vision deficiencies.
 */
export const COMPARE_COLORS = {
  a: { scheme: 'cyanCarbon', swatch: '#00FFFF' },
  b: { scheme: 'orangeCarbon', swatch: '#FFA500' },
} as const;

/** "cofold imatinib vs nilotinib", "dock aspirin and ibuprofen": the two molecules, or null. */
export const parseCompareCommand = (text: string): [string, string] | null => {
  const match = /^(?:please\s+)?(?:co-?fold|dock)\s+(.+?)\s+(?:vs\.?|versus|against|and)\s+(.+?)(?:\s+(?:into|in|with|to|onto)\s+(?:it|(?:this|the)(?:\s+current)?(?:\s+(?:structure|protein|model|one))?))?\s*[.!?]*$/i.exec(text.trim());
  if (!match) return null;
  const pair: [string, string] = [match[1].trim(), match[2].trim()];
  const usable = (m: string) => m && !/^(?:this|that|it|the|a|an|my|some)\b/i.test(m) && !/\s(?:into|onto|with|to|in)\s/i.test(` ${m} `) && m.length <= 500;
  if (!pair.every(usable) || pair[0].toLowerCase() === pair[1].toLowerCase()) return null;
  return pair;
};

const SPECIFIC_TYPES = new Set(['hbond', 'salt_bridge', 'pi_stacking', 'pi_cation', 'halogen', 'metal']);

/** The specific interactions a prediction's molecule makes, by partner residue, measured in its own prediction. */
const fingerprintOf = (result: CofoldResult) => {
  const byResidue = new Map<string, { partner: { chain: string; resi: number; icode: string; resn: string }; types: string[] }>();
  try {
    const site = analyzeInteractions(result.pdb, result.reference ? [result.reference.chain] : []).find(s => s.chain === result.ligandChain);
    for (const i of site?.interactions ?? []) {
      if (!SPECIFIC_TYPES.has(i.type)) continue;
      const key = residueKey(i.partner);
      const entry = byResidue.get(key) ?? { partner: i.partner, types: [] };
      if (!entry.types.includes(i.type)) entry.types.push(i.type);
      byResidue.set(key, entry);
    }
  } catch {
    // Interactions are extra: the comparison stands on contacts and scores without them
  }
  return byResidue;
};

/**
 * Two predictions from the same request (only the molecule differs) as one complex: the first's
 * protein and molecule, the second molecule as one more chain, and the crystal pose of whichever
 * matches the experimental structure. Kept in memory like any prediction.
 */
export const compareCofolds = (a: CofoldResult, b: CofoldResult): CofoldResult => {
  const id = `COFOLD-${hash(JSON.stringify(['compare', a.id, b.id]))}`;
  const known = predictions.get(id);
  if (known) return known;

  const records = a.pdb.split('\n').filter(l => l.startsWith('ATOM') || l.startsWith('HETATM') || l.startsWith('TER'));
  const used = new Set(records.filter(l => !l.startsWith('TER')).map(l => l[21]));
  const freeChain = () => {
    const chain = [...'MNOPQRSTUVWXYZKJIHGFEDCBA'].find(c => !used.has(c)) ?? 'Z';
    used.add(chain);
    return chain;
  };
  let serial = records.filter(l => !l.startsWith('TER')).length;
  const rechained = (pdb: string, from: string, to: string) => pdb.split('\n')
    .filter(l => l.startsWith('HETATM') && l[21] === from)
    .map(l => `HETATM${String(++serial % 100000).padStart(5)}${l.slice(11, 21)}${to}${l.slice(22)}`);

  // Names that tell the two apart: a molecule PubChem doesn't know goes by its SMILES, not "your molecule"
  const shown = (r: CofoldResult) => {
    const smiles = r.ligand.smiles ?? '';
    return r.ligand.source === 'smiles' && r.ligand.name === 'your molecule' && smiles
      ? (smiles.length > 18 ? `${smiles.slice(0, 16)}…` : smiles)
      : r.ligand.name;
  };
  let [nameA, nameB] = [shown(a), shown(b)];
  if (nameA.toLowerCase() === nameB.toLowerCase()) [nameA, nameB] = [`${nameA} (first)`, `${nameB} (second)`];

  const chain = freeChain();
  const second = rechained(b.pdb, b.ligandChain, chain);
  // The crystal pose shown: the first molecule's, else the second's
  let reference = a.reference;
  let referenceOf: 'a' | 'b' | null = a.reference ? 'a' : null;
  const referenceLines: string[] = [];
  if (!a.reference && b.reference) {
    const referenceChain = freeChain();
    referenceLines.push(...rechained(b.pdb, b.reference.chain, referenceChain));
    reference = { ...b.reference, chain: referenceChain };
    referenceOf = 'b';
  }
  const pdb = `${[...records, ...second, ...referenceLines, 'END'].join('\n')}\n`;

  const atoms = pdbAtoms(pdb);
  const at = (c: string) => atoms.filter(x => x.het && x.chain === c).map(x => x.position);
  const pa = at(a.ligandChain);
  const pb = at(chain);
  const centroidDistance = pa.length && pb.length ? Math.round(distance(centroid(pa), centroid(pb)) * 10) / 10 : 0;

  const inA = new Set(a.contacts.map(residueKey));
  const inB = new Set(b.contacts.map(residueKey));
  const shared = a.contacts.filter(c => inB.has(residueKey(c)));
  const onlyA = a.contacts.filter(c => !inB.has(residueKey(c)));
  const onlyB = b.contacts.filter(c => !inA.has(residueKey(c)));
  const union = shared.length + onlyA.length + onlyB.length;

  const fa = fingerprintOf(a);
  const fb = fingerprintOf(b);
  const fingerprint = [...new Set([...fa.keys(), ...fb.keys()])]
    .map(key => {
      const p = (fa.get(key) ?? fb.get(key))!.partner;
      return { chain: p.chain, resi: p.resi, icode: p.icode, resn: p.resn, a: fa.get(key)?.types ?? [], b: fb.get(key)?.types ?? [] };
    })
    // Residues both molecules use first, then in sequence order
    .sort((x, y) => Number(y.a.length > 0 && y.b.length > 0) - Number(x.a.length > 0 && x.b.length > 0) || x.chain.localeCompare(y.chain) || x.resi - y.resi);

  const { reference: _dropped, ...base } = a;
  const merged: CofoldResult = {
    ...base,
    id,
    pdb,
    ligand: { ...a.ligand, name: nameA },
    ...(reference ? { reference } : {}),
    compare: {
      other: { ...b, ligand: { ...b.ligand, name: nameB } },
      chain,
      reference: referenceOf,
      centroidDistance,
      shared,
      onlyA,
      onlyB,
      overlap: union ? Math.round((shared.length / union) * 100) / 100 : 0,
      fingerprint,
    },
  };
  predictions.set(id, merged);
  return merged;
};

/**
 * Which molecule is predicted to bind more tightly, and by how much. Under a tenfold gap the two
 * are "similar" (tighter is null): that is about the size of Boltz-2's usual error.
 */
export const affinityGap = (a: CofoldResult, b: CofoldResult): { tighter: 'a' | 'b' | null; fold: number } | null => {
  if (!a.affinity || !b.affinity) return null;
  const gap = a.affinity.log10Ic50 - b.affinity.log10Ic50; // Above 0: the second has the lower IC50
  return { tighter: Math.abs(gap) < 1 ? null : gap > 0 ? 'b' : 'a', fold: 10 ** Math.abs(gap) };
};

/** "8×", "23×", "180×". */
export const foldText = (fold: number) => `${Number(fold.toPrecision(fold < 10 ? 1 : 2))}×`;

/** Whether two poses share a site: most of their residues in common, or centred within 4 Å. */
export const siteRelation = (c: CofoldComparison): 'same' | 'partly' | 'different' =>
  c.overlap >= 0.3 || c.centroidDistance <= 4 ? 'same' : c.overlap > 0 ? 'partly' : 'different';

/** "Asp189", "Asp25 (B)": a residue in a sentence or a table. */
export const residueLabel = (r: { chain: string; resi: number; icode: string; resn: string }, withChain: boolean) =>
  `${THREE_LETTER[r.resn] ?? r.resn}${r.resi}${r.icode}${withChain ? ` (${r.chain})` : ''}`;

/** The answer the viewer shows for a comparison: both molecules and every residue holding either. */
export const compareAnalysis = (result: CofoldResult): ProteinAnalysis => {
  const c = result.compare!;
  const a = result;
  const b = c.other;
  const [nameA, nameB] = [a.ligand.name, b.ligand.name];
  const multiChain = a.request.source.kind === 'pdb' && a.request.source.chains.length > 1;
  const all = c.shared.length + c.onlyA.length + c.onlyB.length;
  const site = siteRelation(c);
  const some = (items: string[]) => (items.length > 3 ? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more` : listed(items));
  // A name mid-sentence is lower-cased like any other, except a SMILES string, whose case is chemistry
  const nameIn = (r: CofoldResult) => (r.ligand.source === 'smiles' && r.ligand.smiles && r.ligand.name.startsWith(r.ligand.smiles.slice(0, 16)) ? r.ligand.name : inSentence(r.ligand.name));

  let summary = `Boltz-2 placed ${nameIn(a)} and ${nameIn(b)} in ${inSentence(a.request.proteinName)} (${sourceName(a.request)}). `;
  summary += site === 'same'
    ? `They bind the same site: ${c.shared.length} of the ${all} residues they touch are shared. `
    : site === 'partly'
      ? `Their sites overlap only partly: ${c.shared.length} of ${all} residues shared, ${c.centroidDistance.toFixed(1)} Å apart. `
      : `They bind different places on the protein, ${c.centroidDistance.toFixed(1)} Å apart, so their affinities are not a like-for-like comparison. `;

  const gap = affinityGap(a, b);
  if (gap && a.affinity && b.affinity) {
    if (gap.tighter === null) {
      summary += `Their predicted affinities are similar (IC50 ≈ ${formatIc50(a.affinity.log10Ic50)} and ≈ ${formatIc50(b.affinity.log10Ic50)}): closer than the tenfold error these estimates usually carry. `;
    } else {
      const [win, lose] = gap.tighter === 'a' ? [a, b] : [b, a];
      summary += `By about ${foldText(gap.fold)}, ${nameIn(win)} is predicted to bind more tightly (IC50 ≈ ${formatIc50(win.affinity!.log10Ic50)} against ≈ ${formatIc50(lose.affinity!.log10Ic50)}). `;
    }
    summary += `Binder probability: ${Math.round(a.affinity.binderProbability * 100)}% for ${nameIn(a)}, ${Math.round(b.affinity.binderProbability * 100)}% for ${nameIn(b)}. `;
  }
  for (const r of [a, b]) {
    const iptm = r.scores.ligandIptm ?? r.scores.iptm;
    if (poseConfidence(r.scores) === 'low' && iptm !== null) summary += `The pose of ${nameIn(r)} is low-confidence (ligand ipTM ${iptm.toFixed(2)}), so treat its numbers with caution. `;
  }
  const label = (f: CofoldComparison['fingerprint'][number]) => residueLabel(f, multiChain);
  const common = c.fingerprint.filter(f => f.a.some(t => f.b.includes(t)));
  const aOnly = c.fingerprint.filter(f => f.a.length > 0 && !f.a.some(t => f.b.includes(t)));
  const bOnly = c.fingerprint.filter(f => f.b.length > 0 && !f.b.some(t => f.a.includes(t)));
  if (common.length) summary += `Both make the same kind of interaction with ${some(common.map(label))}. `;
  if (aOnly.length) summary += `Only ${nameIn(a)} interacts specifically with ${some(aOnly.map(label))}. `;
  if (bOnly.length) summary += `Only ${nameIn(b)} interacts specifically with ${some(bOnly.map(label))}. `;
  summary += 'These are predictions, not measurements.';

  const byChain = new Map<string, number[]>();
  for (const r of [...c.shared, ...c.onlyA, ...c.onlyB]) byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r.resi]);
  const highlights: Highlight[] = [
    { chain: a.ligandChain, resi: [1], label: `${nameA} (predicted pose)`, category: 'ligand' },
    { chain: c.chain, resi: [1], label: `${nameB} (predicted pose)`, category: 'ligand' },
    ...[...byChain].map(([chain, resi]) => ({ chain, resi: [...new Set(resi)].sort((x, y) => x - y), label: `Holds ${nameA} or ${nameB}`, category: 'binding_site' as const })),
  ];
  return {
    pdbId: result.id,
    title: `${nameA} vs ${nameB} · ${a.request.proteinName}`.slice(0, 200),
    summary,
    highlights,
  };
};

/** Is this structure ID something Co-fold can start from? (Not a prediction of its own.) */
export const cofoldSourceKind = (structureId: string): 'pdb' | 'alphafold' | 'sequence' | null => {
  if (isCofoldId(structureId)) return null;
  if (parseAlphaFoldId(structureId)) return 'alphafold';
  if (/^ESM-/i.test(structureId)) return 'sequence';
  return /^[0-9][A-Za-z0-9]{3}$/.test(structureId) ? 'pdb' : null;
};
