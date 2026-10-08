import type { Vec3 } from './superpose';

// --- mmCIF ATOM RECORDS ---
// AlphaFill serves its models as mmCIF, and Boltz-2 returns its predictions as mmCIF only.
// Both write one atom per line, so the _atom_site loop is read line by line.

export interface CifAtom {
  het: boolean;
  name: string; // label_atom_id
  element: string; // type_symbol
  compound: string; // label_comp_id
  asym: string; // label_asym_id
  authAsym: string; // auth_asym_id (label_asym_id when absent)
  resi: number; // auth_seq_id (label_seq_id when absent)
  icode: string; // pdbx_PDB_ins_code, '' when none
  altId: string; // label_alt_id, '' when none
  bfactor: number; // B_iso_or_equiv: pLDDT in predicted models; NaN when absent
  model: number; // pdbx_PDB_model_num, 1 when absent
  position: Vec3;
}

/** One mmCIF data row: whitespace-separated, with quoted values ("C1'") kept whole. */
export const cifTokens = (line: string): string[] => {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
    if (i >= line.length) break;
    const quote = line[i];
    if (quote === "'" || quote === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === quote && (j + 1 === line.length || line[j + 1] === ' ' || line[j + 1] === '\t'))) j++;
      out.push(line.slice(i + 1, j));
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && line[j] !== ' ' && line[j] !== '\t') j++;
      out.push(line.slice(i, j));
      i = j;
    }
  }
  return out;
};

// '?' (unknown) and '.' (not applicable) are mmCIF's empty values
const value = (raw: string | undefined) => (raw === undefined || raw === '?' || raw === '.' ? '' : raw);

