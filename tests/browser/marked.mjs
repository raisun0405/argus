// The default chat look: "Marked in 3D" with many parts (collapsed, expanded, a row clicked), and the
// tool loader's clock at several widths. node cdp-marked.mjs
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-marked-${Date.now()}`, '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const problems = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)); });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r?.result?.value; };
const frames = async (n = 4) => { for (let i = 0; i < n; i++) { await ev(`new Promise((r) => requestAnimationFrame(() => r(true)))`); await sleep(80); } };
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const shotColumn = async (name, width = 1440) => {
  await frames(4);
  const r = await ev(`(() => { const c = document.querySelector('[data-chat-column]').getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; })()`);
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/shots/${name}.png`, Buffer.from(result.data, 'base64'));
  writeFileSync(`${OUT}/shots/${name}.rect.json`, JSON.stringify(r));
};
const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const H = (chain, resi, label, category) => ({ chain, resi, label, category });
  const insulin = { pdbId: '1TRZ', title: 'Human insulin hexamer', measurements: [],
    summary: 'Insulin is held together by three disulfide bonds: one inside chain A (A6-A11) and two linking chain A to chain B (A7-B7, A20-B19). In this crystal form two zinc ions coordinate the B-chain histidines, with chloride and sodium ions nearby.',
    highlights: [H('A', [6, 11], 'Intrachain Disulfide (A6-A11)', 'other'), H('A', [7], 'Interchain Disulfide (A7-B7)', 'other'), H('B', [7], 'Interchain Disulfide (A7-B7)', 'other'),
      H('A', [20], 'Interchain Disulfide (A20-B19)', 'other'), H('B', [19], 'Interchain Disulfide (A20-B19)', 'other'), H('B', [31], 'Zinc Ion', 'metal'), H('D', [31], 'Zinc Ion', 'metal'),
      H('B', [32], 'Chloride Ion', 'other'), H('D', [32], 'Chloride Ion', 'other'), H('D', [33], 'Sodium Ion', 'other')] };
  const cache = {}; for (const s of ['', '|grounded']) cache[hash('what holds insulin together?' + '1TRZ' + s)] = { timestamp: Date.now(), data: insulin };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache)); return true;
})()`;
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${BASE}/app` });
  for (let i = 0; i < 80; i++) { if (await ev(`!!document.querySelector('textarea') && document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`)) break; await sleep(250); }
  await sleep(3500);
  await ev(SEED);
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'What holds insulin together?'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
  await ev(`document.querySelector('[data-chat-send]').click()`);
  for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('[data-marked-parts]')`)) break; await sleep(250); }
  await sleep(1500);

  const rows = await ev(`[...document.querySelectorAll('[data-marked-parts] li')].map(li => li.textContent)`);
  check('ten highlights become six named parts, four shown', rows.length === 4, JSON.stringify(rows));
  check('the two halves of a bond share a row', rows.includes('Interchain Disulfide (A7-B7)A 7 · B 7'), rows[1]);
  check('"Show 2 more" offered', await ev(`[...document.querySelectorAll('[data-marked-parts] button')].some(b => b.textContent.trim() === 'Show 2 more')`));
  await shotColumn('after-marked-collapsed');
  await ev(`[...document.querySelectorAll('[data-marked-parts] button')].find(b => b.textContent.trim() === 'Show 2 more').click()`);
  await sleep(400);
  const all = await ev(`[...document.querySelectorAll('[data-marked-parts] li')].map(li => li.textContent)`);
  check('expanded: all six parts', all.length === 6 && all[5] === 'Sodium IonD 33', JSON.stringify(all.slice(4)));
  await ev(`(() => { const s = document.querySelector('[data-chat-column] .overflow-y-auto'); if (s) s.scrollTop = s.scrollHeight; return true; })()`);
  await shotColumn('after-marked-expanded');
  // A row selects every residue it names (both halves of the A7-B7 bond)
  await ev(`document.querySelector('[data-highlight-chip="A:7 B:7"]').click()`);
  await sleep(1200);
  const focus = await ev(`(() => { const t = document.querySelector('aside[aria-label=Inspector]')?.textContent ?? ''; return t.slice(0, 160); })()`);
  check('clicking a row selects both of its residues', /2 residues|Cys7.*Cys7|A7.*B7|B7.*A7/i.test(focus), focus);

  // The tool loader's clock at several widths: never alone on a line
  for (const width of [1100, 1280, 1440, 1600, 1920]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false });
    await sleep(500);
    if (!(await ev(`!!document.querySelector('[aria-label="Chat design tweaks"]')`))) { await ev(`document.querySelector('button[aria-label="Tweaks"]')?.click()`); await sleep(500); }
    if (!(await ev(`document.querySelector('[data-preview="work"]')?.getAttribute('aria-pressed') === 'true'`))) await ev(`document.querySelector('[data-preview="work"]').click()`);
    await sleep(600);
    await ev(`(() => { const s = document.querySelector('[data-chat-column] .overflow-y-auto'); if (s) s.scrollTop = s.scrollHeight; return true; })()`);
    const layout = await ev(`(() => {
      const p = document.querySelector('[data-chat-loader] p');
      const clock = [...p.querySelectorAll('span.tabular-nums')][0];
      const lines = Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight));
      const range = document.createRange(); range.selectNodeContents(clock); const rects = [...range.getClientRects()];
      const word = clock.parentElement; const wr = word.getBoundingClientRect(); const cr = clock.getBoundingClientRect();
      return { lines, clockRects: rects.length, clockWithWord: Math.abs(wr.top - cr.top) < 2 && wr.width > cr.width + 8, text: p.textContent };
    })()`);
    check(`${width}px: the clock is whole and on the line of the word before it (${layout.lines} line${layout.lines > 1 ? 's' : ''})`, layout.clockRects === 1 && layout.clockWithWord, JSON.stringify(layout));
    await shotColumn(`after-loader-${width}`);
  }
  check('the busy beam runs on the composer during a preview', await ev(`document.querySelector('[data-chat-composer] [data-beam]')?.hasAttribute('data-active') === true`));
  await ev(`document.querySelector('[data-preview="work"]').click()`);
  await sleep(1500);
  check('…and stops when the preview ends', await ev(`document.querySelector('[data-chat-composer] [data-beam]')?.hasAttribute('data-active') === false`));
  await ev(`document.querySelector('[data-preview="work"]').click()`);
  await sleep(600);
  // Narrow enough to wrap (a scaled Windows display gives the chat fewer CSS pixels): the clock moves with its word
  for (const maxWidth of [380, 330, 290, 240]) {
    await ev(`(() => { document.querySelector('[data-chat-loader]').style.maxWidth = '${maxWidth}px'; return true; })()`);
    await sleep(150);
    const wrapped = await ev(`(() => {
      const p = document.querySelector('[data-chat-loader] p');
      const clock = p.querySelector('span.tabular-nums'); const word = clock.parentElement;
      const lines = Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight));
      const range = document.createRange(); range.selectNodeContents(word); const rects = [...range.getClientRects()].filter(r => r.width > 0);
      return { lines, linesUsed: new Set(rects.map(r => Math.round(r.top))).size, onLastLine: rects[0].top >= p.getBoundingClientRect().bottom - parseFloat(getComputedStyle(p).lineHeight) - 1, lastLine: word.textContent };
    })()`);
    check(`${maxWidth}px loader: "${wrapped.lastLine}" stays together (${wrapped.lines} lines)`, wrapped.linesUsed === 1 && wrapped.onLastLine, JSON.stringify(wrapped));
    if (maxWidth === 290) await shotColumn('after-loader-wrapped');
  }
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`, problems.length ? `| page problems: ${problems.join(' | ')}` : '');
} finally { ws.close(); chrome.kill(); }
