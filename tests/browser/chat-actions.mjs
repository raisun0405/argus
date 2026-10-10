// The chat changes the workspace: plain requests run without the AI, an answer's actions run once its
// structure is on screen, and the receipt says what actually happened. /api/analyze is canned (no AI calls).
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-actions-${Date.now()}`, '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const problems = [];
const analyzeCalls = [];

// Canned answers, chosen by the question
const H = (chain, resi, label, category = 'binding_site') => ({ chain, resi, label, category });
const answerFor = (query, context) => {
  if (/hemoglobin as a surface/i.test(query)) {
    return { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen on four heme groups.', highlights: [H('A', [87], 'Proximal His87')], measurements: [], actions: ['shape:surface', 'color:chain', 'tool:cofold', 'bogus'] };
  }
  if (/fade the protein/i.test(query)) {
    return { pdbId: context?.pdbId ?? '4HHB', title: 'Human deoxyhemoglobin', summary: 'The proximal histidines hold the iron.', highlights: [H('A', [87], 'Proximal His87'), H('B', [92], 'Proximal His92')], measurements: [], actions: ['opacity:30'] };
  }
  if (/Generate a cinematic tour/i.test(query)) {
    return { pdbId: context?.pdbId ?? '4HHB', title: 'Human deoxyhemoglobin', summary: 'A short tour.', highlights: [H('A', [87], 'Proximal His87')], measurements: [],
      tour: [{ text: 'This is haemoglobin, four chains around four hemes, seen whole for a moment.', focus: [] }, { text: 'Here is the proximal histidine of chain A, holding the iron from below.', focus: [H('A', [87], 'His87')] }] };
  }
  return { pdbId: context?.pdbId ?? '1TRZ', title: 'Human insulin', summary: 'Insulin is a small hormone made of two chains.', highlights: [H('A', [6, 11], 'Intrachain Disulfide (A6-A11)', 'other')], measurements: [] };
};

ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Fetch.requestPaused') {
    const body = JSON.parse(m.params.request.postData ?? '{}');
    analyzeCalls.push(body.query);
    const answer = answerFor(body.query ?? '', body.currentContext);
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(answer)).toString('base64') });
  }
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r?.result?.value; };
const waitFor = async (expr, t = 20000) => { const s = Date.now(); while (Date.now() - s < t) { const v = await ev(expr); if (v && !String(v).startsWith('EXC')) return Date.now() - s; await sleep(200); } return -1; };
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const lastReceipt = `[...document.querySelectorAll('[data-action-receipt]')].pop()`;
const receiptItems = `[...((${lastReceipt})?.querySelectorAll('li') ?? [])].map(li => li.dataset.actionState + ':' + li.textContent)`;
const receiptDone = `!!(${lastReceipt}) && !(${lastReceipt}).querySelector('[data-action-state=pending]')`;
const shape = `document.querySelector('[role=group][aria-label="Visual mode"] button[aria-pressed=true]')?.textContent.trim()`;
const colouring = `document.querySelector('[role=combobox][aria-label="Colouring"]')?.dataset.value`;
const toggle = (label) => `[...document.querySelectorAll('aside[aria-label=Inspector] button[aria-pressed]')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.getAttribute('aria-pressed') === 'true'`;
const say = async (text) => {
  const receipts = await ev(`document.querySelectorAll('[data-action-receipt]').length`);
  const messages = await ev(`document.querySelectorAll('[data-message]').length`);
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(120);
  await ev(`document.querySelector('[data-chat-send]').click()`);
  return { receipts, messages };
};
// A plain request: its receipt appears and settles
const command = async (text) => {
  const before = await say(text);
  await waitFor(`document.querySelectorAll('[data-action-receipt]').length > ${before.receipts} && ${receiptDone}`, 15000);
  await sleep(300);
  return ev(receiptItems);
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/analyze*', requestStage: 'Request' }] });
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ' && !!document.querySelector('textarea')`, 30000);
  await sleep(4000);

  console.log('== Plain requests (no AI)');
  let items = await command('change shape to surface and color to rainbow');
  check('the request that failed before now works: shape', (await ev(shape)) === 'Surface', await ev(shape));
  check('…and colour', (await ev(colouring)) === 'rainbow', await ev(colouring));
  check('…the receipt says exactly that', JSON.stringify(items) === JSON.stringify(['done:Shape: surface', 'done:Colour: rainbow']), JSON.stringify(items));
  check('…without asking the AI', analyzeCalls.length === 0, analyzeCalls.join(' | '));

  items = await command('hide ligands');
  check('hide ligands', (await ev(toggle('Ligands'))) === false && JSON.stringify(items) === '["done:Ligands hidden"]', JSON.stringify(items));
  items = await command('show the ligands');
  check('show the ligands', (await ev(toggle('Ligands'))) === true, JSON.stringify(items));

  items = await command('opacity 40');
  check('opacity 40', (await ev(`document.querySelector('input[aria-label="Structure opacity"]').value`)) === '40', JSON.stringify(items));

  await ev(`[...document.querySelectorAll('aside[aria-label=Inspector] button')].find(b => b.textContent.trim().startsWith('Layers'))?.click()`);
  await sleep(300);
  items = await command('hide chain B');
  const chainB = `[...document.querySelectorAll('aside[aria-label=Inspector] button[aria-pressed]')].find(b => /^(Hide|Show) B\\b/.test(b.getAttribute('aria-label') ?? ''))`;
  check('hide chain B', (await ev(`(${chainB})?.getAttribute('aria-pressed')`)) === 'false' && JSON.stringify(items) === '["done:Chain B hidden"]', `${await ev(`(${chainB})?.getAttribute('aria-label')`)} ${JSON.stringify(items)}`);
  await command('show chain B');
  check('show chain B', (await ev(`(${chainB})?.getAttribute('aria-pressed')`)) === 'true');

  items = await command('select A:6');
  check('select A:6', (await waitFor(`/1 selected/.test(document.body.textContent)`, 3000)) >= 0 && JSON.stringify(items) === '["done:Selected A:6"]', JSON.stringify(items));
  items = await command('select A:999');
  check('a selection that cannot be made says so', items.length === 1 && items[0].startsWith("failed:Couldn't select A:999") && /no such residues/.test(items[0]), JSON.stringify(items));
  items = await command('clear selection');
  check('clear selection', !(await ev(`/1 selected/.test(document.body.textContent)`)) && JSON.stringify(items) === '["done:Selection cleared"]', JSON.stringify(items));

  items = await command('colour by confidence');
  check('confidence colouring is refused on an experimental structure, with the reason', items.length === 1 && items[0].startsWith('failed:') && /predicted models/.test(items[0]) && (await ev(colouring)) === 'rainbow', JSON.stringify(items));

  items = await command('paper theme');
  check('paper theme', (await ev(`document.documentElement.dataset.theme`)) === 'paper' && JSON.stringify(items) === '["done:Theme: Paper"]', JSON.stringify(items));
  items = await command('dark mode');
  check('dark mode', (await ev(`document.documentElement.dataset.theme`)) === 'mono', JSON.stringify(items));

  items = await command('open variant lens');
  check('open Variant Lens', (await waitFor(`${colouring} === 'pathogenicity'`, 5000)) >= 0 && JSON.stringify(items) === '["done:Variant Lens opened"]', JSON.stringify(items));
  items = await command('close the lens');
  check('close the lens: back to rainbow', (await ev(colouring)) === 'rainbow' && JSON.stringify(items) === '["done:Variant Lens closed"]', `${await ev(colouring)} ${JSON.stringify(items)}`);
  await command('cartoon');
  check('no AI call for any of these', analyzeCalls.length === 0, analyzeCalls.join(' | '));
  await send('Page.captureScreenshot', { format: 'png' }).then(({ result }) => writeFileSync(`${OUT}/shots/actions-local.png`, Buffer.from(result.data, 'base64')));

  console.log('== Questions go to the AI');
  let before = await say('what is the surface area of insulin?');
  await waitFor(`document.querySelectorAll('[data-message]').length >= ${before.messages + 2}`, 30000);
  check('a question with "surface" in it is not taken for a command', analyzeCalls.length === 1, analyzeCalls.join(' | '));

  console.log('== An answer\'s actions');
  before = await say('show me hemoglobin as a surface');
  check('the mixed request goes to the AI', (await waitFor(`${analyzeCalls.length} >= 0 && document.querySelector('[data-structure-id]')?.textContent.trim() === '4HHB'`, 40000)) >= 0 && analyzeCalls.length === 2, analyzeCalls.join(' | '));
  await waitFor(receiptDone, 30000);
  await sleep(500);
  items = await ev(receiptItems);
  check('its actions ran once 4HHB was on screen', (await ev(shape)) === 'Surface' && (await ev(colouring)) === 'chain', `${await ev(shape)} / ${await ev(colouring)}`);
  check('…the receipt lists them, and never Co-fold or junk', JSON.stringify(items) === JSON.stringify(['done:Shape: surface', 'done:Colour: chain']), JSON.stringify(items));
  check('…inside the answer', await ev(`!!(${lastReceipt}).closest('[data-message=assistant]')?.querySelector('[data-answer-title]')`));
  await send('Page.captureScreenshot', { format: 'png' }).then(({ result }) => writeFileSync(`${OUT}/shots/actions-answer.png`, Buffer.from(result.data, 'base64')));

  before = await say('fade the protein so the highlights stand out more');
  await waitFor(`document.querySelectorAll('[data-message]').length >= ${before.messages + 2}`, 30000);
  await waitFor(receiptDone, 20000);
  await sleep(600);
  check("an answer's opacity wins over the automatic fade", (await ev(`document.querySelector('input[aria-label="Structure opacity"]').value`)) === '30', await ev(`document.querySelector('input[aria-label="Structure opacity"]').value`));

  console.log('== The tour');
  before = await say('play the tour');
  check('"play the tour" with no tour asks the AI for one', (await waitFor(`${analyzeCalls.length} >= 0 && document.querySelector('button[aria-label="Stop the tour"]') !== null`, 30000)) >= 0 && analyzeCalls.some(q => /Generate a cinematic tour/.test(q)), analyzeCalls.slice(-1).join(''));
  check('…and plays it when it arrives', await ev(`!!document.querySelector('button[aria-label="Stop the tour"]')`));
  check('…the request shows as one turn (the tour prompt stays hidden)', !(await ev(`[...document.querySelectorAll('[data-message=user]')].some(m => /Generate a cinematic tour/.test(m.textContent))`)));
  items = await command('stop the tour');
  check('stop the tour', !(await ev(`!!document.querySelector('button[aria-label="Stop the tour"]')`)) && JSON.stringify(items) === '["done:Tour stopped"]', JSON.stringify(items));

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`, problems.length ? `| page problems: ${problems.join(' | ')}` : '');
} finally { ws.close(); chrome.kill(); }
