import type { Highlight, ProteinAnalysis } from '../types';
import { fetchOrNull, memoize } from './http';
import { fetchResidueListing, fetchSiftsMapping, loadSegmentPositions } from './variantService';
import { parseAlphaFoldId } from './alphafoldService';
import { isEsmFoldId } from './esmfoldService';
import { pocketFactsLine } from './pocketService';
import { partnerFactsLine } from './partnerService';
import { alphaFillFactsLine } from './alphafillService';
import { cofoldFactsLine, getCofold, isCofoldId } from './cofoldService';
import { interactionFactsLine } from './interactionService';
import { overlayFactsLine } from './overlayService';
import { paeFactsLine } from './paeService';
import { fetchPdbFile } from './structureFiles';

// --- STRUCTURE FACTS (grounding for /api/analyze) ---
// The LLM recalls residue numbers poorly, and PDB files often number residues
// differently from UniProt (EGFR in 1M17 is UniProt - 24, haemoglobin in 4HHB
// UniProt - 1). This builds a short text block of curated UniProt features
// (active sites, binding residues, disulfides, domains...) converted to the
// loaded file's own chain IDs and residue numbers, plus the ligands the file
// really contains, and sends it with every question about that structure.
// All sources are keyless and CORS-enabled. The block is prefetched when a
// structure loads, so asking a question doesn't wait for it.

const PDBE_API = 'https://www.ebi.ac.uk/pdbe/api';
const UNIPROT_API = 'https://rest.uniprot.org/uniprotkb';
const UNIPROT_FIELDS = [
  'id', 'protein_name', 'sequence',
  'ft_chain', 'ft_peptide', 'ft_act_site', 'ft_binding', 'ft_site', 'ft_disulfid',
  'ft_mod_res', 'ft_domain', 'ft_zn_fing', 'ft_dna_bind', 'ft_motif', 'ft_region',
].join(',');
const MAX_PROTEINS = 4; // Large complexes: the proteins with the most observed residues
export const MAX_FACTS_CHARS = 1800; // ~450 tokens at most; typical entries need far less
const MAX_LINE_CHARS = 360;

// Crystallisation additives: real atoms in the file, but noise for the model
const ADDITIVES = new Set([
  'HOH', 'DOD', 'GOL', 'EDO', 'PEG', 'PGE', 'PG4', '1PE', '2PE', 'P6G', '12P', 'PE4', 'ACT', 'ACY',
  'DMS', 'FMT', 'MPD', 'MRD', 'TRS', 'EPE', 'MES', 'BME', 'IPA', 'EOH', 'MOH', 'SCN', 'NO3', 'IMD',
]);

const THREE: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
};
const STANDARD = new Set(Object.values(THREE));

const residueName = (code: string) => (code === 'MSE' ? 'Met' : code.charAt(0) + code.slice(1).toLowerCase());

// --- SOURCES ---

interface Feature {
  type: string;
  start: number;
  end: number;
  description: string;
  ligand?: string;
  ligandPart?: string;
}

interface UniProtEntry {
  identifier: string;
  name: string;
  sequence: string;
  features: Feature[];
}

const uniprotCache = new Map<string, Promise<UniProtEntry | null>>();

const fetchUniProtEntry = (accession: string): Promise<UniProtEntry | null> =>
  memoize(uniprotCache, accession, async () => {
    const response = await fetchOrNull(`${UNIPROT_API}/${accession}.json?fields=${UNIPROT_FIELDS}`);
    if (!response) return null;
    const json = await response.json();
    const names = json?.proteinDescription;
    return {
      identifier: json?.uniProtkbId ?? accession,
      name: names?.recommendedName?.fullName?.value ?? names?.submissionNames?.[0]?.fullName?.value ?? accession,
      sequence: json?.sequence?.value ?? '',
      features: (json?.features ?? [])
        .map((f: any) => ({
          type: String(f?.type ?? ''),
          start: f?.location?.start?.value,
          end: f?.location?.end?.value,
          description: String(f?.description ?? ''),
          ligand: f?.ligand?.name,
          ligandPart: f?.ligandPart?.name,
        }))
        .filter((f: Feature) => Number.isInteger(f.start) && Number.isInteger(f.end)),
    };
  });

interface Ligand {
  id: string;
  name: string;
  chain: string;
  resi: number;
}

const ligandCache = new Map<string, Promise<Ligand[]>>();

const fetchLigands = (id: string): Promise<Ligand[]> =>
  memoize(ligandCache, id, async () => {
    const response = await fetchOrNull(`${PDBE_API}/pdb/entry/ligand_monomers/${id}`);
    if (!response) return [];
    const json = await response.json();
    return (json?.[id] ?? [])
      .map((l: any) => ({
        id: String(l?.chem_comp_id ?? ''),
        name: String(l?.chem_comp_name ?? ''),
        chain: String(l?.chain_id ?? ''),
        resi: l?.author_residue_number,
      }))
      .filter((l: Ligand) => l.id && l.chain && Number.isInteger(l.resi));
  });

interface Molecule {
  type: string;
  name: string;
  chains: string[];
  asyms: string[];
}

const moleculeCache = new Map<string, Promise<Molecule[]>>();

const fetchMolecules = (id: string): Promise<Molecule[]> =>
  memoize(moleculeCache, id, async () => {
    const response = await fetchOrNull(`${PDBE_API}/pdb/entry/molecules/${id}`);
    if (!response) return [];
    const json = await response.json();
    return (json?.[id] ?? []).map((m: any) => ({
      type: String(m?.molecule_type ?? ''),
      name: String(m?.molecule_name?.[0] ?? ''),
      chains: Array.isArray(m?.in_chains) ? m.in_chains : [],
      asyms: Array.isArray(m?.in_struct_asyms) ? m.in_struct_asyms : [],
    }));
  });

// --- UNIPROT POSITION -> RESIDUE IN THE FILE ---

interface Located {
  chain: string;
  resi: number;
  name: string; // Three-letter code as it appears in the file, e.g. "His"
}

