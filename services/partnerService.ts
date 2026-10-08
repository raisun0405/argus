import type { Highlight, InteractionPartner, PartnerQuery, PartnerSearchResult } from '../types';
import { fetchSiftsMapping } from './variantService';
import { fetchPdbFile } from './structureFiles';

// --- INTERACTION PARTNERS (STRING) AND SOLVED COMPLEXES (RCSB PDB) ---
// STRING scores how likely two proteins work together (experiments, curated databases,
// co-expression, literature); its data is CC BY 4.0 and its API is keyless with CORS. Partners are
// matched to UniProt through UniProt's STRING cross-references (gene names as a fallback), and the
// RCSB search API counts the PDB entries that hold both proteins. Opening one marks the interface
// residues, found from the atoms. No LLM tokens are used.

const STRING_API = 'https://string-db.org/api/json';
const STRING_CALLER = 'argus'; // STRING asks API users to identify their tool
const UNIPROT_SEARCH = 'https://rest.uniprot.org/uniprotkb/search';
const RCSB_SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query';
const RCSB_GRAPHQL = 'https://data.rcsb.org/graphql';
const REQUEST_TIMEOUT_MS = 20000;

const MAX_PARTNERS = 10;
const MIN_SCORE = 400; // STRING's "medium confidence" floor (0.4)
// Well-studied proteins have dozens of partners tied at 0.999, so more candidates are fetched and
// ties are broken by the direct evidence (experiments + curated databases + literature)
const CANDIDATES = 50;
const CONTACT_DISTANCE = 4.5; // Å between heavy atoms of the two proteins
const MAX_INTERFACE_RESIDUES = 40; // Per side, closest first
const MAX_INTERFACE_ATOMS = 60000; // Larger assemblies: skip the interface rather than stall the page

export class PartnerError extends Error {}

const getJson = async (url: string): Promise<any> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response.json();
};

const postJson = async (url: string, body: unknown): Promise<any> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 204) return null; // RCSB search: nothing matched
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response.json();
};

// --- STRING ---

interface StringRow {
  stringId_A: string;
  stringId_B: string;
  preferredName_A: string;
  preferredName_B: string;
  ncbiTaxonId: number;
  score: number;
  escore: number; dscore: number; tscore: number; ascore: number; nscore: number; fscore: number; pscore: number;
}

