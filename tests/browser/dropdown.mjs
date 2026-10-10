// The colouring menu: drawn over the page (never clipped by the inspector), opening downwards or
// upwards by the room there is, and working by mouse and keyboard.
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-dd-${Date.now()}`, '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const problems = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails?.exception?.description?.slice(0, 160)); });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r?.result?.value; };
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const trigger = `document.querySelector('[role=combobox][aria-label="Colouring"]')`;
const menu = `document.querySelector('[role=listbox][aria-label="Colouring"]')`;
// Is every option fully inside the window and inside the menu's visible box (no clipping)?
const geometry = `(() => {
  const m = ${menu}; if (!m) return null;
  const r = m.getBoundingClientRect(), t = ${trigger}.getBoundingClientRect();
  const opts = [...m.querySelectorAll('[role=option]')];
  return {
    inWindow: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
    inColumn: r.left >= document.querySelector('aside[aria-label=Inspector]').getBoundingClientRect().left,
    below: r.top >= t.bottom - 1, above: r.bottom <= t.top + 1, rightAligned: Math.abs(r.right - t.right) < 2, leftAligned: Math.abs(r.left - t.left) < 1.5,
    swatchesLineUp: (() => { const ts = ${trigger}.querySelector('span[aria-hidden]').getBoundingClientRect().left; return opts.every(o => Math.abs(o.querySelector('span[aria-hidden]').getBoundingClientRect().left - ts) < 1.5); })(),
    namesWhole: opts.every(o => { const n = o.querySelector('.block'); return n.scrollWidth <= n.clientWidth + 1; }),
    options: opts.length, scrolls: m.scrollHeight > m.clientHeight + 1,
    swatchesWhole: opts.every(o => { const s = o.querySelector('span[aria-hidden]'); if (!s) return true; const b = s.getBoundingClientRect(); return b.left >= r.left; }),
    hintsWhole: opts.every(o => { const h = o.querySelectorAll('.block')[1]; return !h || h.scrollWidth <= h.clientWidth + 1; }),
  };
})()`;
const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const hiv = { pdbId: '1HSG', title: 'HIV-1 protease with indinavir (MK1)', measurements: [], summary: 'HIV-1 protease answer.', highlights: [{ chain: 'A', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }] };
  const cache = {}; for (const s of ['', '|grounded']) cache[hash('show me hiv protease with its drug' + '1TRZ' + s)] = { timestamp: Date.now(), data: hiv };
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache)); return true;
})()`;
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${BASE}/app` });
  for (let i = 0; i < 80; i++) { if (await ev(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`)) break; await sleep(250); }
  await sleep(3000);
  await ev(SEED);
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Show me HIV protease with its drug'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await ev(`document.querySelector('[data-chat-send]').click()`);
  for (let i = 0; i < 60; i++) { if (await ev(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1HSG'`)) break; await sleep(250); }
  await sleep(3500);

  console.log('== Room below (900px window)');
  await ev(`${trigger}.click()`);
  await sleep(400);
  let g = await ev(geometry);
  check('the menu is drawn over the page, not inside the inspector', await ev(`!${menu}.closest('aside')`));
  check('whole, inside the window', g?.inWindow, JSON.stringify(g));
  check('under the button, exactly as wide as it (both edges line up)', g?.below && g?.rightAligned && g?.leftAligned, JSON.stringify(g));
  check('swatches in one column with the button swatch, no name cut off', g?.swatchesLineUp && g?.namesWhole, JSON.stringify(g));
  check('every option (8 here, tools included) without scrolling', g?.options === 8 && !g?.scrolls, `${g?.options} options, scrolls ${g?.scrolls}`);
  check('swatches not cut off', g?.swatchesWhole);
  check('inside the inspector column, one line per option', g?.inColumn && (await ev(`[...${menu}.querySelectorAll('[role=option]')].every(o => o.querySelectorAll('.block').length === 1)`)), JSON.stringify(g));
  check('the chosen colouring is described under the row', /Carbon grey/.test(await ev(`document.querySelector('[data-colouring-hint]')?.textContent ?? ''`)));
  const r = await ev(`(() => { const a = document.querySelector('aside[aria-label=Inspector]').getBoundingClientRect(); const m = ${menu}.getBoundingClientRect(); return { x: a.x - 20, y: m.y - 120, width: a.width + 20, height: m.height + 190 }; })()`);
  const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
  writeFileSync(`${OUT}/shots/dropdown-open.png`, Buffer.from(result.data, 'base64'));
  await ev(`[...${menu}.querySelectorAll('[role=option]')].find(o => o.querySelector('.block').textContent === 'Rainbow').click()`);
  await sleep(500);
  check('a click picks it and closes the menu', (await ev(`${trigger}.dataset.value`)) === 'rainbow' && !(await ev(`!!${menu}`)));
  check('…and the description follows it', /start to end/.test(await ev(`document.querySelector('[data-colouring-hint]')?.textContent ?? ''`)));

  console.log('== Little room below (a short window)');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 560, deviceScaleFactor: 2, mobile: false });
  await sleep(600);
  await ev(`(() => { const t = ${trigger}; t.scrollIntoView({ block: 'end' }); return true; })()`);
  await sleep(300);
  await ev(`${trigger}.click()`);
  await sleep(400);
  g = await ev(geometry);
  check('opens upwards, still whole', g?.above && g?.inWindow, JSON.stringify(g));
  // Keyboard: the menu is open with Rainbow focused; ArrowDown twice reaches Hydrophobic... by order
  const order = await ev(`[...${menu}.querySelectorAll('[role=option]')].map(o => o.querySelector('.block').textContent)`);
  const target = order[order.indexOf('Rainbow') + 1];
  await ev(`${trigger}.focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(500);
  check(`ArrowDown then Enter picks the next one (${target})`, (await ev(`${trigger}.textContent.trim()`)) === target, await ev(`${trigger}.textContent.trim()`));
  await ev(`${trigger}.click()`);
  await sleep(300);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 300, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 300, button: 'left', clickCount: 1 });
  await sleep(300);
  check('a click elsewhere closes it', !(await ev(`!!${menu}`)));

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`, problems.length ? `| page problems: ${problems.join(' | ')}` : '');
} finally { ws.close(); chrome.kill(); }
