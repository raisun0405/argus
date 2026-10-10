// The chat's plain requests for the confidence map, next to the ones it must not take over.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { parseChatCommand } = await import(`${ROOT_URL}services/chatActions.ts`);
const cases = [
  ['confidence map', '[{"kind":"tool","tool":"pae"}]'],
  ['show the PAE plot', '[{"kind":"tool","tool":"pae"}]'],
  ['open the predicted aligned error', '[{"kind":"tool","tool":"pae"}]'],
  ['pae', '[{"kind":"tool","tool":"pae"}]'],
  ['close the confidence map', '[{"kind":"close-tool"}]'],
  ['colour by confidence', '[{"kind":"colour","colouring":"confidence"}]'],
  ['model confidence', '[{"kind":"colour","colouring":"confidence"}]'],
  ['what does the confidence map say', 'null'],
  ['is the error map reliable here?', 'null'],
];
let failures = 0;
for (const [text, want] of cases) {
  const got = JSON.stringify(parseChatCommand(text));
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  "${text}" -> ${got}${ok ? '' : ` (wanted ${want})`}`);
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
