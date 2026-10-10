// Shared harness for the browser tests: a headless Chrome driven over the DevTools protocol, emulating a
// phone by default (touch, coarse pointer, DPR 2), with the AI's answers canned (no AI calls) and
// screenshots in tests/.out/shots/m.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { BASE, OUT, CHROME, sleep } from './env.mjs';

export { BASE, OUT, sleep };
mkdirSync(`${OUT}/shots/m`, { recursive: true });

export async function launch({ width = 390, height = 844, dpr = 2, answer = cannedAnswer, intercept = [], onPaused = null, canned = true } = {}) {
  // A port no other browser holds: with two runs side by side, a shared port would let a test attach to
  // the other run's page and drive the wrong app
  let port;
  for (let tries = 0; tries < 40 && !port; tries++) {
    const candidate = 9500 + Math.floor(Math.random() * 400);
    const taken = await fetch(`http://127.0.0.1:${candidate}/json/version`, { signal: AbortSignal.timeout(300) }).then(() => true, () => false);
    if (!taken) port = candidate;
  }
  if (!port) throw new Error('no free debugging port');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-mob-${Date.now()}-${port}`,
    `--window-size=${width},${height}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });
  let page;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const problems = [];
  const calls = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') problems.push(`EXC ${m.params.exceptionDetails?.exception?.description}`.slice(0, 300));
    // Without canned answers, a test that intercepts /api/analyze answers it itself
    if (m.method === 'Fetch.requestPaused' && (!canned || !m.params.request.url.includes('/api/analyze'))) {
      if (onPaused) onPaused(m.params, send); else send('Fetch.continueRequest', { requestId: m.params.requestId });
      return;
    }
    if (m.method === 'Fetch.requestPaused') {
      // Answers from the AI are canned: no AI calls
      const body = JSON.parse(m.params.request.postData ?? '{}');
      calls.push(body.query);
      // An answer may be a promise, to hold the reply back (an answer still on its way)
      Promise.resolve(answer(body.query ?? '', body.currentContext, body)).then(data =>
        send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(data)).toString('base64') }));
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const waitFor = async (expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { if (await ev(expr).catch(() => false)) return Date.now() - s; await sleep(200); } return -1; };
  const frame = () => ev('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const shot = async (n) => { await frame(); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/shots/m/${n}.png`, Buffer.from(data, 'base64')); console.log(`  shot ${n}`); };
  const click = (js) => ev(`(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
  // A real tap at an element's centre (touch events, then the synthesized click)
  const tap = async (js) => {
    const box = await ev(`(() => { const el = ${js}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!box) return false;
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(120);
    return true;
  };
  const setSize = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true, screenWidth: w, screenHeight: h });
    await frame(); await frame();
  };
  const say = async (text) => {
    await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(150);
    await ev(`document.querySelector('[data-chat-send]').click()`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const patterns = [...(canned ? [{ urlPattern: '*/api/analyze*', requestStage: 'Request' }] : []), ...intercept.map((urlPattern) => ({ urlPattern, requestStage: 'Request' }))];
  if (patterns.length) await send('Fetch.enable', { patterns });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true, screenWidth: width, screenHeight: height });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => { let lib; Object.defineProperty(window, '$3Dmol', { configurable: true, get: () => lib, set: (v) => {
      lib = new Proxy(v, { get: (t, p) => p === 'createViewer' ? (...args) => (window.__testViewer = t.createViewer(...args)) : Reflect.get(t, p) });
    } }); })();
    window.__copied = [];
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } }); } catch {}` });
  const close = () => { ws.close(); chrome.kill(); };
  return { send, ev, waitFor, frame, shot, click, tap, setSize, say, problems, calls, close };
}

// Cached answers keyed like services/cacheService (question + structure on screen)
export const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const hb = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen in red blood cells. Each of its four chains holds a heme group whose iron binds one O2 molecule; the proximal histidine (His87 on α, His92 on β) anchors the iron from below, while the distal histidine (His58 / His63) sits above it and steadies the bound oxygen. In this deoxy (T-state) form the hemes sit 2.0 Å out of the porphyrin plane.',
    measurements: [],
    highlights: [{ chain: 'A', resi: [87], label: 'Proximal His', category: 'active_site' }, { chain: 'B', resi: [92], label: 'Proximal His', category: 'active_site' }, { chain: 'A', resi: [58], label: 'Distal His', category: 'binding_site' }, { chain: 'A', resi: [142], label: 'Heme', category: 'ligand' }],
    tour: [{ text: 'Step one: the tetramer, two alpha and two beta chains.', focus: [] }, { text: 'Step two: the proximal histidine that holds the heme iron from below.', focus: [{ chain: 'B', resi: [92], label: 'His92', category: 'active_site' }] }] };
  const quiz = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'A question on the structure on screen.', measurements: [], highlights: [],
    quiz: { question: 'Which bonds hold insulin\\'s A and B chains together?', options: ['Disulfide bonds between cysteines', 'Hydrogen bonds between backbone atoms only', 'Salt bridges between lysine and glutamate', 'Coordination to the zinc ions'], correctAnswerIndex: 0, explanation: 'Two interchain disulfides (A7–B7 and A20–B19) join the chains; a third disulfide (A6–A11) sits within chain A.' } };
  const cache = {};
  for (const [ctx, q, data] of [['1TRZ', 'show me hemoglobin', hb], ['4HHB', 'quiz me on human deoxyhemoglobin', quiz]])
    for (const suffix of ['', '|grounded']) cache[hash(q + ctx + suffix)] = { timestamp: Date.now(), data };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache));
  return Object.keys(cache).length;
})()`;