type Locate = (position: number) => Located | null;

/** Copies of one protein chain with identical numbering, e.g. haemoglobin alpha in chains A and C. */
interface ChainGroup {
  chains: string[]; // First is the representative
  own: Map<number, Located>; // Representative chain only
  residues: Map<number, Located>; // Representative, gaps filled from the copies
}

/** Two chains are copies if they cover mostly the same UniProt positions with the same numbering. */
const isCopy = (a: Map<number, Located>, b: Map<number, Located>) => {
  let shared = 0;
  for (const [position, residue] of b) {
    const other = a.get(position);
    if (!other) continue;
    if (other.resi !== residue.resi) return false;
    shared++;
  }
  return shared >= 0.5 * Math.min(a.size, b.size);
};

const groupCopies = (byChain: Map<string, Map<number, Located>>): ChainGroup[] => {
  const groups: ChainGroup[] = [];
  for (const [chain, residues] of byChain) {
    if (residues.size === 0) continue;
    const group = groups.find(g => isCopy(g.own, residues));
    if (!group) {
      groups.push({ chains: [chain], own: residues, residues: new Map(residues) });
      continue;
    }
    group.chains.push(chain);
    for (const [position, residue] of residues) if (!group.residues.has(position)) group.residues.set(position, residue);
  }
  return groups;
};

const locateIn = (groups: ChainGroup[]): Locate => position => {
  for (const group of groups) {
    const residue = group.residues.get(position);
    if (residue) return residue;
  }
  return null;
};

// --- TEXT ---

interface Line {
  text: string;
  priority: number; // 0 = always kept; higher numbers are dropped first when over budget
}

