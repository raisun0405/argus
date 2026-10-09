import { parseResidueQuery } from './commands';

// --- CHAT ACTIONS ---
// What the chat can do in the workspace besides answering: change how the structure looks, show or
// hide its parts, open a tool, select residues, switch theme, play the tour. Two ways in:
// - a plain request ("surface", "colour by chain", "hide waters") is recognised here and runs at
//   once, without the AI (parseChatCommand);
// - an AI answer may carry an "actions" list in a small vocabulary ("shape:surface"), checked here
//   before anything runs (normalizeActionIds, actionFromId). Co-folding is never on that list: a
//   prediction spends a quota, so it stays the user's call.
// The chat reports what actually ran (ActionResult), so it never claims a change it didn't make.

export type Shape = 'cartoon' | 'stick' | 'sphere' | 'surface';
export type Colouring = 'element' | 'chain' | 'rainbow' | 'hydrophobicity' | 'residue' | 'confidence';
export type Part = 'highlights' | 'ligands' | 'substrates' | 'metals' | 'waters';
export type Tool = 'pockets' | 'interactions' | 'pathogenicity' | 'overlay' | 'similar' | 'partners' | 'alphafold' | 'cofold' | 'pae';

export type ChatAction =
  | { kind: 'shape'; shape: Shape }
  | { kind: 'colour'; colouring: Colouring }
  | { kind: 'opacity'; opacity: number }
  | { kind: 'part'; part: Part; shown: boolean }
  | { kind: 'chain'; chain: string; shown: boolean }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'overlay'; with: string } // Lay a PDB entry ("1AKE") or the protein's AlphaFold model ("alphafold") over the structure
  | { kind: 'close-tool' }
  | { kind: 'reset' }
  | { kind: 'select'; chain?: string; from: number; to: number; name?: string; wholeChain?: boolean }
  | { kind: 'clear-selection' }
  | { kind: 'inspector'; open: boolean }
  | { kind: 'theme'; theme: string; name: string }
  | { kind: 'tour'; play: boolean }
  | { kind: 'picture' }; // Save the 3D view as a PNG file (only the user asks for this)

export interface ActionResult {
  action: ChatAction;
  label: string; // What happened ("Shape: surface"), or what couldn't ("Couldn't open Pockets")
  ok: boolean;
  note?: string; // Why it couldn't
  pending?: boolean; // Planned, still waiting for its structure to load
}

// --- RECEIPTS ---

const SHAPE_NAME: Record<Shape, string> = { cartoon: 'cartoon', stick: 'wireframe', sphere: 'spacefill', surface: 'surface' };
const COLOUR_NAME: Record<Colouring, string> = {
  element: 'element', chain: 'chain', rainbow: 'rainbow', hydrophobicity: 'hydrophobicity', residue: 'residue type', confidence: 'model confidence',
};
const PART_NAME: Record<Part, string> = { highlights: 'Highlights', ligands: 'Ligands', substrates: 'Substrates', metals: 'Metals & ions', waters: 'Waters' };
const TOOL_NAME: Record<Tool, string> = {
  pockets: 'Pockets', interactions: 'Interactions', pathogenicity: 'Variant Lens', overlay: 'Overlay', similar: 'Find similar', partners: 'Partners', alphafold: 'the AlphaFold model', cofold: 'Co-fold', pae: 'the confidence map',
};
const overlayLabel = (a: Extract<ChatAction, { kind: 'overlay' }>) => (a.with === 'alphafold' ? 'the AlphaFold model' : a.with);

const residuesLabel = (a: Extract<ChatAction, { kind: 'select' }>) =>
  a.wholeChain
    ? `chain ${a.chain}`
    : `${a.chain ? `${a.chain}:` : ''}${a.name ? a.name[0] + a.name.slice(1).toLowerCase() : ''}${a.from}${a.to !== a.from ? `–${a.to}` : ''}`;

