// --- THE STRUCTURE ON SCREEN, AS DATA ---
// One parse of the loaded PDB text into the model the workspace works from: chains with their
// residues in file order, the ligands and ions beside them, and the lookups selection needs.
// The sequence strip, the selection model, the layers list and the focus panel all read this, so a
// residue means the same thing everywhere: author chain + author number + insertion code.

export type ChainKind = 'protein' | 'nucleic' | 'other';

export type Vec3 = [number, number, number];

export interface ModelResidue {
  chain: string; // Author chain ID (matches 3Dmol atom.chain)
  resi: number; // Author residue number
  icode: string; // Insertion code, '' when none
  resn: string; // Three-letter name as written in the file
  code: string; // One letter for polymers ('X' when unknown), '' for everything else
  index: number; // Position within its chain, 0-based (the sequence strip's x axis)
  atoms: number;
  bfactor: number; // Mean B-factor: pLDDT in predicted models
  het: boolean;
  center: Vec3; // Mean of its heavy atoms: what the camera flies to
  positions: Vec3[]; // Heavy atoms, for "what is near this residue"
}

export interface ModelChain {
  chain: string;
  kind: ChainKind;
  residues: ModelResidue[];
  sequence: string; // One letter per residue, in file order
  name?: string; // From COMPND, when the file says
  gaps: number[]; // Indices where the residue number jumps (unmodelled stretches)
}

export interface ModelLigand {
  key: string;
  chain: string;
  resi: number;
  icode: string;
  resn: string;
  atoms: number;
  kind: 'ligand' | 'ion' | 'water';
}

export interface StructureModel {
  chains: ModelChain[]; // Polymers, longest first within file order
  ligands: ModelLigand[]; // Everything else worth naming (waters counted, not listed individually)
  ligandResidues: ModelResidue[]; // The same groups as residues, so they can be picked and measured
  waters: number;
  residueCount: number;
  atomCount: number;
  byKey: Map<string, ModelResidue>; // `${chain}|${resi}|${icode}`, polymer residues and ligands alike
}

export const ONE_LETTER: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  // Modified residues keep their parent letter, as the PDB's SEQRES would
  MSE: 'M', SEP: 'S', TPO: 'T', PTR: 'Y', CSO: 'C', CSD: 'C', CME: 'C', OCS: 'C', CAS: 'C', KCX: 'K',
  LLP: 'K', MLY: 'K', M3L: 'K', ALY: 'K', HYP: 'P', HIC: 'H', NEP: 'H', CGU: 'E', PCA: 'E', SEC: 'U', PYL: 'O',
  DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U', A: 'A', C: 'C', G: 'G', U: 'U', I: 'I',
};
const NUCLEIC = new Set(['DA', 'DC', 'DG', 'DT', 'DU', 'A', 'C', 'G', 'U', 'I']);
export const WATERS = new Set(['HOH', 'DOD', 'WAT', 'H2O']);
const IONS = new Set([
  'ZN', 'MG', 'CA', 'MN', 'FE', 'FE2', 'CU', 'CU1', 'CO', 'NI', 'MO', 'NA', 'K', 'CL', 'BR', 'IOD', 'CD', 'HG',
  'CS', 'RB', 'SR', 'BA', 'LI', 'AL', 'F', 'PT', 'AU', 'AG', 'PB', 'TL', 'W', 'V', 'CR', 'GD', 'EU', 'TB', 'YB',
]);

export const residueKey = (r: { chain: string; resi: number; icode: string }) => `${r.chain}|${r.resi}|${r.icode}`;

/** "ASP" + 25 -> "Asp25"; a ligand keeps its code ("MK1 902"). */
export const residueLabel = (r: ModelResidue) => {
  const name = r.code ? r.resn.charAt(0) + r.resn.slice(1).toLowerCase() : r.resn;
  return `${name}${r.code ? '' : ' '}${r.resi}${r.icode}`;
};

/** "HIV-1 PROTEASE" -> "HIV-1 protease": words with digits, and short ones (DNA, ABL), keep their capitals. */
export const readableName = (text: string) => {
  const words = text.trim().split(/\s+/).map(w => (/\d/.test(w) || w.replace(/[^A-Za-z]/g, '').length <= 3 ? w : w.toLowerCase()));
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
};

