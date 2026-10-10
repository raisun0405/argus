// Pocket Radar end to end in headless Chrome: toolbar toggle, panel, colours, focus, surface view,
// chat facts (AI answer faked via CDP Fetch, so no AI call), AlphaFold switch, themes, phone.
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync(`${OUT}/shots`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9351;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-pockets-${Date.now()}`,
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
const held = [];
const prankRequests = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`EXC ${m.params.exceptionDetails?.exception?.description}`.slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('prankweb.cz')) prankRequests.push(m.params.request.url.replace('https://prankweb.cz/api/v2/prediction/', ''));
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failedRequests.push(`${m.params.response.status} ${m.params.response.url.slice(0, 120)}`);
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) failedRequests.push(`FAILED ${m.params.errorText} (${m.params.type})`);
  if (m.method === 'Fetch.requestPaused') held.push(m.params);
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
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const badge = `document.querySelector('[data-structure-id]')?.textContent`;
const rows = `[...document.querySelectorAll('button[aria-pressed]')].filter(b => /^Pocket \\d/.test(b.textContent.trim()))`;
const panelText = `document.querySelector('#inspector-pockets')?.textContent ?? ''`;
const colourAt = (chain, resi) => `(() => { const a = window.__testViewer.selectedAtoms({ chain: '${chain}', resi: ${resi}, atom: 'CA' })[0]; const f = a?.style?.cartoon?.colorfunc; return f ? f(a) : a?.style?.cartoon?.color ?? null; })()`;

const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const answers = [
    ['1TRZ', 'show me hiv protease', { pdbId: '1HSG', title: 'HIV-1 protease with the inhibitor MK1', summary: 'Protease answer.', measurements: [],
      highlights: [{ chain: 'A', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }, { chain: 'B', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }] }],
    ['1HSG', 'show me hemoglobin', { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Hemoglobin answer.', measurements: [],
      highlights: [{ chain: 'A', resi: [87], label: 'Proximal His', category: 'active_site' }, { chain: 'B', resi: [92], label: 'Proximal His', category: 'active_site' }] }],
  ];
  const cache = {};
  for (const [ctx, q, data] of answers) for (const suffix of ['', '|grounded']) cache[hash(q + ctx + suffix)] = { timestamp: Date.now(), data };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache));
  return Object.keys(cache).length;
})()`;

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => { let lib; Object.defineProperty(window, '$3Dmol', { configurable: true, get: () => lib, set: (v) => {
      lib = new Proxy(v, { get: (t, p) => p === 'createViewer' ? (...args) => (window.__testViewer = t.createViewer(...args)) : Reflect.get(t, p) });
    } }); })();` });
  await send('Page.navigate', { url: `${BASE}/app?theme=crimson` });
  await waitFor(`!!document.querySelector('canvas:not([data-chat-column] canvas)')`);
  await sleep(5000);
  console.log('seeded', await ev(SEED));

  console.log('\n[1] toolbar on the default structure (1TRZ)');
  check('Pockets tool in the toolbar', await ev(`!!document.querySelector('button[aria-label="Pockets"]')`));
  check('toolbar order', (await ev(`[...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => ['AlphaFold model', 'Variant Lens', 'Pockets', 'Find similar'].includes(l)).join(' | ')`)) === 'AlphaFold model | Variant Lens | Pockets | Find similar',
    await ev(`[...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')).filter(l => ['AlphaFold model', 'Variant Lens', 'Pockets', 'Find similar'].includes(l)).join(' | ')`));

  console.log('\n[2] HIV protease (cached answer) + Pocket Radar');
  await say('Show me HIV protease');
  check('switched to 1HSG', (await waitFor(`${badge} === '1HSG'`, 20000)) >= 0);
  await sleep(3000);
  const t0 = Date.now();
  await click(`document.querySelector('button[aria-label="Pockets"]')`);
  check('toolbar button pressed', (await ev(`document.querySelector('button[aria-label="Pockets"]').getAttribute('aria-pressed')`)) === 'true');
  const shownIn = await waitFor(`${rows}.length > 0`, 60000);
  check('pockets listed', shownIn >= 0, `${Date.now() - t0} ms`);
  const rowTexts = await ev(`${rows}.map(b => b.textContent.replace(/\\s+/g, ' ').trim())`);
  console.log('   rows:', rowTexts.join(' || '));
  check('pocket 1: 98% and holds MK1', /Pocket 1/.test(rowTexts[0]) && /MK1/.test(rowTexts[0]) && /98%/.test(rowTexts[0]), rowTexts[0]);
  check('only pockets of 10% or more (98, 37, 15)', rowTexts.length === 3, String(rowTexts.length));
  check('weaker pockets counted', /\d+ weaker pockets? not shown/.test(await ev(panelText)), (await ev(panelText)).match(/\d+ weaker pockets? not shown/)?.[0]);
  check('colouring menu says Pockets', (await ev(`document.querySelector('[role=combobox][aria-label="Colouring"]')?.textContent.trim()`)) === 'Pockets');
  check('opacity at 100% despite highlights', (await ev(`document.querySelector('input[aria-label="Structure opacity"]')?.value`)) === '100');
  await sleep(800);
  check('Asp25 (pocket 1) drawn amber', (await ev(colourAt('A', 25))) === '#f59e0b', await ev(colourAt('A', 25)));
  check('Pro1 (no pocket) drawn neutral grey', (await ev(colourAt('A', 1))) === '#888888', await ev(colourAt('A', 1)));
  check('attribution links to PrankWeb', (await ev(`[...document.querySelectorAll('a')].find(a => a.textContent === 'PrankWeb')?.href`)) === 'https://prankweb.cz/analyze?database=v4-conservation-hmm&code=1HSG');
  check('conservation model named', (await ev(panelText)).includes('with conservation'));
  await shot('pk-01-1hsg-cartoon');

  console.log('\n[3] focus pocket 1');
  await click(`${rows}[0]`);
  await sleep(1500);
  check('row pressed', (await ev(`${rows}[0].getAttribute('aria-pressed')`)) === 'true');
  check('pocket residues as amber sticks', (await ev(`window.__testViewer.selectedAtoms({ chain: 'A', resi: 25, atom: 'CA' })[0]?.style?.stick?.color`)) === '#f59e0b');
  await shot('pk-02-focus');
  await click(`${rows}[0]`);
  await sleep(600);
  check('second click releases', (await ev(`${rows}[0].getAttribute('aria-pressed')`)) === 'false');

  console.log('\n[4] surface view');
  await click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Surface view')`);
  await sleep(4000);
  check('visual mode is Surface', (await ev(`[...document.querySelectorAll('[role=group][aria-label="Visual mode"] button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent.trim()`)) === 'Surface');
  check('button now offers Cartoon view', await ev(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Cartoon view')`));
  await shot('pk-03-surface');
  await click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cartoon view')`);
  await sleep(1500);

  console.log('\n[5] the chat sees the pockets (AI answer faked)');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*api/analyze*', requestStage: 'Request' }] });
  await say('Where else could a drug bind on this protease?');
  for (let i = 0; i < 60 && held.length === 0; i++) await sleep(250);
  const request = held[0] ? JSON.parse(Buffer.from(held[0].request.postData ?? '', 'utf8').toString()) : null;
  const facts = request?.structureFacts ?? '';
  console.log('   facts sent:', facts.split('\n').find(l => l.startsWith('Predicted')) ?? '(none)');
  check('pocket line in the facts', /^Predicted ligand-binding pockets/m.test(facts) && facts.includes('holds MK1'));
  check('facts within the server cap', facts.length <= 2800, `${facts.length} chars`);
  const fake = { pdbId: '1HSG', title: 'HIV-1 protease', summary: 'Pocket 2 answer.', measurements: [],
    highlights: [{ chain: 'B', resi: [29, 30], label: 'Predicted pocket 2 (Asp29, Asp30)', category: 'binding_site' }] };
  for (const h of held.splice(0)) await send('Fetch.fulfillRequest', { requestId: h.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(fake)).toString('base64') });
  await send('Fetch.disable');
  check('answer shown', (await waitFor(`[...document.querySelectorAll('p')].some(p => p.textContent === 'Pocket 2 answer.')`, 20000)) >= 0);
  await sleep(2000);
  check('Pocket Radar still open on the same structure', (await ev(`${rows}.length`)) > 0);
  check('no repair call (answer consistent)', held.length === 0);

  console.log('\n[6] close and reopen from the Colouring menu');
  await click(`document.querySelector('button[aria-label="Exit Pocket Radar"]')`);
  await sleep(800);
  check('panel closed', (await ev(`${rows}.length`)) === 0);
  check('colouring back to Element', (await ev(`document.querySelector('[role=combobox][aria-label="Colouring"]')?.textContent.trim()`)) === 'Element');
  const before = prankRequests.length;
  await ev(`(async () => { document.querySelector('[role=combobox][aria-label="Colouring"]').click(); await new Promise(r => setTimeout(r, 150)); const o = [...document.querySelectorAll('[role=listbox][aria-label="Colouring"] [role=option]')].find(o => o.querySelector('.block')?.textContent.trim() === 'Pockets'); o.click(); return true; })()`);
  await sleep(300);
  check('reopened instantly from the session cache', (await waitFor(`${rows}.length > 0`, 3000)) >= 0 && prankRequests.length === before, `${prankRequests.length - before} new PrankWeb requests`);

  console.log('\n[7] haemoglobin, then its AlphaFold model, with the radar open');
  await say('Show me hemoglobin');
  check('switched to 4HHB', (await waitFor(`${badge} === '4HHB'`, 20000)) >= 0);
  check('4HHB pockets listed', (await waitFor(`${rows}.length > 0 && (${panelText}).includes('HEM')`, 90000)) >= 0, (await ev(`${rows}.map(b => b.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 2).join(' || ')`)));
  await shot('pk-04-4hhb');
  await click(`document.querySelector('button[aria-label="AlphaFold model"]')`);
  await sleep(500);
  await click(`[...document.querySelectorAll('button')].find(b => /HBB_HUMAN/.test(b.textContent))`);
  check('AlphaFold model loaded', (await waitFor(`/P68871/.test(${badge} ?? '')`, 30000)) >= 0);
  check('radar stays open on the model', (await waitFor(`${rows}.length > 0 && !(${panelText}).includes('HEM')`, 90000)) >= 0, (await ev(`${rows}.map(b => b.textContent.replace(/\\s+/g, ' ').trim()).slice(0, 2).join(' || ')`)));
  check('colouring still Pockets (not Confidence)', (await ev(`document.querySelector('[role=combobox][aria-label="Colouring"]')?.textContent.trim()`)) === 'Pockets');
  check('AlphaFold PrankWeb database used', prankRequests.some(u => u.startsWith('v4-alphafold-conservation-hmm/P68871')), prankRequests.filter(u => u.includes('alphafold')).slice(0, 2).join(', '));
  await shot('pk-05-alphafold');
  await click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Experimental'))`);
  check('back on 4HHB', (await waitFor(`${badge} === '4HHB'`, 20000)) >= 0);
  check('4HHB pockets back (cached)', (await waitFor(`(${panelText}).includes('HEM')`, 10000)) >= 0);

  console.log('\n[8] light theme');
  await click(`document.querySelector('button[aria-haspopup="menu"]')`);
  await sleep(300);
  await click(`[...document.querySelectorAll('[role=menuitemradio]')].find(b => b.textContent.includes('Peach'))`);
  await sleep(1500);
  const peachGrey = await ev(`(() => { const a = window.__testViewer.selectedAtoms({ chain: 'A', resi: 1, atom: 'CA' })[0]; return a.style.cartoon.colorfunc(a); })()`);
  check('neutral grey follows the light theme', peachGrey !== '#888888', peachGrey);
  await shot('pk-06-peach');
  await click(`document.querySelector('button[aria-haspopup="menu"]')`);
  await sleep(300);
  await click(`[...document.querySelectorAll('[role=menuitemradio]')].find(b => b.textContent.includes('Crimson'))`);
  await sleep(500);

  console.log('\n[9] phone 390x844');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  check('no horizontal page scroll', !(await ev(`document.documentElement.scrollWidth > window.innerWidth + 1`)));
  // A phone shows one pane at a time and keeps the inspector out of the way until asked
  await click(`[...document.querySelectorAll('[data-pane=structure]')].find(b => b.getBoundingClientRect().width > 0)`);
  await sleep(900);
  check('phone: the inspector starts hidden so the structure gets the screen', await ev(`!document.querySelector('aside[aria-label=Inspector]') && !document.querySelector('[data-phone-sheet]')`));
  await shot('pk-07a-phone-structure');
  await click(`document.querySelector('button[aria-label="Show the inspector"]')`);
  await sleep(700);
  const diag = await ev(`JSON.stringify({ inspector: !!document.querySelector('[data-phone-sheet][aria-label=Inspector]'), colour: document.querySelector('[role=combobox][aria-label="Colouring"]')?.textContent, section: !!document.querySelector('#inspector-pockets'), tool: document.querySelector('button[aria-label="Pockets"]')?.getAttribute('aria-pressed') })`);
  check('phone: the pockets list is reachable from the inspector', (await ev(`${rows}.length`)) > 0, `${await ev(`${rows}.length`)} rows ${diag}`);
  const fits = await ev(`(() => { const p = document.querySelector('[data-phone-sheet]').getBoundingClientRect(); return p.left >= 0 && p.right <= window.innerWidth + 1 && p.bottom <= window.innerHeight + 1; })()`);
  check('the inspector rises inside the screen, the pockets first', fits && await ev(`document.querySelector('[data-phone-sheet] [data-section]')?.dataset.section === 'pockets'`));
  check('the tools are one button, named after the open one', /Pockets/.test(await ev(`[...document.querySelectorAll('[data-sheet-toggle]')][0]?.textContent ?? ''`)));
  await ev(`document.querySelector('canvas:not([data-chat-column] canvas)').scrollIntoView({ block: 'end' })`);
  await sleep(400);
  await shot('pk-07-phone');

  console.log('\n[10] PrankWeb requests:', [...new Set(prankRequests)].join(', '));
  check('no failed requests', failedRequests.length === 0, failedRequests.join(' | '));
  check('no console errors or warnings', problems.length === 0, problems.join(' | '));
} catch (e) {
  console.log('TEST ERROR', e.message);
  failures++;
  await shot('pk-99-error').catch(() => {});
} finally {
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  ws.close();
  chrome.kill();
}