/** What a finished action did, as the chat reports it. */
export const describeAction = (a: ChatAction): string => {
  switch (a.kind) {
    case 'shape': return `Shape: ${SHAPE_NAME[a.shape]}`;
    case 'colour': return `Colour: ${COLOUR_NAME[a.colouring]}`;
    case 'opacity': return `Opacity: ${a.opacity}%`;
    case 'part': return `${PART_NAME[a.part]} ${a.shown ? 'shown' : 'hidden'}`;
    case 'chain': return `Chain ${a.chain} ${a.shown ? 'shown' : 'hidden'}`;
    case 'tool':
      return a.tool === 'similar' ? 'Searching for similar structures'
        : a.tool === 'partners' ? 'Looking up interaction partners'
        : a.tool === 'cofold' ? 'Co-fold form opened'
        : a.tool === 'alphafold' ? 'AlphaFold model opened'
        : a.tool === 'pae' ? 'Confidence map opened'
        : `${TOOL_NAME[a.tool]} opened`;
    case 'overlay': return `Overlay: ${overlayLabel(a)}`;
    case 'close-tool': return 'Tool closed';
    case 'reset': return 'View reset';
    case 'select': return `Selected ${residuesLabel(a)}`;
    case 'clear-selection': return 'Selection cleared';
    case 'inspector': return a.open ? 'Inspector opened' : 'Inspector closed';
    case 'theme': return `Theme: ${a.name}`;
    case 'tour': return a.play ? 'Tour started' : 'Tour stopped';
    case 'picture': return 'Picture saved';
  }
};

/** What an action that couldn't run set out to do ("open Pockets"). */
const intent = (a: ChatAction): string => {
  switch (a.kind) {
    case 'shape': return `switch to ${SHAPE_NAME[a.shape]}`;
    case 'colour': return `colour by ${COLOUR_NAME[a.colouring]}`;
    case 'opacity': return 'change the opacity';
    case 'part': return `${a.shown ? 'show' : 'hide'} ${PART_NAME[a.part].toLowerCase()}`;
    case 'chain': return `${a.shown ? 'show' : 'hide'} chain ${a.chain}`;
    case 'tool':
      return a.tool === 'similar' ? 'search for similar structures'
        : a.tool === 'partners' ? 'look up interaction partners'
        : `open ${TOOL_NAME[a.tool]}`;
    case 'overlay': return `lay ${overlayLabel(a)} over this structure`;
    case 'close-tool': return 'close the tool';
    case 'reset': return 'reset the view';
    case 'select': return `select ${residuesLabel(a)}`;
    case 'clear-selection': return 'clear the selection';
    case 'inspector': return `${a.open ? 'open' : 'close'} the inspector`;
    case 'theme': return `switch to ${a.name}`;
    case 'tour': return `${a.play ? 'start' : 'stop'} the tour`;
    case 'picture': return 'save a picture';
  }
};

export const actionDone = (action: ChatAction, label = describeAction(action)): ActionResult => ({ action, label, ok: true });
export const actionFailed = (action: ChatAction, note: string): ActionResult => ({ action, label: `Couldn't ${intent(action)}`, ok: false, note });
export const actionPlanned = (action: ChatAction): ActionResult => ({ action, label: describeAction(action), ok: true, pending: true });

// --- ACTIONS IN AN AI ANSWER ---

const SHAPES: Record<string, Shape> = { cartoon: 'cartoon', stick: 'stick', sticks: 'stick', wireframe: 'stick', sphere: 'sphere', spheres: 'sphere', spacefill: 'sphere', surface: 'surface' };
const COLOURINGS: Record<string, Colouring> = { element: 'element', chain: 'chain', rainbow: 'rainbow', hydrophobicity: 'hydrophobicity', residue: 'residue', confidence: 'confidence' };
const PARTS: Record<string, Part> = { highlights: 'highlights', ligands: 'ligands', substrates: 'substrates', metals: 'metals', waters: 'waters' };
// The tools an answer may open (never Co-fold)
const ANSWER_TOOLS: Record<string, Tool> = {
  pockets: 'pockets', interactions: 'interactions', variants: 'pathogenicity', pathogenicity: 'pathogenicity', similar: 'similar', partners: 'partners', alphafold: 'alphafold',
};
const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);
const PDB_ID = /^[1-9][a-z0-9]{3}$/i;

