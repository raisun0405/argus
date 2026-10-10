// The identity check in the chat, with the AI's answers scripted (live records for the check itself):
//  1. 2JDF called "Human Insulin Hexamer": the retry carries the correction, and the AI's fixed answer is
//     what the chat shows
//  2. the AI repeats the mistake: the heading becomes 2JDF's own title and the answer opens with the correction
//  3. a right answer: no retry at all
//   node cdp-identity.mjs [base]
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const WRONG = { pdbId: '2JDF', title: 'Human Insulin Hexamer', summary: 'This X-ray structure (1.8 Å) shows human insulin assembled as a hexamer with coordinated zinc ions, providing insight into its storage form.', highlights: [], measurements: [] };
const FIXED = { pdbId: '2JDF', title: 'Human gamma-B crystallin', summary: 'A lens protein that keeps the eye lens clear.', highlights: [], measurements: [] };
const RIGHT = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen in red blood cells.', highlights: [], measurements: [] };
let script = 'fixes';
const calls = [];
const answer = (query) => {
  calls.push(query);
  if (/hemoglobin/i.test(query)) return RIGHT;
  if (/\[Correction needed\]/.test(query)) return script === 'fixes' ? FIXED : WRONG;
  return WRONG;
};
const lastAnswer = `(() => { const m = [...document.querySelectorAll('[data-message="assistant"]')].at(-1); return (m?.textContent ?? '').replace(/\\s+/g, ' ').trim(); })()`;
const answers = `document.querySelectorAll('[data-message="assistant"]').length`;

const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);

  console.log('[1. a wrong protein, fixed on the retry]');
  await b.say('load any experimental structure');
  await b.waitFor(`${answers} >= 1`, 60000);
  await sleep(500);
  const retry = calls.find(q => /\[Correction needed\]/.test(q)) ?? '';
  check('the answer was sent back once, with what is wrong', calls.length === 2 && retry.includes('the answer calls 2JDF "Human Insulin Hexamer", but 2JDF is "Human gamma-B crystallin"'), retry.slice(retry.indexOf('[Correction'), retry.indexOf('[Correction') + 200));
  check('...asking it to describe 2JDF as it is or choose the entry it meant', retry.includes('Either describe 2JDF as the protein it really is'));
  const first = await b.ev(lastAnswer);
  check('the chat shows the fixed answer, with no correction note', first.includes('Human gamma-B crystallin') && first.includes('A lens protein') && !first.includes('insulin') && !first.includes('Correction:'), first.slice(0, 160));

  console.log('\n[2. the AI repeats the mistake]');
  script = 'repeats';
  calls.length = 0;
  await b.say('show me another experimental structure');
  await b.waitFor(`${answers} >= 2`, 60000);
  await sleep(500);
  const second = await b.ev(lastAnswer);
  check('one retry, then the heading is 2JDF\'s own title and the answer opens with the correction', calls.length === 2 && second.includes('Human gamma-B crystallin') && second.includes('Correction: 2JDF is "Human gamma-B crystallin", which isn\'t what this answer describes.') && !/Human Insulin Hexamer/.test(second), second.slice(0, 200));

  console.log('\n[3. a right answer]');
  calls.length = 0;
  await b.say('show me hemoglobin');
  await b.waitFor(`${answers} >= 3`, 60000);
  await sleep(500);
  check('no retry, the answer as written', calls.length === 1 && (await b.ev(lastAnswer)).includes('Human deoxyhemoglobin') && !(await b.ev(lastAnswer)).includes('Correction'), `${calls.length} call(s)`);
  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