const shortNote = (text: string, max = 40) => {
  const t = text.split(';')[0].replace(/\s*binding residue$/i, '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const capList = (items: string[], max: number) =>
  items.length > max ? [...items.slice(0, max), `+${items.length - max} more`] : items;

const residueToken = (position: number, locate: Locate, sequence: string) => {
  const residue = locate(position);
  if (!residue) return null;
  const expected = THREE[sequence[position - 1]];
  const mutated = expected && STANDARD.has(residue.name) && residue.name !== expected;
  return `${residue.chain}:${residue.name}${residue.resi}${mutated ? ` (UniProt ${expected})` : ''}`;
};

/** "A:20-89" for a UniProt range, clipped to the residues present in the file. */
const spanToken = (start: number, end: number, locate: Locate) => {
  let first: Located | null = null;
  let last: Located | null = null;
  for (let p = start; p <= end; p++) {
    const residue = locate(p);
    if (!residue) continue;
    first ??= residue;
    last = residue;
  }
  if (!first || !last) return null;
  if (first === last) return `${first.chain}:${first.name}${first.resi}`;
  return first.chain === last.chain
    ? `${first.chain}:${first.resi}-${last.resi}`
    : `${first.chain}:${first.resi}-${last.chain}:${last.resi}`;
};

const featureTokens = (f: Feature, locate: Locate, sequence: string): string[] => {
  if (f.end - f.start > 3) {
    const span = spanToken(f.start, f.end, locate);
    return span ? [span] : [];
  }
  const tokens: string[] = [];
  for (let p = f.start; p <= f.end; p++) {
    const token = residueToken(p, locate, sequence);
    if (token) tokens.push(token);
  }
  return tokens;
};

const withNote = (tokens: string[], note: string) => tokens.map(t => (note ? `${t} (${note})` : t));

/**
 * Curated features of one protein, in the file's numbering; features outside
 * the file are skipped. `present` = UniProt positions found in the file.
 */
const featureLines = (entry: UniProtEntry, locate: Locate, present: number): Line[] => {
  const lines: Line[] = [];
  const { features, sequence } = entry;
  const ofType = (...types: string[]) => features.filter(f => types.includes(f.type));

  const active = ofType('Active site').flatMap(f => withNote(featureTokens(f, locate, sequence), shortNote(f.description)));
  if (active.length) lines.push({ text: `- active site: ${capList(active, 10).join(', ')}`, priority: 1 });

  const binding = new Map<string, string[]>();
  for (const f of ofType('Binding site')) {
    const tokens = withNote(featureTokens(f, locate, sequence), shortNote(f.description, 24));
    if (!tokens.length) continue;
    const ligand = `${f.ligand ?? 'ligand'}${f.ligandPart ? ` (${f.ligandPart})` : ''}`;
    binding.set(ligand, [...(binding.get(ligand) ?? []), ...tokens]);
  }
  [...binding].slice(0, 8).forEach(([ligand, tokens]) =>
    lines.push({ text: `- binds ${ligand}: ${capList(tokens, 14).join(', ')}`, priority: 1 })
  );

  const bonds = new Set<string>();
  for (const f of ofType('Disulfide bond')) {
    const a = residueToken(f.start, locate, sequence);
    if (!a) continue;
    if (f.start === f.end) {
      // One-residue entry: a bond to another chain, e.g. the antibody hinge
      bonds.add(`${a} (${shortNote(f.description).replace(/[()]/g, '') || 'interchain'})`);
      continue;
    }
    const b = residueToken(f.end, locate, sequence);
    if (b) bonds.add(`${a}–${b}`);
  }
  if (bonds.size) lines.push({ text: `- disulfide bonds: ${capList([...bonds], 10).join(', ')}`, priority: 2 });

  // "(Microbial infection) Cleavage; by N.americanus apr-2" x22 on haemoglobin beta is noise
  const sites = new Map<string, string[]>();
  for (const f of ofType('Site')) {
    if (/^\(Microbial infection\)|not glycated|breakpoint/i.test(f.description)) continue;
    const tokens = featureTokens(f, locate, sequence);
    if (!tokens.length) continue;
    const note = shortNote(f.description.replace(/;\s*/g, ', ')) || 'site';
    sites.set(note, [...(sites.get(note) ?? []), ...tokens]);
  }
  [...sites].slice(0, 6).forEach(([note, tokens]) =>
    lines.push({ text: `- site, ${note}: ${capList(tokens, 10).join(', ')}`, priority: 3 })
  );

  // Ranges grouped by name: "Dimerization of protease A:1-5, A:49-55, A:88-99"
  const spansByLabel = (items: Feature[], label: (f: Feature) => string) => {
    const byLabel = new Map<string, string[]>();
    for (const f of items) {
      const span = spanToken(f.start, f.end, locate);
      if (span) byLabel.set(label(f), [...(byLabel.get(label(f)) ?? []), span]);
    }
    return [...byLabel].map(([name, spans]) => `${name} ${spans.join(', ')}`);
  };

  // A region covering most of what the file shows says nothing about where to look
  // (p53 core domain: "Interaction with CCAR2", "... with HIPK1", "... with AXIN1"...)
  const isLocalised = (f: Feature) => {
    let inFile = 0;
    for (let p = f.start; p <= f.end; p++) if (locate(p)) inFile++;
    return inFile < 0.75 * present;
  };

  const domains = spansByLabel(ofType('Domain', 'Zinc finger', 'DNA binding', 'Motif'), f =>
    f.type === 'Domain' || f.type === 'Motif' ? f.description : `${f.type} ${f.description}`.trim()
  );
  if (domains.length) lines.push({ text: `- domains: ${capList(domains, 8).join('; ')}`, priority: 3 });

  const regions = spansByLabel(
    ofType('Region').filter(f => !/disordered|compositional bias/i.test(f.description) && isLocalised(f)),
    f => shortNote(f.description)
  );
  if (regions.length) lines.push({ text: `- regions: ${capList(regions, 6).join('; ')}`, priority: 4 });

  const modified = ofType('Modified residue').flatMap(f => withNote(featureTokens(f, locate, sequence), shortNote(f.description, 24)));
  if (modified.length) lines.push({ text: `- modified residues: ${capList(modified, 6).join(', ')}`, priority: 4 });

  return lines;
};

const numberingNote = (group: ChainGroup) => {
  const offsets = new Set([...group.own].map(([position, residue]) => residue.resi - position));
  if (offsets.size !== 1) return 'file numbering differs from UniProt';
  const [k] = [...offsets];
  return k === 0 ? 'file numbering = UniProt' : `file numbering = UniProt ${k > 0 ? '+' : '-'} ${Math.abs(k)}`;
};

/** "chain B (copy: D) = Insulin B chain, residues 1-30, file numbering = UniProt - 24" */
const groupLabel = (group: ChainGroup, entry: UniProtEntry | null) => {
  const [chain, ...copies] = group.chains;
  const positions = [...group.own.keys()];
  const numbers = [...group.own.values()].map(r => r.resi);
  const from = Math.min(...positions);
  const to = Math.max(...positions);

  // Mature chain or peptide this chain corresponds to (e.g. "Protease" within HIV Gag-Pol)
  let part = '';
  let best = { overlap: 0, length: Infinity };
  for (const f of entry?.features ?? []) {
    if (f.type !== 'Chain' && f.type !== 'Peptide') continue;
    const overlap = Math.min(to, f.end) - Math.max(from, f.start) + 1;
    const length = f.end - f.start;
    if (overlap > best.overlap || (overlap === best.overlap && overlap > 0 && length < best.length)) {
      best = { overlap, length };
      part = f.description;
    }
  }
  const name = part && part.toLowerCase() !== entry?.name.toLowerCase() ? ` = ${part}` : '';
  const copyNote = copies.length ? ` (identical cop${copies.length > 1 ? 'ies' : 'y'}: ${copies.join(', ')})` : '';
  return `chain ${chain}${copyNote}${name}, residues ${Math.min(...numbers)}-${Math.max(...numbers)}, ${numberingNote(group)}`;
};

const proteinLines = (accession: string, fallbackName: string, entry: UniProtEntry | null, groups: ChainGroup[]): Line[] => {
  const header = `${entry?.name ?? fallbackName} [${entry?.identifier ?? fallbackName}, UniProt ${accession}]`;
  const lines: Line[] =
    groups.length === 1
      ? [{ text: `${header}: ${groupLabel(groups[0], entry)}`, priority: 0 }]
      : [{ text: header, priority: 0 }, ...groups.map(g => ({ text: `- ${groupLabel(g, entry)}`, priority: 0 }))];
  const present = new Set(groups.flatMap(g => [...g.residues.keys()])).size;
  return entry ? [...lines, ...featureLines(entry, locateIn(groups), present)] : lines;
};

const ligandLine = (ligands: Ligand[]): Line => {
  const byId = new Map<string, Ligand[]>();
  for (const l of ligands) if (!ADDITIVES.has(l.id)) byId.set(l.id, [...(byId.get(l.id) ?? []), l]);
  if (byId.size === 0) return { text: 'Ligands in the file: none', priority: 0 };
  const parts = [...byId].map(([id, copies]) => {
    const name = copies[0].name.toLowerCase();
    const label = name ? ` (${name.length > 36 ? `${name.slice(0, 35)}…` : name})` : '';
    return `${id}${label} ${capList(copies.map(l => `${l.chain}:${l.resi}`), 6).join(', ')}`;
  });
  return { text: `Ligands in the file: ${capList(parts, 8).join('; ')}`, priority: 1 };
};

const fitToBudget = (lines: Line[]): string | null => {
  const kept = lines.map(l => ({ ...l, text: l.text.length > MAX_LINE_CHARS ? `${l.text.slice(0, MAX_LINE_CHARS - 1)}…` : l.text }));
  let total = kept.reduce((n, l) => n + l.text.length + 1, 0);
  for (let priority = 4; priority >= 1 && total > MAX_FACTS_CHARS; priority--) {
    for (let i = kept.length - 1; i >= 0 && total > MAX_FACTS_CHARS; i--) {
      if (kept[i].priority !== priority) continue;
      total -= kept[i].text.length + 1;
      kept.splice(i, 1);
    }
  }
  const text = kept.map(l => l.text).join('\n').slice(0, MAX_FACTS_CHARS).trim();
  return text || null;
};

// --- ASSEMBLY ---

/** What the per-question residue check needs about one protein of a structure. */
interface HintProtein {
  sequence: string; // UniProt sequence
  locate: Locate; // UniProt position -> residue in the file
  residues: Located[]; // Every residue placed in the file (for names given in file numbering)
}

/** What the answer check needs: every residue and ligand the file really has. */
interface StructureIndex {
  residues: Map<string, string>; // "A|87" -> "HIS": observed polymer residues (author numbering, no insertion code)
  ligands: Map<string, string> | null; // "A|142" -> "HEM"; null when the ligand list couldn't be loaded
}

interface FactLines {
  lines: Line[];
  hints: HintProtein[];
  index: StructureIndex | 'unknown' | null; // 'unknown': no such PDB entry
  incomplete: boolean; // A source failed: use the text now, but don't cache it
}

const pdbFactLines = async (id: string): Promise<FactLines> => {
  let incomplete = false;
  let moleculesFailed = false;
  const failed = <T,>(fallback: T) => () => {
    incomplete = true;
    return fallback;
  };
  const [sifts, listing, ligands, molecules] = await Promise.all([
    fetchSiftsMapping(id),
    fetchResidueListing(id),
    fetchLigands(id).catch(failed(null)),
    fetchMolecules(id).catch(() => {
      moleculesFailed = true;
      return failed([] as Molecule[])();
    }),
  ]);
  if (listing.size === 0 && molecules.length === 0) return { lines: [], hints: [], index: 'unknown', incomplete }; // No such entry

  // Observed residues of each protein, keyed by UniProt position, per author chain
  const positions = await Promise.all(
    sifts.map(entry => loadSegmentPositions(entry, listing).catch(failed(new Map<string, Map<number, number>>())))
  );
  const proteins = sifts
    .map((entry, idx) => {
      const asymChains = new Map(entry.segments.map(s => [s.structAsymId, s.chain] as const));
      const byChain = new Map<string, Map<number, Located>>();
      for (const [asym, byResidue] of positions[idx]) {
        const chain = asymChains.get(asym)!;
        const residues = byChain.get(chain) ?? new Map<number, Located>();
        byChain.set(chain, residues);
        for (const r of listing.get(asym) ?? []) {
          // Insertion-code residues can't be addressed by a highlight (integer resi), so leave them out
          const position = byResidue.get(r.residueNumber);
          if (!r.observed || r.insCode || position === undefined) continue;
          residues.set(position, { chain, resi: r.authorNumber, name: residueName(r.name) });
        }
      }
      const groups = groupCopies(byChain);
      return { entry, groups, observed: groups.reduce((n, g) => n + g.residues.size, 0) };
    })
    .filter(p => p.observed > 0)
    .sort((a, b) => b.observed - a.observed);

  const shown = proteins.slice(0, MAX_PROTEINS);
  const entries = await Promise.all(shown.map(p => fetchUniProtEntry(p.entry.accession).catch(failed(null))));
  const lines = shown.flatMap((p, i) => proteinLines(p.entry.accession, p.entry.identifier, entries[i], p.groups));
  const hints = shown.flatMap((p, i) => {
    const sequence = entries[i]?.sequence;
    return sequence ? [{ sequence, locate: locateIn(p.groups), residues: p.groups.flatMap(g => [...g.residues.values()]) }] : [];
  });
  if (proteins.length > shown.length) {
    lines.push({ text: `(+${proteins.length - shown.length} more UniProt proteins in this entry, not listed)`, priority: 4 });
  }

  // Polymers without a UniProt mapping: DNA/RNA, synthetic peptides, designed proteins
  const mapped = new Set(sifts.flatMap(a => a.segments.map(s => s.structAsymId)));
  const others: string[] = [];
  for (const molecule of molecules) {
    if (!/^poly/.test(molecule.type)) continue;
    const kind = /deoxyribo/.test(molecule.type) ? 'DNA' : /ribo/.test(molecule.type) ? 'RNA' : molecule.name.slice(0, 30) || 'polymer';
    molecule.asyms.forEach((asym, i) => {
      if (mapped.has(asym)) return;
      const numbers = (listing.get(asym) ?? []).filter(r => r.observed).map(r => r.authorNumber);
      if (numbers.length) others.push(`${molecule.chains[i] ?? asym} ${kind} ${Math.min(...numbers)}-${Math.max(...numbers)}`);
    });
  }
  if (others.length) lines.push({ text: `Other polymer chains: ${capList(others, 6).join('; ')}`, priority: 2 });

  if (ligands) lines.push(ligandLine(ligands));

  // Every observed polymer residue (the residue listing also holds ligands and waters, which go
  // through the ligand list instead) and every ligand, by author chain + number, for the answer
  // check. Without the molecule list polymers can't be told apart, so there is no check then.
  let index: StructureIndex | null = null;
  if (!moleculesFailed) {
    const polymerChain = new Map<string, string>();
    for (const molecule of molecules) {
      if (!/^poly/.test(molecule.type)) continue;
      molecule.asyms.forEach((asym, i) => polymerChain.set(asym, molecule.chains[i] ?? asym));
    }
    const residues = new Map<string, string>();
    for (const [asym, list] of listing) {
      const chain = polymerChain.get(asym);
      if (!chain) continue;
      for (const r of list) if (r.observed && !r.insCode) residues.set(`${chain}|${r.authorNumber}`, r.name.toUpperCase());
    }
    index = {
      residues,
      ligands: ligands ? new Map(ligands.map(l => [`${l.chain}|${l.resi}`, l.id] as const)) : null,
    };
  }
  return { lines, hints, index, incomplete };
};

// AlphaFold models: one chain "A" covering the whole UniProt sequence in UniProt numbering
const alphaFoldFactLines = async (accession: string): Promise<FactLines> => {
  const entry = await fetchUniProtEntry(accession);
  if (!entry?.sequence) return { lines: [], hints: [], index: null, incomplete: false };
  const own = new Map<number, Located>();
  [...entry.sequence].forEach((aa, i) => own.set(i + 1, { chain: 'A', resi: i + 1, name: THREE[aa] ?? aa }));
  return {
    lines: [
      ...proteinLines(accession, accession, entry, [{ chains: ['A'], own, residues: own }]),
      { text: 'Ligands in the file: none (predicted model: no ligands, metals or substrates)', priority: 0 },
    ],
    hints: [{ sequence: entry.sequence, locate: position => own.get(position) ?? null, residues: [...own.values()] }],
    index: {
      residues: new Map([...own].map(([position, r]) => [`A|${position}`, r.name.toUpperCase()] as const)),
      ligands: new Map(), // Predicted models carry no ligands
    },
    incomplete: false,
  };
};

// --- RESIDUES NAMED IN A QUESTION ---
// The model applies a numbering offset unreliably, above all when an earlier answer on
// screen already used UniProt numbers. So "T790M" or "Thr790" in a question is checked
// against the UniProt sequence and converted here, and the result is added to the facts.

const ONE_LETTER: Record<string, string> = Object.fromEntries(Object.entries(THREE).map(([one, three]) => [three.toLowerCase(), one]));
const MAX_NAMED = 6;

/** "T790M", "R175H", "E6V", "Thr790", "His 87" -> [{ aa: 'T', position: 790, text: 'T790' }, ...] */
const namedResidues = (query: string) => {
  const found = new Map<string, { aa: string; position: number; text: string }>();
  const add = (aa: string, position: number, text: string) => {
    if (position > 0 && position < 100000 && !found.has(`${aa}${position}`)) found.set(`${aa}${position}`, { aa, position, text });
  };
  for (const m of query.matchAll(/\b([ACDEFGHIKLMNPQRSTVWY])(\d{1,5})(?:[ACDEFGHIKLMNPQRSTVWY*]|del|fs|ins)?\b/g)) add(m[1], Number(m[2]), `${m[1]}${m[2]}`);
  for (const m of query.matchAll(/\b(Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val)[\s-]?(\d{1,5})\b/gi)) {
    add(ONE_LETTER[m[1].toLowerCase()], Number(m[2]), `${m[1]}${m[2]}`);
  }
  return [...found.values()].slice(0, MAX_NAMED);
};

/**
 * One line per residue named in the question that matches the structure: in UniProt numbering
 * (the residue type agrees with the UniProt sequence) or already in the file's numbering.
 */
const questionHintLine = (proteins: HintProtein[], query: string): string | null => {
  const notes: string[] = [];
  const label = (r: Located) => `${r.chain}:${r.name}${r.resi}`;
  for (const { aa, position, text } of namedResidues(query)) {
    for (const protein of proteins) {
      const fitsUniProt = protein.sequence[position - 1] === aa;
      const viaUniProt = fitsUniProt ? protein.locate(position) : null;
      const inFile = protein.residues.find(r => r.resi === position && r.name === THREE[aa]);
      if (viaUniProt && inFile && label(viaUniProt) !== label(inFile)) {
        // Both readings give the right residue type (trypsin's Ser195 in chymotrypsin numbering
        // is also a Ser in UniProt numbering): say so and let the context decide
        notes.push(`${text} fits two numberings: ${label(inFile)} if meant in this file's numbering, ${label(viaUniProt)} if meant in UniProt numbering`);
      } else if (viaUniProt) {
        notes.push(`${text} (UniProt numbering) = ${label(viaUniProt)} in this file`);
      } else if (inFile) {
        notes.push(`${text} is already this file's numbering (${label(inFile)})`);
      } else if (fitsUniProt) {
        notes.push(`${text} (UniProt numbering) is not in this structure`);
      } else {
        continue; // Not this protein: try the next one
      }
      break;
    }
  }
  return notes.length ? `Residues named in the question (checked against UniProt): ${notes.join('; ')}` : null;
};

const factsCache = new Map<string, Promise<string | null>>();
const hintCache = new Map<string, HintProtein[]>(); // Filled alongside factsCache
const indexCache = new Map<string, StructureIndex | 'unknown'>(); // Likewise

/** Cache key for a structure with facts: "AF-P04637" or a lower-case PDB ID; null for anything else (e.g. ESMFold). */
const factsKey = (structureId: string) => {
  const id = structureId.trim();
  const accession = parseAlphaFoldId(id);
  if (accession) return `AF-${accession}`;
  return !isEsmFoldId(id) && /^[0-9][a-z0-9]{3}$/i.test(id) ? id.toLowerCase() : null;
};

/** Facts block for a PDB entry or AlphaFold model ("AF-P04637-F1"); null when nothing is known (e.g. ESMFold). */
export const loadStructureFacts = (structureId: string): Promise<string | null> => {
  const key = factsKey(structureId);
  if (!key) return Promise.resolve(null);
  const accession = parseAlphaFoldId(structureId.trim());
  let incomplete = false;
  const pending = memoize(factsCache, key, async () => {
    const result = accession ? await alphaFoldFactLines(accession) : await pdbFactLines(key);
    incomplete = result.incomplete;
    hintCache.set(key, result.hints);
    if (result.index) indexCache.set(key, result.index);
    else indexCache.delete(key);
    return fitToBudget(result.lines);
  });
  // Built while a source was failing: use it for this question, fetch again next time
  pending.then(() => { if (incomplete && factsCache.get(key) === pending) factsCache.delete(key); }, () => {});
  return pending;
};

// Questions about how something binds get the ligand interactions computed from the file
const BINDING_QUESTION = /bind|bound|ligand|drug|inhibit|interact|hold|contact|pocket|site|hydrogen|h-?bond|salt|stack|metal|zinc|iron|heme|haem|cofactor|substrate|affinity|dock|co-?fold/i;

/** Ligand interactions of a PDB entry or a co-folded complex, from its own coordinates; null otherwise. */
const interactionLine = async (structureId: string, maxWaitMs: number): Promise<string | null> => {
  const id = structureId.trim();
  try {
    if (isCofoldId(id)) {
      const complex = getCofold(id);
      return complex
        ? interactionFactsLine(complex.pdb, { skipChains: complex.reference ? [complex.reference.chain] : [], names: { [`${complex.ligandChain}|1|`]: complex.ligand.name } })
        : null;
    }
    const key = factsKey(id);
    if (!key || key.startsWith('AF-')) return null;
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), maxWaitMs));
    const pdb = await Promise.race([fetchPdbFile(id).catch(() => null), timeout]); // Cached once the viewer has it
    return pdb ? interactionFactsLine(pdb) : null;
  } catch {
    return null;
  }
};