const chainNamesFrom = (pdb: string): Map<string, string> => {
  const text = pdb.split('\n').filter(l => l.startsWith('COMPND')).map(l => l.slice(10, 80).trimEnd()).join(' ');
  const names = new Map<string, string>();
  for (const block of text.split(/MOL_ID:/).slice(1)) {
    const molecule = /MOLECULE:\s*([^;]+);?/.exec(block)?.[1]?.trim();
    const chains = /CHAIN:\s*([^;]+);?/.exec(block)?.[1];
    if (!molecule || !chains) continue;
    for (const chain of chains.split(',').map(c => c.trim()).filter(Boolean)) names.set(chain, readableName(molecule));
  }
  return names;
};

/**
 * Parse the first model of a PDB file. Heavy atoms only, first alternate location; HETATM groups with
 * a backbone (MSE and friends) stay part of their chain, everything else becomes a ligand, ion or water.
 */
export const parseStructure = (pdb: string): StructureModel => {
  const names = chainNamesFrom(pdb);
  const order: string[] = [];
  const residues = new Map<string, ModelResidue & { backbone: Set<string>; bSum: number }>();
  let atomCount = 0;

  for (const line of pdb.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    const isAtom = line.startsWith('ATOM');
    if (!isAtom && !line.startsWith('HETATM')) continue;
    const altLoc = line[16];
    if (altLoc && altLoc !== ' ' && altLoc !== 'A') continue;
    const name = line.slice(12, 16).trim();
    const element = (line.slice(76, 78).trim() || name.replace(/[^A-Za-z]/g, '').charAt(0)).toUpperCase();
    if (element === 'H' || element === 'D') continue;
    const resi = parseInt(line.slice(22, 26), 10);
    if (!Number.isFinite(resi)) continue;
    const chain = (line[21] ?? ' ').trim() || ' ';
    const icode = (line[26] ?? ' ').trim();
    const resn = line.slice(17, 20).trim();
    const key = `${chain}|${resi}|${icode}`;
    atomCount++;
    let residue = residues.get(key);
    if (!residue) {
      residue = { chain, resi, icode, resn, code: '', index: 0, atoms: 0, bfactor: 0, het: !isAtom, center: [0, 0, 0], positions: [], backbone: new Set(), bSum: 0 };
      residues.set(key, residue);
      order.push(key);
    }
    residue.atoms++;
    const position: Vec3 = [parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))];
    if (position.every(Number.isFinite)) residue.positions.push(position);
    const b = parseFloat(line.slice(60, 66));
    if (Number.isFinite(b)) residue.bSum += b;
    if (['N', 'CA', 'C'].includes(name) || ["P", "O5'", "C3'"].includes(name)) residue.backbone.add(name);
    if (isAtom) residue.het = false;
  }

  const chains = new Map<string, ModelChain>();
  const ligands: ModelLigand[] = [];
  const ligandResidues: ModelResidue[] = [];
  let waters = 0;
  for (const key of order) {
    const r = residues.get(key)!;
    r.bfactor = r.atoms > 0 ? r.bSum / r.atoms : 0;
    if (r.positions.length > 0) {
      const sum = r.positions.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as Vec3, [0, 0, 0] as Vec3);
      r.center = [sum[0] / r.positions.length, sum[1] / r.positions.length, sum[2] / r.positions.length];
    }
    const polymer = ['N', 'CA', 'C'].every(n => r.backbone.has(n)) || ["P", "O5'", "C3'"].some(n => r.backbone.has(n));
    if (WATERS.has(r.resn)) {
      waters++;
      continue;
    }
    if (!polymer) {
      ligands.push({ key, chain: r.chain, resi: r.resi, icode: r.icode, resn: r.resn, atoms: r.atoms, kind: IONS.has(r.resn) ? 'ion' : 'ligand' });
      ligandResidues.push(r);
      continue;
    }
    let chain = chains.get(r.chain);
    if (!chain) {
      chain = { chain: r.chain, kind: 'other', residues: [], sequence: '', gaps: [], ...(names.get(r.chain) ? { name: names.get(r.chain) } : {}) };
      chains.set(r.chain, chain);
    }
    r.code = ONE_LETTER[r.resn] ?? 'X';
    r.index = chain.residues.length;
    chain.residues.push(r);
  }

  const byKey = new Map<string, ModelResidue>();
  for (const chain of chains.values()) {
    chain.sequence = chain.residues.map(r => r.code).join('');
    chain.kind = chain.residues.filter(r => NUCLEIC.has(r.resn)).length > chain.residues.length / 2 ? 'nucleic' : 'protein';
    // A jump in residue number means residues the experiment never saw
    chain.gaps = chain.residues.flatMap((r, i) => (i > 0 && r.resi > chain!.residues[i - 1].resi + 1 ? [i] : []));
    for (const r of chain.residues) byKey.set(residueKey(r), r);
  }

  for (const r of ligandResidues) byKey.set(residueKey(r), r);
  // The parse used two scratch fields per residue; the model that leaves here is the declared shape
  for (const r of residues.values()) {
    delete (r as Partial<{ backbone: unknown; bSum: unknown }>).backbone;
    delete (r as Partial<{ backbone: unknown; bSum: unknown }>).bSum;
  }

  return {
    chains: [...chains.values()],
    ligands,
    ligandResidues,
    waters,
    residueCount: [...chains.values()].reduce((n, c) => n + c.residues.length, 0),
    atomCount,
    byKey,
  };
};