/** One of an answer's actions ("shape:surface", "hide:waters", "tool:pockets"...) as something to run; null if it isn't one. */
export const actionFromId = (id: string): ChatAction | null => {
  const m = /^([a-z-]+)(?::([a-z0-9-]+))?$/.exec(id.trim().toLowerCase());
  if (!m) return null;
  const [, verb, arg = ''] = m;
  switch (verb) {
    case 'shape': { const shape = own(SHAPES, arg); return shape ? { kind: 'shape', shape } : null; }
    case 'color':
    case 'colour': { const colouring = own(COLOURINGS, arg); return colouring ? { kind: 'colour', colouring } : null; }
    case 'opacity': return /^\d{1,3}$/.test(arg) ? { kind: 'opacity', opacity: Math.min(100, Number(arg)) } : null;
    case 'show':
    case 'hide': { const part = own(PARTS, arg); return part ? { kind: 'part', part, shown: verb === 'show' } : null; }
    case 'tool': { const tool = own(ANSWER_TOOLS, arg); return tool ? { kind: 'tool', tool } : null; }
    case 'overlay': return arg === 'alphafold' ? { kind: 'overlay', with: 'alphafold' } : PDB_ID.test(arg) ? { kind: 'overlay', with: arg.toUpperCase() } : null;
    case 'reset':
    case 'reset-view': return arg ? null : { kind: 'reset' };
    case 'tour': return !arg || arg === 'play' ? { kind: 'tour', play: true } : null;
    default: return null;
  }
};

/** The canonical form of an action an answer may carry; null for the ones only the user can ask for. */
export const actionToId = (a: ChatAction): string | null => {
  switch (a.kind) {
    case 'shape': return `shape:${a.shape === 'stick' ? 'sticks' : a.shape === 'sphere' ? 'spheres' : a.shape}`;
    case 'colour': return `color:${a.colouring}`;
    case 'opacity': return `opacity:${a.opacity}`;
    case 'part': return `${a.shown ? 'show' : 'hide'}:${a.part}`;
    case 'tool': return a.tool === 'cofold' || a.tool === 'overlay' ? null : `tool:${a.tool === 'pathogenicity' ? 'variants' : a.tool}`;
    case 'overlay': return `overlay:${a.with === 'alphafold' ? 'alphafold' : a.with.toLowerCase()}`;
    case 'reset': return 'reset-view';
    case 'tour': return a.play ? 'tour:play' : null;
    default: return null;
  }
};

const MAX_ANSWER_ACTIONS = 6;
/** The setting an action changes: one shape, one colouring, one opacity, one tool (an overlay is one) per answer. */
const settingOf = (id: string) => (id.startsWith('show:') || id.startsWith('hide:') ? `part:${id.slice(5)}` : id.startsWith('overlay:') ? 'tool' : id.split(':')[0]);

/** An answer's "actions", kept only when well-formed: canonical, one per setting (the last asked for wins), at most six. */
export const normalizeActionIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw.slice(0, 20)) {
    if (typeof item !== 'string' || item.length > 40) continue;
    const action = actionFromId(item);
    const id = action ? actionToId(action) : null;
    if (!id) continue;
    const same = ids.findIndex(x => settingOf(x) === settingOf(id));
    if (same >= 0) ids.splice(same, 1);
    ids.push(id);
  }
  return ids.slice(0, MAX_ANSWER_ACTIONS);
};

// --- PLAIN REQUESTS (no AI) ---
// A message is a command only when every word in it is part of one: "please make it a surface and
// colour it by chain" is two actions, "show me haemoglobin as a surface" is a question for the AI
// (which can still return the surface as an action). Anything unrecognised goes to the AI.

export interface ThemeChoice { id: string; name: string; colorScheme: 'light' | 'dark' }