/**
 * Facts for a question: the structure laid over this one when the user has opened Overlay (it is what
 * they are looking at), the curated block, the residues the question names converted to the file's
 * numbering, the ligand interactions computed from the file (for questions about binding), then the
 * ligands AlphaFill placed (AlphaFold models) and what Pocket Radar and Partners already found for
 * this structure this session. A co-folded complex is described by its prediction.
 * Most important first, since the server cuts an over-long block at the end. Never throws, and
 * gives up on the curated block after maxWaitMs.
 */
export const getStructureFacts = async (structureId: string | undefined, query = '', maxWaitMs = 2500): Promise<string | null> => {
  if (!structureId) return null;
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), maxWaitMs));
  const wantsInteractions = isCofoldId(structureId) || BINDING_QUESTION.test(query);
  const [facts, interactions] = await Promise.all([
    Promise.race([loadStructureFacts(structureId).catch(() => null), timeout]),
    wantsInteractions ? interactionLine(structureId, maxWaitMs) : Promise.resolve(null),
  ]);
  const key = factsKey(structureId);
  const hint = facts && key && query ? questionHintLine(hintCache.get(key) ?? [], query)?.slice(0, 500) : null;
  const lines = [cofoldFactsLine(structureId), overlayFactsLine(structureId), facts, hint, interactions, paeFactsLine(structureId), alphaFillFactsLine(structureId), pocketFactsLine(structureId), partnerFactsLine(structureId)].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
};

