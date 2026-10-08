import type { Vec3 } from './superpose';
import { LIGAND_NAMES, NOT_SHOWN } from './alphafillService';

// --- LIGAND INTERACTIONS ---
// What holds each ligand in place: hydrogen bonds, salt bridges, π-stacking, cation-π, halogen bonds,
// metal coordination, water bridges and hydrophobic contacts, found from the coordinates with the
// geometric criteria of PLIP (Salentin et al., NAR 2015; Adasme et al., NAR 2021). Structure files
// rarely hold hydrogens, so donors, acceptors and charges come from residue templates on the protein
// side and from bond geometry (bond lengths, ring planarity) on the ligand side, and hydrogen bonds
// use a tighter heavy-atom distance with angle checks in place of PLIP's added hydrogens.

export type InteractionType =
  | 'hbond' | 'salt_bridge' | 'pi_stacking' | 'pi_cation' | 'halogen' | 'metal' | 'water_bridge' | 'hydrophobic';

export const INTERACTION_ORDER: InteractionType[] = ['metal', 'salt_bridge', 'hbond', 'halogen', 'pi_stacking', 'pi_cation', 'water_bridge', 'hydrophobic'];

export const INTERACTION_LABELS: Record<InteractionType, { one: string; many: string }> = {
  hbond: { one: 'Hydrogen bond', many: 'Hydrogen bonds' },
  salt_bridge: { one: 'Salt bridge', many: 'Salt bridges' },
  pi_stacking: { one: 'π-stacking', many: 'π-stacking' },
  pi_cation: { one: 'Cation-π', many: 'Cation-π' },
  halogen: { one: 'Halogen bond', many: 'Halogen bonds' },
  metal: { one: 'Metal coordination', many: 'Metal coordination' },
  water_bridge: { one: 'Water bridge', many: 'Water bridges' },
  hydrophobic: { one: 'Hydrophobic contact', many: 'Hydrophobic contacts' },
};

export interface InteractionPartner {
  chain: string;
  resi: number;
  icode: string;
  resn: string; // Residue (or ion, other ligand) name: "ASP", "ZN"
  atom?: string; // Partner atom, when the interaction is between atoms
}

export interface Interaction {
  type: InteractionType;
  partner: InteractionPartner;
  ligandAtom?: string; // Ligand atom name; absent for ring and charge-centre interactions
  distance: number; // Å: between atoms, or ring / charge centres
  from: Vec3; // Ligand side (atom, ring centre or charge centre)
  to: Vec3; // Partner side
  via?: { chain: string; resi: number; position: Vec3 }; // The water of a water bridge
  detail?: string; // "ligand donates", "parallel", "T-shaped", "cation on the ligand"...
}

export interface LigandSite {
  key: string; // `${chain}|${resi}|${icode}`
  code: string; // PDB residue name ("MK1")
  name: string; // Readable name when known
  chain: string;
  resi: number;
  icode: string;
  heavyAtoms: number;
  kind: 'organic' | 'metal' | 'ion';
  interactions: Interaction[]; // Ordered by INTERACTION_ORDER, then distance
}

// PLIP's thresholds (Å, degrees), and the heavy-atom stand-ins for its hydrogen-based checks
const HYDROPHOBIC_MAX = 4.0;
const HBOND_MIN = 2.5;
const HBOND_MAX = 3.5; // PLIP: 4.1 Å donor-acceptor with a hydrogen angle; without hydrogens, closer
const HBOND_ANGLE_MIN = 85; // At donor and acceptor, between a bonded neighbour and the partner
const SALT_BRIDGE_MAX = 4.0; // Between oppositely charged N and O atoms (PLIP's 5.5 Å between charge centres also counts near misses)
const PI_STACK_MAX = 5.5;
const PI_ANGLE_DEV = 30;
const PI_OFFSET_MAX = 2.0;
const PI_CATION_MAX = 6.0;
const HALOGEN_MAX = 4.0;
const HALOGEN_DONOR_ANGLE = 165;
const HALOGEN_ACCEPTOR_ANGLE = 120;
const HALOGEN_ANGLE_DEV = 30;
const METAL_MAX = 3.0;
const METAL_BOND = 2.6; // Atoms this close to a metal are bound to it: no longer hydrogen-bond donors or acceptors
const WATER_MAX = 3.5; // Each leg of a water bridge
const WATER_MIN = 2.5;
const NEIGHBOURHOOD = 8.0; // Partner atoms considered around a ligand
const COVALENT_MIN = 2.0; // Closer than this is a covalent bond (covalent ligands), not an interaction

const WATERS = new Set(['HOH', 'DOD', 'WAT', 'H2O']);
const METALS = new Set([
  'LI', 'NA', 'K', 'RB', 'CS', 'MG', 'CA', 'SR', 'BA', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN', 'CD', 'HG', 'MO', 'W', 'V', 'CR',
  'PT', 'PD', 'AU', 'AG', 'RU', 'RH', 'OS', 'IR', 'AL', 'GA', 'PB', 'TL', 'SN', 'GD', 'EU', 'TB', 'YB', 'LU', 'SM', 'HO',
  'ER', 'LA', 'PR', 'Y', 'ZR', 'U',
]);
const COVALENT_RADIUS: Record<string, number> = {
  B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, SI: 1.11, P: 1.07, S: 1.05, CL: 1.02, BR: 1.2, I: 1.39, SE: 1.2, AS: 1.19,
};
// Single-bond lengths: ring bonds well below them are aromatic or conjugated
const SINGLE_BOND: Record<string, number> = {
  CC: 1.54, CN: 1.47, CO: 1.43, CS: 1.82, NN: 1.45, NO: 1.4, NS: 1.68, OS: 1.6, OO: 1.48, SS: 2.05,
};

// --- Protein and nucleic-acid templates (PLIP's donor, acceptor, charge, ring and hydrophobic atoms) ---