type Entry =
  | { t: 'filler' }
  | { t: 'verb'; shown: boolean } // show / hide, for the targets that follow
  | { t: 'negate' } // "don't show"
  | { t: 'colourword' }
  | { t: 'shape'; shape: Shape }
  | { t: 'colour'; colouring: Colouring; needsColourWord?: boolean }
  | { t: 'part'; part: Part }
  | { t: 'chainword' } // "chain B" (a layer) or "by chain" (a colouring)
  | { t: 'tool'; tool: Tool }
  | { t: 'overlay' } // what to lay over may follow ("overlay 1AKE", "superpose the AlphaFold model")
  | { t: 'reset' }
  | { t: 'select' } // the residues follow
  | { t: 'centre' } // "centre on A:25" selects, "centre" alone resets
  | { t: 'clear-selection' }
  | { t: 'clear' }
  | { t: 'selection' }
  | { t: 'opacity' } // "opacity 40"
  | { t: 'transparency' } // "transparency 60" (opacity 40)
  | { t: 'set-opacity'; opacity: number } // "transparent", "opaque"
  | { t: 'onoff'; shown: boolean } // "ligands off"
  | { t: 'inspector' }
  | { t: 'tour' }
  | { t: 'save' } // "save", "download": a picture may follow
  | { t: 'picture'; standalone?: boolean }; // "screenshot" asks by itself; "picture" needs "save" ("show me a picture of..." is a question)

const TABLE = new Map<string, Entry>();
const add = (phrases: string, entry: Entry) => phrases.split('|').forEach(p => TABLE.set(p, entry));

add('please|pls|plz|can|could|would|will|you|u|me|us|i|we|it|its|this|that|these|those|to|into|as|by|and|then|also|plus|with|of|for|now|just|' +
  'change|set|make|use|apply|give|put|render|draw|view|style|shape|shapes|representation|rep|look|looks|mode|theme|appearance|ok|okay|hey|hi|yo|' +
  'lets|let|want|wanna|need|like|prefer|instead|again|back|kindly|thanks|thank|some|bit|little|protein|structure|molecule|model|current|' +
  'currently|find|search|predict|compute|calculate|get|fetch|see|percent|%|in|at|the|a|an|go ahead|switch|turn|everything|camera|from', { t: 'filler' });
add('show|display|open|enable|activate|unhide|reveal|start|play|begin|run|launch|turn on|switch on|bring up|pull up|bring back|visible|add', { t: 'verb', shown: true });
add('hide|remove|disable|deactivate|close|exit|quit|stop|end|turn off|switch off|without|no|invisible|get rid of|take away|drop', { t: 'verb', shown: false });
add('dont|do not|not|never', { t: 'negate' });
add('colour|paint|painted|tint|scheme', { t: 'colourword' });

add('cartoon|cartoons|ribbon|ribbons', { t: 'shape', shape: 'cartoon' });
add('stick|sticks|wireframe|wire|wires|licorice|liquorice|ball stick|balls sticks|ball and stick|balls and sticks|ball-and-stick', { t: 'shape', shape: 'stick' });
add('sphere|spheres|spacefill|space fill|space filling|space-fill|space-filling|spacefilling|vdw|van der waals', { t: 'shape', shape: 'sphere' });
add('surface|surfaces|molecular surface|solvent surface', { t: 'shape', shape: 'surface' });

add('rainbow|spectrum|n to c|n-to-c', { t: 'colour', colouring: 'rainbow' });
add('element|elements|cpk|atom type|atom types|default colour|normal colour', { t: 'colour', colouring: 'element' });
add('hydrophobicity|hydrophobic|hydrophobics|polarity', { t: 'colour', colouring: 'hydrophobicity' });
add('residue type|residue types|amino acid|amino acids|amino acid type', { t: 'colour', colouring: 'residue' });
add('residue|residues', { t: 'colour', colouring: 'residue', needsColourWord: true });
add('confidence|plddt|model confidence', { t: 'colour', colouring: 'confidence' });
add('chain|chains', { t: 'chainword' });

add('highlights|highlight|highlighted|marks|markers|marked parts', { t: 'part', part: 'highlights' });
add('ligands|ligand|drugs|drug|inhibitor|inhibitors|small molecules|small molecule', { t: 'part', part: 'ligands' });
add('substrates|substrate', { t: 'part', part: 'substrates' });
add('metals|metal|ions|ion|metal ions|metals and ions', { t: 'part', part: 'metals' });
add('water|waters|solvent|hoh|water molecules', { t: 'part', part: 'waters' });

