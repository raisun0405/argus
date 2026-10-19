import { BoundedMap, fetchOrNull, memoize } from './http';
import { parseAlphaFoldId } from './alphafoldService';
import { superpose, type Vec3 } from './superpose';
import { parseAtomSite, type CifAtom } from './mmcif'; // AlphaFill serves its models as mmCIF

// --- ALPHAFILL (ligands and cofactors transplanted into AlphaFold models) ---
// AlphaFold models have no ligands. AlphaFill (Hekkelman et al., Nat Methods 2023; alphafill.eu,
// keyless with CORS) copies them in from homologous PDB entries and scores every transplant: TCS,
// the r.m.s. van der Waals overlap with the protein, and local r.m.s.d., the fit of the backbone
// within 6 Å of the ligand. Its precomputed transplants sit in AlphaFold DB v4 models while Argus
// shows v6 models: the same prediction in another frame for many proteins, re-predicted domains for
// others. So each ligand is moved onto its own binding site by superposing that site's backbone,
// and is left out when the site differs between the two models.

const ALPHAFILL_API = 'https://alphafill.eu/v1/aff';
// AlphaFill's confidence bands (from the paper): high up to TCS 0.64 Å and local r.m.s.d. 0.92 Å,
// medium up to 1.27 Å and 3.10 Å; anything beyond is low confidence and not shown
const HIGH = { tcs: 0.64, localRmsd: 0.92 };
const MEDIUM = { tcs: 1.27, localRmsd: 3.1 };
const SITE_RADIUS = 6; // Å: backbone atoms this close to the ligand make its site, as in AlphaFill
const WIDE_SITE_RADIUS = 10; // For small ligands with few backbone atoms that close
const MAX_SITE_RMSD = 1.0; // Å between the site in AlphaFill's model and in the model on screen
const MAX_TRANSPLANTS = 6; // Cofactors, metals and gases first; the view stays readable
const OVERLAP_DISTANCE = 1.2; // Å: atoms closer than this occupy the same space
const CONTACT_DISTANCE = 4.0; // Å: residues this close to a ligand are listed as its contacts
const COORDINATION_DISTANCE = 3.0; // Å: N, O or S atoms this close to a metal coordinate it
const IRON_BOND_DISTANCE = 2.6; // Å: a gas this close to a heme iron is bound to it
export const FIRST_TRANSPLANT_RESIDUE = 9001; // Residue numbers of the transplants in the merged model

// Good scores alone don't make a transplant this protein's ligand: AlphaFill also copies ligands of
// neighbouring molecules in the source crystal (a heme from the next subunit of a sickle-cell
// haemoglobin fibre, touching one residue) and surface ions from crystallisation. So a placed
// transplant must also be held by the model: metals by at least 3 coordinating atoms, gases by a
// heme iron, other ligands by enough residues for their size.
// Metals must also come from a close homolog: a homolog's surface ion is rarely a site of this protein.
const METALS = new Set(['ZN', 'MG', 'CA', 'MN', 'FE', 'FE2', 'CU', 'CU1', 'CO', 'NI', 'MO']);
const METAL_MIN_IDENTITY = 0.7;
// Small molecules that bind a heme iron, the physiological ones first (O2 rather than nitrite on haemoglobin)
const IRON_LIGANDS_BY_PREFERENCE = ['OXY', 'CMO', 'NO', 'CYN', 'NO2', 'H2S', 'PER'];
const IRON_LIGANDS = new Set(IRON_LIGANDS_BY_PREFERENCE);
const MAX_OTHER_LIGANDS = 2; // Drugs and probes from ligand-soaking studies: a couple, after cofactors and metals
const IRON_CARRIERS = new Set(['HEM', 'HEC', 'HEA']);
// Organic cofactors, nucleotides, sugars and physiological effectors: placed first
const COFACTORS = new Set([
  'HEM', 'HEC', 'HEA', 'ATP', 'ADP', 'AMP', 'ANP', 'ACP', 'GTP', 'GDP', 'GNP', 'GSP', 'NAD', 'NAI', 'NAP', 'NDP',
  'FAD', 'FMN', 'SAM', 'SAH', 'COA', 'ACO', 'PLP', 'TPP', 'B12', 'SF4', 'FES', 'F3S', 'CLA', 'CHL', 'BCL', 'RET',
  'BTN', 'H4B', 'MTE', 'NAG', 'BMA', 'MAN', 'GLC', 'BGC', 'DG2',
]);

