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
    case 'chains': return `chains:${a.only.join(',') || 'all'}`;
    case 'spin': return `spin:${a.on ? 'on' : 'off'}`;
    case 'open': return `open:${a.id}`;
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
  ['give me a tour of this protein', 'tour:play'],
  ['a tour of the whole structure', 'tour:play'],
  ['tour it again', 'tour:play'],
  ['walkthrough', 'tour:play'],
  ['play the tour and hide the waters', 'tour:play hide:waters'],
  ['hide the inspector', 'inspector:false'],
  ['open the inspector', 'inspector:true'],
  // Only some chains, spin, zoom
  ['show only chain A', 'chains:A'],
  ['hide everything except chain B', 'chains:B'],
  ['isolate chain A', 'chains:A'],
  ['just chains A and B', 'chains:A,B'],
  ['show all chains', 'chains:all'],
  ['spin', 'spin:on'],
  ['rotate it', 'spin:on'],
  ['turn it around', 'spin:on'],
  ['stop spinning', 'spin:off'],
  ['zoom in', 'zoom'],
  ['make it bigger', 'zoom'],
  ['hide all ligands', 'hide:ligands'],
  // An entry by its ID, the file, a link, a fresh chat
  ['open 4HHB', 'open:4HHB'],
  ['load 1hsg', 'open:1HSG'],
  ['1hsg', 'open:1HSG'],
  ['show me 1hsg as a surface', 'open:1HSG shape:surface'],
  ['download the structure', 'download'],
  ['save the pdb file', 'download'],
  ['save a picture of the structure', 'picture'],
  ['share this', 'share'],
  ['copy the link', 'share'],
  ['clear chat', 'clear-chat'],
  ['start over', 'clear-chat'],
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
  // A tour of named parts: the AI writes a tour of just those (a plain "tour" would cover the whole structure)
  'tour of the heme pocket',
  'tour the pockets',
  'play the tour of chain A',
  'start the tour of the ligands',
  'walk through the active site',
  'guided tour of residues 20 to 40',
  'tour of the highlighted parts',
  // Isolating a part, zooming to one, IDs that are numbers, files without "save"
  'show just the ligand',
  'show only the ligands',
  'isolate the heme',
  'zoom in on the ligand',
  'which chain is bigger?',
  'opacity 1000',
  'what is in the pdb file?',
  'only chain',
  'show me 1hsg and explain it',
];
for (const text of QUESTIONS) {
  const got = parse(text);
  check(`"${text}" is a question`, got === null, got === null ? '' : `parsed as ${got}`);
}

console.log('== Questions that ask for a tour (its answer\'s tour starts by itself)');
for (const text of [
  'explain me this protein like a journey',
  'walk me through the active site',
  'a walk-through of the binding site',
  'take me through how it binds oxygen',
  'lead us through the mechanism',
  'explain it step by step',
  'step-by-step explanation of the mechanism',
  'give me a guided tour of the heme pocket',
  'tell the story of this enzyme',
  'show me around',
  'Tour of only these parts',
]) check(`"${text}" asks for a tour`, A.asksForTour(text) === true);
for (const text of [
  'explain the active site',
  'what does this protein do',
  'show me the ligands',
  'the contour of its surface',
  'a detour through the literature',
]) check(`"${text}" does not`, A.asksForTour(text) === false);

console.log('== What Argus can\'t do is said, not skipped');
const cant = (text) => A.unsupportedAsks(text).map(r => `${r.label}${r.ok ? '' : ' x'}`).join(' | ');
for (const [text, want] of [
  ['colour the zinc ions red', "Couldn't colour it red x"],
  ['make it blue', "Couldn't colour it blue x"],
  ['make the ligand green please', "Couldn't colour it green x"],
  ['highlight the heme in yellow', "Couldn't colour it yellow x"],
  ['show labels', "Couldn't show labels x"],
  ['label the active site residues', "Couldn't show labels x"],
  ['color chain A orange and add labels', "Couldn't colour it orange x | Couldn't show labels x"],
]) check(`"${text}" -> ${want}`, cant(text) === want, cant(text));
for (const text of ['why is blood red?', 'colour by chain', 'what does this label mean?', 'show me the green fluorescent protein', 'explain the active site'])
  check(`"${text}" asks for nothing Argus can't do`, cant(text) === '', cant(text));
check('a reason comes with it', /colourings are by element, chain/.test(A.unsupportedAsks('make it blue')[0]?.note ?? ''));

