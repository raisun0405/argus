// The facts sent with a question about an experimental entry now say how much of each protein it holds.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { getStructureFacts } = await import(`${ROOT_URL}services/groundingService.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
for (const [id, want] of [['1TUP', 'this entry holds UniProt 94-289 of 393 (49%); not in it: 1-93, 290-393'], ['4HHB', 'this entry holds UniProt 2-142 of 142 (99%); not in it: 1'], ['1TRZ', 'this entry holds UniProt 25-54, 90-110 of 110 (46%); not in it: 1-24, 55-89']]) {
  const facts = (await getStructureFacts(id, 'what is this?', 20000)) ?? '';
  const line = facts.split('\n').find(l => l.includes('this entry holds')) ?? '(none)';
  check(`${id}: ${want}`, facts.replace(/–/g, '-').includes(want), line.trim());
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