/** STRING's partners of a UniProt accession (any species), or null when STRING doesn't know the protein. */
const fetchStringPartners = async (accession: string): Promise<StringRow[] | null> => {
  const url = `${STRING_API}/interaction_partners?identifiers=${encodeURIComponent(accession)}` +
    `&limit=${CANDIDATES}&required_score=${MIN_SCORE}&caller_identity=${STRING_CALLER}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const rows = await response.json().catch(() => null);
  // An unknown protein comes back as [{ Error: "not found", ... }] (STRING has no viral proteins, for instance)
  if (Array.isArray(rows) && rows.some(r => r?.Error)) return null;
  if (!response.ok || !Array.isArray(rows)) throw new Error(`string-db.org responded ${response.status}`);
  return rows.filter((r): r is StringRow =>
    typeof r?.stringId_B === 'string' && typeof r?.preferredName_B === 'string' && Number.isFinite(r?.score));
};

const CHANNELS: [keyof StringRow, string][] = [
  ['escore', 'Experiments'], ['dscore', 'Databases'], ['tscore', 'Literature'], ['ascore', 'Co-expression'],
];

/** The evidence that carries an interaction: channels scoring 0.4 or more, strongest first (at least one). */
const evidenceOf = (row: StringRow): string[] => {
  const channels: [number, string][] = CHANNELS.map(([key, label]) => [Number(row[key]) || 0, label]);
  channels.push([Math.max(Number(row.nscore) || 0, Number(row.fscore) || 0, Number(row.pscore) || 0), 'Gene context']);
  channels.sort((a, b) => b[0] - a[0]);
  const strong = channels.filter(([value]) => value >= 0.4).map(([, label]) => label);
  return (strong.length ? strong : channels[0][0] > 0 ? [channels[0][1]] : []).slice(0, 3);
};

// --- STRING -> UNIPROT ---

interface UniProtMatch { accession: string; description?: string; reviewed: boolean }

const uniprotEntries = async (query: string, size: number): Promise<any[]> => {
  const url = `${UNIPROT_SEARCH}?query=${encodeURIComponent(query)}&fields=accession,protein_name,gene_names,xref_string,reviewed&format=json&size=${size}`;
  const json = await getJson(url);
  return Array.isArray(json?.results) ? json.results : [];
};

const describe = (entry: any): UniProtMatch => ({
  accession: String(entry?.primaryAccession ?? ''),
  description: entry?.proteinDescription?.recommendedName?.fullName?.value ?? entry?.proteinDescription?.submissionNames?.[0]?.fullName?.value,
  reviewed: /reviewed/i.test(String(entry?.entryType ?? '')) && !/unreviewed/i.test(String(entry?.entryType ?? '')),
});

/**
 * STRING ID -> UniProt entry: UniProt's own STRING cross-references first, then gene names in the
 * same organism for the rest. Swiss-Prot entries win, since the PDB maps structures to them.
 */
const matchUniProt = async (rows: StringRow[], taxId: number): Promise<Map<string, UniProtMatch>> => {
  const matches = new Map<string, UniProtMatch>();
  const ids = [...new Set(rows.map(r => r.stringId_B))];
  const byXref = await uniprotEntries(`(${ids.map(id => `xref:string-${id}`).join(' OR ')})`, ids.length * 3).catch(() => []);
  for (const entry of byXref) {
    const match = describe(entry);
    if (!match.accession) continue;
    for (const ref of entry?.uniProtKBCrossReferences ?? []) {
      if (ref?.database !== 'STRING' || !ids.includes(ref?.id)) continue;
      const known = matches.get(ref.id);
      if (!known || (match.reviewed && !known.reviewed)) matches.set(ref.id, match);
    }
  }

  // Unmatched partners, or matched only to an unreviewed (TrEMBL) entry: try their gene names
  const weak = rows.filter(r => !matches.get(r.stringId_B)?.reviewed);
  if (weak.length > 0 && Number.isInteger(taxId)) {
    const names = [...new Set(weak.map(r => r.preferredName_B))].filter(n => /^[\w.\-/]+$/.test(n));
    if (names.length > 0) {
      const query = `(${names.map(n => `gene_exact:"${n}"`).join(' OR ')}) AND organism_id:${taxId}`;
      const byGene = (await uniprotEntries(query, names.length * 4).catch(() => []))
        .sort((x, y) => Number(describe(y).reviewed) - Number(describe(x).reviewed));
      for (const row of weak) {
        const name = row.preferredName_B.toUpperCase();
        const entry = byGene.find(e => (e?.genes ?? []).some((g: any) =>
          String(g?.geneName?.value ?? '').toUpperCase() === name ||
          (g?.synonyms ?? []).some((s: any) => String(s?.value ?? '').toUpperCase() === name)));
        const match = entry ? describe(entry) : null;
        const known = matches.get(row.stringId_B);
        if (match?.accession && (!known || (match.reviewed && !known.reviewed))) matches.set(row.stringId_B, match);
      }
    }
  }
  return matches;
};

// --- RCSB: PDB ENTRIES HOLDING BOTH PROTEINS ---

const ACCESSION_ATTRIBUTE = 'rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession';
const terminal = (attribute: string, operator: string, value: unknown) => ({ type: 'terminal', service: 'text', parameters: { attribute, operator, value } });

/** Entries with both proteins that the viewer can open (PDB-format files exist below 100,000 atoms and 63 chains). */
const findComplexes = async (a: string, b: string): Promise<{ count: number; best?: string }> => {
  const json = await postJson(RCSB_SEARCH, {
    query: {
      type: 'group',
      logical_operator: 'and',
      nodes: [
        terminal(ACCESSION_ATTRIBUTE, 'exact_match', a),
        terminal(ACCESSION_ATTRIBUTE, 'exact_match', b),
        terminal('rcsb_entry_info.deposited_atom_count', 'less', 100000),
        terminal('rcsb_entry_info.deposited_polymer_entity_instance_count', 'less_or_equal', 62),
      ],
    },
    return_type: 'entry',
    request_options: { paginate: { start: 0, rows: 1 }, sort: [{ sort_by: 'rcsb_entry_info.resolution_combined', direction: 'asc' }] },
  });
  const best = json?.result_set?.[0]?.identifier;
  return { count: Number(json?.total_count) || 0, ...(typeof best === 'string' ? { best } : {}) };
};

const fetchEntrySummaries = async (ids: string[]): Promise<Map<string, { title?: string; resolution?: number }>> => {
  const summaries = new Map<string, { title?: string; resolution?: number }>();
  if (ids.length === 0) return summaries;
  const json = await postJson(RCSB_GRAPHQL, {
    query: `{ entries(entry_ids: ${JSON.stringify(ids)}) { rcsb_id struct { title } rcsb_entry_info { resolution_combined } } }`,
  });
  for (const entry of json?.data?.entries ?? []) {
    const resolution = Number(entry?.rcsb_entry_info?.resolution_combined?.[0]);
    summaries.set(String(entry?.rcsb_id), {
      title: typeof entry?.struct?.title === 'string' ? entry.struct.title : undefined,
      ...(Number.isFinite(resolution) ? { resolution } : {}),
    });
  }
  return summaries;
};

// --- SEARCH ---

const searches = new Map<string, PartnerSearchResult>(); // Structure key -> latest result (chat facts)
const pending = new Map<string, Promise<PartnerSearchResult>>(); // Accession -> search in flight or done

const keyOf = (structureId: string) => structureId.trim().toUpperCase();

/**
 * Interaction partners of the protein on screen, best first, with the solved complexes each forms
 * with it. Rejects with a PartnerError when STRING doesn't cover the protein.
 */
export const findPartners = async (query: PartnerQuery, onStatus?: (status: string) => void): Promise<PartnerSearchResult> => {
  let search = pending.get(query.accession);
  if (!search) {
    search = runSearch(query, onStatus);
    pending.set(query.accession, search);
    search.catch(() => pending.delete(query.accession));
  }
  const result = { ...(await search), query };
  for (const key of query.structureKeys) searches.set(keyOf(key), result);
  return result;
};

const runSearch = async (query: PartnerQuery, onStatus?: (status: string) => void): Promise<PartnerSearchResult> => {
  onStatus?.('Asking STRING for interaction partners…');
  const all = await fetchStringPartners(query.accession);
  if (!all) throw new PartnerError(`STRING has no interaction data for ${query.label}; it covers cellular organisms, not viruses`);
  const direct = (r: StringRow) => (Number(r.escore) || 0) + (Number(r.dscore) || 0) + (Number(r.tscore) || 0);
  all.sort((a, b) => b.score - a.score || direct(b) - direct(a));
  const rows = all.slice(0, MAX_PARTNERS + 6); // A few spare: genes sharing one protein merge below
  const first = rows[0];
  const name = first?.preferredName_A ?? query.label;
  const taxId = Number(first?.ncbiTaxonId);

  onStatus?.('Matching partners to UniProt…');
  const matches = rows.length ? await matchUniProt(rows, taxId) : new Map<string, UniProtMatch>();

  // One row per protein: genes encoding the same protein (HBA1, HBA2) share a UniProt entry
  const partners: InteractionPartner[] = [];
  const byKey = new Map<string, InteractionPartner>();
  for (const row of rows) {
    const match = matches.get(row.stringId_B);
    if (match?.accession === query.accession) continue;
    const key = match?.accession ?? `name:${row.preferredName_B.toUpperCase()}`;
    const known = byKey.get(key);
    if (known) {
      const names = new Set([...known.name.split('/'), row.preferredName_B]);
      known.name = [...names].sort().join('/');
      continue;
    }
    const partner: InteractionPartner = {
      name: row.preferredName_B,
      ...(match ? { accession: match.accession, ...(match.description ? { description: match.description } : {}) } : {}),
      score: Math.min(1, Math.max(0, row.score)),
      evidence: evidenceOf(row),
    };
    byKey.set(key, partner);
    partners.push(partner);
  }
  partners.splice(MAX_PARTNERS);

  onStatus?.('Looking for solved complexes in the PDB…');
  await Promise.all(partners.map(async partner => {
    if (!partner.accession) return;
    try {
      const { count, best } = await findComplexes(query.accession, partner.accession);
      partner.complexes = count;
      if (best) partner.bestComplex = best;
    } catch {
      // Left unchecked: the card shows no complex button for this partner
    }
  }));
  const bestIds = [...new Set(partners.map(p => p.bestComplex).filter((id): id is string => Boolean(id)))];
  const summaries = await fetchEntrySummaries(bestIds).catch(() => new Map<string, { title?: string; resolution?: number }>());
  for (const partner of partners) {
    const summary = partner.bestComplex ? summaries.get(partner.bestComplex) : undefined;
    if (summary?.title) partner.bestComplexTitle = summary.title;
    if (summary?.resolution !== undefined) partner.bestComplexResolution = summary.resolution;
  }

  return {
    query,
    name,
    taxId,
    partners,
    stringUrl: first
      ? `https://string-db.org/network/${encodeURIComponent(first.stringId_A)}`
      : `https://string-db.org/cgi/network?identifiers=${encodeURIComponent(query.accession)}`,
  };
};