console.log('== While a tour plays, short words steer it (no AI call)');
const CONTROLS = [
  ['pause', 'pause'], ['Pause the tour', 'pause'], ['wait', 'pause'], ['hold on', 'pause'],
  ['resume', 'resume'], ['continue', 'resume'], ['go on please', 'resume'],
  ['stop', 'stop'], ['Stop it!', 'stop'], ['stop the tour', 'stop'], ['enough', 'stop'],
  ['next', 'next'], ['next step please', 'next'], ['skip', 'next'],
  ['back', 'previous'], ['go back', 'previous'], ['previous step', 'previous'],
  ['again', 'repeat'], ['repeat that', 'repeat'],
  ['start over', 'restart'], ['replay', 'restart'], ['restart the tour', 'restart'],
  // The whole tour again is its first step, not the step on screen
  ['repeat the tour', 'restart'], ['play the tour again', 'restart'], ['can you repeat the tour', 'restart'], ['play it again', 'restart'], ['tour again', 'restart'],
  // ...while "once more" and "that step again" are the step on screen
  ['once more', 'repeat'], ['one more time', 'repeat'], ['show that again', 'repeat'], ['repeat the last step', 'repeat'], ['show that step again', 'repeat'],
  // New steps once it ends
  ['more', 'more'], ['give more tour of same', 'more'], ['more steps', 'more'], ['tell me more', 'more'], ['extend the tour', 'more'], ['next part of the tour', 'more'],
  ['continue the tour', 'resume'], ['keep going', 'resume'],
];
for (const [text, want] of CONTROLS) check(`"${text}" -> ${want}`, A.parseTourControl(text) === want, String(A.parseTourControl(text)));
const STEPS_NAMED = [['step 2', 1], ['go back to step two', 1], ['repeat step 3', 2], ['show me the third step', 2], ['Step 1 please', 0], ['play the tour from step 4', 3]];
for (const [text, index] of STEPS_NAMED) check(`"${text}" -> step index ${index}`, A.parseTourControl(text)?.step === index, JSON.stringify(A.parseTourControl(text)));
for (const text of ['pause the music and explain the active site', 'what happens next?', 'go back to hemoglobin', 'next, explain the heme', 'stop the bleeding', 'step 0', 'more transparent', 'what else does it bind?', ''])
  check(`"${text}" is not a tour control`, A.parseTourControl(text) === null, JSON.stringify(A.parseTourControl(text)));

console.log('== Outside a tour: the whole tour, the last one again, or more of it');
const show = (ask) => (ask ? `${ask.ask}${ask.from !== undefined ? ` from ${ask.from}` : ''}${ask.named ? ' (named)' : ''}` : 'none');
for (const [text, want] of [
  ['full tour', 'whole (named)'], ['give me a general tour', 'whole (named)'], ['a complete tour of this protein', 'whole (named)'], ['tour of the whole protein', 'whole (named)'],
  ['take me on a full tour', 'whole (named)'], ['overview tour', 'whole (named)'], ['walk me through the whole structure', 'whole (named)'],
  ['repeat the tour', 'replay (named)'], ['play the tour again', 'replay (named)'], ['show the tour again', 'replay (named)'], ['start the tour again', 'replay (named)'],
  ['go back to step 2', 'replay from 1 (named)'], ['repeat step two', 'replay from 1 (named)'], ['repeat the last step', 'replay from -1 (named)'], ['show that step again', 'replay from -1 (named)'],
  // Bare words: the tour only right after one (the app checks that)
  ['again', 'replay'], ['repeat it', 'replay'], ['one more time', 'replay'], ['play it again', 'replay'], ['from the beginning', 'replay'], ['start over', 'replay'],
  ['give more tour of same', 'more (named)'], ['more of the tour', 'more (named)'], ['give me more steps', 'more (named)'], ['continue the tour', 'more (named)'], ['next part of the tour', 'more (named)'], ['a longer tour', 'more (named)'],
  ['more', 'more'], ['tell me more', 'more'], ['continue', 'more'], ['keep going', 'more'], ['what else', 'more'],
]) check(`"${text}" -> ${want}`, show(A.parseTourAsk(text)) === want, show(A.parseTourAsk(text)));
// Questions and other requests stay what they were: a tour of named parts goes to the AI, "play the tour" is the plain command
for (const text of ['tour of the heme pocket', 'give me a tour', 'play the tour', 'tell me more about the heme', 'what else does it bind?', 'more transparent', 'next', 'repeat after me', 'again, what is the heme?'])
  check(`"${text}" is not a tour follow-up`, A.parseTourAsk(text) === null, show(A.parseTourAsk(text)));
check('a tour that starts at a step says so', A.describeAction({ kind: 'tour', play: true, from: 3 }) === 'Tour from step 4');

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
check('only some chains, spin, zoom in: answer actions', norm(['chains:A-B', 'spin:on', 'zoom:in']) === '["chains:a-b","spin:on","zoom:in"]', norm(['chains:A-B', 'spin:on', 'zoom:in']));
check('...every chain again, spin off', norm(['chains:all', 'spin:off']) === '["chains:all","spin:off"]', norm(['chains:all', 'spin:off']));
check('...junk chains dropped', norm(['chains:', 'chains:ab', 'chains:a-', 'zoom:out', 'spin:fast']) === '[]', norm(['chains:', 'chains:ab', 'chains:a-', 'zoom:out', 'spin:fast']));
check('opening, files, links and clearing the chat are the user\'s own', [{ kind: 'open', id: '4HHB' }, { kind: 'download' }, { kind: 'share' }, { kind: 'clear-chat' }].every(a => A.actionToId(a) === null));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
