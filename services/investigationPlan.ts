import type { Highlight } from '../types';

// --- INVESTIGATE MODE: THE PLAN AND THE WRITE-UP ---
// A question that needs several of the app's tools is answered in three parts: the AI plans which
// tools to run (/api/investigate, stage "plan"), the browser runs them (services/investigation), and
// the AI writes the conclusion from their results alone (stage "write"). This module says what the
// two AI stages may return, and cleans what they do return. Pure TypeScript: the server and the
// browser both check the model's JSON with it.

export type ToolId = 'facts' | 'variants' | 'pockets' | 'ligands' | 'partners' | 'similar' | 'relate';
type DataTool = Exclude<ToolId, 'relate'>;

const DATA_TOOLS: DataTool[] = ['facts', 'variants', 'pockets', 'ligands', 'partners', 'similar'];

/** The residue sets each tool makes: "relate" and the write-up's marks refer to them by name. */
export const TOOL_SETS: Record<DataTool, string[]> = {
  facts: ['sites'],
  variants: ['harmful', 'disease'],
  pockets: ['pocket1', 'pocket2', 'pocket3'],
  ligands: ['ligand'],
  partners: [],
  similar: [],
};

const TOOL_LABELS: Record<DataTool, string> = {
  facts: 'UniProt and PDBe annotations',
  variants: 'Variant effects (AlphaMissense, UniProt)',
  pockets: 'Predicted pockets (P2Rank)',
  ligands: 'Ligand contacts in the file',
  partners: 'Interaction partners (STRING)',
  similar: 'Similar folds (Foldseek)',
};

/** Tools that can take up to a minute (an outside server computes them). */
export const SLOW_TOOLS = new Set<ToolId>(['pockets', 'similar']);

const SET_LABELS: Record<string, string> = {
  sites: 'annotated sites',
  harmful: 'likely harmful positions',
  disease: 'disease-variant positions',
  pocket1: 'pocket 1',
  pocket2: 'pocket 2',
  pocket3: 'pocket 3',
  ligand: 'ligand contacts',
};

/** The set a "relate" step makes: the residues of `a` near `b`. */
export const relateSet = (a: string, b: string) => `${a}_near_${b}`;

/** "harmful_near_pocket1" -> "likely harmful positions near pocket 1". */
export const setLabel = (name: string): string => {
  const near = name.indexOf('_near_');
  if (near > 0) return `${setLabel(name.slice(0, near))} near ${setLabel(name.slice(near + 6))}`;
  return SET_LABELS[name] ?? name;
};

