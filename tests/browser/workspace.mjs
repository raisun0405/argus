// The redesigned workspace in headless Chrome: layout zones, the sequence strip, selection,
// the inspector, the command palette, shortcuts, layers, resizing and the phone layout.
// Answers come from the seeded cache: no AI calls.
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync(`${OUT}/redesign`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9381;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-ws-${Date.now()}`,
  '--window-size=1600,1000', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank',
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
const failed = [];
const aiCalls = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`EXC ${m.params.exceptionDetails?.exception?.description}`.slice(0, 260));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 260));
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/analyze')) aiCalls.push(1);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !/ebi\.ac\.uk\/pdbe\/api/.test(m.params.response.url)) failed.push(`${m.params.response.status} ${m.params.response.url.slice(0, 90)}`);
  if (m.method === 'Network.loadingFailed' && !m.params.canceled) failed.push(`FAILED ${m.params.errorText}`);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { if (await ev(expr).catch(() => false)) return true; await sleep(200); } return false; };
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/redesign/${n}.png`, Buffer.from(data, 'base64')); console.log(`  ${n}.png`); };
const click = (js) => ev(`(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
const key = async (k, mods = {}) => {
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, metaKey: ${!!mods.meta} }))`);
  await sleep(200);
};
const say = async (text) => {
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await ev(`document.querySelector('form button[type=submit]').click()`);
};
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const badge = `document.querySelector('[data-structure-id]')?.textContent`;
const inspector = `document.querySelector('aside[aria-label=Inspector]')`;
const statusBar = `[...document.querySelectorAll('div')].find(d => d.className.includes('h-7') && /residues? ·/.test(d.textContent ?? ''))`;
const seqCell = (resi) => `document.querySelector('[data-resi="${resi}"]')`;
const palette = `document.querySelector('[role=dialog][aria-label="Command palette"]')`;
const sheet = `document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]')`;
const focusText = `document.querySelector('#inspector-focus')?.textContent ?? ''`;