add('pockets|pocket|pocket radar|binding pockets|cavities|cavity|p2rank|prankweb', { t: 'tool', tool: 'pockets' });
add('interactions|interaction|contacts|ligand interactions|plip', { t: 'tool', tool: 'interactions' });
add('variant lens|variants|variant|pathogenicity|alphamissense|missense|lens', { t: 'tool', tool: 'pathogenicity' });
add('overlay|superpose|superimpose|superposition|align|lay over', { t: 'overlay' });
add('similar|similar structures|similar proteins|similar folds|foldseek|lookalikes|look-alikes', { t: 'tool', tool: 'similar' });
add('partners|interaction partners|binding partners|string|string partners|protein partners', { t: 'tool', tool: 'partners' });
add('alphafold|alpha fold|alphafold model|af model|alphafold prediction', { t: 'tool', tool: 'alphafold' });
add('cofold|co-fold|co fold|cofold form', { t: 'tool', tool: 'cofold' });
add('confidence map|confidence maps|pae|pae map|pae plot|predicted aligned error|aligned error|error map', { t: 'tool', tool: 'pae' });

add('reset|reset view|reset camera|recentre|re-centre|zoom out|fit|fit to screen|whole|entire|full|home|default view', { t: 'reset' });
add('centre', { t: 'centre' });
add('select|go|jump|focus|zoom|zoom in|zoom to|zoom in on|go to|jump to|take me to', { t: 'select' });
add('deselect|unselect|select none|clear selection|clear the selection', { t: 'clear-selection' });
add('clear', { t: 'clear' });
add('selection|selections', { t: 'selection' });

add('opacity', { t: 'opacity' });
add('transparency', { t: 'transparency' });
add('transparent|translucent|see through|see-through|seethrough|semi transparent|semi-transparent|ghost|ghostly|faded|fade|dim|dimmed', { t: 'set-opacity', opacity: 40 });
add('opaque|solid|fully opaque|full opacity|no transparency', { t: 'set-opacity', opacity: 100 });
add('on', { t: 'onoff', shown: true });
add('off', { t: 'onoff', shown: false });

add('inspector|side panel|inspector panel', { t: 'inspector' });
add('tour|cinematic tour|guided tour|walkthrough|walk through', { t: 'tour' });
add('save|download|export|capture|grab|snap|take', { t: 'save' });
add('picture|pictures|image|images|png|photo|photos|pic|pics', { t: 'picture' });
add('screenshot|screenshots|snapshot|snapshots|screen shot|screen capture|screengrab|screen grab', { t: 'picture', standalone: true });

// Words skipped between "select" and the residues it names ("select residue 25", "focus on A:25")
const SPEC_SKIP = new Set(['on', 'residue', 'residues', 'res', 'at', 'the', 'to', 'number', 'no']);
// ...and between "overlay" and what to lay over ("overlay it with 1AKE", "superpose the AlphaFold model")
const OVERLAY_SKIP = new Set(['with', 'onto', 'on', 'to', 'over', 'the', 'its', 'it', 'this', 'pdb', 'entry', 'structure', 'against']);