// A loop_ whose items start with `prefix`: where its header and data rows sit in `lines`. Data rows
// run up to the next item, loop, data block or '#'.
interface Loop { loopLine: number; headers: string[]; first: number; end: number }
const findLoops = (lines: string[], prefix: string): Loop[] => {
  const loops: Loop[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'loop_' || !lines[i + 1]?.startsWith(prefix)) continue;
    let first = i + 1;
    const headers: string[] = [];
    for (; first < lines.length && lines[first].startsWith('_'); first++) headers.push(lines[first].trim());
    let end = first;
    while (end < lines.length && !/^(#|_|loop_|data_)/.test(lines[end])) end++;
    loops.push({ loopLine: i, headers, first, end });
    i = end - 1;
  }
  return loops;
};

/**
 * The polymer atom rows of each author chain in the first model: ATOM records plus modified residues
 * (HETATM rows of the chain's polymer entity, e.g. MSE); ligands and waters are left out.
 */
const polymerRows = (lines: string[], loop: Loop) => {
  const col = (name: string) => loop.headers.indexOf(`_atom_site.${name}`);
  const [group, chain, entity, model, seq, icode] =
    ['group_PDB', 'auth_asym_id', 'label_entity_id', 'pdbx_PDB_model_num', 'auth_seq_id', 'pdbx_PDB_ins_code'].map(col);
  const byChain = new Map<string, { line: string; f: string[] }[]>();
  if (group < 0 || chain < 0) return { byChain, seq, icode };
  const rows = lines.slice(loop.first, loop.end).map(line => ({ line, f: cifTokens(line) })).filter(r => r.f.length === loop.headers.length);
  const firstModel = model >= 0 ? rows[0]?.f[model] : undefined;
  const polymerEntity = new Map<string, string>(); // Author chain -> entity of its ATOM records
  if (entity >= 0) for (const r of rows) if (r.f[group] === 'ATOM' && !polymerEntity.has(r.f[chain])) polymerEntity.set(r.f[chain], r.f[entity]);
  for (const r of rows) {
    if (model >= 0 && r.f[model] !== firstModel) continue;
    const own = r.f[group] === 'ATOM' || (entity >= 0 && polymerEntity.get(r.f[chain]) === r.f[entity]);
    if (!own) continue;
    const list = byChain.get(r.f[chain]);
    if (list) list.push(r);
    else byChain.set(r.f[chain], [r]);
  }
  return { byChain, seq, icode };
};

/**
 * Protein chains of an mmCIF file as templates for structure prediction: for each chain, the file
 * with its _atom_site rows cut to that chain's polymer atoms in the first model (modified residues
 * kept, ligands and waters dropped) and without anisotropic B-factors. Every other category stays,
 * so the entity sequences a parser needs are still there. Chains without polymer atoms are left out.
 */
export const chainTemplates = (cif: string, authChains: string[]): Map<string, string> => {
  const templates = new Map<string, string>();
  const lines = cif.split(/\r?\n/);
  const loops = findLoops(lines, '_atom_site');
  const site = loops.find(l => l.headers[0]?.startsWith('_atom_site.'));
  if (!site) return templates;
  const { byChain } = polymerRows(lines, site);
  for (const chain of authChains) {
    const atoms = byChain.get(chain) ?? [];
    if (atoms.length === 0) continue;
    const out: string[] = [];
    let next = 0;
    for (const loop of loops) {
      out.push(...lines.slice(next, loop.loopLine));
      if (loop === site) out.push(...lines.slice(loop.loopLine, loop.first), ...atoms.map(r => r.line));
      // _atom_site_anisotrop (and any other _atom_site* loop): dropped
      next = loop.end;
    }
    out.push(...lines.slice(next));
    templates.set(chain, out.join('\n'));
  }
  return templates;
};

/** Residues with coordinates, per author chain: author number plus insertion code ("25", "184A"). */
export const observedResidues = (cif: string): Map<string, Set<string>> => {
  const lines = cif.split(/\r?\n/);
  const site = findLoops(lines, '_atom_site.')[0];
  const observed = new Map<string, Set<string>>();
  if (!site) return observed;
  const { byChain, seq, icode } = polymerRows(lines, site);
  if (seq < 0) return observed;
  for (const [chain, rows] of byChain) observed.set(chain, new Set(rows.map(r => `${r.f[seq]}${icode >= 0 ? value(r.f[icode]) : ''}`)));
  return observed;
};

/** The atoms of an mmCIF file's _atom_site loop; [] when it has none. */
export const parseAtomSite = (cif: string): CifAtom[] => {
  const lines = cif.split(/\r?\n/);
  let i = lines.findIndex(l => l.startsWith('_atom_site.'));
  if (i < 0) return [];
  const columns: string[] = [];
  for (; i < lines.length && lines[i].startsWith('_atom_site.'); i++) columns.push(lines[i].trim().slice('_atom_site.'.length));
  const col = (name: string) => columns.indexOf(name);
  const [group, element, atom, compound, asym, authAsym, authSeq, labelSeq, icode, altId, bfactor, model, x, y, z] = [
    'group_PDB', 'type_symbol', 'label_atom_id', 'label_comp_id', 'label_asym_id', 'auth_asym_id', 'auth_seq_id',
    'label_seq_id', 'pdbx_PDB_ins_code', 'label_alt_id', 'B_iso_or_equiv', 'pdbx_PDB_model_num', 'Cartn_x', 'Cartn_y', 'Cartn_z',
  ].map(col);
  const seq = authSeq >= 0 ? authSeq : labelSeq;
  if ([group, atom, compound, asym, seq, x, y, z].some(c => c < 0)) return [];
  const atoms: CifAtom[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) break;
    const f = cifTokens(line);
    const position: Vec3 = [Number(f[x]), Number(f[y]), Number(f[z])];
    if (position.some(v => !Number.isFinite(v))) continue;
    atoms.push({
      het: f[group] === 'HETATM',
      name: f[atom],
      element: element >= 0 ? f[element] : f[atom].replace(/[^A-Za-z]/g, '').slice(0, 1),
      compound: f[compound],
      asym: f[asym],
      authAsym: value(authAsym >= 0 ? f[authAsym] : undefined) || f[asym],
      resi: parseInt(f[seq], 10),
      icode: value(icode >= 0 ? f[icode] : undefined),
      altId: value(altId >= 0 ? f[altId] : undefined),
      bfactor: bfactor >= 0 ? Number(f[bfactor]) : NaN,
      model: model >= 0 ? parseInt(f[model], 10) || 1 : 1,
      position,
    });
  }
  return atoms;
};
