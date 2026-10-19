// More that the chat does without the AI, and what it says when it can't. Scripted answers, no AI calls.
//  1. only some chains, all chains again; spin and stop; zoom in
//  2. the structure file and a link to this view; opening an entry by its ID, with a change asked with it
//  3. what Argus can't do ("colour the zinc ions red") is said under the answer; "show just the ligand"
//     goes to the AI; "clear chat" starts again
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const answer = (query, context) => {
  if (/zinc/i.test(query)) return { pdbId: context?.pdbId ?? '1TRZ', title: 'Human insulin', summary: 'Two zinc ions hold the insulin hexamer together.', highlights: [], measurements: [], actions: ['color:element', 'show:metals'] };
  return { pdbId: context?.pdbId ?? '1TRZ', title: 'Structure', summary: 'A short canned answer.', highlights: [], measurements: [] };
};
// An ID that is no entry: RCSB answers 404 for it here. A real unused ID can't be relied on: 9ZZZ itself
// was released in October 2026, and every four-character ID is being handed out
const MISSING = '9ZZZ';
const b = await launch({
  width: 1440, height: 900, dpr: 1, answer,
  intercept: [`*data.rcsb.org/rest/v1/core/entry/${MISSING}*`],
  onPaused: (p, send) => send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"status":404}').toString('base64') }),
});
const structure = `document.querySelector('[data-structure-id]')?.textContent.trim()`;
const receipts = `document.querySelectorAll('[data-action-receipt]').length`;
const lastItems = `[...([...document.querySelectorAll('[data-action-receipt]')].at(-1)?.querySelectorAll('li') ?? [])].map(li => li.dataset.actionState + ':' + li.textContent)`;
// A plain request: its receipt appears and settles
const command = async (text) => {
  const before = await b.ev(receipts);
  await b.say(text);
  await b.waitFor(`${receipts} > ${before} && ![...document.querySelectorAll('[data-action-receipt]')].at(-1).querySelector('[data-action-state=pending]')`, 30000);
  await sleep(400);
  return b.ev(lastItems);
};
const chainShown = (id) => `[...document.querySelectorAll('aside[aria-label=Inspector] button[aria-pressed]')].find(x => new RegExp('^(Hide|Show) ${id}\\\\b').test(x.getAttribute('aria-label') ?? ''))?.getAttribute('aria-pressed')`;
try {
  // Downloads are recorded, not saved
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__downloads = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return realClick.call(this); };` });
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`${structure} === '1TRZ' && !!document.querySelector('textarea')`, 30000);
  await sleep(3000);
  await b.click(`[...document.querySelectorAll('aside[aria-label=Inspector] button')].find(x => x.textContent.trim().startsWith('Layers'))`);
  await sleep(300);

  console.log('[1. only some chains, spin, zoom]');
  let items = await command('show only chain B');
  check('"show only chain B": the other chains go', JSON.stringify(items) === '["done:Only chain B shown"]' && (await b.ev(chainShown('B'))) === 'true', JSON.stringify(items));
  check('...A, C and D hidden', (await b.ev(`[${['A', 'C', 'D'].map(chainShown).join(',')}].every(v => v === 'false')`)) === true, await b.ev(`[${['A', 'B', 'C', 'D'].map(chainShown).join(',')}]`));
  items = await command('show all chains');
  check('"show all chains": every one back', JSON.stringify(items) === '["done:All chains shown"]' && (await b.ev(`[${['A', 'B', 'C', 'D'].map(chainShown).join(',')}].every(v => v === 'true')`)) === true, JSON.stringify(items));
  items = await command('hide everything except chain A');
  check('"hide everything except chain A"', JSON.stringify(items) === '["done:Only chain A shown"]' && (await b.ev(chainShown('B'))) === 'false', JSON.stringify(items));
  await command('show all chains');
  // The camera, read twice a moment apart: it moves while spinning, and holds still once stopped
  const turning = `(async () => { const a = JSON.stringify(window.__testViewer.getView()); await new Promise(r => setTimeout(r, 800)); return a !== JSON.stringify(window.__testViewer.getView()); })()`;
  items = await command('spin');
  check('"spin" starts it, and says how to stop', items.length === 1 && items[0].startsWith('done:Spinning') && /stop spinning/.test(items[0]), JSON.stringify(items));
  check('...the structure turns', (await b.ev(turning)) === true);
  items = await command('stop spinning');
  check('"stop spinning"', JSON.stringify(items) === '["done:Spin stopped"]', JSON.stringify(items));
  await sleep(300);
  check('...and it holds still', (await b.ev(turning)) === false);
  items = await command('zoom in');
  check('"zoom in"', JSON.stringify(items) === '["done:Zoomed in"]', JSON.stringify(items));

  console.log('[2. the file, a link, an entry by its ID]');
  items = await command('download the structure');
  check('"download the structure" saves its file', JSON.stringify(items) === '["done:Structure file saved"]' && (await b.ev(`window.__downloads.at(-1)`)) === 'argus-1trz.pdb', `${JSON.stringify(items)} ${await b.ev(`JSON.stringify(window.__downloads)`)}`);
  items = await command('share this');
  check('"share this" copies the link to this view', JSON.stringify(items) === '["done:Link to this view copied"]' && /#view=/.test(await b.ev(`window.__copied.at(-1) ?? ''`)), JSON.stringify(items));
  const calls = b.calls.length;
  items = await command('open 4HHB');
  check('"open 4HHB" opens it, under its title', items.length === 1 && /^done:Opened 4HHB: /.test(items[0]) && (await b.waitFor(`${structure} === '4HHB'`, 20000)) >= 0, `${JSON.stringify(items)} ${await b.ev(structure)}`);
  items = await command(`open ${MISSING}`); // No such entry (RCSB's 404 above)
  check('an ID that is no entry says so', items.length === 1 && items[0] === `failed:Couldn't open ${MISSING}: no PDB entry has that ID` && (await b.ev(structure)) === '4HHB', JSON.stringify(items));
  items = await command('show me 1hsg as a surface');
  const shape = await b.ev(`document.querySelector('[role=group][aria-label="Visual mode"] button[aria-pressed=true]')?.textContent.trim()`);
  check('"show me 1hsg as a surface": opened, then made a surface', (await b.ev(structure)) === '1HSG' && shape === 'Surface' && items.length === 2 && items[1] === 'done:Shape: surface', `${await b.ev(structure)} ${shape} ${JSON.stringify(items)}`);
  check('none of these asked the AI', b.calls.length === calls, b.calls.slice(calls));
  await command('cartoon');

  console.log('[3. what it can\'t do, isolating a part, a fresh chat]');
  const before = await b.ev(`document.querySelectorAll('[data-message="assistant"]').length`);
  await b.say('colour the zinc ions red');
  await b.waitFor(`document.querySelectorAll('[data-message="assistant"]').length > ${before} && ![...document.querySelectorAll('[data-action-receipt]')].at(-1)?.querySelector('[data-action-state=pending]')`, 30000);
  await sleep(1500);
  items = await b.ev(lastItems);
  check('the answer does what it can, and says what it can\'t', items.includes('done:Colour: element') && items.some(x => x.startsWith("failed:Couldn't colour it red: choosing colours isn't possible yet")), JSON.stringify(items));
  const asked = b.calls.length;
  await b.say('show just the ligand');
  for (let i = 0; i < 40 && b.calls.length === asked; i++) await sleep(250);
  check('"show just the ligand" goes to the AI (not "Ligands shown")', b.calls.length === asked + 1, b.calls.slice(asked));
  await sleep(2000);
  await b.say('clear chat');
  check('"clear chat" starts again', (await b.waitFor(`document.querySelectorAll('[data-message="user"]').length === 0`, 5000)) >= 0, await b.ev(`document.querySelectorAll('[data-message]').length`));
  check('...the structure stays', (await b.ev(structure)) === '1HSG', await b.ev(structure));

  check('no page errors', b.problems.length === 0, b.problems);
} finally { b.close(); }
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