// --- THE INTERFACE IN A COMPLEX ---

interface Atom { chain: string; resi: number; x: number; y: number; z: number }

/**
 * Residues of each protein within 4.5 Å of the other in a PDB entry holding both, for the chain pair
 * with the largest interface. Returns [] when the chains can't be told apart or the entry is too big.
 */
export const complexInterface = async (
  pdbId: string,
  a: { accession: string; name: string },
  b: { accession: string; name: string },
): Promise<Highlight[]> => {
  const [sifts, pdb] = await Promise.all([fetchSiftsMapping(pdbId), fetchPdbFile(pdbId)]);
  const chainsOf = (accession: string) => new Set(sifts.find(s => s.accession === accession)?.segments.map(s => s.chain) ?? []);
  const chainsA = chainsOf(a.accession);
  const chainsB = chainsOf(b.accession);
  if (chainsA.size === 0 || chainsB.size === 0) return [];

  // Heavy atoms of polymer residues (modified amino acids are HETATM but keep N, CA and C), first model only
  const residues = new Map<string, { atoms: Atom[]; names: Set<string>; het: boolean }>();
  for (const line of pdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    const het = line.startsWith('HETATM');
    if (!het && !line.startsWith('ATOM')) continue;
    const chain = line.slice(21, 22).trim();
    if (!chainsA.has(chain) && !chainsB.has(chain)) continue;
    const element = line.slice(76, 78).trim() || line.slice(12, 14).trim().replace(/\d/g, '');
    if (element === 'H' || element === 'D') continue;
    const atom = { chain, resi: parseInt(line.slice(22, 26), 10), x: parseFloat(line.slice(30, 38)), y: parseFloat(line.slice(38, 46)), z: parseFloat(line.slice(46, 54)) };
    if (!Number.isFinite(atom.resi) || !Number.isFinite(atom.x) || !Number.isFinite(atom.y) || !Number.isFinite(atom.z)) continue;
    const key = `${chain}|${atom.resi}`;
    let residue = residues.get(key);
    if (!residue) {
      residue = { atoms: [], names: new Set(), het };
      residues.set(key, residue);
    }
    residue.atoms.push(atom);
    residue.names.add(line.slice(12, 16).trim());
  }
  const atoms: Atom[] = [];
  for (const r of residues.values()) {
    if (!r.het || (r.names.has('N') && r.names.has('CA') && r.names.has('C'))) atoms.push(...r.atoms);
  }
  if (atoms.length === 0 || atoms.length > MAX_INTERFACE_ATOMS) return [];

  // Spatial grid with cells of the contact distance: only neighbouring cells can hold contacts
  const cell = (v: number) => Math.floor(v / CONTACT_DISTANCE);
  const grid = new Map<string, Atom[]>();
  for (const atom of atoms) {
    if (!chainsB.has(atom.chain)) continue;
    const key = `${cell(atom.x)},${cell(atom.y)},${cell(atom.z)}`;
    const list = grid.get(key);
    if (list) list.push(atom);
    else grid.set(key, [atom]);
  }

  // Closest approach per residue, for every pair of an A chain and a B chain
  const cutoff = CONTACT_DISTANCE * CONTACT_DISTANCE;
  const pairs = new Map<string, { sideA: Map<number, number>; sideB: Map<number, number> }>();
  const note = (side: Map<number, number>, resi: number, d2: number) => {
    const best = side.get(resi);
    if (best === undefined || d2 < best) side.set(resi, d2);
  };
  for (const atom of atoms) {
    if (!chainsA.has(atom.chain)) continue;
    const cx = cell(atom.x), cy = cell(atom.y), cz = cell(atom.z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (other.chain === atom.chain) continue; // Same chain: both proteins can't share one
        const d2 = (atom.x - other.x) ** 2 + (atom.y - other.y) ** 2 + (atom.z - other.z) ** 2;
        if (d2 > cutoff) continue;
        const key = `${atom.chain}|${other.chain}`;
        let pair = pairs.get(key);
        if (!pair) {
          pair = { sideA: new Map(), sideB: new Map() };
          pairs.set(key, pair);
        }
        note(pair.sideA, atom.resi, d2);
        note(pair.sideB, other.resi, d2);
      }
    }
  }

  let bestKey: string | null = null;
  let bestSize = 0;
  for (const [key, pair] of pairs) {
    const size = pair.sideA.size + pair.sideB.size;
    if (size > bestSize) { bestSize = size; bestKey = key; }
  }
  if (!bestKey) return [];
  const [chainA, chainB] = bestKey.split('|');
  const pair = pairs.get(bestKey)!;
  const closest = (side: Map<number, number>) =>
    [...side].sort((x, y) => x[1] - y[1]).slice(0, MAX_INTERFACE_RESIDUES).map(([resi]) => resi).sort((x, y) => x - y);
  return [
    { chain: chainA, resi: closest(pair.sideA), label: `${a.name} interface with ${b.name}`, category: 'binding_site' },
    { chain: chainB, resi: closest(pair.sideB), label: `${b.name} interface with ${a.name}`, category: 'binding_site' },
  ];
};

// --- FACTS FOR THE AI ---

/**
 * One facts line with the partners already looked up for a structure (nothing is requested here),
 * or null when Partners hasn't run on it this session.
 */
export const partnerFactsLine = (structureId: string, maxChars = 380): string | null => {
  const result = searches.get(keyOf(structureId));
  if (!result || result.partners.length === 0) return null;
  let line = `Interaction partners of ${result.name} (STRING confidence 0-1; "PDB" = solved complex with both):`;
  for (const p of result.partners) {
    const complex = p.bestComplex ? ` PDB ${p.bestComplex}${p.complexes && p.complexes > 1 ? ` +${p.complexes - 1}` : ''}` : '';
    const entry = ` ${p.name} ${p.score.toFixed(3)}${complex};`;
    if (line.length + entry.length > maxChars) break;
    line += entry;
  }
  return line.replace(/;$/, '');
};