// --- ANSWER CHECK ---
// Highlights are compared with the residues and ligands the chosen structure really has.
// Only clear contradictions count: a residue or chain that isn't there, a ligand that isn't
// there, or a residue whose type differs from a three-letter name in its label ("Lys745").

const MAX_PROBLEMS = 8;
// Modified residues count as their parent amino acid ("Met100" in a selenomethionine structure)
const PARENT: Record<string, string> = {
  MSE: 'MET', SEP: 'SER', TPO: 'THR', PTR: 'TYR', CSO: 'CYS', CSD: 'CYS', CME: 'CYS', OCS: 'CYS', CAS: 'CYS',
  KCX: 'LYS', LLP: 'LYS', MLY: 'LYS', M3L: 'LYS', ALY: 'LYS', HYP: 'PRO', HIC: 'HIS', NEP: 'HIS', CGU: 'GLU', PCA: 'GLU',
};
const THREE_NAMES = 'Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val';
const titleCase = (code: string) => code.charAt(0) + code.slice(1).toLowerCase();

/**
 * Residue types a label names, by residue number: "Lys745" -> 745: {LYS}; "p.Thr790Met" or
 * "T790M" -> 790: {THR, MET} (wild type or mutant). Bare "A87" is left alone: it may mean chain A.
 */
const labelledTypes = (label: string) => {
  const byNumber = new Map<number, Set<string>>();
  const add = (position: number, ...codes: (string | undefined)[]) => {
    const set = byNumber.get(position) ?? new Set<string>();
    for (const code of codes) if (code) set.add(code.toUpperCase());
    byNumber.set(position, set);
  };
  for (const m of label.matchAll(new RegExp(`\\b(${THREE_NAMES})[\\s-]?(\\d{1,5})(${THREE_NAMES})?(?![0-9])`, 'gi'))) add(Number(m[2]), m[1], m[3]);
  for (const m of label.matchAll(/\b([ACDEFGHIKLMNPQRSTVWY])(\d{1,5})([ACDEFGHIKLMNPQRSTVWY])\b/g)) add(Number(m[2]), THREE[m[1]], THREE[m[3]]);
  return byNumber;
};