const SIDE_DONORS: Record<string, string[]> = {
  ARG: ['NE', 'NH1', 'NH2'], ASN: ['ND2'], GLN: ['NE2'], HIS: ['ND1', 'NE2'], LYS: ['NZ'], SER: ['OG'], THR: ['OG1'],
  TYR: ['OH'], TRP: ['NE1'],
  DA: ['N6'], A: ['N6', "O2'"], DG: ['N1', 'N2'], G: ['N1', 'N2', "O2'"], DC: ['N4'], C: ['N4', "O2'"], DT: ['N3'], U: ['N3', "O2'"],
};
const SIDE_ACCEPTORS: Record<string, string[]> = {
  ASP: ['OD1', 'OD2'], GLU: ['OE1', 'OE2'], ASN: ['OD1'], GLN: ['OE1'], HIS: ['ND1', 'NE2'], SER: ['OG'], THR: ['OG1'], TYR: ['OH'],
  DA: ['N1', 'N3', 'N7'], A: ['N1', 'N3', 'N7', "O2'"], DG: ['O6', 'N3', 'N7'], G: ['O6', 'N3', 'N7', "O2'"],
  DC: ['O2', 'N3'], C: ['O2', 'N3', "O2'"], DT: ['O2', 'O4'], U: ['O2', 'O4', "O2'"],
};
const NUCLEOTIDE_ACCEPTORS = ['OP1', 'OP2', 'O1P', 'O2P', "O3'", "O4'", "O5'"];
const NUCLEOTIDES = new Set(['DA', 'DC', 'DG', 'DT', 'DU', 'A', 'C', 'G', 'U']);
const PURINE = [['N1', 'C2', 'N3', 'C4', 'C5', 'C6'], ['C4', 'C5', 'N7', 'C8', 'N9']];
const PYRIMIDINE = [['N1', 'C2', 'N3', 'C4', 'C5', 'C6']];
const RINGS: Record<string, string[][]> = {
  PHE: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
  TYR: [['CG', 'CD1', 'CE1', 'CZ', 'CE2', 'CD2']],
  TRP: [['CD2', 'CE2', 'CZ2', 'CH2', 'CZ3', 'CE3'], ['CG', 'CD1', 'NE1', 'CE2', 'CD2']],
  HIS: [['CG', 'ND1', 'CE1', 'NE2', 'CD2']],
  DA: PURINE, A: PURINE, DG: PURINE, G: PURINE, DC: PYRIMIDINE, C: PYRIMIDINE, DT: PYRIMIDINE, U: PYRIMIDINE, DU: PYRIMIDINE,
};
const HYDROPHOBIC_ATOMS: Record<string, string[]> = {
  ALA: ['CB'], VAL: ['CB', 'CG1', 'CG2'], LEU: ['CB', 'CG', 'CD1', 'CD2'], ILE: ['CB', 'CG1', 'CG2', 'CD1'],
  MET: ['CB', 'CG', 'SD', 'CE'], MSE: ['CB', 'CG', 'SE', 'CE'], PHE: ['CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'],
  TYR: ['CB', 'CG', 'CD1', 'CD2', 'CE1', 'CE2'], TRP: ['CB', 'CG', 'CD2', 'CE3', 'CZ2', 'CZ3', 'CH2'], PRO: ['CB', 'CG'],
  LYS: ['CB', 'CG', 'CD'], ARG: ['CB', 'CG'], GLU: ['CB', 'CG'], GLN: ['CB', 'CG'], ASP: ['CB'], ASN: ['CB'], THR: ['CG2'],
  HIS: ['CB'], DT: ['C7', 'C5M'],
};
const PARENT: Record<string, string> = { MSE: 'MET', SEP: 'SER', TPO: 'THR', PTR: 'TYR', CSO: 'CYS', HYP: 'PRO', MLY: 'LYS', KCX: 'LYS' };

// --- Parsing ---

