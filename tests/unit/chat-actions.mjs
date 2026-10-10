// services/chatActions.ts: plain requests the chat runs itself, and the actions an AI answer may carry.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const A = await import(`${ROOT_URL}services/chatActions.ts`);
const N = await import(`${ROOT_URL}services/normalizeAnalysis.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const THEMES = [
  { id: 'mono', name: 'Mono', colorScheme: 'dark' }, { id: 'crimson', name: 'Crimson', colorScheme: 'dark' }, { id: 'noir', name: 'Noir', colorScheme: 'dark' },
  { id: 'paper', name: 'Paper', colorScheme: 'light' }, { id: 'lime', name: 'Lime', colorScheme: 'light' }, { id: 'peach', name: 'Peach', colorScheme: 'light' },
];
// Actions as compact strings, for readable expectations
const short = (a) => {
  switch (a.kind) {
    case 'shape': return `shape:${a.shape}`;
    case 'colour': return `colour:${a.colouring}`;
    case 'opacity': return `opacity:${a.opacity}`;
    case 'part': return `${a.shown ? 'show' : 'hide'}:${a.part}`;
    case 'chain': return `${a.shown ? 'show' : 'hide'}:chain-${a.chain}`;
    case 'tool': return `tool:${a.tool}`;
    case 'overlay': return `overlay:${a.with}`;
    case 'select': return a.wholeChain ? `select:chain-${a.chain}` : `select:${a.chain ?? '*'}:${a.name ?? ''}${a.from}-${a.to}`;
    case 'inspector': return `inspector:${a.open}`;
    case 'theme': return `theme:${a.theme}`;
    case 'tour': return `tour:${a.play ? 'play' : 'stop'}`;
    default: return a.kind;
  }
};
const parse = (text) => { const r = A.parseChatCommand(text, THEMES); return r ? r.map(short).join(' ') : null; };

console.log('== Plain requests run without the AI');
const COMMANDS = [
  ['change shape to surface and color to rainbow', 'shape:surface colour:rainbow'],
  ['surface', 'shape:surface'],
  ['Surface please!', 'shape:surface'],
  ['make it a surface', 'shape:surface'],
  ['can you show it as sticks?', 'shape:stick'],
  ['wireframe', 'shape:stick'],
  ['ball and stick', 'shape:stick'],
  ['spacefill', 'shape:sphere'],
  ['cartoon view', 'shape:cartoon'],
  ['remove the surface', 'shape:cartoon'],
  ['colour by chain', 'colour:chain'],
  ['color by chain', 'colour:chain'],
  ['chain colours', 'colour:chain'],
  ['rainbow', 'colour:rainbow'],
  ['colour by element', 'colour:element'],
  ['colour by hydrophobicity', 'colour:hydrophobicity'],
  ['colour by residue type', 'colour:residue'],
  ['render it as a molecular surface coloured from the N to the C terminus', 'shape:surface colour:rainbow'],
  ['colour N-terminus to C-terminus', 'colour:rainbow'],
  ['colour by residue', 'colour:residue'],
  ['color by confidence', 'colour:confidence'],
  ['transparent surface', 'opacity:40 shape:surface'],
  ['opacity 50', 'opacity:50'],
  ['set opacity to 30%', 'opacity:30'],
  ['set opacity to 30 percent', 'opacity:30'],
  ['50% opacity', 'opacity:50'],
  ['transparency 70', 'opacity:30'],
  ['make it opaque', 'opacity:100'],
  ['hide ligands', 'hide:ligands'],
  ['show the ligands', 'show:ligands'],
  ['ligands off', 'hide:ligands'],
  ['ligands off and waters on', 'hide:ligands show:waters'],
  ['hide water', 'hide:waters'],
  ['no waters', 'hide:waters'],
  ["don't show metals", 'hide:metals'],
  ['turn off the highlights', 'hide:highlights'],
  ['hide ligands and waters', 'hide:ligands hide:waters'],
  ['hide ligands and make it a surface', 'hide:ligands shape:surface'],
  ['hide chain B', 'hide:chain-B'],
  ['hide chains B and C', 'hide:chain-B hide:chain-C'],
  ['show chain A', 'show:chain-A'],
  ['open pockets', 'tool:pockets'],
  ['find pockets', 'tool:pockets'],
  ['pocket radar', 'tool:pockets'],
  ['close pockets', 'close-tool'],
  ['show interactions', 'tool:interactions'],
  ['variant lens', 'tool:pathogenicity'],
  ['find similar structures', 'tool:similar'],
  ['interaction partners', 'tool:partners'],
  ['open the alphafold model', 'tool:alphafold'],
  ['co-fold', 'tool:cofold'],
  ['overlay 1ake', 'overlay:1AKE'],
  ['Overlay 1AKE.', 'overlay:1AKE'],
  ['overlay it with 1AKE', 'overlay:1AKE'],
  ['superpose 2hhb', 'overlay:2HHB'],
  ['align with 1ake', 'overlay:1AKE'],
  ['superimpose the alphafold model', 'overlay:alphafold'],
  ['overlay alphafold', 'overlay:alphafold'],
  ['overlay the alpha fold prediction', 'overlay:alphafold'],
  ['overlay', 'tool:overlay'],
  ['open overlay', 'tool:overlay'],
  ['close overlay', 'close-tool'],
  ['remove the overlay', 'close-tool'],
  ['remove the surface and overlay 1ake', 'shape:cartoon overlay:1AKE'],
  ['reset view', 'reset'],
  ['reset the camera', 'reset'],
  ['zoom out', 'reset'],
  ['center', 'reset'],
  ['show the whole structure', 'reset'],
  ['select A:25', 'select:A:25-25'],
  ['go to Asp25', 'select:*:ASP25-25'],
  ['zoom to 25-40', 'select:*:25-40'],
  ['focus on chain A residue 25', 'select:A:25-25'],
  ['center on b 92', 'select:B:92-92'],
  ['select chain B', 'select:chain-B'],
  ['clear selection', 'clear-selection'],
  ['clear the selection', 'clear-selection'],
  ['deselect', 'clear-selection'],
  ['paper theme', 'theme:paper'],
  ['switch to dark mode', 'theme:mono'],
  ['light theme', 'theme:paper'],
  ['play the tour', 'tour:play'],
  ['stop the tour', 'tour:stop'],
  ['hide the inspector', 'inspector:false'],
  ['open the inspector', 'inspector:true'],
];
for (const [text, want] of COMMANDS) {
  const got = parse(text);
  check(`"${text}"`, got === want, got === want ? '' : `got ${got}, want ${want}`);
}

console.log('== Questions still go to the AI');
const QUESTIONS = [
  'show me hemoglobin as a surface',
  'what is the surface area of insulin?',
  'where are the ligands',
  'show me the ligands',
  'hydrophobic residues',
  'explain the active site',
  'make it blue',
  'zoom in',
  'select the active site',
  'how does this protein bind zinc?',
  'surface residues near the pocket',
  'ligands',
  'chain',
  'opacity',
  'paper',
  'thanks',
  'show',
  'go back',
  'colour the flaps red',
  'where does this protein come from',
  'what pockets does it have and why do they matter for drug design in general',
  'how does 1ake differ from this one',
  'compare with 1ake',
  'overlay 1ake and explain the changes',
  'overlay something',
];
for (const text of QUESTIONS) {
  const got = parse(text);
  check(`"${text}" is a question`, got === null, got === null ? '' : `parsed as ${got}`);
}

console.log('== Receipts');
check('describe a shape', A.describeAction({ kind: 'shape', shape: 'surface' }) === 'Shape: surface');
check('describe a colouring', A.describeAction({ kind: 'colour', colouring: 'residue' }) === 'Colour: residue type');
check('describe hidden waters', A.describeAction({ kind: 'part', part: 'waters', shown: false }) === 'Waters hidden');
check('describe a selection by name', A.describeAction({ kind: 'select', chain: 'A', from: 25, to: 25, name: 'ASP' }) === 'Selected A:Asp25');
check('describe a whole chain', A.describeAction({ kind: 'select', chain: 'B', from: -99999, to: 99999, wholeChain: true }) === 'Selected chain B');
check('a failure says what it set out to do', A.actionFailed({ kind: 'tool', tool: 'pockets' }, 'not for this structure').label === "Couldn't open Pockets");
check('…and why', A.actionFailed({ kind: 'tool', tool: 'pockets' }, 'not for this structure').note === 'not for this structure');
check('describe an overlay', A.describeAction({ kind: 'overlay', with: '1AKE' }) === 'Overlay: 1AKE' && A.describeAction({ kind: 'overlay', with: 'alphafold' }) === 'Overlay: the AlphaFold model');
check('an overlay that failed says what it set out to do', A.actionFailed({ kind: 'overlay', with: '1LYZ' }, "1LYZ isn't the same protein").label === "Couldn't lay 1LYZ over this structure");

console.log('== Actions in an AI answer');
const norm = (raw) => JSON.stringify(A.normalizeActionIds(raw));
check('canonical ids', norm(['Shape:Surface', 'colour:chain', 'hide:waters']) === '["shape:surface","color:chain","hide:waters"]', norm(['Shape:Surface', 'colour:chain', 'hide:waters']));
check('plural and singular shapes agree', norm(['shape:stick', 'shape:spheres']) === '["shape:spheres"]', norm(['shape:stick', 'shape:spheres']));
check('one per setting, the last wins', norm(['color:chain', 'color:rainbow', 'opacity:20', 'opacity:80']) === '["color:rainbow","opacity:80"]', norm(['color:chain', 'color:rainbow', 'opacity:20', 'opacity:80']));
check('variants is Variant Lens', norm(['tool:variants']) === '["tool:variants"]');
check('Co-fold is never an answer action', norm(['tool:cofold']) === '[]');
check('junk dropped', norm(['explode', 'shape:', 'color:blue', 'opacity:-5', 42, null, { a: 1 }, 'tool:constructor', 'show:__proto__']) === '[]', norm(['explode', 'shape:', 'color:blue', 'opacity:-5', 42, null, { a: 1 }, 'tool:constructor', 'show:__proto__']));
check('opacity capped at 100', norm(['opacity:250']) === '["opacity:100"]', norm(['opacity:250']));
check('at most six', A.normalizeActionIds(['shape:surface', 'color:chain', 'opacity:50', 'hide:waters', 'hide:ligands', 'tool:pockets', 'reset-view', 'tour:play']).length === 6);
check('not a list: nothing', norm('shape:surface') === '[]');
const analysis = N.normalizeAnalysis({ pdbId: '4HHB', title: 't', summary: 's', highlights: [], actions: ['shape:surface', 'tool:cofold', 'bogus'] });
check('normalizeAnalysis keeps valid actions only', JSON.stringify(analysis.actions) === '["shape:surface"]', JSON.stringify(analysis.actions));
const plain = N.normalizeAnalysis({ pdbId: '4HHB', title: 't', summary: 's', highlights: [] });
check('…and adds no key when there are none', !('actions' in plain));
check('ids round-trip', ['shape:surface', 'color:rainbow', 'opacity:40', 'show:ligands', 'hide:waters', 'tool:pockets', 'tool:variants', 'reset-view', 'tour:play', 'overlay:1ake', 'overlay:alphafold'].every(id => A.actionToId(A.actionFromId(id)) === id));
check('an overlay: a PDB ID or the AlphaFold model, canonical', norm(['Overlay:1AKE']) === '["overlay:1ake"]' && norm(['overlay:alphafold']) === '["overlay:alphafold"]', norm(['Overlay:1AKE']));
check('...anything else dropped', norm(['overlay:12', 'overlay:abcde', 'overlay:0abc', 'overlay:', 'overlay:constructor']) === '[]', norm(['overlay:12', 'overlay:abcde', 'overlay:0abc', 'overlay:', 'overlay:constructor']));
check('...one tool per answer, an overlay counting as one (the last wins)', norm(['tool:pockets', 'overlay:1ake']) === '["overlay:1ake"]' && norm(['overlay:1ake', 'tool:interactions']) === '["tool:interactions"]', norm(['tool:pockets', 'overlay:1ake']));
check('"tool:overlay" (the picker) is not an answer action', norm(['tool:overlay']) === '[]');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