/**
 * Problems with an answer, judged against the structure it names; [] when it is consistent,
 * null when it can't be checked (ESMFold prediction, co-folded complex, data unavailable or slow).
 */
export const checkAnswer = async (analysis: ProteinAnalysis, maxWaitMs = 6000): Promise<string[] | null> => {
  const id = analysis.pdbId;
  if (isEsmFoldId(id) || isCofoldId(id)) return null;
  const key = factsKey(id);
  if (!key) return [`"${id}" is not a valid PDB ID (PDB IDs are 4 characters, e.g. a digit and three letters or digits)`];

  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), maxWaitMs));
  await Promise.race([loadStructureFacts(id).catch(() => null), timeout]);
  const index = indexCache.get(key);
  if (!index) return null;
  if (index === 'unknown') return [`${id} is not an existing PDB entry`];

  const problems = new Set<string>();
  const chainRanges = new Map<string, [number, number]>();
  for (const residueKey of index.residues.keys()) {
    const [chain, number] = residueKey.split('|');
    const resi = Number(number);
    const range = chainRanges.get(chain);
    chainRanges.set(chain, range ? [Math.min(range[0], resi), Math.max(range[1], resi)] : [resi, resi]);
  }
  const whereIs = (chain: string) => {
    const range = chainRanges.get(chain);
    return range
      ? `chain ${chain} has residues ${range[0]}-${range[1]}`
      : `there is no chain ${chain}; the chains are ${[...chainRanges.keys()].sort().join(', ')}`;
  };

  const checkHighlight = (h: Highlight) => {
    const label = h.label ? ` ("${h.label}")` : '';
    const ligandLike = h.category === 'ligand' || h.category === 'substrate' || h.category === 'cofactor' || h.category === 'metal';
    const named = labelledTypes(h.label ?? '');
    // Only when the label names a ligand and no residue ("Zinc-binding Cys176" is about the Cys)
    const namesLigand = ligandLike && named.size === 0 && namedLigandIds(h.label ?? '').size > 0;
    for (const resi of h.resi) {
      const at = `${h.chain}|${resi}`;
      const residue = index.residues.get(at);
      const ligand = index.ligands?.get(at);
      if (ligandLike) {
        if (!residue && !ligand && index.ligands) problems.add(`${h.chain}:${resi}${label} is not a ligand, metal or residue in this file`);
        // "Heme group" on a protein residue: the label names a ligand, so it must be that ligand
        else if (residue && !ligand && namesLigand && index.ligands) problems.add(`${h.chain}:${resi} is a ${titleCase(residue)} residue, not the ligand named in${label}`);
        continue;
      }
      if (!residue) {
        if (!ligand) problems.add(`${h.chain}:${resi}${label} is not in this file (${whereIs(h.chain)})`);
        continue;
      }
      const expected = named.get(resi);
      const actual = PARENT[residue] ?? residue;
      if (expected && expected.size > 0 && !expected.has(actual)) {
        problems.add(`${h.chain}:${resi} is ${titleCase(residue)} in this file, not ${[...expected].map(titleCase).join('/')} as labelled${label}`);
      }
    }
  };

  analysis.highlights.forEach(checkHighlight);
  analysis.tour?.forEach(step => step.focus.forEach(checkHighlight));
  analysis.quiz?.answerHighlights?.forEach(checkHighlight);
  for (const m of analysis.measurements ?? []) {
    for (const end of [m.start, m.end]) {
      const at = `${end.chain}|${end.resi}`;
      if (!index.residues.has(at) && !index.ligands?.has(at)) problems.add(`measurement end ${end.chain}:${end.resi} is not in this file (${whereIs(end.chain)})`);
    }
  }
  return [...problems].slice(0, MAX_PROBLEMS);
};

