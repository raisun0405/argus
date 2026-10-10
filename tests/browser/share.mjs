// Share links end to end in headless Chrome: share a customised view, reopen the link, compare.
// Answers come from the seeded cache: no AI calls. The clipboard is stubbed to capture the link.
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync(`${OUT}/shots`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9356;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-share-${Date.now()}`,
  '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!page) await sleep(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const problems = [];
const failedRequests = [];
const aiCalls = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`EXC ${m.params.exceptionDetails?.exception?.description}`.slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/analyze')) aiCalls.push(m.params.request.url);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failedRequests.push(`${m.params.response.status} ${m.params.response.url.slice(0, 120)}`);
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) failedRequests.push(`FAILED ${m.params.errorText} (${m.params.type})`);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { if (await ev(expr).catch(() => false)) return Date.now() - s; await sleep(250); } return -1; };
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/shots/${n}.png`, Buffer.from(data, 'base64')); console.log(`  screenshot ${n}.png`); };
const click = (js) => ev(`(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
const say = async (text) => {
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await ev(`document.querySelector('button[type=submit]').click()`);
};
// The inspector's controls: shape is a segmented group, colouring a dropdown with swatches
const pick = async (aria, label) => {
  if (aria === 'Visual mode') {
    await click(`[...document.querySelectorAll('[role=group][aria-label="Visual mode"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`);
  } else {
    await ev(`(async () => { document.querySelector('[role=combobox][aria-label="Colouring"]').click(); await new Promise(r => setTimeout(r, 150)); const o = [...document.querySelectorAll('[role=listbox][aria-label="Colouring"] [role=option]')].find(o => o.querySelector('.block')?.textContent.trim() === ${JSON.stringify(label)}); o.click(); return true; })()`);
  }
  await sleep(800);
};
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const badge = `document.querySelector('[data-structure-id]')?.textContent`;
const dropdown = (aria) => aria === 'Visual mode'
  ? `document.querySelector('[role=group][aria-label="Visual mode"] button[aria-pressed=true]')?.textContent.trim()`
  : `document.querySelector('[role=combobox][aria-label="Colouring"]')?.textContent.trim()`;

const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const hb = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Hemoglobin answer: the heme iron sits 2.0 Å from the proximal His.', measurements: [],
    highlights: [{ chain: 'A', resi: [87], label: 'Proximal His', category: 'active_site' }, { chain: 'B', resi: [92], label: 'Proximal His', category: 'active_site' }],
    tour: [{ text: 'Step one: the tetramer.', focus: [] }, { text: 'Step two: the proximal histidine.', focus: [{ chain: 'B', resi: [92], label: 'His92', category: 'active_site' }] }] };
  const again = { ...hb, summary: 'A newer answer about hemoglobin.', highlights: [{ chain: 'B', resi: [63], label: 'Distal His', category: 'active_site' }] };
  const cache = {};
  for (const [ctx, q, data] of [['1TRZ', 'show me hemoglobin', hb], ['4HHB', 'tell me more about hemoglobin', again]])
    for (const suffix of ['', '|grounded']) cache[hash(q + ctx + suffix)] = { timestamp: Date.now(), data };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache));
  return Object.keys(cache).length;
})()`;

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => { let lib; Object.defineProperty(window, '$3Dmol', { configurable: true, get: () => lib, set: (v) => {
      lib = new Proxy(v, { get: (t, p) => p === 'createViewer' ? (...args) => (window.__testViewer = t.createViewer(...args)) : Reflect.get(t, p) });
    } }); })();
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } });` });
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`!!document.querySelector('canvas:not([data-chat-column] canvas)')`);
  await sleep(5000);
  console.log('seeded', await ev(SEED));

  console.log('\n[1] build a view worth sharing');
  await say('Show me hemoglobin');
  check('on 4HHB', (await waitFor(`${badge} === '4HHB'`, 20000)) >= 0);
  await waitFor(`!document.querySelector('button[aria-label="Partners"]')?.disabled`, 20000);
  await click(`document.querySelector('button[aria-label="AlphaFold model"]')`);
  await sleep(400);
  await click(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('HBB_HUMAN'))`);
  check('AlphaFold model of HBB open', (await waitFor(`/P68871/.test(${badge} ?? '')`, 30000)) >= 0);
  await sleep(2500);
  await pick('Visual mode', 'Surface');
  await pick('Colouring', 'Rainbow');
  await ev(`(() => { window.__testViewer.rotate(70, 'y'); window.__testViewer.rotate(-25, 'x'); window.__testViewer.zoom(1.3); window.__testViewer.render(); return true; })()`);
  await sleep(1500);
  const camera = await ev(`window.__testViewer.getView()`);
  check('share button present and enabled', await ev(`!document.querySelector('button[aria-label="Share this view"]').disabled`));
  await click(`document.querySelector('button[aria-label="Share this view"]')`);
  check('"Link copied" confirmation', (await waitFor(`[...document.querySelectorAll('[role=status]')].some(s => s.textContent.startsWith('Link copied'))`, 3000)) >= 0);
  const link = await ev(`window.__copied[0] ?? ''`);
  check('link copied to the clipboard', link.startsWith(`${BASE}/app#view=`), `${link.length} chars`);
  await shot('sh-01-before-share');

  console.log('\n[2] open the link in a fresh page');
  const aiBefore = aiCalls.length;
  await send('Page.navigate', { url: 'about:blank' }); // A real page load, not a fragment change
  await sleep(500);
  await send('Page.navigate', { url: link });
  await waitFor(`!!document.querySelector('canvas:not([data-chat-column] canvas)')`);
  check('fresh page (nothing left from before)', (await ev(`window.__copied.length`)) === 0);
  check('the AlphaFold model opens directly', (await waitFor(`/P68871/.test(${badge} ?? '')`, 30000)) >= 0);
  await sleep(3500);
  check('"Experimental 4HHB" back button: the switch came from the entry', await ev(`[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Experimental 4HHB')`));
  check('visual mode restored', (await ev(dropdown('Visual mode'))) === 'Surface', await ev(dropdown('Visual mode')));
  check('colouring restored (not replaced by confidence)', (await ev(dropdown('Colouring'))) === 'Rainbow', await ev(dropdown('Colouring')));
  const opacityNow = await ev(`(document.querySelector('input[aria-label="Structure opacity"]')?.value + '%')`);
  check('opacity restored (100%, not the automatic 65%)', opacityNow?.includes('100%'), opacityNow);
  const restored = await ev(`window.__testViewer.getView()`);
  const drift = Math.max(...camera.map((v, i) => Math.abs(v - restored[i])));
  check('camera restored', drift < 1e-3, `max difference ${drift.toExponential(1)}`);
  check('chat labels it "Shared view"', await ev(`[...document.querySelectorAll('[data-message="assistant"] p')].some(s => s.textContent === 'Shared view')`));
  check('chat explains it was shared, not generated', await ev(`[...document.querySelectorAll('p')].some(p => p.textContent.startsWith('Opened from a share link'))`));
  check('summary arrives intact (Å included)', await ev(`[...document.querySelectorAll('p')].some(p => p.textContent === 'Hemoglobin answer: the heme iron sits 2.0 Å from the proximal His.')`));
  check('highlight chips listed', await ev(`!!document.querySelector('[data-highlight-chip~="B:92"]')`));
  check('the shared tour can be played', (await ev(`document.querySelector('button[title="Play Cinematic Tour"]') !== null`)));
  check('no AI call to open it', aiCalls.length === aiBefore);
  check('link kept in the address bar while its answer is on screen', (await ev(`location.hash`)).startsWith('#view='));
  await shot('sh-02-opened');

  console.log('\n[3] the conversation moves on');
  await say('Tell me more about hemoglobin');
  check('new answer shown', (await waitFor(`[...document.querySelectorAll('p')].some(p => p.textContent === 'A newer answer about hemoglobin.')`, 20000)) >= 0);
  await sleep(500);
  check('link removed from the address bar', (await ev(`location.hash`)) === '', await ev(`location.hash`));
  const opacityAfter = await ev(`(document.querySelector('input[aria-label="Structure opacity"]')?.value + '%')`);
  check('a new answer goes back to the automatic opacity', opacityAfter?.includes('65%'), opacityAfter);

  console.log('\n[4] blocked clipboard: the link is shown to copy by hand');
  await ev(`(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); return true; })()`);
  await click(`document.querySelector('button[aria-label="Share this view"]')`);
  check('manual copy box with the link', (await waitFor(`(document.querySelector('input[aria-label="Link to this view"]')?.value ?? '').startsWith('${BASE}/app#view=')`, 3000)) >= 0);
  check('link pre-selected', await ev(`(() => { const i = document.querySelector('input[aria-label="Link to this view"]'); return document.activeElement === i && i.selectionEnd - i.selectionStart === i.value.length; })()`));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(200);
  check('Escape closes it', !(await ev(`!!document.querySelector('input[aria-label="Link to this view"]')`)));

  console.log('\n[5] a damaged link pasted into the open tab (only the fragment changes)');
  await ev(`(() => { window.__marker = 'still the same page'; return true; })()`);
  await ev(`(() => { location.hash = '#view=bm90IGEgdmlldw'; return true; })()`);
  await waitFor(`window.__marker === undefined && !!document.querySelector('canvas:not([data-chat-column] canvas)')`, 20000);
  check('the tab started over with the link', (await ev(`window.__marker === undefined`)));
  check('chat says it could not be opened', (await waitFor(`[...document.querySelectorAll('p')].some(p => p.textContent.startsWith("This share link couldn't be opened"))`, 10000)) >= 0);
  check('default structure instead', (await waitFor(`${badge} === '1TRZ'`, 20000)) >= 0);
  check('damaged link cleared from the address bar', (await ev(`location.hash`)) === '');

  console.log('\n[6] phone header');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1000);
  check('no horizontal page scroll', !(await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)));
  const header = await ev(`(() => { const b = document.querySelector('button[aria-label="Share this view"]').getBoundingClientRect(); return b.right <= window.innerWidth && b.left > 0; })()`);
  check('share button inside the header', header);

  const unexpected = failedRequests.filter(r => !/^404 https:\/\/www\.ebi\.ac\.uk\/pdbe\/api\//.test(r));
  check('no failed requests', unexpected.length === 0, unexpected.join(' | '));
  check('no console errors or warnings', problems.length === 0, problems.join(' | '));
} catch (e) {
  console.log('TEST ERROR', e.message);
  failures++;
  await shot('sh-99-error').catch(() => {});
} finally {
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  ws.close();
  chrome.kill();
}