// Crystallisation additives, buffer ions and probe molecules: real atoms in the source entries,
// but not what the protein binds in a cell (also left out of Co-fold's ligand picks)
export const NOT_SHOWN = new Set([
  'HOH', 'DOD', 'WAT', 'UNX', 'UNL', 'GOL', 'EDO', 'PEG', 'PGE', 'PG4', '1PE', '2PE', 'P6G', '12P', 'PE4',
  'ACT', 'ACY', 'FMT', 'FOR', 'DMS', 'MPD', 'MRD', 'TRS', 'TAM', 'EPE', 'MES', 'BME', 'IPA', 'EOH', 'MOH',
  'SCN', 'NO3', 'IMD', 'SO4', 'CIT', 'FLC', 'MLI', 'TLA', 'DIO', 'BU3', 'NH4', 'CL', 'BR', 'IOD', 'NA',
  'K', 'CD', 'XE', 'KR', 'MBN', 'BNZ', 'AZI',
  // Heavy-atom soaks used for phasing
  'YT3', 'HO', 'HO3', 'GD', 'GD3', 'SM', 'EU', 'EU3', 'TB', 'YB', 'LU', 'ER', 'PR', 'LA', 'PT', 'HG', 'AU', 'AU3',
  'PB', 'OS', 'IR', 'TL', 'BA', 'SR', 'CS', 'RB', 'LI', 'W', 'WO4', 'SE',
]);

// Readable names for common ligands; others show their PDB code
export const LIGAND_NAMES: Record<string, string> = {
  DG2: '2,3-Bisphosphoglycerate', S1P: 'Sphingosine-1-phosphate', ARS: 'Arsenic', CYN: 'Cyanide', NO2: 'Nitrite',
  H2S: 'Hydrogen sulfide', PER: 'Peroxide',
  HEM: 'Heme', HEC: 'Heme C', HEA: 'Heme A', OXY: 'Oxygen', CMO: 'Carbon monoxide', NO: 'Nitric oxide',
  ZN: 'Zinc', MG: 'Magnesium', CA: 'Calcium', MN: 'Manganese', FE: 'Iron', FE2: 'Iron', CU: 'Copper',
  CU1: 'Copper', CO: 'Cobalt', NI: 'Nickel', MO: 'Molybdenum',
  ATP: 'ATP', ADP: 'ADP', AMP: 'AMP', ANP: 'ATP analogue', ACP: 'ATP analogue', GTP: 'GTP', GDP: 'GDP',
  GNP: 'GTP analogue', GSP: 'GTP analogue', NAD: 'NAD', NAI: 'NADH', NAP: 'NADP', NDP: 'NADPH', FAD: 'FAD',
  FMN: 'FMN', SAM: 'S-adenosylmethionine', SAH: 'S-adenosylhomocysteine', COA: 'Coenzyme A', ACO: 'Acetyl-CoA',
  PLP: 'Pyridoxal phosphate', TPP: 'Thiamine diphosphate', B12: 'Cobalamin', SF4: 'Iron-sulfur cluster',
  FES: 'Iron-sulfur cluster', F3S: 'Iron-sulfur cluster', CLA: 'Chlorophyll a', CHL: 'Chlorophyll b',
  BCL: 'Bacteriochlorophyll', RET: 'Retinal', BTN: 'Biotin', H4B: 'Tetrahydrobiopterin', MTE: 'Molybdopterin',
  PO4: 'Phosphate', NAG: 'N-acetylglucosamine', BMA: 'Mannose', MAN: 'Mannose', GLC: 'Glucose', BGC: 'Glucose',
};

export type TransplantConfidence = 'high' | 'medium';

export interface Transplant {
  compound: string; // PDB chemical component ID, e.g. "HEM"
  name: string; // Readable name when known, else the ID
  sourcePdb: string; // Entry it was copied from
  identity: number; // Sequence identity of that entry's protein to the model, 0-1
  localRmsd: number; // AlphaFill's local r.m.s.d., Å
  clashScore: number; // AlphaFill's TCS, Å
  confidence: TransplantConfidence;
  chain: string; // Where it sits in the merged model
  resi: number;
  contacts: string[]; // Model residues within 4 Å, e.g. "A:His93"
}