// --- WHAT IS NEAR WHAT ---
// The focus panel answers "what surrounds this residue" (within 5 Å). A grid over the residues keeps
// it instant on every click.

const NEIGHBOUR_CELL = 8; // Å

const grids = new WeakMap<StructureModel, Map<string, ModelResidue[]>>();

const gridOf = (model: StructureModel) => {
  let grid = grids.get(model);
  if (grid) return grid;
  grid = new Map<string, ModelResidue[]>();
  const all = [...model.chains.flatMap(c => c.residues), ...model.ligandResidues];
  for (const r of all) {
    for (const p of r.positions) {
      const cell = `${Math.floor(p[0] / NEIGHBOUR_CELL)},${Math.floor(p[1] / NEIGHBOUR_CELL)},${Math.floor(p[2] / NEIGHBOUR_CELL)}`;
      const list = grid.get(cell);
      if (list) {
        if (list[list.length - 1] !== r) list.push(r);
      } else grid.set(cell, [r]);
    }
  }
  grids.set(model, grid);
  return grid;
};

export interface Neighbour {
  residue: ModelResidue;
  distance: number; // Closest heavy-atom approach, Å
}

/**
 * Residues with a heavy atom within `radius` of this one, closest first (the residue itself excluded).
 * `skipAdjacent` also drops the residues before and after it in the chain: they are bonded to it, so
 * they are always within 1.5 Å and say nothing about what the residue sits against.
 */
export const neighboursOf = (model: StructureModel, key: string, radius = 5, skipAdjacent = false): Neighbour[] => {
  const target = model.byKey.get(key);
  if (!target) return [];
  const grid = gridOf(model);
  const near = new Map<string, number>();
  const seen = new Set<ModelResidue>();
  for (const p of target.positions) {
    const [cx, cy, cz] = [Math.floor(p[0] / NEIGHBOUR_CELL), Math.floor(p[1] / NEIGHBOUR_CELL), Math.floor(p[2] / NEIGHBOUR_CELL)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const r of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (r === target) continue;
        seen.add(r);
      }
    }
  }
  for (const r of seen) {
    let best = Infinity;
    for (const a of target.positions) {
      for (const b of r.positions) {
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d < best) best = d;
      }
    }
    if (best <= radius) near.set(residueKey(r), best);
  }
  return [...near]
    .map(([k, distance]) => ({ residue: model.byKey.get(k)!, distance: Math.round(distance * 100) / 100 }))
    .filter(n => n.residue && !(skipAdjacent && n.residue.chain === target.chain && Math.abs(n.residue.index - target.index) === 1 && !n.residue.het))
    .sort((a, b) => a.distance - b.distance);
};