const SEED = `(() => {
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + s.length; };
  const hiv = { pdbId: '1HSG', title: 'HIV-1 protease with indinavir', measurements: [], summary: 'HIV protease answer.',
    highlights: [{ chain: 'A', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }, { chain: 'B', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }] };
  const cache = {};
  for (const sfx of ['', '|grounded']) cache[hash('show me hiv protease with its drug' + '1TRZ' + sfx)] = { timestamp: Date.now(), data: hiv };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache));
  localStorage.removeItem('argus-chat-width'); localStorage.removeItem('argus-inspector-width');
  return 1;
})()`;

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`!!document.querySelector('canvas:not([data-chat-column] canvas)')`);
  await ev(SEED);
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`!!document.querySelector('canvas:not([data-chat-column] canvas)')`);
  await sleep(2500);
  await say('Show me HIV protease with its drug');
  check('structure opens', await waitFor(`${badge} === '1HSG'`, 20000), await ev(badge));
  await sleep(3000);

  console.log('== Layout');
  const zones = await ev(`(() => {
    const r = (el) => el ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
    return { seq: r(document.querySelector('[data-resi]')?.closest('div.flex.items-stretch')), canvas: r(document.querySelector('canvas:not([data-chat-column] canvas)')), inspector: r(${inspector}), status: r(${statusBar}), chat: r(document.querySelector('textarea')?.closest('.flex.flex-col.h-full')) };
  })()`);
  check('all four zones exist', Boolean(zones.seq && zones.canvas && zones.inspector && zones.status), JSON.stringify(zones));
  check('sequence sits above the canvas', zones.seq.y < zones.canvas.y, `${zones.seq.y} < ${zones.canvas.y}`);
  check('status sits below the canvas', zones.status.y > zones.canvas.y, `${zones.status.y} > ${zones.canvas.y}`);
  check('inspector is right of the canvas', zones.inspector.x > zones.canvas.x);
  check('canvas is edge to edge (no card gap)', zones.canvas.x === zones.chat.w + 1, `canvas.x ${zones.canvas.x}, chat ${zones.chat.w}`);
  check('status bar counts what is loaded', /198 res/.test(await ev(`(${statusBar}).textContent`)), (await ev(`(${statusBar}).textContent`)).slice(0, 70));
  check('the header names the structure, not the status bar', (await ev(`document.querySelector('[data-structure-id]')?.textContent.trim()`)) === '1HSG' && !/1HSG/.test(await ev(`(${statusBar}).textContent`)));
  const tops = await ev(`JSON.stringify([document.querySelector('[data-structure-id]').closest('.h-11'), document.querySelector('aside[aria-label=Inspector] > div'), document.querySelector('[data-chat-column] > .h-11')].map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }))`);
  check('canvas, inspector and chat headers share one top edge and height', new Set(JSON.parse(tops).map(t => t.join('/'))).size === 1, tops);
  check('nothing floats over the canvas at the top-left', await ev(`(() => { const c = document.querySelector('canvas:not([data-chat-column] canvas)').getBoundingClientRect(); const el = document.elementFromPoint(c.left + 30, c.top + 20); return el?.tagName === 'CANVAS'; })()`));

  console.log('== Sequence strip and selection');
  check('sequence shows both chains', await ev(`[...document.querySelectorAll('button[aria-pressed]')].filter(b => /^[AB]$/.test(b.textContent.trim())).length === 2`));
  check('answer highlights are marked on the strip', await ev(`!!document.querySelector('[data-resi="25"] span[style*="background"]')`));
  await ev(`(() => { const el = ${seqCell(25)}; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return true; })()`);
  await sleep(300);
  check('clicking a residue selects it', await waitFor(`/Asp25/.test(${focusText})`, 4000), (await ev(focusText)).slice(0, 80));
  check('status bar shows the selection', /1 selected/.test(await ev(`(${statusBar}).textContent`)));
  check('focus lists what is within 5 A', /Within 5 Å/.test(await ev(focusText)) && /Asp25|MK1|Ile50|Gly27/.test(await ev(focusText)), (await ev(focusText)).slice(0, 200));
  await ev(`(() => { const el = ${seqCell(30)}; const o = { bubbles: true, shiftKey: true }; el.dispatchEvent(new PointerEvent('pointerdown', o)); return true; })()`);
  await sleep(300);
  check('shift extends the selection', /[5-9] selected|1[0-9] selected/.test(await ev(`(${statusBar}).textContent`)), (await ev(`(${statusBar}).textContent`)).match(/\d+ selected/)?.[0]);
  await click(`[...document.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.trim() === 'A')`);
  check('the chain button selects the whole chain', /99 selected/.test(await ev(`(${statusBar}).textContent`)), (await ev(`(${statusBar}).textContent`)).match(/\d+ selected/)?.[0]);
  await key('Escape');
  check('Escape clears the selection', !/selected/.test(await ev(`(${statusBar}).textContent`)));
  await shot('10-workspace');

  console.log('== Inspector');
  check('Focus, Style and Layers sections are present', await ev(`['Focus','Style','Layers'].every(t => [...document.querySelectorAll('aside[aria-label=Inspector] button')].some(b => b.textContent.includes(t)))`));
  await click(`[...document.querySelectorAll('aside[aria-label=Inspector] button')].find(b => b.textContent.includes('Layers'))`);
  await sleep(300);
  const layerText = await ev(`document.querySelector('#inspector-layers')?.textContent ?? ''`);
  check('layers list the chains and the ligand', /HIV-1 protease/i.test(layerText) && /MK1|Ligands/.test(layerText) && /Waters/.test(layerText), layerText.slice(0, 110));
  await click(`document.querySelector('#inspector-layers button[aria-pressed=true]')`);
  await sleep(400);
  check('a layer can be switched off', await ev(`!!document.querySelector('#inspector-layers button[aria-pressed=false]')`));
  await click(`document.querySelector('#inspector-layers button[aria-pressed=false]')`);
  check('shape buttons are not clipped', await ev(`[...document.querySelectorAll('[role=group][aria-label="Visual mode"] button')].every(b => b.scrollWidth <= b.clientWidth + 1)`));

  console.log('== Command palette and shortcuts');
  await key('k', { ctrl: true });
  check('Ctrl+K opens the palette', await waitFor(`!!${palette}`, 3000));
  await ev(`(() => { const i = ${palette}.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'A:25'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(400);
  check('typing a residue offers to go there', await ev(`/Go to/.test(${palette}.textContent) && /A:25/.test(${palette}.textContent)`), (await ev(`${palette}.textContent`)).slice(0, 90));
  await click(`${palette}.querySelector('[role=option]')`);
  check('running it selects that residue', await waitFor(`/1 selected/.test((${statusBar}).textContent)`, 4000), (await ev(`(${statusBar}).textContent`)).match(/\d+ selected/)?.[0]);
  await key('k', { ctrl: true });
  await ev(`(() => { const i = ${palette}.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'pocket'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  check('searching finds a tool', await ev(`/Pockets/.test(${palette}.textContent)`));
  await key('Escape');
  check('Escape closes the palette', await waitFor(`!${palette}`, 3000));
  await key('?', { shift: true });
  check('? opens the shortcut sheet', await waitFor(`!!${sheet}`, 3000));
  check('the sheet lists the shortcuts', await ev(`/Show or hide the chat/.test(${sheet}.textContent) && /Rotate/.test(${sheet}.textContent)`));
  await key('Escape');
  await waitFor(`!${sheet}`, 3000);
  const before = await ev(`!!${inspector}`);
  await key('i');
  check('I hides the inspector', await waitFor(`!${inspector}`, 3000), `was ${before}`);
  await key('i');
  await waitFor(`!!${inspector}`, 3000);
  await key('2');
  check('2 switches to wireframe', await waitFor(`[...document.querySelectorAll('[role=group][aria-label="Visual mode"] button')].find(b => b.getAttribute('aria-pressed') === 'true')?.textContent === 'Wire'`, 3000));
  await key('1');
  await key('b');
  // Hidden, not removed: the conversation has to survive being folded away
  check('B hides the chat', await waitFor(`(() => { const t = document.querySelector('textarea'); return !t || t.getBoundingClientRect().width === 0; })()`, 3000));
  await key('b');
  await waitFor(`(document.querySelector('textarea')?.getBoundingClientRect().width ?? 0) > 0`, 3000);

  console.log('== Resizing');
  const w0 = await ev(`Math.round((${inspector}).getBoundingClientRect().width)`);
  await ev(`(() => { const h = document.querySelector('[role=separator][aria-label="Resize the inspector"]'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); return true; })()`);
  await sleep(300);
  const w1 = await ev(`Math.round((${inspector}).getBoundingClientRect().width)`);
  check('the inspector resizes from the keyboard', w1 > w0, `${w0} -> ${w1}`);
  check('the size is remembered', Number(await ev(`localStorage.getItem('argus-inspector-width')`)) === w1, await ev(`localStorage.getItem('argus-inspector-width')`));

  console.log('== Phone');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // Headless Chrome renders only when asked, and media-query listeners run in a render
  await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
  await waitFor(`[...document.querySelectorAll('[role=tab]')].filter(t => t.getBoundingClientRect().width > 0).length === 2`, 15000);
  await sleep(600);
  check('a phone shows one pane, with the Chat | 3D switch in its header', await ev(`[...document.querySelectorAll('[role=tab]')].filter(t => t.getBoundingClientRect().width > 0).length === 2`));
  check('the chat fills the phone, no split', await ev(`(() => { const t = document.querySelector('textarea'); return t ? Math.round(t.closest('.flex.flex-col.h-full').getBoundingClientRect().width) >= 380 : false; })()`));
  await click(`[...document.querySelectorAll('[data-pane=structure]')].find(b => b.getBoundingClientRect().width > 0)`);
  await sleep(1200);
  check('switching to the structure shows the canvas full width', await ev(`Math.round(document.querySelector('canvas:not([data-chat-column] canvas)').getBoundingClientRect().width) >= 380`));
  await shot('11-phone');

  console.log(`  AI calls: ${aiCalls.length}`);
  check('no console errors', problems.length === 0, problems.join(' | ').slice(0, 400));
  check('no failed requests', failed.length === 0, failed.join(' | ').slice(0, 200));
} catch (e) {
  console.log('ERROR', e.message);
  failures++;
} finally {
  ws.close();
  chrome.kill();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
}