export const tabSel = (name) => `document.querySelector('[data-pane="${name}"]:not(.hidden *)') && [...document.querySelectorAll('[data-pane="${name}"]')].find((b) => b.getBoundingClientRect().width > 0)`;
export const viewerCanvas = `document.querySelector('canvas:not([data-chat-column] canvas)')`;

// Everything that sticks out of the screen sideways, or is clipped by it
export const OVERFLOW = `(() => {
  const W = innerWidth, out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    if (r.right > W + 1 || r.left < -1) {
      let p = el.parentElement, clipped = false;
      while (p) { const ps = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(ps.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= W + 1 && pr.left >= -1) { clipped = true; break; } } p = p.parentElement; }
      if (!clipped) out.push((el.tagName.toLowerCase() + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '') + '.' + String(el.className).split(' ').slice(0, 3).join('.')).slice(0, 90) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  }
  return { scroll: document.documentElement.scrollWidth > W + 1, out: out.slice(0, 12) };
})()`;

// Tap targets smaller than 32px on either side that are visible
export const SMALL_TARGETS = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, a, [role=tab], [role=option], input, select, textarea, [role=switch], [role=checkbox]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    if (r.width < 32 || r.height < 32) out.push(((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 28)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return out;
})()`;

const H = (chain, resi, label, category = 'active_site') => ({ chain, resi, label, category });
// What the canned AI says: haemoglobin for haemoglobin, a quiz for a quiz, a tour for a tour
export function cannedAnswer(query, context) {
  const q = query.toLowerCase();
  const on = context?.pdbId ?? '1TRZ';
  if (/tour/.test(q)) return { pdbId: on, title: context?.title ?? 'Structure', summary: 'A short tour.', highlights: [], measurements: [],
    tour: [{ text: 'Step one: the whole molecule, seen at once.', focus: [] }, { text: 'Step two: one of its key residues, up close.', focus: [] }] };
  if (/quiz/.test(q)) return { pdbId: on, title: context?.title ?? 'Structure', summary: 'A question on the structure on screen.', highlights: [], measurements: [],
    quiz: { question: 'Which residue holds the heme iron from below in each haemoglobin chain?', options: ['The proximal histidine', 'The distal histidine', 'A cysteine', 'A lysine'], correctAnswerIndex: 0, explanation: 'The proximal histidine (His87 in α, His92 in β) binds the iron directly; the distal histidine sits on the other side.' } };
  if (/trypsin/.test(q)) return { pdbId: '3PTB', title: 'Trypsin with benzamidine', summary: 'Trypsin cuts proteins after lysine and arginine; benzamidine sits in its S1 pocket against Asp189.', measurements: [], highlights: [H('A', [189], 'S1 pocket Asp189', 'binding_site')] };
  if (/h(a)?emoglobin/.test(q)) return { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen in red blood cells. Each of its four chains holds a heme group whose iron binds one O2 molecule; the proximal histidine (His87 on α, His92 on β) anchors the iron from below, while the distal histidine (His58 / His63) sits above it and steadies the bound oxygen.',
    highlights: [H('A', [87], 'Proximal His'), H('B', [92], 'Proximal His'), H('A', [58], 'Distal His', 'binding_site')], measurements: [],
    tour: [{ text: 'Step one: the tetramer, two alpha and two beta chains.', focus: [] }, { text: 'Step two: the proximal histidine that holds the heme iron from below.', focus: [H('B', [92], 'His92')] }] };
  return { pdbId: on, title: context?.title ?? 'Structure', summary: 'A short canned answer about the structure on screen.', highlights: [], measurements: [] };
}
