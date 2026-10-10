// The canvas header at window sizes from a big monitor down to a small tablet: the tools always fit,
// labels show only when they fit, the three column headers share a top edge, nothing floats over
// the canvas, and the page never scrolls sideways.
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9363;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-header-${Date.now()}`,
  '--window-size=1920,1080', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map();
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
// Headless Chrome renders only when asked; a real window repaints on resize, which is when resize
// observers and media-query listeners run. Ask for two frames so the test sees what a user would.
const nextFrames = () => ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const MEASURE = `(() => {
  const id = document.querySelector('[data-structure-id]');
  const header = id?.closest('.h-11');
  const bar = document.querySelector('[role=toolbar][aria-label=Tools]');
  const canvas = document.querySelector('canvas:not([data-chat-column] canvas)');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; };
  const labels = [...document.querySelectorAll('[data-tool-label]')].map((el) => el.clientWidth > 0);
  const c = canvas?.getBoundingClientRect();
  const atCorner = c ? document.elementFromPoint(c.left + 30, c.top + 20) : null;
  const inspectorHeader = document.querySelector('aside[aria-label=Inspector] > div');
  return {
    header: box(header), headerOverflow: header ? header.scrollWidth - header.clientWidth : null,
    bar: box(bar), id: box(id), labelsShown: labels.filter(Boolean).length, labelCount: labels.length,
    inspectorHeader: box(inspectorHeader), cornerIsCanvas: atCorner?.tagName === 'CANVAS',
    pageScroll: document.documentElement.scrollWidth > innerWidth + 1,
  };
})()`;

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}/app` });
  check('start screen loads', await waitFor(`!!document.querySelector('[data-structure-id]') && !!document.querySelector('[role=toolbar][aria-label=Tools]')`, 40000));
  await sleep(4000);

  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1100, 800], [1024, 768], [900, 1000], [768, 1024]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await waitFor(`innerWidth === ${w}`, 5000);
    await nextFrames();
    await sleep(300);
    const m = await ev(MEASURE);
    console.log(`== ${w}x${h}: header ${m.header?.w}px, tools ${m.bar?.w}px, labels ${m.labelsShown}/${m.labelCount}`);
    check(`${w}: header is 44px at the top`, m.header?.t === 0 && m.header?.h === 44, JSON.stringify(m.header));
    check(`${w}: tools stay inside the header`, m.bar && m.header && m.bar.r <= m.header.r && m.headerOverflow <= 1, `bar right ${m.bar?.r}, header right ${m.header?.r}, overflow ${m.headerOverflow}`);
    check(`${w}: the structure ID stays visible`, m.id && m.id.w > 0 && m.id.l >= m.header.l && m.id.r <= m.bar.l, JSON.stringify(m.id));
    check(`${w}: labels all on or all off`, m.labelsShown === 0 || m.labelsShown === m.labelCount, `${m.labelsShown}/${m.labelCount}`);
    if (m.inspectorHeader) check(`${w}: inspector header level with the canvas header`, m.inspectorHeader.t === m.header.t && m.inspectorHeader.h === m.header.h, JSON.stringify(m.inspectorHeader));
    check(`${w}: nothing floats over the canvas corner`, m.cornerIsCanvas);
    check(`${w}: no sideways page scroll`, !m.pageScroll);
    if (w === 1920) check('1920: room for labels, so they show', m.labelsShown === m.labelCount && m.labelCount > 0, `${m.labelsShown}/${m.labelCount}`);
    if (w <= 1100) check(`${w}: too narrow for labels, so icons only`, m.labelsShown === 0, `${m.labelsShown}/${m.labelCount}`);
  }

  // Folding the chat frees the width, so the labels come back, and the header offers the chat again
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await nextFrames();
  await sleep(300);
  await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))`);
  await sleep(1500);
  const folded = await ev(MEASURE);
  check('chat folded: labels show in the freed width', folded.labelsShown === folded.labelCount, `${folded.labelsShown}/${folded.labelCount}`);
  check('chat folded: the header has a show-chat button at its left', await ev(`(() => { const b = document.querySelector('button[aria-label="Show the chat"]'); return !!b && b.getBoundingClientRect().left < document.querySelector('[data-structure-id]').getBoundingClientRect().left; })()`));
  await ev(`document.querySelector('button[aria-label="Show the chat"]').click()`);
  await sleep(1200);
  check('show-chat brings the chat back', await ev(`!!document.querySelector('textarea') && document.querySelector('textarea').getBoundingClientRect().width > 0`));

  // The Co-fold form opens leftwards from the right end of the header and stays on screen
  const hasCofold = await ev(`!!document.querySelector('button[aria-label="Co-fold"]')`);
  if (hasCofold) {
    await ev(`document.querySelector('button[aria-label="Co-fold"]').click()`);
    await sleep(800);
    const menu = await ev(`(() => { const m = [...document.querySelectorAll('div')].find((d) => d.className.includes('w-[300px]') && d.className.includes('absolute')); if (!m) return null; const r = m.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top) }; })()`);
    check('Co-fold form opens below the header, fully on screen', menu && menu.l >= 0 && menu.r <= 1440 && menu.t >= 44, JSON.stringify(menu));
    await ev(`document.querySelector('button[aria-label="Co-fold"]').click()`);
  } else console.log('  (Co-fold not configured locally: menu check skipped)');

  check('no console errors or exceptions', problems.length === 0, problems.join(' | ').slice(0, 400));
} catch (e) {
  console.log('ERROR', e.message);
  failures++;
} finally {
  ws.close();
  chrome.kill();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
}