export interface AlphaFillResult {
  accession: string;
  transplants: Transplant[]; // Placed in the model on screen, most relevant first
  skipped: number; // Confident transplants left out because their site differs in this model version
  pdb: string; // The model on screen with the transplants added as HETATM records
}

// --- THE MODEL ON SCREEN (PDB format) ---

interface ModelResidue { name: string; backbone: Map<string, Vec3>; atoms: Vec3[]; polar: Vec3[] }

const parseModel = (pdb: string) => {
  const residues = new Map<number, ModelResidue>();
  let lastSerial = 0;
  for (const line of pdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const serial = parseInt(line.slice(6, 11), 10);
    if (Number.isFinite(serial)) lastSerial = Math.max(lastSerial, serial);
    if (!line.startsWith('ATOM')) continue;
    const resi = parseInt(line.slice(22, 26), 10);
    const position: Vec3 = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    if (!Number.isFinite(resi) || position.some(v => !Number.isFinite(v))) continue;
    let residue = residues.get(resi);
    if (!residue) {
      residue = { name: line.slice(17, 20).trim(), backbone: new Map(), atoms: [], polar: [] };
      residues.set(resi, residue);
    }
    const name = line.slice(12, 16).trim();
    if (name === 'N' || name === 'CA' || name === 'C' || name === 'O') residue.backbone.set(name, position);
    residue.atoms.push(position);
    const element = (line.slice(76, 78).trim() || name.charAt(0)).toUpperCase();
    if (element === 'N' || element === 'O' || element === 'S') residue.polar.push(position);
  }
  return { residues, lastSerial };
};

const isPolar = (element: string) => ['N', 'O', 'S'].includes(element.toUpperCase());

const distance2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const near = (points: Vec3[], others: Vec3[], cutoff: number) => {
  const c2 = cutoff * cutoff;
  return points.some(p => others.some(q => distance2(p, q) <= c2));
};

/** HETATM record in PDB format (atom names of one-letter elements start in column 14, as in the PDB). */
const hetatm = (serial: number, name: string, element: string, compound: string, chain: string, resi: number, p: Vec3) => {
  const atomName = name.length >= 4 || element.length === 2 ? name.padEnd(4).slice(0, 4) : ` ${name}`.padEnd(4);
  return `HETATM${String(serial).padStart(5)} ${atomName} ${compound.padStart(3)} ${chain}${String(resi).padStart(4)}    ` +
    `${p[0].toFixed(3).padStart(8)}${p[1].toFixed(3).padStart(8)}${p[2].toFixed(3).padStart(8)}  1.00  0.00          ${element.toUpperCase().padStart(2)}`;
};

const titleCase = (code: string) => code.charAt(0) + code.slice(1).toLowerCase();

// --- LOADING ---

const results = new BoundedMap<string, Promise<AlphaFillResult | null>>(6); // Accession -> result
const loaded = new BoundedMap<string, AlphaFillResult>(6); // Finished results, read synchronously for the chat facts

/**
 * AlphaFill's confident transplants for an AlphaFold model, moved into the model on screen
 * (`modelPdb`, the AlphaFold DB file Argus shows). Null when AlphaFill has no entry for the protein.
 */
