// A question about the residues selected in 3D ("what is this residue?") carries them to the AI, a
// new selection makes it a new question (never the cached answer about the last one), and with
// nothing selected nothing is sent. Scripted answers, no AI calls.
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const bodies = [];
const answer = (query, context, body) => {
  bodies.push(body);
  return { pdbId: context?.pdbId ?? '1TRZ', title: 'Human insulin', summary: 'A short canned answer about the structure on screen.', highlights: [], measurements: [] };
};
const assistants = `document.querySelectorAll('[data-message="assistant"]').length`;
const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
// A plain command ("select A:7"): its receipt appears, no AI call
const command = async (text) => {
  const before = await b.ev(assistants);
  await b.say(text);
  await b.waitFor(`${assistants} > ${before}`, 10000);
  await sleep(600);
};
const ask = async (text) => {
  const calls = bodies.length;
  const before = await b.ev(assistants);
  await b.say(text);
  await b.waitFor(`${assistants} > ${before}`, 30000);
  await sleep(600);
  return bodies.length > calls ? bodies.at(-1) : null;
};
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ' && !!document.querySelector('textarea')`, 30000);
  await sleep(2500);

  await command('select A:7');
  check('A:7 is selected', await b.ev(`/1 selected/.test(document.body.textContent)`));
  let sent = await ask('what is this residue?');
  check('the question goes to the AI with the selection', sent?.currentContext?.selection === 'A:Cys7', sent?.currentContext);

  await command('select A:6');
  sent = await ask('what is this residue?');
  check('another residue selected: the same words are a new question, sent with it', sent?.currentContext?.selection === 'A:Cys6', sent ? sent.currentContext : 'answered from the cache');

  await command('select A:6-11');
  sent = await ask('what do these residues do?');
  check('several residues go by name', sent?.currentContext?.selection === 'A:Cys6, A:Cys7, A:Thr8, A:Ser9, A:Ile10, A:Cys11', sent?.currentContext?.selection);

  await command('clear selection');
  sent = await ask('what is this residue?');
  check('nothing selected: nothing sent', sent !== null && !('selection' in (sent.currentContext ?? {})), sent ? sent.currentContext : 'answered from the cache');

  check('no page errors', b.problems.length === 0, b.problems);
} finally { b.close(); }
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