// --- LOCAL CORRECTION ---
// The commonest mistakes can be fixed exactly without asking the model again (the AI
// tier allows ~2 answers a minute): a residue given in UniProt numbering is converted through the
// SIFTS mapping, and a ligand or metal placed on a residue that doesn't exist is moved onto the
// matching ligand the file really contains. What can't be fixed this way is left for a retry.

const LIGAND_WORDS: [RegExp, string[]][] = [
  [/\bhaem|\bheme/i, ['HEM', 'HEC', 'HEA', 'HEB', 'HAS']],
  [/\bzinc|\bzn\b/i, ['ZN']],
  [/\biron|\bfe\b/i, ['FE', 'FE2']],
  [/magnesium|\bmg\b/i, ['MG']],
  [/calcium|\bca2?\+/i, ['CA']],
  [/manganese|\bmn\b/i, ['MN']],
  [/copper|\bcu\b/i, ['CU', 'CU1']],
  [/nickel/i, ['NI']],
  [/cobalt/i, ['CO']],
  [/sodium/i, ['NA']],
  [/potassium/i, ['K']],
  [/cadmium/i, ['CD']],
  [/chloride/i, ['CL']],
  [/\batp\b/i, ['ATP', 'ANP', 'ACP', 'AGS']],
  [/\badp\b/i, ['ADP']],
  [/\bgtp\b/i, ['GTP', 'GNP', 'GCP']],
  [/\bgdp\b/i, ['GDP']],
  [/\bnadph?\b|\bnadp\b/i, ['NAP', 'NDP']],
  [/\bnadh?\b/i, ['NAD', 'NAI']],
  [/\bfad\b/i, ['FAD']],
  [/\bfmn\b/i, ['FMN']],
  [/\bsam\b|adenosylmethionine/i, ['SAM']],
  [/\bplp\b|pyridoxal/i, ['PLP']],
  [/coenzyme a|\bcoa\b/i, ['COA']],
  [/glucose/i, ['GLC', 'BGC']],
  [/\boxygen\b|\bo2\b/i, ['OXY']],
];
const METALS = new Set(['ZN', 'FE', 'FE2', 'MG', 'CA', 'MN', 'CU', 'CU1', 'NI', 'CO', 'NA', 'K', 'CD', 'HG']);

/** Ligand IDs a label names by common name ("Heme group" -> HEM, HEC...), whatever the file holds. */
const namedLigandIds = (label: string) => {
  const ids = new Set<string>();
  for (const [pattern, codes] of LIGAND_WORDS) if (pattern.test(label)) codes.forEach(c => ids.add(c));
  return ids;
};

export interface CorrectedAnswer {
  analysis: ProteinAnalysis;
  conversions: string[]; // "UniProt Lys745 = A:Lys721", for the note added to the summary
}