/** The centre of a set of residues: where the camera should look. */
export const centerOf = (model: StructureModel, keys: Iterable<string>): Vec3 | null => {
  let n = 0;
  const sum: Vec3 = [0, 0, 0];
  for (const key of keys) {
    const r = model.byKey.get(key);
    if (!r) continue;
    sum[0] += r.center[0];
    sum[1] += r.center[1];
    sum[2] += r.center[2];
    n++;
  }
  return n > 0 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
};

// --- SELECTION ---
// A selection is a set of residue keys. It is the one thing the sequence strip, the 3D canvas, the
// focus panel and the tools all agree on, so every part can show and change the same thing.

export interface Selection {
  keys: Set<string>;
  focus: string | null; // The residue the inspector describes: the last one picked
}

export const emptySelection = (): Selection => ({ keys: new Set(), focus: null });

export const isSelected = (selection: Selection, key: string) => selection.keys.has(key);

/** Apply a click to a selection: plain replaces, ⌘/Ctrl toggles, Shift extends along the chain. */
export const applyPick = (
  selection: Selection,
  model: StructureModel,
  key: string,
  modifiers: { toggle?: boolean; range?: boolean } = {},
): Selection => {
  const keys = new Set(selection.keys);
  if (modifiers.range && selection.focus) {
    const from = model.byKey.get(selection.focus);
    const to = model.byKey.get(key);
    if (from && to && from.chain === to.chain) {
      const chain = model.chains.find(c => c.chain === from.chain);
      if (chain) {
        const [a, b] = [from.index, to.index].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) keys.add(residueKey(chain.residues[i]));
        return { keys, focus: key };
      }
    }
  }
  if (modifiers.toggle) {
    if (keys.has(key)) {
      keys.delete(key);
      return { keys, focus: selection.focus === key ? null : selection.focus };
    }
    keys.add(key);
    return { keys, focus: key };
  }
  // A plain click on the only selected residue clears it, so clicking twice undoes
  if (keys.size === 1 && keys.has(key)) return emptySelection();
  return { keys: new Set([key]), focus: key };
};

/** Every residue of a chain, for the chain button on the sequence strip. */
export const selectChain = (model: StructureModel, chain: string): Selection => {
  const found = model.chains.find(c => c.chain === chain);
  if (!found) return emptySelection();
  return { keys: new Set(found.residues.map(residueKey)), focus: found.residues[0] ? residueKey(found.residues[0]) : null };
};

/** A 3Dmol selection spec matching exactly these residues (insertion codes included). */
export const toAtomSpec = (keys: Set<string>) => ({
  predicate: (atom: { chain?: string; resi?: number; icode?: string }) =>
    keys.has(`${atom.chain}|${atom.resi}|${(atom.icode ?? '').trim()}`),
});

/** "A:24-28, 50 · B:25" — a selection as people write it, for the status bar and the chat. */
export const describeSelection = (selection: Selection, model: StructureModel, maxChars = 90): string => {
  const byChain = new Map<string, number[]>();
  for (const key of selection.keys) {
    const r = model.byKey.get(key);
    if (!r) continue;
    byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r.resi]);
  }
  const parts: string[] = [];
  for (const [chain, list] of [...byChain].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...new Set(list)].sort((a, b) => a - b);
    const ranges: string[] = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      ranges.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
      i = j + 1;
    }
    parts.push(`${chain}:${ranges.join(', ')}`);
  }
  const text = parts.join(' · ');
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
};

/**
 * The selection as the chat sends it to the AI with a question, so "what is this residue?" is about it:
 * each residue by name when there are a few ("A:Cys7, B:His10"), ranges and a count when there are
 * many ("A:1-21 · B:1-30 (51 residues)"). Null when nothing is selected.
 */
export const selectionForAi = (selection: Selection, model: StructureModel, maxNamed = 12): string | null => {
  const residues = [...selection.keys].map(key => model.byKey.get(key)).filter((r): r is ModelResidue => Boolean(r));
  if (residues.length === 0) return null;
  if (residues.length > maxNamed) return `${describeSelection(selection, model, 240)} (${residues.length} residues)`;
  return residues
    .sort((a, b) => a.chain.localeCompare(b.chain) || a.resi - b.resi || a.icode.localeCompare(b.icode))
    .map(r => `${r.chain}:${residueLabel(r)}`)
    .join(', ');
};
