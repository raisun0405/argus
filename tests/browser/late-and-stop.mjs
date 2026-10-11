// An answer that lands after the user has moved on, and Stop on an investigation. Scripted answers, no AI calls.
//  1. Stop while the investigation is planning, or writing up: it stops at once, and the chat is free again
//  2. an answer that comes after the user opened another structure doesn't pull the view back: it waits
//     in the chat with an Open button
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

// /api/analyze: scripted, and the trypsin answer held until released
let releaseTrypsin = null;
const answer = (query, context) => {
  if (/trypsin/i.test(query)) return new Promise(resolve => { releaseTrypsin = () => resolve({ pdbId: '3PTB', title: 'Trypsin with benzamidine', summary: 'Trypsin cuts proteins after lysine and arginine.', highlights: [], measurements: [] }); });
  if (/insulin/i.test(query)) return { pdbId: '1TRZ', title: 'Human insulin', summary: 'Insulin is a small hormone made of two chains.', highlights: [], measurements: [] };
  return { pdbId: context?.pdbId ?? '1TRZ', title: 'Structure', summary: 'A short canned answer.', highlights: [], measurements: [] };
};
// /api/investigate: each stage answered as the test says, or held (never answered)
let investigate = { plan: 'hold', write: 'hold' };
const plan4hhb = { title: 'Human haemoglobin', structure: '4HHB', steps: [{ tool: 'facts', why: 'What is known about it' }] };
const onPaused = (params, send) => {
  const body = JSON.parse(params.request.postData ?? '{}');
  const how = investigate[body.stage];
  if (how === 'hold') return; // Never answered: the page's own Stop must end the wait
  const reply = how === 'plan' ? plan4hhb : { error: 'Model returned invalid JSON' };
  send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: how === 'plan' ? 200 : 502, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(reply)).toString('base64') });
};

const b = await launch({ width: 1440, height: 900, dpr: 1, answer, intercept: ['*/api/investigate*'], onPaused });
const card = `[...document.querySelectorAll('[data-investigation]')].at(-1)`;
const phase = `((${card})?.dataset.phase ?? null)`; // In brackets: "x ?? null === 'done'" reads as "x ?? (null === 'done')"
const structure = `document.querySelector('[data-structure-id]')?.textContent.trim()`;
const toolsOff = `[...document.querySelectorAll('button')].find(x => x.textContent.includes('Find similar'))?.disabled`;
const assistants = `document.querySelectorAll('[data-message="assistant"]').length`;
const ask = async (text, wait = true) => {
  const before = await b.ev(assistants);
  await b.say(text);
  if (wait) { await b.waitFor(`${assistants} > ${before}`, 30000); await sleep(800); }
};
const stopInvestigation = () => b.click(`[...(${card})?.querySelectorAll('button') ?? []].find(x => x.textContent.trim() === 'Stop')`);
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`${structure} === '1TRZ' && !!document.querySelector('textarea')`, 30000);
  await sleep(2500);

  console.log('[1. Stop on an investigation]');
  investigate = { plan: 'hold', write: 'hold' };
  await ask('investigate: what holds the two chains together?', false);
  await b.waitFor(`${phase} === 'planning'`, 10000);
  await sleep(1500);
  check('planning, and the chat is busy', (await b.ev(phase)) === 'planning' && (await b.ev(toolsOff)) === true, { phase: await b.ev(phase), toolsOff: await b.ev(toolsOff) });
  await stopInvestigation();
  check('Stop while planning stops it at once', (await b.waitFor(`${phase} === 'stopped'`, 2000)) >= 0, await b.ev(phase));
  check('...and frees the chat and the viewer\'s tools', (await b.waitFor(`${toolsOff} === false`, 2000)) >= 0, await b.ev(toolsOff));

  investigate = { plan: 'plan', write: 'hold' };
  await ask('investigate: what does haemoglobin do?', false);
  check('with a plan, the steps run, then the write-up is awaited', (await b.waitFor(`${phase} === 'writing'`, 45000)) >= 0, await b.ev(phase));
  await stopInvestigation();
  check('Stop while writing stops it at once', (await b.waitFor(`${phase} === 'stopped'`, 2000)) >= 0 && (await b.waitFor(`${toolsOff} === false`, 2000)) >= 0, { phase: await b.ev(phase), toolsOff: await b.ev(toolsOff) });

  console.log('[2. an answer that lands after the user has moved on]');
  investigate = { plan: 'plan', write: 'fail' }; // The step results stand in for the write-up
  await ask('investigate: what does haemoglobin do?', false);
  check('an investigation of 4HHB finishes, with 4HHB on screen', (await b.waitFor(`${phase} === 'done' && ${structure} === '4HHB'`, 45000)) >= 0, { phase: await b.ev(phase), structure: await b.ev(structure) });
  await ask('show me insulin');
  check('insulin opened', (await b.waitFor(`${structure} === '1TRZ'`, 15000)) >= 0, await b.ev(structure));
  const view4hhb = `[...(${card})?.querySelectorAll('button') ?? []].find(x => /View in 3D/.test(x.textContent))`;
  check('the investigation offers 4HHB again', !!(await b.ev(`!!${view4hhb}`)));
  await ask('tell me about trypsin', false);
  await b.waitFor(`!!document.querySelector('[data-chat-loader]')`, 5000);
  await b.click(view4hhb); // The user moves on while the answer is on its way
  check('the user opens 4HHB meanwhile', (await b.waitFor(`${structure} === '4HHB'`, 15000)) >= 0, await b.ev(structure));
  const before = await b.ev(assistants);
  releaseTrypsin?.();
  await b.waitFor(`${assistants} > ${before}`, 15000);
  await sleep(2500);
  check('the late answer about 3PTB does not pull the view away from 4HHB', (await b.ev(structure)) === '4HHB', await b.ev(structure));
  const open3ptb = `[...document.querySelectorAll('[data-held-back] button')].find(x => x.textContent.trim() === 'Open 3PTB')`;
  check('...it says so, with an Open button', !!(await b.ev(`!!${open3ptb}`)), await b.ev(`document.querySelector('[data-held-back]')?.textContent ?? null`));
  await b.click(open3ptb);
  check('Open brings 3PTB up', (await b.waitFor(`${structure} === '3PTB'`, 15000)) >= 0, await b.ev(structure));
  check('...and the note is gone', (await b.waitFor(`!document.querySelector('[data-held-back]')`, 3000)) >= 0);

  check('no page errors', b.problems.length === 0, b.problems);
} finally { b.close(); }
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
