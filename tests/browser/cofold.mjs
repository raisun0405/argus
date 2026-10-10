// Co-fold end to end in headless Chrome on the dev server .
//   node cdp-cofold.mjs        -> UI flow on 3PTB with /api/cofold answered by CDP (no NVIDIA credits), chat command,
//                                 back/forward, share state, phone layout
//   node cdp-cofold.mjs live   -> one real prediction on 1HSG (indinavir, MK1) through the dev server
// Answers to questions come from the seeded cache: no AI calls.
import { BASE, CHROME, FIXTURES, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const LIVE = process.argv[2] === 'live';
mkdirSync(`${OUT}/shots`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9361;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-cofold-${Date.now()}`,
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
const cofoldPosts = [];
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`EXC ${m.params.exceptionDetails?.exception?.description}`.slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/analyze')) aiCalls.push(m.params.request.url);
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/cofold') && m.params.request.method === 'POST') cofoldPosts.push(m.params.request.postData ?? '');
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !/ebi\.ac\.uk\/pdbe\/api/.test(m.params.response.url)) failedRequests.push(`${m.params.response.status} ${m.params.response.url.slice(0, 120)}`);
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) failedRequests.push(`FAILED ${m.params.errorText} (${m.params.type})`);
  if (m.method === 'Fetch.requestPaused') onPaused(m.params);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { if (await ev(expr).catch(() => false)) return Date.now() - s; await sleep(250); } return -1; };
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/shots/${n}.png`, Buffer.from(data, 'base64')); console.log(`  screenshot ${n}.png`); };
const click = (js) => ev(`(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
const say = async (text) => {
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await ev(`document.querySelector('form:not(.p-3) button[type=submit]').click()`);
};
const typeInto = (selector, text) => ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const badge = `document.querySelector('[data-structure-id]')?.textContent`;
// The card's heading (since the design pass): the tool's icon, "Co-fold", and "Boltz-2" at the right
const card = `[...document.querySelectorAll('[data-chat-column] p')].filter(p => p.querySelector('svg') && /^Co-foldBoltz-2$/.test(p.textContent.trim())).pop()?.closest('.rounded-xl')`;
const cardText = `(${card})?.textContent ?? ''`;
const menu = `[...document.querySelectorAll('p')].find(p => p.textContent === 'Co-fold a molecule')?.closest('.absolute')`;
const toolButton = `document.querySelector('button[aria-label="Co-fold"]')`;
// The CDN build of 3Dmol keeps no list of its viewers (and its namespace is frozen): find the viewer in
// the React state of the component that holds the canvas (test-only)
const VIEWER = `(() => {
  let el = document.querySelector('canvas:not([data-chat-column] canvas)');
  while (el && !Object.keys(el).some(k => k.startsWith('__reactFiber$'))) el = el.parentElement;
  let fiber = el && el[Object.keys(el).find(k => k.startsWith('__reactFiber$'))];
  while (fiber) {
    for (let hook = fiber.memoizedState; hook && typeof hook === 'object'; hook = hook.next) {
      const v = hook.memoizedState;
      if (v && typeof v === 'object' && typeof v.selectedAtoms === 'function') return v;
    }
    fiber = fiber.return;
  }
  return null;
})()`;
const viewerAtoms = (sel) => `(() => { const v = ${VIEWER}; return v ? v.selectedAtoms(${sel}).length : -1; })()`;
const lastAssistant = `[...document.querySelectorAll('[data-message="assistant"]')].map(b => b.textContent).filter(t => t && !/Thinking|Looking up|Boltz-2 is predicting/.test(t)).pop() ?? ''`;

// Canned server answer for 3PTB (the real prediction made earlier), streamed like the server: spaces first
let pausedHandler = null;
const onPaused = (p) => (pausedHandler ? pausedHandler(p) : send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}));
const cannedServer = {
  pdb: readFileSync(`${FIXTURES}/cofold-3PTB-server.pdb`, 'utf8'),
  chains: [{ id: 'A', length: 223 }], ligand: { chain: 'L', resn: 'BEN' }, cofactors: [{ chain: 'X', resn: 'CA' }],
  scores: { confidence: 0.989, ptm: 0.994, iptm: 0.991, ligandIptm: 0.991, proteinIptm: 0, plddt: 0.989, iplddt: 0.985, pde: 0.257, ipde: 0.298 },
  affinity: { log10Ic50: 2.25, binderProbability: 0.8359375 }, template: '3PTB', seconds: 11.6,
};

const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const trypsin = { pdbId: '3PTB', title: 'Trypsin with benzamidine', summary: 'Trypsin answer.', measurements: [],
    highlights: [{ chain: 'A', resi: [189], label: 'S1 pocket Asp189', category: 'binding_site' }] };
  const hiv = { pdbId: '1HSG', title: 'HIV-1 protease with indinavir', summary: 'HIV protease answer.', measurements: [],
    highlights: [{ chain: 'A', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }, { chain: 'B', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }] };
  const cache = {};
  for (const [ctx, q, data] of [['1TRZ', 'show me trypsin with benzamidine', trypsin], ['1TRZ', 'show me hiv protease with its drug', hiv]])
    for (const suffix of ['', '|grounded']) cache[hash(q + ctx + suffix)] = { timestamp: Date.now(), data };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache));
  return Object.keys(cache).length;
})()`;

const open = async (query, id) => {
  await send('Page.navigate', { url: `${BASE}/app?theme=crimson` });
  await waitFor(`!!document.querySelector('canvas:not([data-chat-column] canvas)')`);
  await ev(SEED);
  await sleep(1500);
  await say(query);
  return waitFor(`${badge} === '${id}'`, 20000);
};

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  if (!LIVE) {
    console.log('== Co-fold UI on 3PTB (server answer canned by CDP)');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/cofold*', requestStage: 'Request' }] });
    let posted = null;
    pausedHandler = async (p) => {
      // Whether this server can co-fold: yes, whatever keys the dev server holds
      if (p.request.method !== 'POST') return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"available":true}').toString('base64') });
      posted = JSON.parse(p.request.postData ?? '{}');
      await sleep(1500); // Let the "predicting" status show
      await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(`   ${JSON.stringify(cannedServer)}`).toString('base64') });
    };
    check('3PTB opens from the seeded answer', (await open('Show me trypsin with benzamidine', '3PTB')) >= 0, await ev(badge));
    check('Co-fold tool in the toolbar', (await waitFor(`!!${toolButton}`, 15000)) >= 0);
    await click(toolButton);
    check('menu opens', (await waitFor(`!!${menu}`, 5000)) >= 0);
    const menuText = await ev(`(${menu})?.textContent ?? ''`);
    check('menu: BEN offered, single chain (no chain list), calcium can be kept', /BEN/.test(menuText) && !/Chains/.test(menuText) && /Keep Calcium/.test(menuText), menuText.slice(0, 220));
    check('menu input is focused', await ev(`document.activeElement?.getAttribute('aria-label')?.startsWith('Molecule to co-fold') ?? false`));
    await shot('cofold-menu');
    await typeInto('input[aria-label^="Molecule to co-fold"]', 'benzamidine');
    await sleep(200);
    await click(`(${menu}).querySelector('button[type=submit]')`);
    check('menu closes on submit', (await waitFor(`!${menu}`, 3000)) >= 0);
    const userMsg = await waitFor(`[...document.querySelectorAll('[data-message="user"]')].some(b => /Co-fold benzamidine with Beta-trypsin \\(3PTB, chain A\\)/.test(b.textContent))`, 5000);
    check('chat shows the request as a user turn', userMsg >= 0);
    const phase = await waitFor(`/Boltz-2 is predicting Benzamidine with Beta-trypsin… \\d+ s/.test(document.body.textContent)`, 15000);
    check('status counts the seconds while Boltz-2 runs', phase >= 0);
    check('card arrives', (await waitFor(`!!(${card})`, 30000)) >= 0);
    check('request: PDB 3PTB chain A, BEN by code (+SMILES), calcium kept', posted?.source?.kind === 'pdb' && posted.source.pdbId === '3PTB' && posted.source.chains.join() === 'A'
      && posted.ligand?.ccd === 'BEN' && Boolean(posted.ligand?.smiles) && posted.cofactors?.join() === 'CA', JSON.stringify(posted).slice(0, 200));
    const text = await ev(cardText);
    check('card: pose High · ipTM 0.99', /PoseHighipTM 0\.99/.test(text), text.slice(0, 160));
    check('card: affinity ≈ 180 µM, pIC50 3.8', /≈ 180 µM/.test(text) && /pIC50 3\.8/.test(text));
    check('card: binder 84%', /84%/.test(text));
    check('card: crystal pose 0.1 Å, 11 of 11 contacts', /Crystal pose \(3PTB, grey\): 0\.\d Å away · 11 of 11 contacts shared/.test(text), text.match(/Crystal pose[^·]*·[^H]*/)?.[0]);
    check('card: held by S1 residues incl. Asp189', /Held by.*Asp189/.test(text));
    check('card: template and kept calcium noted', /Protein shaped by 3PTB · kept Calcium/.test(text));
    check('viewer shows the complex: badge Boltz-2', (await waitFor(`${badge} === 'Boltz-2'`, 10000)) >= 0, await ev(badge));
    check('badge tag: Co-folded · pLDDT', await ev(`/Co-folded · pLDDT \\d+/.test(document.body.textContent)`));
    check('opens in element colours with the protein faded', (await waitFor(`document.querySelector('input[aria-label="Structure opacity"]')?.value === '65'`, 5000)) >= 0
      && await ev(`/Element/.test(document.querySelector('[role=combobox][aria-label="Colouring"]').textContent)`), await ev(`document.querySelector('[role=combobox][aria-label="Colouring"]')?.textContent`));
    check('co-fold legend: predicted pose, crystal pose, contacts', await ev(`/Co-folded complex.*Benzamidine · Boltz-2 pose.*Crystal pose · 3PTB.*Residues within 4 Å/.test(document.body.textContent)`));
    await sleep(1500);
    check('3Dmol: predicted ligand (L, 9 atoms), crystal pose (R, 9), calcium (X, 1)', await ev(viewerAtoms(`{ chain: 'L' }`)) === 9 && await ev(viewerAtoms(`{ chain: 'R' }`)) === 9 && await ev(viewerAtoms(`{ chain: 'X' }`)) === 1,
      `${await ev(viewerAtoms(`{ chain: 'L' }`))}/${await ev(viewerAtoms(`{ chain: 'R' }`))}/${await ev(viewerAtoms(`{ chain: 'X' }`))}`);
    check('protein numbered like 3PTB (184A present)', await ev(`(() => { const v = ${VIEWER}; return Boolean(v?.selectedAtoms({ chain: 'A', resi: 184 }).some(a => (a.icode ?? '').trim() === 'A')); })()`));
    check('Co-fold tool hidden on the co-folded complex', await ev(`!${toolButton}`));
    const share = await ev(`(() => { const b = document.querySelector('button[aria-label="Share this view"]'); return b ? (b.title || b.getAttribute('aria-description') || '') + '|' + b.disabled + '|' + b.getAttribute('aria-disabled') : 'none'; })()`);
    check('share explains a co-folded complex stays in this browser', /co-folded complex lives only in this browser/.test(share) || /co-folded complex/.test(await ev(`document.body.innerHTML`)), share);
    await shot('cofold-result');

    // Back and forth
    await click(`[...(${card}).querySelectorAll('button')].find(b => b.textContent.startsWith('Back to'))`);
    check('Back to 3PTB', (await waitFor(`${badge} === '3PTB'`, 10000)) >= 0, await ev(badge));
    check('card offers View complex again', (await waitFor(`[...(${card}).querySelectorAll('button')].some(b => b.textContent === 'View complex')`, 3000)) >= 0);
    await click(`[...(${card}).querySelectorAll('button')].find(b => b.textContent === 'View complex')`);
    check('View complex reopens it', (await waitFor(`${badge} === 'Boltz-2'`, 10000)) >= 0);

    // Chat command on the complex itself: refused politely; from 3PTB: same prediction, no new request
    const posts = cofoldPosts.length;
    await say('cofold BEN');
    check('chat "cofold" on a complex: asks to go back first', (await waitFor(`/go back to the original structure first/.test(${lastAssistant})`, 10000)) >= 0, (await ev(lastAssistant)).slice(0, 120));
    await click(`[...(${card}).querySelectorAll('button')].find(b => b.textContent.startsWith('Back to'))`);
    await waitFor(`${badge} === '3PTB'`, 10000);
    await say('cofold benzamidine');
    check('chat "cofold benzamidine" on 3PTB: same prediction, from memory', (await waitFor(`${badge} === 'Boltz-2'`, 15000)) >= 0 && cofoldPosts.length === posts, `posts ${posts} -> ${cofoldPosts.length}`);

    // Phone: the menu fits the screen
    await click(`[...document.querySelectorAll('button')].filter(b => b.textContent.startsWith('Back to')).pop()`);
    await waitFor(`${badge} === '3PTB'`, 10000);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    // Headless Chrome renders only when asked; media queries and resize observers run in a render
    await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    await waitFor(`!![...document.querySelectorAll('[data-pane=structure]')].find(b => b.getBoundingClientRect().width > 0)`, 15000);
    await click(`[...document.querySelectorAll('[data-pane=structure]')].find(b => b.getBoundingClientRect().width > 0)`);
    await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    // A phone: Co-fold from the labelled list of tools, its form in the sheet
    await waitFor(`!![...document.querySelectorAll('[data-sheet-toggle]')].find(b => /^Tools/.test(b.getAttribute('aria-label')))`, 10000);
    await click(`[...document.querySelectorAll('[data-sheet-toggle]')].find(b => /^Tools/.test(b.getAttribute('aria-label')))`);
    await waitFor(`!!document.querySelector('[data-phone-tool=cofold]')`, 3000);
    await click(`document.querySelector('[data-phone-tool=cofold]')`);
    await waitFor(`!!document.querySelector('[data-phone-sheet] input[aria-label^="Molecule to co-fold"]')`, 3000);
    const box = await ev(`(() => { const r = document.querySelector('[data-phone-sheet]').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: innerWidth }; })()`);
    check('phone: the form rises in a sheet inside the screen', box.left >= 0 && box.right <= box.width, JSON.stringify(box));
    await shot('cofold-phone');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  } else {
    console.log('== Live co-fold on 1HSG with MK1 (one NVIDIA call)');
    check('1HSG opens from the seeded answer', (await open('Show me HIV protease with its drug', '1HSG')) >= 0, await ev(badge));
    check('Co-fold tool in the toolbar', (await waitFor(`!!${toolButton}`, 15000)) >= 0);
    await click(toolButton);
    await waitFor(`!!${menu}`, 5000);
    const menuText = await ev(`(${menu})?.textContent ?? ''`);
    check('menu: chains A and B listed and ticked, MK1 offered', /Chains/.test(menuText) && /198 residues selected/.test(menuText) && /MK1/.test(menuText), menuText.slice(0, 260));
    await click(`[...(${menu}).querySelectorAll('button')].find(b => b.textContent.startsWith('MK1'))`);
    check('picking MK1 fills the input', (await ev(`document.querySelector('input[aria-label^="Molecule to co-fold"]').value`)) === 'MK1');
    await click(`(${menu}).querySelector('button[type=submit]')`);
    const t0 = Date.now();
    const arrived = await waitFor(`!!(${card})`, 240000);
    check('live prediction arrives', arrived >= 0, `${Math.round((Date.now() - t0) / 1000)} s`);
    const text = await ev(cardText);
    console.log('  card:', text.slice(0, 500));
    const d = Number(text.match(/(\d+\.\d) Å away/)?.[1]);
    check('crystal pose within 2 Å of the prediction', d < 2, String(d));
    check('badge Boltz-2', (await waitFor(`${badge} === 'Boltz-2'`, 10000)) >= 0);
    await sleep(2000);
    await shot('cofold-live-1hsg');
    const summary = await ev(`[...document.querySelectorAll('[data-message="assistant"] p.whitespace-pre-wrap')].map(p => p.textContent).pop()`);
    console.log('  summary:', summary);
  }

  console.log(`  AI calls: ${aiCalls.length}`);
  check('no console errors or exceptions', problems.length === 0, problems.join(' | ').slice(0, 600));
  check('no failed requests', failedRequests.length === 0, failedRequests.join(' | '));
} catch (e) {
  console.log('ERROR', e.message);
  failures++;
} finally {
  ws.close();
  chrome.kill();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
}
