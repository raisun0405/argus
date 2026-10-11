import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { parseChatCommand } = await import(`${ROOT_URL}services/chatActions.ts`);
const kinds = t => { const r = parseChatCommand(t); return r ? r.map(a => a.kind + (a.part ? ':' + a.part : '') + (a.shown === false ? ':hide' : '')).join(',') : 'AI'; };
const cases = [
  ['save a picture', 'picture'], ['screenshot', 'picture'], ['take a screenshot', 'picture'], ['download image', 'picture'],
  ['export png', 'picture'], ['save a picture and reset view', 'picture,reset'], ['please save an image of this', 'picture'],
  ['show me a picture of haemoglobin', 'AI'], ['picture', 'AI'], ['save', 'AI'], ['download the structure', 'download'], ['save the pdb file', 'download'],
  ['what does this image show', 'AI'], ['take me to A:25', 'select'], ['take away the waters', 'part:waters:hide'], ['surface', 'shape'],
];
let failed = 0;
for (const [text, want] of cases) { const got = kinds(text); const ok = got === want; if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${text}" -> ${got}${ok ? '' : ` (wanted ${want})`}`); }
console.log(failed ? `${failed} FAILED` : 'ALL PASS');