/** The answer with UniProt-numbered residues and misplaced ligands fixed; null when nothing could be fixed. */
export const correctAnswer = async (analysis: ProteinAnalysis, maxWaitMs = 6000): Promise<CorrectedAnswer | null> => {
  const key = factsKey(analysis.pdbId);
  if (!key) return null;
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), maxWaitMs));
  await Promise.race([loadStructureFacts(analysis.pdbId).catch(() => null), timeout]);
  const index = indexCache.get(key);
  if (!index || index === 'unknown') return null;
  const proteins = hintCache.get(key) ?? [];

  let changed = false;
  const conversions = new Set<string>();
  const ligandIds = index.ligands ? [...new Set(index.ligands.values())] : [];
  const ligandInstances = (ids: Set<string>) =>
    [...(index.ligands ?? new Map<string, string>())].filter(([, id]) => ids.has(id)).map(([at]) => {
      const [chain, resi] = at.split('|');
      return { chain, resi: Number(resi) };
    });

  // Which ligand a label means: its chemical ID, a common name, or the only candidate in the file
  const ligandFor = (h: Highlight): Set<string> => {
    const label = h.label ?? '';
    const ids = new Set(ligandIds.filter(id => new RegExp(`(^|[^A-Z0-9])${id}([^A-Z0-9]|$)`).test(label.toUpperCase())));
    for (const [pattern, codes] of LIGAND_WORDS) if (pattern.test(label)) codes.filter(c => ligandIds.includes(c)).forEach(c => ids.add(c));
    if (ids.size > 0) return ids;
    const metals = ligandIds.filter(id => METALS.has(id));
    const others = ligandIds.filter(id => !METALS.has(id) && !ADDITIVES.has(id) && !['SO4', 'PO4', 'CL', 'NA', 'K', 'IOD', 'BR'].includes(id));
    if (h.category === 'metal' && metals.length === 1) return new Set(metals);
    if (h.category !== 'metal' && others.length === 1) return new Set(others);
    return ids;
  };

  // Evidence that the answer used UniProt numbering: a residue named in a label that matches
  // UniProt's residue at that number but not the file's. Only then are numbers without a name
  // (and measurement ends) read as UniProt numbers too.
  const allHighlights = [
    ...analysis.highlights,
    ...(analysis.tour ?? []).flatMap(step => step.focus),
    ...(analysis.quiz?.answerHighlights ?? []),
  ];
  const usesUniProtNumbering = allHighlights.some(h =>
    [...labelledTypes(h.label ?? '')].some(([resi, types]) => {
      const inFile = index.residues.get(`${h.chain}|${resi}`);
      if (inFile && types.has(PARENT[inFile] ?? inFile)) return false;
      return proteins.some(p => {
        const uniprotType = THREE[p.sequence[resi - 1]]?.toUpperCase();
        return uniprotType !== undefined && types.has(uniprotType) && p.locate(resi) !== null;
      });
    })
  );

  const fixHighlight = (h: Highlight): Highlight[] => {
    const ligandLike = h.category === 'ligand' || h.category === 'substrate' || h.category === 'cofactor' || h.category === 'metal';
    const byChain = new Map<string, number[]>();
    const keep = (chain: string, resi: number) => {
      const list = byChain.get(chain) ?? [];
      if (!list.includes(resi)) list.push(resi);
      byChain.set(chain, list);
    };
    const named = labelledTypes(h.label ?? '');
    const namesLigand = ligandLike && named.size === 0 && namedLigandIds(h.label ?? '').size > 0;

    for (const resi of h.resi) {
      const at = `${h.chain}|${resi}`;
      const residue = index.residues.get(at);
      const ligand = index.ligands?.get(at);

      if (ligandLike) {
        const misplaced = !ligand && (!residue || namesLigand);
        if (!misplaced || !index.ligands) { keep(h.chain, resi); continue; }
        const targets = ligandInstances(ligandFor(h));
        const sameChain = targets.filter(t => t.chain === h.chain);
        if (targets.length === 0) { keep(h.chain, resi); continue; }
        (sameChain.length > 0 ? sameChain : targets).forEach(t => keep(t.chain, t.resi));
        changed = true;
        continue;
      }

      const expected = named.get(resi);
      const isNamed = expected !== undefined && expected.size > 0;
      const fits = residue && (!isNamed || expected.has(PARENT[residue] ?? residue));
      if (fits || (!residue && ligand) || (!isNamed && !usesUniProtNumbering)) { keep(h.chain, resi); continue; }

      // Read the number as UniProt numbering instead (residue type checked when the label names one)
      let converted = false;
      for (const protein of proteins) {
        const uniprotType = THREE[protein.sequence[resi - 1]]?.toUpperCase();
        if (!uniprotType || (isNamed && !expected.has(uniprotType))) continue;
        const located = protein.locate(resi);
        if (!located) continue;
        const target = index.residues.has(`${h.chain}|${located.resi}`) ? h.chain : located.chain;
        const targetType = index.residues.get(`${target}|${located.resi}`);
        if (!targetType || (PARENT[targetType] ?? targetType) !== uniprotType) continue;
        keep(target, located.resi);
        if (isNamed) conversions.add(`UniProt ${titleCase(uniprotType)}${resi} = ${target}:${titleCase(uniprotType)}${located.resi}`);
        converted = changed = true;
        break;
      }
      if (!converted) keep(h.chain, resi);
    }
    return [...byChain].map(([chain, resi]) => ({ ...h, chain, resi }));
  };

  const fixAtom = <T extends { chain: string; resi: number }>(end: T): T => {
    const at = `${end.chain}|${end.resi}`;
    if (index.residues.has(at) || index.ligands?.has(at) || !usesUniProtNumbering) return end;
    for (const protein of proteins) {
      const located = protein.locate(end.resi);
      if (located && index.residues.has(`${end.chain}|${located.resi}`)) {
        changed = true;
        return { ...end, resi: located.resi };
      }
    }
    return end;
  };

  const corrected: ProteinAnalysis = {
    ...analysis,
    highlights: analysis.highlights.flatMap(fixHighlight),
    measurements: (analysis.measurements ?? []).map(m => ({ ...m, start: fixAtom(m.start), end: fixAtom(m.end) })),
    ...(analysis.tour ? { tour: analysis.tour.map(step => ({ ...step, focus: step.focus.flatMap(fixHighlight) })) } : {}),
    ...(analysis.quiz
      ? { quiz: { ...analysis.quiz, ...(analysis.quiz.answerHighlights ? { answerHighlights: analysis.quiz.answerHighlights.flatMap(fixHighlight) } : {}) } }
      : {}),
  };
  if (!changed) return null;
  const notes = [...conversions].slice(0, 4);
  if (notes.length) {
    corrected.summary = `${corrected.summary} (Highlights use this file's residue numbers: ${notes.join('; ')}.)`;
  }
  return { analysis: corrected, conversions: notes };
};