export const loadAlphaFill = (accession: string, modelPdb: string): Promise<AlphaFillResult | null> =>
  memoize(results, accession.toUpperCase(), async () => {
    const acc = accession.toUpperCase();
    const metaResponse = await fetchOrNull(`${ALPHAFILL_API}/${acc}/json`);
    if (!metaResponse) return null;
    const meta = await metaResponse.json();

    interface Candidate { compound: string; asym: string; sourcePdb: string; identity: number; localRmsd: number; clashScore: number; confidence: TransplantConfidence }
    const candidates: Candidate[] = [];
    for (const hit of Array.isArray(meta?.hits) ? meta.hits : []) {
      for (const t of Array.isArray(hit?.transplants) ? hit.transplants : []) {
        const compound = String(t?.compound_id ?? '').toUpperCase();
        const localRmsd = Number(t?.local_rmsd);
        const clashScore = Number(t?.clash?.score ?? 0);
        if (!compound || compound.length > 3 || NOT_SHOWN.has(compound) || !Number.isFinite(localRmsd)) continue;
        const tcs = Number.isFinite(clashScore) ? clashScore : 0;
        const confidence: TransplantConfidence | null =
          tcs <= HIGH.tcs && localRmsd <= HIGH.localRmsd ? 'high'
          : tcs <= MEDIUM.tcs && localRmsd <= MEDIUM.localRmsd ? 'medium'
          : null;
        if (!confidence) continue;
        candidates.push({
          compound,
          asym: String(t?.asym_id ?? ''),
          sourcePdb: String(hit?.pdb_id ?? '').toUpperCase(),
          identity: Number(hit?.alignment?.identity) || 0,
          localRmsd,
          clashScore: tcs,
          confidence,
        });
      }
    }
    if (candidates.length === 0) {
      const none: AlphaFillResult = { accession: acc, transplants: [], skipped: 0, pdb: modelPdb };
      loaded.set(acc, none);
      return none;
    }

    // Cofactors first (metals and gases bind to them), then metals, gases and other ligands; within a
    // class close homologs first, then confidence, then the tighter fit
    const classOf = (compound: string) => (IRON_LIGANDS.has(compound) ? 2 : METALS.has(compound) ? 1 : COFACTORS.has(compound) ? 0 : 3);
    const rank = (c: Candidate) => [
      classOf(c.compound),
      IRON_LIGANDS.has(c.compound) ? IRON_LIGANDS_BY_PREFERENCE.indexOf(c.compound) : 0,
      c.identity >= 0.7 ? 0 : 1,
      c.confidence === 'high' ? 0 : 1,
      c.localRmsd + c.clashScore,
      -c.identity,
    ];
    candidates.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    });

    const modelResponse = await fetchOrNull(`${ALPHAFILL_API}/${acc}`);
    if (!modelResponse) return null;
    const cifAtoms = parseAtomSite(await modelResponse.text());
    const fillBackbone = new Map<number, Map<string, Vec3>>(); // AlphaFill's (v4) protein backbone
    const ligandAtoms = new Map<string, CifAtom[]>(); // label_asym_id -> transplant atoms
    for (const a of cifAtoms) {
      if (a.het) {
        const list = ligandAtoms.get(a.asym);
        if (list) list.push(a);
        else ligandAtoms.set(a.asym, [a]);
      } else if (a.name === 'N' || a.name === 'CA' || a.name === 'C' || a.name === 'O') {
        let residue = fillBackbone.get(a.resi);
        if (!residue) { residue = new Map(); fillBackbone.set(a.resi, residue); }
        residue.set(a.name, a.position);
      }
    }
    const model = parseModel(modelPdb);

    const placed: { candidate: Candidate; atoms: { name: string; element: string; position: Vec3 }[] }[] = [];
    const occupiedIrons: Vec3[] = []; // Heme irons that already hold O2, CO, NO...
    let skipped = 0;
    for (const candidate of candidates) {
      if (placed.length >= MAX_TRANSPLANTS) break;
      const atoms = ligandAtoms.get(candidate.asym);
      if (!atoms || atoms.length === 0) continue;
      const ligand = atoms.map(a => a.position);

      // The site: backbone atoms near the ligand in AlphaFill's model, paired with the model on screen
      const pairsWithin = (radius: number) => {
        const from: Vec3[] = [];
        const to: Vec3[] = [];
        for (const [resi, backbone] of fillBackbone) {
          if (!near([...backbone.values()], ligand, radius)) continue;
          const target = model.residues.get(resi)?.backbone;
          if (!target) continue;
          for (const [name, position] of backbone) {
            const partner = target.get(name);
            if (partner) { from.push(position); to.push(partner); }
          }
        }
        return { from, to };
      };
      let pairs = pairsWithin(SITE_RADIUS);
      if (pairs.from.length < 12) pairs = pairsWithin(WIDE_SITE_RADIUS);
      if (pairs.from.length < 12) continue; // Not enough of a site to place it
      const fit = superpose(pairs.from, pairs.to);
      if (fit.rmsd > MAX_SITE_RMSD) { skipped++; continue; }

      const moved = atoms.map(a => ({ name: a.name, element: a.element, position: fit.apply(a.position) }));
      // Two transplants in the same space (the same heme from another template, CO where O2 sits): keep the better
      const positions = moved.map(a => a.position);
      const overlapping = placed.some(other => {
        const otherPositions = other.atoms.map(a => a.position);
        const shared = positions.filter(p => near([p], otherPositions, OVERLAP_DISTANCE)).length;
        return shared >= Math.max(1, Math.ceil(0.3 * Math.min(positions.length, otherPositions.length)));
      });
      if (overlapping) continue;

      // Held by this model? (see the note at the top)
      const touching = [...model.residues.values()].filter(r => near(r.atoms, positions, CONTACT_DISTANCE));
      let iron: Vec3 | undefined;
      if (METALS.has(candidate.compound)) {
        if (candidate.identity < METAL_MIN_IDENTITY) continue;
        // Coordinating groups: residues, or cofactors already placed (ATP's phosphates hold a magnesium)
        const groups = [
          ...touching.map(r => r.polar),
          ...placed.map(p => p.atoms.filter(a => isPolar(a.element)).map(a => a.position)),
        ];
        const coordinating = groups.filter(donors => near(positions, donors, COORDINATION_DISTANCE)).length;
        if (coordinating < 3) continue;
      } else if (IRON_LIGANDS.has(candidate.compound)) {
        // On a heme iron that holds nothing else yet
        iron = placed
          .filter(p => IRON_CARRIERS.has(p.candidate.compound))
          .flatMap(p => p.atoms.filter(a => a.element.toUpperCase() === 'FE').map(a => a.position))
          .find(fe => near(positions, [fe], IRON_BOND_DISTANCE) && !occupiedIrons.includes(fe));
        if (!iron) continue;
      } else if (touching.length < Math.max(3, Math.ceil(atoms.length / 6))) {
        continue;
      } else if (classOf(candidate.compound) === 3 && placed.filter(p => classOf(p.candidate.compound) === 3).length >= MAX_OTHER_LIGANDS) {
        continue;
      }
      if (iron) occupiedIrons.push(iron);
      placed.push({ candidate, atoms: moved });
    }

    // Append the transplants to the model as HETATM records of chain A, residues 9001, 9002...
    const lines: string[] = [];
    let serial = model.lastSerial + 1;
    const transplants: Transplant[] = placed.map(({ candidate, atoms }, i) => {
      const resi = FIRST_TRANSPLANT_RESIDUE + i;
      for (const a of atoms) lines.push(hetatm(serial++, a.name, a.element, candidate.compound, 'A', resi, a.position));
      const positions = atoms.map(a => a.position);
      const contacts = [...model.residues]
        .filter(([, residue]) => near(residue.atoms, positions, CONTACT_DISTANCE))
        .map(([number, residue]) => `A:${titleCase(residue.name)}${number}`);
      return {
        compound: candidate.compound,
        name: LIGAND_NAMES[candidate.compound] ?? candidate.compound,
        sourcePdb: candidate.sourcePdb,
        identity: candidate.identity,
        localRmsd: candidate.localRmsd,
        clashScore: candidate.clashScore,
        confidence: candidate.confidence,
        chain: 'A',
        resi,
        contacts,
      };
    });

    // Inside the first model: AlphaFold DB files wrap their atoms in MODEL/ENDMDL, and 3Dmol (like
    // every parser here) reads only the first model
    const modelLines = modelPdb.replace(/\s+$/, '').split('\n');
    let end = modelLines.findIndex(l => l.startsWith('ENDMDL'));
    if (end < 0) end = modelLines.findIndex(l => /^END\s*$/.test(l));
    if (end >= 0) modelLines.splice(end, 0, ...lines);
    else modelLines.push(...lines);
    const result: AlphaFillResult = { accession: acc, transplants, skipped, pdb: lines.length ? `${modelLines.join('\n')}\n` : modelPdb };
    loaded.set(acc, result);
    return result;
  });

// --- FACTS FOR THE AI ---

/** One facts line naming the transplanted ligands and the residues they touch, for an AlphaFold model ID. */
export const alphaFillFactsLine = (structureId: string, maxChars = 420): string | null => {
  const accession = parseAlphaFoldId(structureId);
  const result = accession ? loaded.get(accession) : undefined;
  if (!result || result.transplants.length === 0) return null;
  let line = 'AlphaFill ligands in this AlphaFold model (copied from homologous PDB entries, not experimental for this model):';
  for (const t of result.transplants) {
    const entry = ` ${t.name} (${t.compound}, from ${t.sourcePdb}, ${t.confidence} confidence) touching ${t.contacts.slice(0, 6).join(' ') || 'no residue'};`;
    if (line.length + entry.length > maxChars) break;
    line += entry;
  }
  return line.replace(/;$/, '');
};