/** How a set is drawn when marked: the category of the residues it starts from. */
export const setCategory = (name: string): NonNullable<Highlight['category']> => {
  const base = name.split('_near_')[0];
  return base === 'sites' ? 'active_site' : base === 'harmful' || base === 'disease' ? 'mutation' : 'binding_site';
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --- THE PLAN ---

export interface PlanStep {
  tool: ToolId;
  why: string; // What the step checks, in a few words (shown under it while it runs)
  a?: string; // relate: the residues of this set...
  b?: string; // ...that lie near this one
  within?: number; // relate: Å
}

export interface InvestigationPlan {
  structure: string; // What to investigate: a PDB ID, an AlphaFold model ID, or the structure on screen
  title: string;
  steps: PlanStep[];
}

export const MAX_STEPS = 6;
const MAX_RELATES = 2;
const DEFAULT_WITHIN = 5;

export const stepLabel = (step: PlanStep): string =>
  step.tool === 'relate'
    ? `${capitalize(setLabel(step.a ?? ''))} within ${step.within ?? DEFAULT_WITHIN} Å of ${setLabel(step.b ?? '')}`
    : TOOL_LABELS[step.tool];

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A step's "why", in sentence case like every other line of the checklist. */
const why = (value: unknown) => capitalize(text(value, 140).replace(/[.;]+$/, ''));

/** "1hsg" -> "1HSG", "af-p04637-f1-model_v6" -> "AF-P04637-F1"; null when it is neither. */
export const canonicalStructureId = (value: unknown): string | null => {
  const id = text(value, 60);
  const af = id.match(/^AF-([A-Z0-9]{6,10})(?:-F\d+)?/i);
  if (af) return `AF-${af[1].toUpperCase()}-F1`;
  return /^[1-9][A-Za-z0-9]{3}$/.test(id) ? id.toUpperCase() : null;
};

/**
 * The plan the model returned, cleaned: known tools only, each data tool once with the annotations
 * always first, "relate" only between sets the plan's data tools make (at most two of them), at most
 * MAX_STEPS steps. The structure is the one on screen unless the model named another valid ID.
 * Null when the reply isn't an object.
 */
export const normalizePlan = (raw: unknown, current: string): InvestigationPlan | null => {
  const data = raw as any;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const asked = text(data.structure, 60);
  const structure = asked && asked.toUpperCase() === current.toUpperCase() ? current : canonicalStructureId(asked) ?? current;

  const given: any[] = Array.isArray(data.steps) ? data.steps : [];
  let dataSteps: PlanStep[] = [{ tool: 'facts', why: why(given.find(s => s?.tool === 'facts')?.why) }];
  for (const s of given) {
    const tool = s?.tool;
    if (!DATA_TOOLS.includes(tool) || dataSteps.some(d => d.tool === tool)) continue;
    dataSteps.push({ tool, why: why(s.why) });
  }

  const relatesFor = (available: PlanStep[]) => {
    const made = new Set(available.flatMap(s => TOOL_SETS[s.tool as DataTool]));
    const relates: PlanStep[] = [];
    for (const s of given) {
      if (s?.tool !== 'relate' || relates.length >= MAX_RELATES) continue;
      const a = text(s.a, 80);
      const b = text(s.b, 80);
      if (!made.has(a) || !made.has(b) || a === b || made.has(relateSet(a, b))) continue;
      const asked = Number(s.within);
      const within = Number.isFinite(asked) ? Math.min(8, Math.max(3, Math.round(asked * 2) / 2)) : DEFAULT_WITHIN;
      relates.push({ tool: 'relate', why: why(s.why), a, b, within });
      made.add(relateSet(a, b));
    }
    return relates;
  };

  // The data tools a set of comparisons needs (through earlier comparisons too), annotations always
  const toolsFor = (relates: PlanStep[]) => {
    const tools = new Set<ToolId>(['facts']);
    const visit = (set: string) => {
      const base = DATA_TOOLS.find(t => TOOL_SETS[t].includes(set));
      if (base) tools.add(base);
      const source = relates.find(r => relateSet(r.a!, r.b!) === set);
      if (source) [source.a!, source.b!].forEach(visit);
    };
    relates.forEach(r => [r.a!, r.b!].forEach(visit));
    return tools;
  };

  // Over the limit: comparisons go from the end while they and their inputs can't fit; then the
  // inputs they need stay, and other tools fill what room is left in the order the model gave them
  let relates = relatesFor(dataSteps);
  while (relates.length > 0 && toolsFor(relates).size + relates.length > MAX_STEPS) relates = relates.slice(0, -1);
  const needed = toolsFor(relates);
  let room = MAX_STEPS - relates.length - dataSteps.filter(s => needed.has(s.tool)).length;
  dataSteps = dataSteps.filter(s => needed.has(s.tool) || room-- > 0);

  return {
    structure,
    title: text(data.title, 70) || 'Investigation',
    steps: [...dataSteps, ...relates],
  };
};

/**
 * A plan made without the AI (it was busy or answered nonsense): the tools the question's words
 * point to, annotations first, and the one comparison that question most likely needs.
 */
export const fallbackPlan = (question: string, current: string): InvestigationPlan => {
  const q = question.toLowerCase();
  const variants = /mutat|variant|disease|pathogen|cancer|clinical|missense|\bsnps?\b|harmful/.test(q);
  const pockets = /pocket|druggab|cavit|binding site|where .{0,40}bind|dock/.test(q);
  const ligands = /ligand|bound|inhibitor|\bdrugs?\b|substrate|cofactor|heme|haem|contact|hydrogen bond|h-?bonds?|salt bridge|\bhold|\bheld\b/.test(q);
  const partners = /partner|interacts? with|interaction network|complex with|other proteins?|string/.test(q);
  const similar = /similar|homolog|fold|related|evolution|resembl|looks? like|family/.test(q);
  const steps: { tool: ToolId; why: string; a?: string; b?: string }[] = [];
  if (variants) steps.push({ tool: 'variants', why: 'Which positions are likely harmful when mutated' });
  if (pockets) steps.push({ tool: 'pockets', why: 'Where a small molecule could bind' });
  if (ligands) steps.push({ tool: 'ligands', why: 'What holds the bound ligands' });
  if (partners) steps.push({ tool: 'partners', why: 'Which proteins it works with' });
  if (similar) steps.push({ tool: 'similar', why: 'Which proteins share its fold' });
  if (steps.length === 0) {
    steps.push({ tool: 'pockets', why: 'Where a small molecule could bind' }, { tool: 'ligands', why: 'What holds the bound ligands' });
  }
  // A question about a bound ligand compares the mutations with its contacts; otherwise with the best pocket
  if (variants && ligands) steps.push({ tool: 'relate', why: 'Whether harmful positions touch the ligand', a: 'harmful', b: 'ligand' });
  else if (variants && pockets) steps.push({ tool: 'relate', why: 'Whether harmful positions line the best pocket', a: 'harmful', b: 'pocket1' });
  const title = text(question, 70).replace(/[?.!]+$/, '');
  return normalizePlan({ structure: current, title: title ? capitalize(title) : 'Investigation', steps }, current)!;
};

/** "investigate: are the mutations near a pocket?" -> the question; null when the message isn't one. */
export const parseInvestigateCommand = (text: string): string | null => {
  const m = text.trim().match(/^\/?investigate\b[\s:,.-]*([\s\S]{3,})$/i);
  return m ? m[1].trim() : null;
};

// --- THE WRITE-UP ---

export interface WriteUp {
  title: string;
  answer: string; // Cites the steps as [1], [2]
  marks: { set: string; label: string }[]; // What to mark in 3D: residue sets the steps made
  caveat?: string;
}

const MAX_MARKS = 4;

/** Text that keeps its paragraph breaks: runs of spaces collapsed, at most one blank line in a row. */
const paragraphs = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
    : '';

/**
 * Citations as single [n] marks of real steps: "[1, 3]" and "[2-3]" are split, numbers outside the
 * investigation dropped, repeats merged ("[2][2]" -> "[2]").
 */
export const cleanCitations = (answer: string, stepCount: number): string =>
  answer
    .replace(/\[\s*(\d+(?:\s*(?:,|–|-|and)\s*\d+)*)\s*\]/g, (_, list: string) => {
      const numbers: number[] = [];
      for (const part of list.split(/\s*(?:,|and)\s*/)) {
        const range = part.match(/^(\d+)\s*[–-]\s*(\d+)$/);
        if (range) for (let n = Number(range[1]); n <= Number(range[2]) && n - Number(range[1]) < 10; n++) numbers.push(n);
        else numbers.push(Number(part));
      }
      return [...new Set(numbers.filter(n => Number.isInteger(n) && n >= 1 && n <= stepCount))].map(n => `[${n}]`).join('');
    })
    .replace(/(\[\d+\])(?:\s*\1)+/g, '$1')
    .replace(/[ \t]+([.,;:])/g, '$1');

/** The answer's text and citations, in order, for rendering. */
export const splitCitations = (answer: string): ({ text: string } | { cite: number })[] => {
  const parts: ({ text: string } | { cite: number })[] = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    if (m.index! > last) parts.push({ text: answer.slice(last, m.index) });
    parts.push({ cite: Number(m[1]) });
    last = m.index! + m[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
};

/** The answer without its citation marks (for the answer's summary, shared links and later questions). */
export const stripCitations = (answer: string) =>
  answer.replace(/\s*\[\d+\]/g, '').replace(/[ \t]+([.,;:])/g, '$1').trim();

/**
 * The write-up the model returned, cleaned: an answer is required; citations point at real steps;
 * marks name sets the steps actually made (at most four, each once).
 */
export const normalizeWrite = (raw: unknown, sets: string[], stepCount: number): WriteUp | null => {
  const data = raw as any;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const answer = cleanCitations(paragraphs(data.answer, 1600), stepCount);
  if (!answer) return null;
  const known = new Set(sets);
  const marks: WriteUp['marks'] = [];
  for (const m of Array.isArray(data.marks) ? data.marks : []) {
    const set = text(m?.set, 80);
    if (!known.has(set) || marks.some(x => x.set === set) || marks.length >= MAX_MARKS) continue;
    marks.push({ set, label: capitalize(text(m?.label, 60) || setLabel(set)) });
  }
  const caveat = text(data.caveat, 300);
  return { title: text(data.title, 80), answer, marks, ...(caveat ? { caveat } : {}) };
};