interface Atom {
  name: string;
  resn: string;
  chain: string;
  resi: number;
  icode: string;
  element: string;
  position: Vec3;
  het: boolean;
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const centroid = (points: Vec3[]): Vec3 => {
  const s = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]] as Vec3, [0, 0, 0] as Vec3);
  return [s[0] / points.length, s[1] / points.length, s[2] / points.length];
};
/** Angle at `vertex` between the directions to a and b, in degrees. */
const angleAt = (vertex: Vec3, a: Vec3, b: Vec3) => {
  const u = sub(a, vertex), v = sub(b, vertex);
  const c = dot(u, v) / ((Math.hypot(...u) * Math.hypot(...v)) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const keyOf = (a: { chain: string; resi: number; icode: string }) => `${a.chain}|${a.resi}|${a.icode}`;
const round = (v: number) => Math.round(v * 100) / 100;

/** Heavy atoms of the first model (first alternate location). */
const parseAtoms = (pdb: string): Atom[] => {
  const atoms: Atom[] = [];
  for (const line of pdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const altLoc = line[16];
    if (altLoc && altLoc !== ' ' && altLoc !== 'A') continue;
    const name = line.slice(12, 16).trim();
    let element = line.slice(76, 78).trim().toUpperCase();
    if (!element) element = (/^[A-Z]{2}$/.test(name) && METALS.has(name) ? name : name.replace(/[^A-Za-z]/g, '').charAt(0)).toUpperCase();
    if (element === 'H' || element === 'D') continue;
    const position: Vec3 = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    const resi = parseInt(line.slice(22, 26), 10);
    if (!Number.isFinite(resi) || position.some(v => !Number.isFinite(v))) continue;
    atoms.push({
      name, resn: line.slice(17, 20).trim(), chain: line[21] ?? ' ', resi, icode: (line[26] ?? ' ').trim(), element, position,
      het: line.startsWith('HETATM'),
    });
  }
  return atoms;
};

// --- Ligand chemistry from geometry ---

interface Charge { center: Vec3; atoms: number[] }
interface Ring { atoms: number[]; center: Vec3; normal: Vec3 }

interface LigandChemistry {
  atoms: Atom[];
  neighbours: number[][]; // Covalent neighbours (heavy, metals excluded)
  donors: Set<number>;
  acceptors: Set<number>;
  positive: Charge[];
  negative: Charge[];
  rings: Ring[]; // Aromatic
  hydrophobic: Set<number>;
  halogens: { atom: number; carbon: number }[];
  metals: number[];
}

/** Centre, unit normal (Newell's method over the ordered ring) and largest out-of-plane deviation. */
const ringGeometry = (points: Vec3[]) => {
  const center = centroid(points);
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(nx, ny, nz) || 1;
  const normal: Vec3 = [nx / length, ny / length, nz / length];
  const deviation = Math.max(...points.map(p => Math.abs(dot(sub(p, center), normal))));
  return { center, normal, deviation };
};

/** Rings of 5 and 6 atoms, each as an ordered cycle (shortest cycle through every bond). */
const smallRings = (neighbours: number[][]): number[][] => {
  const rings = new Map<string, number[]>();
  for (let u = 0; u < neighbours.length; u++) {
    for (const v of neighbours[u]) {
      if (v < u) continue;
      const previous = new Map<number, number>([[u, -1]]);
      let frontier = [u];
      for (let depth = 0; depth < 5 && !previous.has(v); depth++) {
        const next: number[] = [];
        for (const a of frontier) {
          for (const b of neighbours[a]) {
            if ((a === u && b === v) || previous.has(b)) continue;
            previous.set(b, a);
            next.push(b);
          }
        }
        frontier = next;
      }
      if (!previous.has(v)) continue;
      const cycle: number[] = [];
      for (let x = v; x !== -1; x = previous.get(x)!) cycle.push(x);
      if (cycle.length < 5 || cycle.length > 6) continue;
      const key = [...cycle].sort((a, b) => a - b).join(',');
      if (!rings.has(key)) rings.set(key, cycle);
    }
  }
  return [...rings.values()];
};

/** Distance of an atom from the plane through three others: ~0 for sp2 (planar), ~0.4 Å for sp3. */
const pyramidality = (atom: Vec3, around: Vec3[]) => {
  if (around.length !== 3) return 0;
  const [a, b, c] = around;
  const u = sub(b, a), v = sub(c, a);
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n) || 1;
  return Math.abs(dot(sub(atom, a), n)) / length;
};

/**
 * Donors, acceptors, charges, aromatic rings and hydrophobic atoms of a ligand, read from its bond
 * geometry: no bond orders or hydrogens are needed. Carboxylic acids, phosphates and basic amines are
 * taken in their charged form, as at pH 7.
 */
const ligandChemistry = (atoms: Atom[]): LigandChemistry => {
  const n = atoms.length;
  const neighbours: number[][] = atoms.map(() => []);
  const metals: number[] = [];
  atoms.forEach((a, i) => { if (METALS.has(a.element)) metals.push(i); });
  for (let i = 0; i < n; i++) {
    if (METALS.has(atoms[i].element)) continue;
    for (let j = i + 1; j < n; j++) {
      if (METALS.has(atoms[j].element)) continue;
      const d = distance(atoms[i].position, atoms[j].position);
      const limit = (COVALENT_RADIUS[atoms[i].element] ?? 0.8) + (COVALENT_RADIUS[atoms[j].element] ?? 0.8) + 0.45;
      if (d > 0.4 && d <= limit) {
        neighbours[i].push(j);
        neighbours[j].push(i);
      }
    }
  }
  const el = (i: number) => atoms[i].element;
  const bond = (i: number, j: number) => distance(atoms[i].position, atoms[j].position);

  // Aromatic rings: planar 5- and 6-rings of C/N/O/S whose bonds are clearly shorter than single bonds
  const rings: Ring[] = [];
  const aromaticAtoms = new Set<number>();
  const ringOf = new Map<number, number[]>(); // Atom -> sizes of the aromatic rings it is in
  for (const cycle of smallRings(neighbours)) {
    if (!cycle.every(i => ['C', 'N', 'O', 'S'].includes(el(i)) && neighbours[i].length <= 3)) continue;
    const ratios = cycle.map((i, k) => {
      const j = cycle[(k + 1) % cycle.length];
      const single = SINGLE_BOND[[el(i), el(j)].sort().join('')] ?? 1.5;
      return bond(i, j) / single;
    });
    const geometry = ringGeometry(cycle.map(i => atoms[i].position));
    if (geometry.deviation > 0.25 || ratios.reduce((s, r) => s + r, 0) / ratios.length > 0.965) continue;
    rings.push({ atoms: cycle, center: geometry.center, normal: geometry.normal });
    for (const i of cycle) {
      aromaticAtoms.add(i);
      ringOf.set(i, [...(ringOf.get(i) ?? []), cycle.length]);
    }
  }

  const terminalOxygens = (i: number) => neighbours[i].filter(k => el(k) === 'O' && neighbours[k].length === 1);
  const carbonylCarbon = (i: number) => el(i) === 'C' && terminalOxygens(i).some(o => bond(i, o) <= 1.3);
  const sp3Carbon = (i: number) =>
    el(i) === 'C' && !aromaticAtoms.has(i) && neighbours[i].every(k => bond(i, k) >= 1.43)
    && !(neighbours[i].length === 3 && pyramidality(atoms[i].position, neighbours[i].map(k => atoms[k].position)) < 0.15);

  const donors = new Set<number>();
  const acceptors = new Set<number>();
  const positive: Charge[] = [];
  const negative: Charge[] = [];
  const charged = new Set<number>(); // Atoms already in a charged group

  // Negative groups: carboxylates, phosphates, sulfates and sulfonates, tetrazoles
  for (let i = 0; i < n; i++) {
    const oxygens = terminalOxygens(i);
    if (el(i) === 'C' && neighbours[i].length === 3 && oxygens.length === 2) {
      negative.push({ center: centroid(oxygens.map(o => atoms[o].position)), atoms: [i, ...oxygens] });
      [i, ...oxygens].forEach(k => charged.add(k));
    } else if (el(i) === 'P' && oxygens.length >= 2) {
      negative.push({ center: atoms[i].position, atoms: [i, ...oxygens] });
      [i, ...oxygens].forEach(k => charged.add(k));
    } else if (el(i) === 'S' && neighbours[i].filter(k => el(k) === 'O').length >= 3) {
      negative.push({ center: atoms[i].position, atoms: [i, ...oxygens] });
      [i, ...oxygens].forEach(k => charged.add(k));
    }
  }
  for (const ring of rings) {
    if (ring.atoms.length === 5 && ring.atoms.filter(i => el(i) === 'N').length >= 4) negative.push({ center: ring.center, atoms: ring.atoms });
  }

  // Positive groups: amidines and guanidines, basic amines, quaternary ammonium, pyridinium
  for (let i = 0; i < n; i++) {
    if (el(i) !== 'C' || aromaticAtoms.has(i) || neighbours[i].length !== 3) continue;
    const nitrogens = neighbours[i].filter(k => el(k) === 'N' && !aromaticAtoms.has(k));
    if (nitrogens.length >= 2 && !neighbours[i].some(k => el(k) === 'O')
      && pyramidality(atoms[i].position, neighbours[i].map(k => atoms[k].position)) < 0.15
      && nitrogens.every(k => !neighbours[k].some(m => m !== i && carbonylCarbon(m)))) {
      positive.push({ center: atoms[i].position, atoms: [i, ...nitrogens] });
      [i, ...nitrogens].forEach(k => charged.add(k));
    }
  }

  for (let i = 0; i < n; i++) {
    const element = el(i);
    const around = neighbours[i];
    const degree = around.length;
    if (element === 'O') {
      if (degree === 1) {
        const x = around[0];
        if (el(x) === 'C' && !charged.has(i) && bond(i, x) > 1.3) {
          donors.add(i); // Hydroxyl
          acceptors.add(i);
        } else {
          acceptors.add(i); // Carbonyl, carboxylate, phosphate, sulfonyl, N-oxide
        }
      } else if (degree === 2 && !aromaticAtoms.has(i)) {
        acceptors.add(i); // Ether, ester
      } else if (degree === 0) {
        donors.add(i);
        acceptors.add(i);
      }
    } else if (element === 'N') {
      const sizes = ringOf.get(i) ?? [];
      const basic = around.length > 0 && around.every(k => sp3Carbon(k)) && around.every(k => bond(i, k) >= 1.42);
      if (degree === 1) {
        if (bond(i, around[0]) <= 1.2) acceptors.add(i); // Nitrile
        else {
          donors.add(i);
          if (basic && !charged.has(i)) positive.push({ center: atoms[i].position, atoms: [i] });
          else if (!charged.has(i) && bond(i, around[0]) >= 1.38) acceptors.add(i); // Neutral amine or aniline
        }
      } else if (degree === 2) {
        if (sizes.includes(6)) {
          // Pyridine-like N: acceptor. A lactam N-H (next to a ring carbonyl, both ring bonds long, as in
          // uracil N3 or a pyridone) donates instead
          const lactam = around.some(k => carbonylCarbon(k)) && around.every(k => bond(i, k) >= 1.355);
          if (lactam) donors.add(i);
          else acceptors.add(i);
        } else if (sizes.includes(5)) {
          donors.add(i); // Imidazole and pyrazole nitrogens: N-H or N:
          acceptors.add(i);
        } else if (Math.min(...around.map(k => bond(i, k))) <= 1.32 && !charged.has(i)) {
          acceptors.add(i); // Imine
        } else {
          donors.add(i); // Amide, sulfonamide, secondary amine
          if (basic && !charged.has(i)) positive.push({ center: atoms[i].position, atoms: [i] });
        }
      } else if (degree === 3) {
        const planar = pyramidality(atoms[i].position, around.map(k => atoms[k].position)) < 0.2;
        if (!planar) {
          acceptors.add(i);
          if (basic) {
            donors.add(i); // Protonated tertiary amine (N+-H)
            positive.push({ center: atoms[i].position, atoms: [i] });
          }
        } else if (sizes.includes(6) && !charged.has(i)) {
          // Pyridinium (as in NAD): the only nitrogen of a ring with no ring carbonyl
          const ring = rings.find(r => r.atoms.includes(i) && r.atoms.length === 6)!;
          if (ring.atoms.filter(k => el(k) === 'N').length === 1 && !ring.atoms.some(k => carbonylCarbon(k))) {
            positive.push({ center: atoms[i].position, atoms: [i] });
          }
        }
      } else if (degree === 4) {
        positive.push({ center: atoms[i].position, atoms: [i] }); // Quaternary ammonium
      }
      if (charged.has(i) && degree <= 2) donors.add(i); // Amidinium and guanidinium N-H
    }
  }

  // Thioether sulfur: a weak acceptor (biotin's sulfur takes a hydrogen bond from streptavidin's Thr90)
  for (let i = 0; i < n; i++) {
    if (el(i) === 'S' && neighbours[i].length === 2 && !aromaticAtoms.has(i) && neighbours[i].every(k => el(k) === 'C')) acceptors.add(i);
  }
  // Atoms bound to a metal of the ligand (heme's pyrrole nitrogens) neither donate nor accept
  for (const m of metals) {
    for (let i = 0; i < n; i++) {
      if (distance(atoms[i].position, atoms[m].position) <= METAL_BOND) {
        donors.delete(i);
        acceptors.delete(i);
      }
    }
  }

  const hydrophobic = new Set<number>();
  const halogens: { atom: number; carbon: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (el(i) === 'C' && neighbours[i].every(k => el(k) === 'C')) hydrophobic.add(i);
    if (['CL', 'BR', 'I'].includes(el(i))) {
      hydrophobic.add(i);
      const carbon = neighbours[i].find(k => el(k) === 'C');
      if (carbon !== undefined) halogens.push({ atom: i, carbon });
    }
  }
  return { atoms, neighbours, donors, acceptors, positive, negative, rings, hydrophobic, halogens, metals };
};

// --- Partner residues ---

interface Residue {
  key: string;
  chain: string;
  resi: number;
  icode: string;
  resn: string;
  atoms: Atom[];
  byName: Map<string, Atom>;
  water: boolean;
  ligand: boolean; // Another ligand or ion (metal coordination only)
}

interface ResidueCharge { center: Vec3; atom: string; atoms: Atom[] } // Charge centre (cation-π) and charged atoms (salt bridges)

interface ResidueChemistry {
  donors: Atom[];
  acceptors: Atom[];
  positive: ResidueCharge[];
  negative: ResidueCharge[];
  rings: Ring[];
  hydrophobic: Atom[];
}

const residueChemistry = (residue: Residue): ResidueChemistry => {
  const resn = PARENT[residue.resn] ?? residue.resn;
  const get = (names: string[]) => names.map(name => residue.byName.get(name)).filter((a): a is Atom => Boolean(a));
  const nucleotide = NUCLEOTIDES.has(resn);
  const donors = [...get(SIDE_DONORS[resn] ?? []), ...(!nucleotide && resn !== 'PRO' ? get(['N']) : [])];
  const acceptors = [...get(SIDE_ACCEPTORS[resn] ?? []), ...get(nucleotide ? NUCLEOTIDE_ACCEPTORS : ['O', 'OXT'])];
  const positive: ResidueCharge[] = [];
  const negative: ResidueCharge[] = [];
  const group = (list: ResidueCharge[], names: string[], atom: string, centerName?: string) => {
    const atoms = get(names);
    if (atoms.length === 0) return;
    const center = (centerName && residue.byName.get(centerName)?.position) || centroid(atoms.map(a => a.position));
    list.push({ center, atom, atoms });
  };
  if (resn === 'LYS') group(positive, ['NZ'], 'NZ');
  if (resn === 'ARG') group(positive, ['NE', 'NH1', 'NH2'], 'CZ', 'CZ');
  if (resn === 'HIS' && get(['CG', 'ND1', 'CE1', 'NE2', 'CD2']).length === 5) {
    positive.push({ center: centroid(get(['CG', 'ND1', 'CE1', 'NE2', 'CD2']).map(a => a.position)), atom: 'ring', atoms: get(['ND1', 'NE2']) });
  }
  if (resn === 'ASP') group(negative, ['OD1', 'OD2'], 'OD1/OD2');
  if (resn === 'GLU') group(negative, ['OE1', 'OE2'], 'OE1/OE2');
  if (!nucleotide && residue.byName.has('OXT')) group(negative, ['O', 'OXT'], 'OXT');
  if (nucleotide || ['SEP', 'TPO', 'PTR'].includes(residue.resn)) group(negative, ['OP1', 'OP2', 'O1P', 'O2P', 'O3P'], 'P', 'P');
  const rings: Ring[] = [];
  for (const names of RINGS[resn] ?? []) {
    const ring = get(names);
    if (ring.length !== names.length) continue;
    const geometry = ringGeometry(ring.map(a => a.position));
    rings.push({ atoms: [], center: geometry.center, normal: geometry.normal });
  }
  return { donors, acceptors, positive, negative, rings, hydrophobic: get(HYDROPHOBIC_ATOMS[resn] ?? []) };
};

/** Bonded neighbours of an atom within its residue (for the hydrogen-bond angle checks). */
const residueNeighbours = (residue: Residue, atom: Atom) =>
  residue.atoms.filter(a => a !== atom && distance(a.position, atom.position) <= 1.9).map(a => a.position);

// --- Finding the interactions ---

const projectionOffset = (point: Vec3, ring: { center: Vec3; normal: Vec3 }) => {
  const v = sub(point, ring.center);
  const along = dot(v, ring.normal);
  return Math.sqrt(Math.max(0, dot(v, v) - along * along));
};

const partnerOf = (residue: Residue, atom?: string): InteractionPartner => ({
  chain: residue.chain, resi: residue.resi, icode: residue.icode, resn: residue.resn, ...(atom ? { atom } : {}),
});

interface Groups {
  residues: Map<string, Residue>;
  ligands: Residue[]; // Candidate ligand groups, in file order
}

/** Groups atoms into residues; HETATM groups with a backbone (MSE...) count as polymer. */
const groupAtoms = (atoms: Atom[], skipChains: string[]): Groups => {
  const residues = new Map<string, Residue>();
  for (const atom of atoms) {
    if (skipChains.includes(atom.chain)) continue;
    const key = keyOf(atom);
    let residue = residues.get(key);
    if (!residue) {
      residue = { key, chain: atom.chain, resi: atom.resi, icode: atom.icode, resn: atom.resn, atoms: [], byName: new Map(), water: WATERS.has(atom.resn), ligand: false };
      residues.set(key, residue);
    }
    residue.atoms.push(atom);
    if (!residue.byName.has(atom.name)) residue.byName.set(atom.name, atom);
  }
  const ligands: Residue[] = [];
  for (const residue of residues.values()) {
    const het = residue.atoms.every(a => a.het);
    const backbone = ['N', 'CA', 'C'].every(name => residue.byName.has(name));
    if (residue.water || !het || backbone) continue;
    residue.ligand = true;
    if (!NOT_SHOWN.has(residue.resn)) ligands.push(residue);
  }
  return { residues, ligands };
};

const kindOf = (residue: Residue): LigandSite['kind'] =>
  residue.atoms.length === 1 && METALS.has(residue.atoms[0].element) ? 'metal'
  : !residue.atoms.some(a => a.element === 'C') ? 'ion'
  : 'organic';

/** The interactions of one ligand group with everything around it. */
const siteInteractions = (ligand: Residue, groups: Groups, near: (center: Vec3, radius: number) => Residue[]): Interaction[] => {
  const interactions: Interaction[] = [];
  const chemistry = ligandChemistry(ligand.atoms);
  const ligandPositions = ligand.atoms.map(a => a.position);
  const center = centroid(ligandPositions);
  const radius = Math.max(...ligandPositions.map(p => distance(p, center))) + NEIGHBOURHOOD;
  const around = near(center, radius).filter(r => r !== ligand);
  const polymer = around.filter(r => !r.water && !r.ligand);
  const waters = around.filter(r => r.water);
  const chemistryCache = new Map<Residue, ResidueChemistry>();
  const chem = (r: Residue) => {
    let c = chemistryCache.get(r);
    if (!c) { c = residueChemistry(r); chemistryCache.set(r, c); }
    return c;
  };
  const closeToLigand = (p: Vec3, cutoff: number) => ligandPositions.some(q => distance(p, q) <= cutoff);
  const add = (i: Interaction) => interactions.push({ ...i, distance: round(i.distance) });
  const ligandAtomNeighbours = (i: number) => chemistry.neighbours[i].map(k => chemistry.atoms[k].position);

  // Metal coordination: a lone ion and what binds it, a metal inside the ligand (heme iron), or a
  // separate ion the ligand binds (a zinc held by an inhibitor)
  const coordinating = (element: string) => element === 'N' || element === 'O' || element === 'S';
  for (const m of chemistry.metals) {
    const metal = chemistry.atoms[m];
    for (const residue of around) {
      for (const atom of residue.atoms) {
        const d = distance(atom.position, metal.position);
        if (coordinating(atom.element) && d <= METAL_MAX && d > 0.5) {
          add({ type: 'metal', partner: partnerOf(residue, atom.name), ligandAtom: metal.name, distance: d, from: metal.position, to: atom.position,
            ...(residue.water ? { detail: 'water' } : residue.ligand ? { detail: 'another ligand' } : {}) });
        }
      }
    }
  }
  for (const ion of around.filter(r => r.ligand && kindOf(r) === 'metal')) {
    const metal = ion.atoms[0];
    chemistry.atoms.forEach((atom, i) => {
      const d = distance(atom.position, metal.position);
      if (coordinating(atom.element) && d <= METAL_MAX && d > 0.5 && !chemistry.metals.includes(i)) {
        add({ type: 'metal', partner: partnerOf(ion, metal.name), ligandAtom: atom.name, distance: d, from: atom.position, to: metal.position, detail: 'the ligand binds this ion' });
      }
    });
  }
  if (kindOf(ligand) === 'metal') return order(interactions);

  // Atoms bound to a metal (a zinc's histidines, an inhibitor's chelating oxygens) don't hydrogen-bond
  const metalPositions = [
    ...chemistry.metals.map(m => chemistry.atoms[m].position),
    ...around.filter(r => r.ligand && kindOf(r) === 'metal').map(r => r.atoms[0].position),
  ];
  const metalBound = (p: Vec3) => metalPositions.some(m => distance(m, p) <= METAL_BOND);
  for (const i of [...chemistry.donors, ...chemistry.acceptors]) {
    if (metalBound(chemistry.atoms[i].position)) {
      chemistry.donors.delete(i);
      chemistry.acceptors.delete(i);
    }
  }

  // Hydrogen bonds (both directions), salt bridges, halogen bonds and hydrophobic contacts with each residue
  const hydrophobicBest = new Map<string, Interaction>();
  const stackedPairs: { ligandRing: Ring; residue: Residue }[] = [];
  for (const residue of polymer) {
    const c = chem(residue);
    for (const donor of c.donors) {
      if (metalBound(donor.position)) continue;
      for (const i of chemistry.acceptors) {
        const atom = chemistry.atoms[i];
        const d = distance(donor.position, atom.position);
        if (d < HBOND_MIN || d > HBOND_MAX) continue;
        const okDonor = residueNeighbours(residue, donor).every(nb => angleAt(donor.position, nb, atom.position) >= HBOND_ANGLE_MIN);
        const okAcceptor = ligandAtomNeighbours(i).every(nb => angleAt(atom.position, nb, donor.position) >= HBOND_ANGLE_MIN);
        if (okDonor && okAcceptor) add({ type: 'hbond', partner: partnerOf(residue, donor.name), ligandAtom: atom.name, distance: d, from: atom.position, to: donor.position, detail: 'protein donates' });
      }
    }
    for (const acceptor of c.acceptors) {
      if (metalBound(acceptor.position)) continue;
      for (const i of chemistry.donors) {
        const atom = chemistry.atoms[i];
        const d = distance(acceptor.position, atom.position);
        if (d < HBOND_MIN || d > HBOND_MAX) continue;
        // A pair already counted the other way round (hydroxyls, histidines are both) stays one bond
        if (interactions.some(x => x.type === 'hbond' && x.ligandAtom === atom.name && x.partner.atom === acceptor.name && keyOf(x.partner) === residue.key)) continue;
        const okDonor = ligandAtomNeighbours(i).every(nb => angleAt(atom.position, nb, acceptor.position) >= HBOND_ANGLE_MIN);
        const okAcceptor = residueNeighbours(residue, acceptor).every(nb => angleAt(acceptor.position, nb, atom.position) >= HBOND_ANGLE_MIN);
        if (okDonor && okAcceptor) add({ type: 'hbond', partner: partnerOf(residue, acceptor.name), ligandAtom: atom.name, distance: d, from: atom.position, to: acceptor.position, detail: 'ligand donates' });
      }
    }
    // Salt bridges: oppositely charged N and O atoms within 4 Å, drawn between the closest pair
    for (const [ligandCharges, residueCharges, detail] of [
      [chemistry.positive, c.negative, 'cation on the ligand'],
      [chemistry.negative, c.positive, 'anion on the ligand'],
    ] as const) {
      let best: Interaction | null = null;
      for (const lc of ligandCharges) {
        for (const i of lc.atoms) {
          const atom = chemistry.atoms[i];
          if (atom.element !== 'N' && atom.element !== 'O') continue;
          for (const rc of residueCharges) {
            for (const ra of rc.atoms) {
              const d = distance(atom.position, ra.position);
              if (d <= SALT_BRIDGE_MAX && (!best || d < best.distance)) {
                best = { type: 'salt_bridge', partner: partnerOf(residue, ra.name), ligandAtom: atom.name, distance: d, from: atom.position, to: ra.position, detail };
              }
            }
          }
        }
      }
      if (best) add(best);
    }
    for (const { atom: x, carbon } of chemistry.halogens) {
      const halogen = chemistry.atoms[x];
      for (const acceptor of [...c.acceptors, ...residue.atoms.filter(a => a.element === 'S')]) {
        const d = distance(halogen.position, acceptor.position);
        if (d > HALOGEN_MAX || d < 2.5) continue;
        const donorAngle = angleAt(halogen.position, chemistry.atoms[carbon].position, acceptor.position);
        const acceptorAngles = residueNeighbours(residue, acceptor).map(nb => angleAt(acceptor.position, halogen.position, nb));
        if (Math.abs(donorAngle - HALOGEN_DONOR_ANGLE) <= HALOGEN_ANGLE_DEV
          && acceptorAngles.length > 0 && acceptorAngles.every(a => Math.abs(a - HALOGEN_ACCEPTOR_ANGLE) <= HALOGEN_ANGLE_DEV)) {
          add({ type: 'halogen', partner: partnerOf(residue, acceptor.name), ligandAtom: halogen.name, distance: d, from: halogen.position, to: acceptor.position });
        }
      }
    }
    // π-stacking (parallel or T-shaped) and cation-π, from ring and charge centres
    for (const ligandRing of chemistry.rings) {
      for (const ring of c.rings) {
        const d = distance(ligandRing.center, ring.center);
        if (d > PI_STACK_MAX) continue;
        const angle = (Math.acos(Math.min(1, Math.abs(dot(ligandRing.normal, ring.normal)))) * 180) / Math.PI;
        const offset = Math.min(projectionOffset(ligandRing.center, ring), projectionOffset(ring.center, ligandRing));
        const kind = angle <= PI_ANGLE_DEV ? 'parallel' : angle >= 90 - PI_ANGLE_DEV ? 'T-shaped' : null;
        if (kind && offset <= PI_OFFSET_MAX) {
          add({ type: 'pi_stacking', partner: partnerOf(residue, 'ring'), distance: d, from: ligandRing.center, to: ring.center, detail: kind });
          stackedPairs.push({ ligandRing, residue });
        }
      }
      for (const charge of c.positive) {
        const d = distance(ligandRing.center, charge.center);
        if (d <= PI_CATION_MAX && projectionOffset(charge.center, ligandRing) <= PI_OFFSET_MAX && residue.resn !== 'HIS') {
          add({ type: 'pi_cation', partner: partnerOf(residue, charge.atom), distance: d, from: ligandRing.center, to: charge.center, detail: 'ring on the ligand' });
        }
      }
    }
    for (const ring of c.rings) {
      for (const charge of chemistry.positive) {
        const d = distance(ring.center, charge.center);
        if (d <= PI_CATION_MAX && projectionOffset(charge.center, ring) <= PI_OFFSET_MAX) {
          add({ type: 'pi_cation', partner: partnerOf(residue, 'ring'), distance: d, from: charge.center, to: ring.center, detail: 'cation on the ligand' });
        }
      }
    }
    // Hydrophobic contacts: the closest per residue, leaving out atoms of rings already stacked
    for (const atom of c.hydrophobic) {
      for (const i of chemistry.hydrophobic) {
        const d = distance(atom.position, chemistry.atoms[i].position);
        if (d > HYDROPHOBIC_MAX) continue;
        const known = hydrophobicBest.get(residue.key);
        if (!known || d < known.distance) {
          hydrophobicBest.set(residue.key, { type: 'hydrophobic', partner: partnerOf(residue, atom.name), ligandAtom: chemistry.atoms[i].name, distance: d, from: chemistry.atoms[i].position, to: atom.position });
        }
      }
    }
  }
  for (const [key, contact] of hydrophobicBest) {
    const stacked = stackedPairs.some(s => s.residue.key === key);
    if (!stacked) add(contact);
  }

  // Water bridges: a crystal water within hydrogen-bond reach of a ligand polar atom and a residue polar atom
  const ligandPolar = [...new Set([...chemistry.donors, ...chemistry.acceptors])].map(i => chemistry.atoms[i]);
  const bridged = new Map<string, Interaction>();
  for (const water of waters) {
    const oxygen = water.atoms.find(a => a.element === 'O') ?? water.atoms[0];
    const ligandLeg = ligandPolar
      .map(a => ({ a, d: distance(a.position, oxygen.position) }))
      .filter(x => x.d >= WATER_MIN && x.d <= WATER_MAX)
      .sort((x, y) => x.d - y.d)[0];
    if (!ligandLeg || closeToLigand(oxygen.position, WATER_MIN - 0.01)) continue;
    for (const residue of polymer) {
      const c = chem(residue);
      const polar = [...new Set([...c.donors, ...c.acceptors])];
      const leg = polar
        .map(a => ({ a, d: distance(a.position, oxygen.position) }))
        .filter(x => x.d >= WATER_MIN && x.d <= WATER_MAX)
        .sort((x, y) => x.d - y.d)[0];
      if (!leg) continue;
      if (distance(leg.a.position, ligandLeg.a.position) <= HBOND_MAX) continue; // A direct contact, not a bridge
      const worst = Math.max(leg.d, ligandLeg.d);
      const known = bridged.get(residue.key);
      if (!known || worst < known.distance) {
        bridged.set(residue.key, {
          type: 'water_bridge', partner: partnerOf(residue, leg.a.name), ligandAtom: ligandLeg.a.name, distance: worst,
          from: ligandLeg.a.position, to: leg.a.position, via: { chain: water.chain, resi: water.resi, position: oxygen.position },
        });
      }
    }
  }
  for (const bridge of bridged.values()) {
    const direct = interactions.some(x => x.type === 'hbond' && keyOf(x.partner) === keyOf(bridge.partner));
    if (!direct) add(bridge);
  }
  return order(interactions);
};

const order = (interactions: Interaction[]) =>
  interactions
    .filter(i => i.distance > 0.5 && (i.type === 'metal' || i.distance >= COVALENT_MIN || i.type === 'salt_bridge'))
    .sort((a, b) => INTERACTION_ORDER.indexOf(a.type) - INTERACTION_ORDER.indexOf(b.type) || a.distance - b.distance);

// --- Public API ---

const cache = new Map<string, LigandSite[]>();
const MAX_CACHED = 6;

/**
 * Every ligand in a structure (additives, waters and lone buffer ions left out) with its interactions.
 * `skipChains` leaves chains out entirely (a co-folded complex's added crystal pose). Drug-like
 * molecules come first, then smaller ligands, ions and metals.
 */
export const analyzeInteractions = (pdb: string, skipChains: string[] = []): LigandSite[] => {
  let hash = 2166136261;
  for (let i = 0; i < pdb.length; i++) hash = Math.imul(hash ^ pdb.charCodeAt(i), 16777619);
  const cacheKey = `${skipChains.join(',')}#${pdb.length}#${hash >>> 0}`;
  const known = cache.get(cacheKey);
  if (known) return known;

  const groups = groupAtoms(parseAtoms(pdb), skipChains);
  const residues = [...groups.residues.values()];
  const centres = residues.map(r => ({ residue: r, center: centroid(r.atoms.map(a => a.position)), reach: 0 }));
  for (const c of centres) c.reach = Math.max(...c.residue.atoms.map(a => distance(a.position, c.center)));
  const near = (center: Vec3, radius: number) => centres.filter(c => distance(c.center, center) <= radius + c.reach).map(c => c.residue);

  const sites: LigandSite[] = groups.ligands.map(ligand => ({
    key: ligand.key,
    code: ligand.resn,
    name: LIGAND_NAMES[ligand.resn] ?? ligand.resn,
    chain: ligand.chain,
    resi: ligand.resi,
    icode: ligand.icode,
    heavyAtoms: ligand.atoms.length,
    kind: kindOf(ligand),
    interactions: siteInteractions(ligand, groups, near),
  }));
  const rank = (s: LigandSite) => (s.kind === 'organic' ? (s.heavyAtoms >= 6 ? 0 : 1) : s.kind === 'metal' ? 2 : 3);
  sites.sort((a, b) => rank(a) - rank(b) || b.heavyAtoms - a.heavyAtoms);
  cache.set(cacheKey, sites);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return sites;
};

/** Ligand groups present (cheap): whether the Interactions tool has anything to show. */
export const hasLigands = (pdb: string, skipChains: string[] = []) =>
  groupAtoms(parseAtoms(pdb), skipChains).ligands.length > 0;

const THREE: Record<string, string> = {
  ALA: 'Ala', ARG: 'Arg', ASN: 'Asn', ASP: 'Asp', CYS: 'Cys', GLN: 'Gln', GLU: 'Glu', GLY: 'Gly', HIS: 'His', ILE: 'Ile',
  LEU: 'Leu', LYS: 'Lys', MET: 'Met', PHE: 'Phe', PRO: 'Pro', SER: 'Ser', THR: 'Thr', TRP: 'Trp', TYR: 'Tyr', VAL: 'Val', MSE: 'Mse',
};

/** "Asp189", "Asp25 (B)", "ZN", "DG5": a partner as people write it. */
export const partnerLabel = (p: InteractionPartner, withChain = false) =>
  `${THREE[p.resn] ?? p.resn}${p.resi}${p.icode}${withChain ? ` (${p.chain})` : ''}`;

/** Residues per interaction type, in order, each once (closest first). */
export const interactionSummary = (site: LigandSite): { type: InteractionType; partners: InteractionPartner[] }[] => {
  const byType = new Map<InteractionType, InteractionPartner[]>();
  for (const i of site.interactions) {
    const list = byType.get(i.type) ?? [];
    if (!list.some(p => keyOf(p) === keyOf(i.partner))) list.push(i.partner);
    byType.set(i.type, list);
  }
  return INTERACTION_ORDER.filter(t => byType.has(t)).map(type => ({ type, partners: byType.get(type)! }));
};

/** Residues with a specific (non-hydrophobic) interaction, as "type|chain|resi|icode": for comparing two poses. */
export const specificContacts = (site: LigandSite) =>
  new Set(site.interactions.filter(i => i.type !== 'hydrophobic' && i.type !== 'water_bridge').map(i => `${i.type}|${keyOf(i.partner)}`));

/**
 * One facts line about the ligands of a structure for the chat: the main ligands' hydrogen bonds,
 * salt bridges, stacking, metal coordination and hydrophobic contacts, with this file's numbering.
 */
export const interactionFactsLine = (pdb: string, options: { skipChains?: string[]; names?: Record<string, string>; maxChars?: number } = {}): string | null => {
  const maxChars = options.maxChars ?? 520;
  const sites = analyzeInteractions(pdb, options.skipChains ?? []).filter(s => s.interactions.length > 0);
  const chosen: LigandSite[] = [];
  for (const site of sites) {
    if (chosen.length >= 3) break;
    if (site.kind === 'organic' && !chosen.some(c => c.code === site.code)) chosen.push(site);
  }
  const metal = sites.find(s => s.kind === 'metal');
  if (metal && chosen.length < 3) chosen.push(metal);
  if (chosen.length === 0) return null;
  const limits: Partial<Record<InteractionType, number>> = { hbond: 6, hydrophobic: 5, water_bridge: 3 };
  let line = 'Ligand interactions computed from this file (PLIP geometric criteria, hydrogens inferred):';
  for (const site of chosen) {
    const name = options.names?.[site.key] ?? (site.name !== site.code ? `${site.name} (${site.code})` : site.code);
    let entry = ` ${name} ${site.chain}:${site.resi}${site.icode} —`;
    const parts = interactionSummary(site).map(({ type, partners }) => {
      const residues = partners.filter(p => !WATERS.has(p.resn));
      const waters = partners.length - residues.length;
      const shown = residues.slice(0, limits[type] ?? 4).map(p => `${p.chain}:${partnerLabel(p)}`);
      return `${INTERACTION_LABELS[type].many.toLowerCase()} ${shown.join(' ')}${residues.length > shown.length ? ' …' : ''}${waters ? ` + ${waters} water${waters > 1 ? 's' : ''}` : ''}`;
    });
    entry += ` ${parts.join('; ')};`;
    if (line.length + entry.length > maxChars) {
      if (chosen.indexOf(site) === 0) line += entry.slice(0, maxChars - line.length);
      break;
    }
    line += entry;
  }
  return line.replace(/;$/, '');
};