const tokenize = (text: string) =>
  text.toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\bcolou?r(?:s|ed|ing)?\b/g, 'colour')
    .replace(/\bcent(?:er|re)(?:ed|s)?\b/g, 'centre')
    .replace(/\bn(?:[\s-]*termin(?:us|al))?\s+to\s+(?:the\s+)?c(?:[\s-]*termin(?:us|al))?\b/g, 'n-to-c') // "from the N to the C terminus"
    .replace(/[,;!?&+()"]|\.(?=\s|$)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * A plain request to change the view, open a tool, select residues, switch theme or play the tour,
 * as actions to run without the AI; null when the message is anything else.
 */
export const parseChatCommand = (text: string, themes: ThemeChoice[] = []): ChatAction[] | null => {
  if (text.length > 160) return null; // Long messages are questions
  const tokens = tokenize(text);
  if (tokens.length === 0 || tokens.length > 24) return null;
  const mentionsColour = tokens.includes('colour');
  const mentionsTheme = tokens.some(t => t === 'theme' || t === 'mode' || t === 'appearance');
  const saidMe = tokens.includes('me') || tokens.includes('us');

  const actions: ChatAction[] = [];
  let verb: boolean | null = null; // show (true) or hide (false), for visibility targets that follow
  let fresh = false; // The verb came right before this target (only then does "remove" apply to a shape)
  let negate = false;
  let pendingNumber: number | null = null; // "50% opacity": the number came first
  let awaiting: 'opacity' | 'transparency' | null = null; // "opacity 50": the number follows
  let clearing = false;
  let saving = false; // "save" / "download": what to save follows

  const entryAt = (i: number): [Entry, number] | null => {
    for (let n = Math.min(4, tokens.length - i); n >= 1; n--) {
      const entry = TABLE.get(tokens.slice(i, i + n).join(' '));
      if (entry) return [entry, n];
    }
    return null;
  };
  // A visibility target without a verb may take one after it: "ligands off"
  const shownFor = (next: number): [boolean, number] | null => {
    if (verb !== null) return [verb, 0];
    const after = entryAt(next);
    return after && after[0].t === 'onoff' ? [after[0].shown, after[1]] : null;
  };
  // "select A:25", "go to Asp25", "zoom to 25-40", "select chain B"
  const residuesAt = (start: number): [ChatAction, number] | null => {
    let i = start;
    while (i < tokens.length && SPEC_SKIP.has(tokens[i])) i++;
    if (tokens[i] === 'chain' && /^[a-z0-9]$/.test(tokens[i + 1] ?? '')) {
      const next = residuesAt(i + 2); // "chain A residue 25"
      if (next && next[0].kind === 'select' && !next[0].chain) {
        return [{ ...next[0], chain: tokens[i + 1].toUpperCase() }, next[1]];
      }
      return [{ kind: 'select', chain: tokens[i + 1].toUpperCase(), from: -99999, to: 99999, wholeChain: true }, i + 2];
    }
    for (const n of [2, 1]) {
      const words = tokens.slice(i, i + n);
      if (words.length < n) continue;
      for (const spec of n === 2 ? [words.join(''), words.join(' ')] : [words[0]]) {
        const parsed = parseResidueQuery(spec);
        if (parsed && (!parsed.chain || /^[a-z0-9]$/i.test(parsed.chain))) {
          return [{ kind: 'select', ...(parsed.chain ? { chain: parsed.chain.toUpperCase() } : {}), from: parsed.from, to: parsed.to, ...(parsed.name ? { name: parsed.name } : {}) }, i + n];
        }
      }
    }
    return null;
  };
  // "1AKE" or the AlphaFold model, after "overlay"
  const overlayTargetAt = (start: number): [string, number] | null => {
    let i = start;
    while (i < tokens.length && OVERLAY_SKIP.has(tokens[i])) i++;
    if (PDB_ID.test(tokens[i] ?? '')) return [tokens[i].toUpperCase(), i + 1];
    const words = tokens[i] === 'alphafold' || tokens[i] === 'af' ? 1 : tokens[i] === 'alpha' && tokens[i + 1] === 'fold' ? 2 : 0;
    if (words === 0) return null;
    i += words;
    if (tokens[i] === 'model' || tokens[i] === 'prediction') i++;
    return ['alphafold', i];
  };

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const found = entryAt(i);

    if (!found) {
      const number = /^(\d{1,3})%?$/.exec(token);
      if (number) {
        const value = Math.min(100, Number(number[1]));
        if (awaiting) {
          actions.push({ kind: 'opacity', opacity: awaiting === 'opacity' ? value : 100 - value });
          awaiting = null;
        } else if (pendingNumber === null) {
          pendingNumber = value;
        } else return null;
        i++;
        continue;
      }
      // "paper theme", "dark mode"
      const theme = mentionsTheme
        ? themes.find(t => t.id === token || t.name.toLowerCase() === token)
          ?? (token === 'light' || token === 'dark' ? themes.find(t => t.colorScheme === token) : undefined)
        : undefined;
      if (theme) {
        actions.push({ kind: 'theme', theme: theme.id, name: theme.name });
        i++;
        continue;
      }
      return null; // A word that isn't part of any command: a question for the AI
    }

    const [entry, length] = found;
    let next = i + length;
    switch (entry.t) {
      case 'filler':
      case 'colourword':
        break;
      case 'verb':
        verb = negate ? !entry.shown : entry.shown;
        negate = false;
        fresh = true;
        i = next;
        continue;
      case 'negate':
        negate = true;
        i = next;
        continue;
      case 'shape':
        if (fresh && verb === false) {
          if (entry.shape === 'cartoon') return null; // "remove the cartoon"
          actions.push({ kind: 'shape', shape: 'cartoon' }); // "remove the surface"
        } else actions.push({ kind: 'shape', shape: entry.shape });
        break;
      case 'colour':
        if (entry.needsColourWord && !mentionsColour) return null; // "hydrophobic residues" is a question
        actions.push({ kind: 'colour', colouring: fresh && verb === false ? 'element' : entry.colouring });
        break;
      case 'chainword': {
        const ids: string[] = [];
        const isId = (t?: string) => /^[a-z0-9]$/.test(t ?? '');
        while (isId(tokens[next]) && ids.length < 8) {
          ids.push(tokens[next++].toUpperCase());
          if (tokens[next] === 'and' && isId(tokens[next + 1])) next++; // "chains B and C"
        }
        if (ids.length === 0) {
          if (!mentionsColour) return null;
          actions.push({ kind: 'colour', colouring: 'chain' });
          break;
        }
        const shown = shownFor(next);
        if (!shown) return null;
        next += shown[1];
        ids.forEach(chain => actions.push({ kind: 'chain', chain, shown: shown[0] }));
        break;
      }
      case 'part': {
        const shown = shownFor(next);
        if (!shown || (saidMe && shown[0])) return null; // "show me the ligands" is a question about them
        next += shown[1];
        actions.push({ kind: 'part', part: entry.part, shown: shown[0] });
        break;
      }
      case 'tool':
        if (verb === false) {
          if (!actions.some(a => a.kind === 'close-tool')) actions.push({ kind: 'close-tool' });
        } else actions.push({ kind: 'tool', tool: entry.tool });
        break;
      case 'overlay': {
        // Something named is always laid over ("remove the surface and overlay 1AKE"); otherwise
        // "close overlay" closes it and "overlay" alone opens the picker
        const target = overlayTargetAt(next);
        if (target) {
          actions.push({ kind: 'overlay', with: target[0] });
          next = target[1];
        } else if (verb === false) {
          if (!actions.some(a => a.kind === 'close-tool')) actions.push({ kind: 'close-tool' });
        } else actions.push({ kind: 'tool', tool: 'overlay' });
        break;
      }
      case 'reset':
        actions.push({ kind: 'reset' });
        break;
      case 'select':
      case 'centre': {
        const picked = residuesAt(next);
        if (picked) {
          actions.push(picked[0]);
          next = picked[1];
        } else if (entry.t === 'centre') actions.push({ kind: 'reset' });
        else return null; // "zoom in", "go back": not a place we can go to
        break;
      }
      case 'clear-selection':
        actions.push({ kind: 'clear-selection' });
        break;
      case 'clear':
        clearing = true;
        break;
      case 'selection':
        if (!clearing) return null;
        actions.push({ kind: 'clear-selection' });
        clearing = false;
        break;
      case 'opacity':
      case 'transparency':
        if (pendingNumber !== null) {
          actions.push({ kind: 'opacity', opacity: entry.t === 'opacity' ? pendingNumber : 100 - pendingNumber });
          pendingNumber = null;
        } else awaiting = entry.t;
        break;
      case 'set-opacity':
        if (pendingNumber !== null && entry.opacity < 100) {
          actions.push({ kind: 'opacity', opacity: 100 - pendingNumber }); // "70% transparent"
          pendingNumber = null;
        } else actions.push({ kind: 'opacity', opacity: entry.opacity });
        break;
      case 'onoff':
        return null; // "on"/"off" with nothing to switch
      case 'inspector':
        actions.push({ kind: 'inspector', open: verb !== false });
        break;
      case 'tour':
        actions.push({ kind: 'tour', play: verb !== false });
        break;
      case 'save':
        saving = true;
        break;
      case 'picture':
        if (!saving && !entry.standalone) return null;
        if (!actions.some(a => a.kind === 'picture')) actions.push({ kind: 'picture' });
        saving = false;
        break;
    }
    if (entry.t !== 'filler' && entry.t !== 'colourword') fresh = false;
    i = next;
  }

  if (pendingNumber !== null || awaiting || clearing || negate || saving || actions.length === 0 || actions.length > 8) return null;
  return actions;
};
