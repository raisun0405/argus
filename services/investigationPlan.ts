import type { Highlight } from '../types';

// --- INVESTIGATE MODE: THE PLAN AND THE WRITE-UP ---
// A question that needs several of the app's tools is answered in three parts: the AI plans which
// tools to run (/api/investigate, stage "plan"), the browser runs them (services/investigation), and
// the AI writes the conclusion from their results alone (stage "write"). This module says what the
// two AI stages may return, and cleans what they do return. Pure TypeScript: the server and the
// browser both check the model's JSON with it.

export type ToolId = 'facts' | 'variants' | 'pockets' | 'ligands' | 'partners' | 'similar' | 'literature' | 'relate';
type DataTool = Exclude<ToolId, 'relate'>;

const DATA_TOOLS: DataTool[] = ['facts', 'variants', 'pockets', 'ligands', 'partners', 'similar', 'literature'];

/** The residue sets each tool makes: "relate" and the write-up's marks refer to them by name. */
export const TOOL_SETS: Record<DataTool, string[]> = {
  facts: ['sites'],
  variants: ['harmful', 'disease'],
  pockets: ['pocket1', 'pocket2', 'pocket3'],
  ligands: ['ligand'],
  partners: [],
  similar: [],
  literature: [],
};

const TOOL_LABELS: Record<DataTool, string> = {
  facts: 'UniProt and PDBe annotations',
  variants: 'Variant effects (AlphaMissense, UniProt)',
  pockets: 'Predicted pockets (P2Rank)',
  ligands: 'Ligand contacts in the file',
  partners: 'Interaction partners (STRING)',
  similar: 'Similar folds (Foldseek)',
  literature: 'Published research (Tavily)',
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
  query?: string; // literature: the search words
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

const MAX_QUERY = 160;
/** Search words: one line, no quotes or brackets (they'd turn into search operators). */
const searchWords = (value: unknown) => text(value, MAX_QUERY + 40).replace(/["“”[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

/**
 * The plan the model returned, cleaned: known tools only, each data tool once with the annotations
 * always first, "relate" only between sets the plan's data tools make (at most two of them), at most
 * MAX_STEPS steps. The structure is the one on screen unless the model named another valid ID. A
 * literature search without search words searches the question. Null when the reply isn't an object.
 */
export const normalizePlan = (raw: unknown, current: string, question = ''): InvestigationPlan | null => {
  const data = raw as any;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const asked = text(data.structure, 60);
  const structure = asked && asked.toUpperCase() === current.toUpperCase() ? current : canonicalStructureId(asked) ?? current;

  const given: any[] = Array.isArray(data.steps) ? data.steps : [];
  let dataSteps: PlanStep[] = [{ tool: 'facts', why: why(given.find(s => s?.tool === 'facts')?.why) }];
  for (const s of given) {
    const tool = s?.tool;
    if (!DATA_TOOLS.includes(tool) || dataSteps.some(d => d.tool === tool)) continue;
    if (tool !== 'literature') {
      dataSteps.push({ tool, why: why(s.why) });
      continue;
    }
    const query = searchWords(s.query) || searchWords(question);
    if (query.length >= 3) dataSteps.push({ tool, why: why(s.why), query });
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

/** A question that asks what published research says (it gets a literature step even when the model's plan leaves one out). */
export const ASKS_LITERATURE = /literature|papers?\b|\bstud(?:y|ies)\b|research|publish|publications?|trials?\b|approved|\bfda\b|reported|known about|resistan/i;

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
  const literature = ASKS_LITERATURE.test(q);
  const steps: { tool: ToolId; why: string; a?: string; b?: string }[] = [];
  if (variants) steps.push({ tool: 'variants', why: 'Which positions are likely harmful when mutated' });
  if (pockets) steps.push({ tool: 'pockets', why: 'Where a small molecule could bind' });
  if (ligands) steps.push({ tool: 'ligands', why: 'What holds the bound ligands' });
  if (partners) steps.push({ tool: 'partners', why: 'Which proteins it works with' });
  if (similar) steps.push({ tool: 'similar', why: 'Which proteins share its fold' });
  if (literature) steps.push({ tool: 'literature', why: 'What published research reports' });
  if (steps.length === 0) {
    steps.push({ tool: 'pockets', why: 'Where a small molecule could bind' }, { tool: 'ligands', why: 'What holds the bound ligands' });
  }
  // A question about a bound ligand compares the mutations with its contacts; otherwise with the best pocket
  if (variants && ligands) steps.push({ tool: 'relate', why: 'Whether harmful positions touch the ligand', a: 'harmful', b: 'ligand' });
  else if (variants && pockets) steps.push({ tool: 'relate', why: 'Whether harmful positions line the best pocket', a: 'harmful', b: 'pocket1' });
  const title = text(question, 70).replace(/[?.!]+$/, '');
  return normalizePlan({ structure: current, title: title ? capitalize(title) : 'Investigation', steps }, current, question)!;
};

// --- PUBLISHED RESEARCH (the "literature" step) ---
// A web search (Tavily, through /api/investigate stage "search") limited to scientific publishers and
// preprint servers. Titles, links and excerpts come from the search results, never from the model.

/** The sites searched, and the name each is shown under. */
export const LITERATURE_SITES: Record<string, string> = {
  'pubmed.ncbi.nlm.nih.gov': 'PubMed',
  'pmc.ncbi.nlm.nih.gov': 'PMC',
  'europepmc.org': 'Europe PMC',
  'nature.com': 'Nature',
  'science.org': 'Science',
  'cell.com': 'Cell',
  'pnas.org': 'PNAS',
  'elifesciences.org': 'eLife',
  'biorxiv.org': 'bioRxiv',
  'medrxiv.org': 'medRxiv',
  'nejm.org': 'NEJM',
  'thelancet.com': 'The Lancet',
  'jbc.org': 'JBC',
  'pubs.acs.org': 'ACS',
  'onlinelibrary.wiley.com': 'Wiley',
  'link.springer.com': 'Springer',
  'journals.plos.org': 'PLOS',
  'embopress.org': 'EMBO Press',
  'academic.oup.com': 'Oxford Academic',
  'frontiersin.org': 'Frontiers',
  'sciencedirect.com': 'ScienceDirect',
  'aacrjournals.org': 'AACR',
  'ashpublications.org': 'ASH',
  'jci.org': 'JCI',
  'rupress.org': 'Rockefeller UP',
};

export interface LiteratureSource {
  title: string;
  url: string;
  site: string; // "PubMed Central"
  excerpt: string; // What the search returned from the page: all the write-up may draw on
}

export const MAX_SOURCES = 4;
const MAX_EXCERPT = 600;
const MIN_EXCERPT = 200; // Shorter ones are page furniture ("Some insights into ..."), not evidence

/** The listed site a web address belongs to, or null. */
export const literatureSite = (url: string): string | null => {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  const domain = Object.keys(LITERATURE_SITES).find(d => host === d || host.endsWith(`.${d}`));
  return domain ? LITERATURE_SITES[domain] : null;
};

/**
 * An excerpt on one line without the page's furniture (a repeated title, the government banner,
 * markdown marks), cut at a sentence end where one falls late enough, else at a word. A gap in the
 * page's text stays marked "[...]" (the write-up must not join what's on either side), and an opening
 * fragment with no start ("…shows similar efficacy as VX-809") is dropped: its subject is missing.
 */
const excerptOf = (value: unknown, title: string) => {
  let flat = text(value, 4000)
    .replace(/An official website of the United States government\.?/gi, ' ')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s.,;:)]|$)/g, '$1$2')
    .replace(/\s*(?:\[\s*(?:\.\.\.|…)\s*\]|(?<=\S)\s+…\s+(?=\S))\s*/g, ' [...] ')
    .replace(/\s+/g, ' ')
    .trim();
  // "Title: <the title> <more of the title>. Real text..." -> "Real text..."
  flat = flat.replace(/^Title:\s*/i, '');
  for (let i = 0; i < 2 && title && flat.toLowerCase().includes(title.toLowerCase()) && flat.toLowerCase().indexOf(title.toLowerCase()) < 120; i++) {
    const at = flat.toLowerCase().indexOf(title.toLowerCase());
    flat = `${flat.slice(0, at)}${flat.slice(at + title.length)}`.replace(/^[\s.:|–-]+/, '').trim();
  }
  flat = flat.replace(/^(?:…|\.\.\.|\[\.\.\.\])\s*/, '');
  if (!/^[A-Z"“(]/.test(flat)) {
    const start = flat.search(/[.!?]\s+[A-Z"“(]/);
    if (start >= 0 && flat.length - start > MIN_EXCERPT) flat = flat.slice(start + 1).trim();
  }
  const lead = /^[a-z]/.test(flat) ? `…${flat}` : flat;
  if (lead.length <= MAX_EXCERPT) return lead;
  const cut = lead.slice(0, MAX_EXCERPT);
  const sentenceEnd = cut.lastIndexOf('. ');
  return sentenceEnd > MAX_EXCERPT * 0.6 ? cut.slice(0, sentenceEnd + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

/** A title without the site names pages add to it ("Frontiers | ...", "... | bioRxiv", "... - PMC"). */
const bareTitle = (value: unknown) => {
  const full = text(value, 200);
  const trimmed = full.replace(/^(?:Frontiers|eLife|PNAS)\s+\|\s+/i, '').replace(/\s+-\s+PMC$/, '').replace(/\s+\|\s+[^|]{2,60}$/, '');
  return trimmed.length >= 20 ? trimmed : full;
};

// Page text that isn't the paper: cookie and government banners, PubMed's page controls, licence notices
const PAGE_FURNITURE = /This website requires cookies|cookie policy|Federal government websites often end in|Save citation to file|Add to Collections|distributed under the terms of the Creative Commons|Open Access article distributed|Received \d{4} \w+ \d{1,2}; (?:Revised|Accepted)/i;
// A reference list: several citations in a row, not the paper's own words
const CITATIONS = /\bPMID:\s*\d|\bdoi:\s*10\.|Google Scholar|\b(?:19|20)\d{2};\s*\d+\s*\(\d+\)/gi;

/** Whether an excerpt is the paper's own text, not the page around it or its reference list. */
const isEvidence = (excerpt: string) => !PAGE_FURNITURE.test(excerpt) && (excerpt.match(CITATIONS)?.length ?? 0) < 3;

/** One key per paper, so its journal page and its PubMed Central copy count once. */
const paperKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 80);

/**
 * Search results cleaned: listed sites only, real excerpts only, each paper once, at most MAX_SOURCES.
 * Accepts Tavily's results ({ title, url, content }) and this app's own sources ({ title, url, excerpt }).
 */
export const normalizeSources = (raw: unknown): LiteratureSource[] => {
  const sources: LiteratureSource[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const url = text(r?.url, 500);
    const site = literatureSite(url);
    const title = bareTitle(r?.title);
    const excerpt = excerptOf(r?.excerpt ?? r?.content, title);
    if (!site || !title || excerpt.length < MIN_EXCERPT || !isEvidence(excerpt)) continue;
    if (sources.some(s => s.url === url || paperKey(s.title) === paperKey(title))) continue;
    sources.push({ title, url, site, excerpt });
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
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
  checked?: { sentences: number; fixed: number; dropped: number; quotes?: number }; // Sentences checked against the results they cite; quotes matched to their papers
  quotes?: { paper: string; quote: string }[]; // Papers' own words the model picked ("3a"): verified, then added to the answer in code
}

const MAX_MARKS = 4;

/** Text that keeps its paragraph breaks: runs of spaces collapsed, at most one blank line in a row. */
const paragraphs = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
    : '';

const CITE = /\[(\d+)([a-d]?)\]/g; // [2], or [3a] for a literature step's paper (a)

/**
 * Citations as single [n] (or [na]) marks of real steps: "[1, 3]" and "[2-3]" are split, numbers
 * outside the investigation dropped, repeats merged ("[2][2]" -> "[2]"). The forms models drift into
 * are brought back: 【2】, "([2])", "[3][a]" and "([3]a)" for [3a], and a citation after the full stop.
 */
export const cleanCitations = (answer: string, stepCount: number): string =>
  answer
    .replace(/【\s*([^】]{1,30}?)\s*】/g, '[$1]')
    .replace(/\[(\d+)\]\s*\[([a-d])\]/g, '[$1$2]')
    .replace(/\(\s*\[(\d+)\]\s*([a-d])\s*\)/g, '[$1$2]')
    .replace(/\[(\d+)\]([a-d])\b/g, '[$1$2]')
    .replace(/\[\s*(\d+[a-d]?(?:\s*(?:,|–|-|and)\s*\d+[a-d]?)*)\s*\]/g, (_, list: string) => {
      const refs: string[] = [];
      for (const part of list.split(/\s*(?:,|and)\s*/)) {
        const range = part.match(/^(\d+)\s*[–-]\s*(\d+)$/);
        if (range) for (let n = Number(range[1]); n <= Number(range[2]) && n - Number(range[1]) < 10; n++) refs.push(String(n));
        else refs.push(part);
      }
      return [...new Set(refs.filter(r => { const n = parseInt(r, 10); return Number.isInteger(n) && n >= 1 && n <= stepCount; }))].map(r => `[${r}]`).join('');
    })
    .replace(/\(\s*((?:\[\d+[a-d]?\]\s*)+)\)/g, (_, group: string) => group.replace(/\s+/g, ''))
    .replace(/([.!?])((?:[ \t]*\[\d+[a-d]?\])+)/g, (_, stop: string, cites: string) => ` ${cites.replace(/\s+/g, '')}${stop}`)
    .replace(/(\[\d+[a-d]?\])(?:\s*\1)+/g, '$1')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');

/** The answer's text and citations, in order, for rendering; `paper` is the letter of a cited paper. */
export const splitCitations = (answer: string): ({ text: string } | { cite: number; paper?: string })[] => {
  const parts: ({ text: string } | { cite: number; paper?: string })[] = [];
  let last = 0;
  for (const m of answer.matchAll(CITE)) {
    if (m.index! > last) parts.push({ text: answer.slice(last, m.index) });
    parts.push({ cite: Number(m[1]), ...(m[2] ? { paper: m[2] } : {}) });
    last = m.index! + m[0].length;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last) });
  return parts;
};

/** The answer without its citation marks (for the answer's summary, shared links and later questions). */
export const stripCitations = (answer: string) =>
  answer.replace(/\s*\[\d+[a-d]?\]/g, '').replace(/[ \t]+([.,;:])/g, '$1').trim();

// --- CHECKING THE ANSWER ---
// After the write-up, its sentences go back to the AI with the results they were written from
// (/api/investigate stage "check"): each kept, cut down to what its sources state, or dropped. The
// answer is rebuilt from them in code, so nothing else in it can change.

// A full stop after these doesn't end a sentence
const ABBREVIATION = /(?:\be\.g|\bi\.e|\bet al|\bvs|\bapprox|\bca|\bFig)\.$/i;

/** The answer as sentences, each with the whitespace after it: joined back, they are the answer. */
export const splitSentences = (answer: string): { text: string; gap: string }[] => {
  const out: { text: string; gap: string }[] = [];
  let start = 0;
  for (const m of answer.matchAll(/([.!?]+)(\s+)|(\n+)/g)) {
    const end = m.index! + (m[1]?.length ?? 0);
    const text = answer.slice(start, end);
    // Nor does one before a lowercase word, as after a one-letter abbreviation
    if (m[1] && (ABBREVIATION.test(text) || /^[a-z]/.test(answer.slice(m.index! + m[0].length)))) continue;
    const gap = m[2] ?? m[3];
    out.push({ text, gap });
    start = end + gap.length;
  }
  if (start < answer.length) out.push({ text: answer.slice(start), gap: '' });
  return out;
};

export type CheckVerdict = { id: number; verdict: 'keep' | 'fix' | 'drop'; text?: string };

/** The checker's verdicts, cleaned: known sentences only, a fix needs its text (citations kept). */
export const normalizeCheck = (raw: unknown, sentences: { id: number; text: string }[]): CheckVerdict[] => {
  const given: any[] = Array.isArray((raw as any)?.verdicts) ? (raw as any).verdicts : [];
  const verdicts: CheckVerdict[] = [];
  for (const s of sentences) {
    const v = given.find(g => Number(g?.id) === s.id);
    const verdict = v?.verdict === 'fix' || v?.verdict === 'drop' ? v.verdict : 'keep';
    if (verdict !== 'fix') {
      verdicts.push({ id: s.id, verdict });
      continue;
    }
    let fixed = text(v?.text, 600);
    if (!fixed) {
      verdicts.push({ id: s.id, verdict: 'keep' });
      continue;
    }
    // The fix keeps the sentence's citations, wherever the model put them. A sentence that cited
    // nothing is fixed only by adding the citation it lacked: a fix that still cites nothing drops it
    const cites = [...s.text.matchAll(CITE)].map(m => m[0]);
    if (!/\[\d+[a-d]?\]/.test(fixed)) {
      if (!cites.length) {
        verdicts.push({ id: s.id, verdict: 'drop' });
        continue;
      }
      fixed = `${fixed.replace(/[.!?]+$/, '')} ${cites.join('')}.`;
    }
    verdicts.push({ id: s.id, verdict: 'fix', text: fixed });
  }
  return verdicts;
};

// A sentence's words alone, for spotting a repeat: no citations, case or punctuation
const bareSentence = (sentence: string) => stripCitations(sentence).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

/**
 * The answer rebuilt from the check's verdicts (ids are its splitSentences indexes): kept sentences as
 * they were, fixes in their place, drops gone, and a sentence that repeats an earlier one (as a fix
 * can) gone too.
 */
export const applyCheck = (answer: string, verdicts: CheckVerdict[], stepCount: number) => {
  const seen = new Set<string>();
  let fixed = 0;
  let dropped = 0;
  const rebuilt = splitSentences(answer).map((p, id) => {
    const v = verdicts.find(x => x.id === id);
    const sentence = v?.verdict === 'fix' && v.text ? v.text : p.text;
    const bare = bareSentence(sentence);
    if (v?.verdict === 'drop' || (bare && seen.has(bare))) {
      dropped++;
      return '';
    }
    if (bare) seen.add(bare);
    if (v?.verdict === 'fix') fixed++;
    return sentence + p.gap;
  }).join('').trim();
  return { answer: cleanCitations(rebuilt, stepCount), fixed, dropped };
};

// Words a question asks with, as opposed to the names it asks about
const ASKING_WORDS = new Set(`what which where when does have been about known study studies research published publications
  literature report reports reported according approved drug drugs target targets targeted targeting mutation mutations
  variant variants resistance protein proteins structure structures residue residues pocket pockets binds binding bound
  cause causes there these those clinical trial trials tested against small molecule molecules inhibitor inhibitors
  inhibit inhibits affect affects response mechanism works shows found function disease patients other through between
  reactivating correctors stabilizers deficiency sensitivity compound compounds activity selective receptor receptors
  pathway pathways therapy therapies treatment treatments genetic changes effects`.split(/\s+/));

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%]+/g, '');

/**
 * The names and numbers in a sentence that what it cites never mentions: codes (G12C, CYP2C19, 4MNF),
 * decimals, percentages and numbers of two digits or more, and the names the question asks about. Found
 * by matching words, so a synonym can hide one; the check takes them as a sign of a fact borrowed from
 * elsewhere. `cited` is the text of the steps and papers the sentence cites.
 */
export const missingTerms = (sentence: string, question: string, cited: string): string[] => {
  if (!cited.trim()) return [];
  const plain = stripCitations(sentence);
  const asked = new Set((question.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? [])
    .filter(w => !ASKING_WORDS.has(w.toLowerCase()) && (/[A-Z]{2}|\d/.test(w) || w.length >= 7))
    .map(w => w.toLowerCase()));
  const terms = [
    ...(plain.match(/\b(?=[A-Za-z-]*\d)(?=[\d-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]*\b/g) ?? []).filter(t => !/^[23]D$/i.test(t)),
    ...(plain.match(/\d+\.\d+|\d+%|\b\d{2,}\b/g) ?? []),
    ...(plain.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []).filter(w => asked.has(w.toLowerCase())),
  ];
  const evidence = squash(cited);
  return [...new Set(terms)].filter(t => !evidence.includes(squash(t))).slice(0, 6);
};

/**
 * The write-up's title when every word of substance in it (four letters or more, or with a digit) is
 * in the final answer or the question; '' otherwise, so the plan's title shows instead. The check
 * reads only the answer, and a title can still claim what the check took out of it.
 */
export const safeTitle = (title: string, question: string, answer: string) => {
  const allowed = squash(`${question} ${answer}`);
  const words = (title.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []).filter(w => (w.length >= 4 || /\d/.test(w)) && !ASKING_WORDS.has(w.toLowerCase()));
  return words.every(w => allowed.includes(squash(w))) ? title : '';
};

// --- QUOTES OF PAPERS ---
// The write-up uses a paper only by quoting it, and after the check code makes sure every quote is the
// paper's own words: a paraphrase can say more than the paper does, a verified quote can't.

const MIN_QUOTE_WORDS = 5;
const MAX_FRAMING_WORDS = 12; // "One study of 40 patients reports that" and the like
// A sentence about the search as a whole rather than one paper: what it found, or didn't
const ABOUT_THE_SEARCH = /\b(?:no|none|nothing|neither)\b|\bfound (?:\d+|one|two|three|four|five|several)\b/i;

// A text's words, lowercased, with an excerpt's "[...]" gaps kept as breaks no quote can cross
const quoteWords = (s: string) => s.toLowerCase().replace(/\[\s*(?:\.\.\.|…)\s*\]/g, ' | ').match(/[a-z0-9]+|\|/g) ?? [];

/** Whether a quote's words appear in a text, in order and unbroken. */
const quotedIn = (quote: string, source: string) => {
  const q = quoteWords(quote).filter(w => w !== '|');
  const s = quoteWords(source);
  if (q.length === 0) return false;
  for (let i = 0; i + q.length <= s.length; i++) if (q.every((w, j) => s[i + j] === w)) return true;
  return false;
};

const wordCount = (s: string) => (s.match(/[A-Za-z0-9]+/g) ?? []).length;

/**
 * The answer with every sentence about a paper verified. Such a sentence must quote (in double quotes,
 * at least MIN_QUOTE_WORDS words) one unbroken stretch of the title or excerpt of a paper under a step
 * it cites, with at most MAX_FRAMING_WORDS words around its quotes; its citations of literature steps
 * become the papers the quotes were found in. A sentence citing a literature step without a quote
 * stays only when it is about the search itself ("found no paper on ..."). Anything else is dropped.
 * `papers` holds each literature step's papers by step number.
 */
export const quoteGate = (answer: string, papers: Record<number, { title: string; excerpt: string }[]>, stepCount: number) => {
  let dropped = 0;
  const drop = () => {
    dropped++;
    return '';
  };
  const kept = splitSentences(answer).map(p => {
    const marks = [...p.text.matchAll(CITE)];
    const cited = [...new Set(marks.map(m => Number(m[1])).filter(n => papers[n]?.length))];
    if (!cited.length) return p.text + p.gap;
    const quotes = [...p.text.matchAll(/["“]([^"“”]+)["”]/g)].map(m => m[1]);
    if (!quotes.length) {
      const onePaper = marks.some(m => m[2] && papers[Number(m[1])]?.length);
      return !onePaper && ABOUT_THE_SEARCH.test(p.text) ? p.text + p.gap : drop();
    }
    const found: string[] = [];
    for (const quote of quotes) {
      if (wordCount(quote) < MIN_QUOTE_WORDS) return drop();
      const hit = cited.flatMap(n => papers[n].map((paper, i) => ({ n, i, paper })))
        .find(({ paper }) => quotedIn(quote, paper.excerpt) || quotedIn(quote, paper.title));
      if (!hit) return drop();
      found.push(`[${hit.n}${String.fromCharCode(97 + hit.i)}]`);
    }
    if (wordCount(stripCitations(p.text.replace(/["“][^"“”]*["”]/g, ' '))) > MAX_FRAMING_WORDS) return drop();
    // The papers the quotes came from replace the sentence's citations of literature steps
    const rest = p.text.replace(CITE, (mark, n) => (papers[Number(n)]?.length ? '' : mark)).trimEnd();
    const stop = rest.match(/[.!?]+$/)?.[0] ?? '';
    return `${rest.slice(0, rest.length - stop.length).trimEnd()} ${[...new Set(found)].join('')}${stop || '.'}${p.gap}`;
  }).join('').trim();
  return { answer: cleanCitations(kept, stepCount), dropped };
};

/**
 * The answer with the papers' own words the model picked, each found word for word in one unbroken
 * stretch of the paper it names (or, failing that, of another paper of the same step, which it is then
 * cited to) and added as a sentence written here: "One paper reports “…” [3a]." Code writes the words
 * around the quote, so they can't claim more than it says. A quote found in no paper is left out.
 */
export const addQuotes = (answer: string, quotes: NonNullable<WriteUp['quotes']>, papers: Record<number, { title: string; excerpt: string }[]>) => {
  const added: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const { paper, quote } of quotes) {
    const step = Number(paper.slice(0, -1));
    const list = papers[step] ?? [];
    const named = paper.charCodeAt(paper.length - 1) - 97;
    const at = [named, ...list.map((_, i) => i).filter(i => i !== named)]
      .find(i => list[i] && (quotedIn(quote, list[i].excerpt) || quotedIn(quote, list[i].title)));
    const key = quoteWords(quote).join(' ');
    if (at === undefined || seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    const cite = `[${step}${String.fromCharCode(97 + at)}]`;
    const lead = added.some(s => s.endsWith(`${cite}.`)) ? 'The same paper reports' : added.length ? 'Another paper reports' : 'One paper reports';
    added.push(`${lead} “${quote.replace(/[\s.,;:]+$/, '')}” ${cite}.`);
  }
  return { answer: [answer, ...added].filter(Boolean).join(' '), added: added.length, dropped };
};

const MAX_QUOTES = 3;

/**
 * The write-up the model returned, cleaned: an answer is required; citations point at real steps;
 * marks name sets the steps actually made (at most four, each once); quotes name a paper of a real
 * step and are long enough to verify (at most three).
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
  const quotes: NonNullable<WriteUp['quotes']> = [];
  for (const q of Array.isArray(data.quotes) ? data.quotes : []) {
    const paper = text(q?.paper, 12).replace(/[[\]\s]/g, '').toLowerCase();
    const step = Number(paper.match(/^(\d+)[a-d]$/)?.[1]);
    const quote = text(q?.quote, 400).replace(/^["“'‘\s]+|["”'’\s]+$/g, '');
    if (step >= 1 && step <= stepCount && wordCount(quote) >= MIN_QUOTE_WORDS && quotes.length < MAX_QUOTES) quotes.push({ paper, quote });
  }
  return { title: text(data.title, 80), answer, marks, ...(caveat ? { caveat } : {}), ...(quotes.length ? { quotes } : {}) };
};
