// The composer's + menu: the row it replaces, the menu (mouse and keyboard), modes as chips, prompts
// one level down, the sequence file, co-fold not set up, and sending in each mode. The AI and Co-fold
// endpoints are answered here (no real calls).
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
writeFileSync(`${OUT}/hba.fasta`, '>sp|P69905|HBA_HUMAN Hemoglobin subunit alpha\nMVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHV\nDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR\n');
writeFileSync(`${OUT}/notes.txt`, 'Remember to ask about the zinc sites tomorrow.\n');

const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-menu-${Date.now()}`, '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const pageErrors = [];
let cofoldAvailable = true;
const posted = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    const reply = (status, body) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
    if (request.url.includes('/api/cofold') && request.method === 'GET') return reply(200, { available: cofoldAvailable });
    posted.push(`${request.method} ${new URL(request.url).pathname} ${request.postData ?? ''}`.slice(0, 200));
    if (request.url.includes('/api/cofold')) return reply(503, { error: 'test: no prediction' });
    return reply(502, { error: 'test: AI unavailable' }); // /api/investigate: falls back without an AI call
  }
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r?.result?.value; };
const frames = async () => { for (let i = 0; i < 3; i++) { await ev(`new Promise((r) => requestAnimationFrame(() => r(true)))`); await sleep(60); } };
const waitFor = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); } return false; };
const key = async (k, code = k) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, Escape: 27, End: 35, Home: 36, Enter: 13 }[k] ?? 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
  await sleep(120);
};
const shot = async (name, clipExpr) => {
  await frames();
  const clip = clipExpr ? await ev(clipExpr) : null;
  const { result } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  writeFileSync(`${OUT}/shots/${name}.png`, Buffer.from(result.data, 'base64'));
};
const menu = `document.querySelector('[data-composer-menu-panel]')`;
const openMenu = async () => { if (!(await ev(`!!${menu}`))) await ev(`document.querySelector('[data-composer-menu]').click()`); await waitFor(`!!${menu}`, 3000); await frames(); };
const chip = () => ev(`document.querySelector('[data-mode-chip]')?.dataset.modeChip ?? null`);
const placeholder = () => ev(`document.querySelector('textarea').placeholder`);
const value = () => ev(`document.querySelector('textarea').value`);
const setText = (text) => ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const menuAndComposer = `(() => { const a = document.querySelector('[data-composer-menu-panel]').getBoundingClientRect(); const b = document.querySelector('[data-chat-composer]').getBoundingClientRect(); const top = Math.max(0, a.top - 10); return { x: Math.max(0, Math.min(a.left, b.left) - 10), y: top, width: Math.min(innerWidth, Math.max(a.right, b.right) + 10) - Math.max(0, Math.min(a.left, b.left) - 10), height: b.bottom + 10 - top, scale: 1 }; })()`;
// The menu against the composer: lined up, as wide, and how tall against the room above the composer
const fit = () => ev(`(() => { const m = ${menu}.getBoundingClientRect(), f = document.querySelector('[data-chat-composer]').getBoundingClientRect(); return { left: Math.round(m.left - f.left), width: Math.round(m.width - f.width), height: Math.round(m.height), room: Math.round(f.top - 16), gap: Math.round(f.top - m.bottom) }; })()`);
const scroller = (sel) => ev(`(() => { const s = ${menu}.querySelector(${JSON.stringify(sel)}); const r = s.getBoundingClientRect(); return { scrolls: s.scrollHeight > s.clientHeight + 1, overflowY: getComputedStyle(s).overflowY, scrollTop: Math.round(s.scrollTop), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const wheel = async (x, y, deltaY) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); await sleep(350); };
const setSearch = (text) => ev(`(() => { const s = ${menu}.querySelector('input[aria-label="Search prompts"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, ${JSON.stringify(text)}); s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/cofold*', requestStage: 'Request' }, { urlPattern: '*/api/investigate*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`!!document.querySelector('textarea') && document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`, 30000);
  await sleep(1200);

  console.log('\n[1] the row');
  const row = await ev(`(() => {
    const row = document.querySelector('[data-composer-menu]').parentElement;
    const kids = [...row.children].filter(c => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0);
    const plus = document.querySelector('[data-composer-menu]').getBoundingClientRect(), send = document.querySelector('[data-chat-send]').getBoundingClientRect();
    return { buttons: [...row.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent.trim()), overflow: row.scrollWidth > row.clientWidth + 1, plusLeft: plus.left < send.left, oneLine: Math.abs(plus.top - send.top) < 6, count: kids.length };
  })()`);
  check('the + button starts the row; Prompts and Investigate are no longer in it', row.buttons[0].startsWith('Add a sequence file') && !row.buttons.some(b => /^Prompts|^Investigate/.test(b)), JSON.stringify(row.buttons));
  check('one line, nothing overflows', row.oneLine && !row.overflow && row.plusLeft, JSON.stringify(row));
  await shot('menu-row', `(() => { const r = document.querySelector('[data-chat-composer]').getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16, scale: 1 }; })()`);

  console.log('\n[2] the menu');
  await openMenu();
  const items = await ev(`[...${menu}.querySelectorAll('[role^=menuitem]')].map(i => i.textContent.trim())`);
  check('Add, Modes, Prompts', items.length === 4 && items[0].startsWith('Sequence file') && items[1].startsWith('Investigate') && items[2].startsWith('Co-fold') && items[3].startsWith('Prompts'), JSON.stringify(items));
  check('a menu above the + button, inside the window', await ev(`(() => { const m = ${menu}.getBoundingClientRect(), b = document.querySelector('[data-composer-menu]').getBoundingClientRect(); return m.bottom <= b.top && m.left >= 0 && m.right <= innerWidth && m.top >= 0; })()`));
  const wide = await fit();
  check('as wide as the composer, lined up with it, 8px above it', Math.abs(wide.left) <= 1 && Math.abs(wide.width) <= 1 && Math.abs(wide.gap - 8) <= 1, JSON.stringify(wide));
  check('at most 320px tall, and no more than 60% of the room above', wide.height <= 320 && wide.height <= Math.round(wide.room * 0.6) + 1, JSON.stringify(wide));
  check('it is a menu, and the button says it is open', await ev(`${menu}.getAttribute('role') === 'menu' && document.querySelector('[data-composer-menu]').getAttribute('aria-expanded') === 'true'`));
  check('the keyboard starts on the first item', await ev(`document.activeElement?.dataset.menuItem === 'sequence-file'`));
  await shot('menu-open', menuAndComposer);
  await key('ArrowDown');
  check('ArrowDown: Investigate', await ev(`document.activeElement?.dataset.menuMode === 'investigate'`));
  await key('End');
  check('End: Prompts', await ev(`document.activeElement?.dataset.menuPrompts !== undefined`));
  await key('ArrowRight');
  check('ArrowRight on Prompts: the library, its search focused', await ev(`${menu}?.dataset.composerMenuPanel === 'prompts' && document.activeElement?.getAttribute('aria-label') === 'Search prompts'`));
  await key('Escape');
  check('Escape: back to the menu', await ev(`${menu}?.dataset.composerMenuPanel === 'menu'`));
  await key('Escape');
  check('Escape again: closed, focus back on +', await ev(`!${menu} && document.activeElement?.hasAttribute('data-composer-menu')`));
  await openMenu();
  await ev(`document.querySelector('[data-structure-id]').closest('div').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(150);
  check('a click outside closes it', await ev(`!${menu}`));

  console.log('\n[3] modes');
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-mode="investigate"]').click()`);
  await sleep(150);
  check('Investigate: chip, placeholder, menu closed', await chip() === 'investigate' && (await placeholder()).startsWith('Ask a question to investigate') && await ev(`!${menu}`), `${await chip()} | ${await placeholder()}`);
  await openMenu();
  check('the menu ticks the mode that is on', await ev(`${menu}.querySelector('[data-menu-mode="investigate"]').getAttribute('aria-checked') === 'true' && ${menu}.querySelector('[data-menu-mode="cofold"]').getAttribute('aria-checked') === 'false'`));
  await shot('menu-mode-checked', menuAndComposer);
  await ev(`${menu}.querySelector('[data-menu-mode="cofold"]').click()`);
  await sleep(150);
  check('Co-fold replaces it: one mode at a time', await chip() === 'cofold' && (await placeholder()).startsWith('Name a molecule'), `${await chip()} | ${await placeholder()}`);
  await shot('menu-chip-cofold', `(() => { const r = document.querySelector('[data-chat-composer]').getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16, scale: 1 }; })()`);
  await ev(`document.querySelector('[data-mode-chip] button').click()`);
  await sleep(120);
  check('× on the chip turns the mode off', await chip() === null && (await placeholder()).startsWith('Ask Argus about a protein'), await placeholder());
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-mode="investigate"]').click()`);
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-mode="investigate"]').click()`);
  await sleep(120);
  check('picking the mode that is on turns it off', await chip() === null);

  console.log('\n[4] prompts');
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-prompts]').click()`);
  await sleep(150);
  const tabs = await ev(`(() => { const list = document.querySelector('[role=tablist][aria-label="Prompt categories"]'); const box = ${menu}.getBoundingClientRect(); return { labels: [...list.children].map(t => t.textContent), clipped: [...list.children].some(t => t.getBoundingClientRect().right > box.right - 4) || list.scrollWidth > list.clientWidth + 1 }; })()`);
  check('the library one level down, five tabs that fit', tabs.labels.length === 5 && !tabs.clipped, JSON.stringify(tabs));
  const libFit = await fit();
  check('the library: as wide as the composer, at most 320px tall', Math.abs(libFit.left) <= 1 && Math.abs(libFit.width) <= 1 && libFit.height <= 320, JSON.stringify(libFit));
  await setSearch('the');
  await sleep(150);
  const searchTop = () => ev(`Math.round(${menu}.querySelector('input[aria-label="Search prompts"]').getBoundingClientRect().top)`);
  const before = { ...(await scroller('ul[data-menu-scroll]')), search: await searchTop(), height: (await fit()).height, shown: await ev(`${menu}.querySelectorAll('[data-prompt]').length`) };
  await wheel(before.x, before.y, 240);
  const after = { ...(await scroller('ul[data-menu-scroll]')), search: await searchTop(), height: (await fit()).height };
  check('many prompts: the list scrolls under the search, the menu keeps its height', before.scrolls && before.overflowY === 'auto' && after.scrollTop > 0 && after.search === before.search && after.height === before.height && after.height <= 320, JSON.stringify({ before, after }));
  await shot('menu-prompts-scrolled', menuAndComposer);
  await setSearch('');
  await sleep(120);
  await ev(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Investigate').click()`);
  await sleep(120);
  await shot('menu-prompts', menuAndComposer);
  await ev(`${menu}.querySelector('[data-prompt="Mutations near a drug pocket"]').click()`);
  await sleep(150);
  check('an Investigate prompt: the mode on, the question without a prefix', await chip() === 'investigate' && await value() === 'Are the disease mutations of KRAS near a druggable pocket?', `${await chip()} | ${await value()}`);
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-prompts]').click()`);
  await sleep(120);
  await ev(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Predict').click()`);
  await sleep(120);
  await ev(`${menu}.querySelector('[data-prompt="Compare two molecules"]').click()`);
  await sleep(150);
  check('a Co-fold prompt: Co-fold on, just the molecules', await chip() === 'cofold' && await value() === 'imatinib vs nilotinib', `${await chip()} | ${await value()}`);
  await ev(`document.querySelector('[data-mode-chip] button').click()`);
  await setText('');

  console.log('\n[5] a sequence file');
  await openMenu();
  const { root } = (await send('DOM.getDocument', { depth: -1 })).result;
  const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[data-sequence-file]' })).result;
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(OUT, 'notes.txt')] });
  await sleep(400);
  check('a file that isn\'t a sequence: said so, menu stays open', await ev(`!!${menu}?.querySelector('[role=alert]') && ${menu}.querySelector('[role=alert]').textContent.includes("doesn't look like a protein sequence")`), await ev(`${menu}?.querySelector('[role=alert]')?.textContent ?? 'no alert'`));
  await shot('menu-file-error', menuAndComposer);
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(OUT, 'hba.fasta')] });
  await sleep(400);
  check('a FASTA file: into the composer, menu closed', (await value()).startsWith('>sp|P69905|HBA_HUMAN') && await ev(`!${menu}`), (await value()).slice(0, 40));
  await setText('');

  console.log('\n[6] sending in a mode');
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-mode="cofold"]').click()`);
  await setText('aspirin');
  await sleep(100);
  await ev(`document.querySelector('[data-chat-send]').click()`);
  check('Co-fold mode sends "Co-fold aspirin"', await waitFor(`[...document.querySelectorAll('[data-message="user"]')].some(m => m.innerText.trim() === 'Co-fold aspirin')`, 5000));
  check('...which runs a co-fold, not an AI answer', await waitFor(`/Couldn't co-fold aspirin/.test(document.body.innerText)`, 15000) && posted.some(p => p.startsWith('POST /api/cofold')), JSON.stringify(posted));
  check('the mode was for one message', await chip() === null);
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-mode="investigate"]').click()`);
  await setText('What holds the zinc?');
  await sleep(100);
  await ev(`document.querySelector('[data-chat-send]').click()`);
  check('Investigate mode runs an investigation', await waitFor(`!!document.querySelector('[data-investigation]')`, 5000) && await waitFor(`document.querySelector('[data-investigation]')?.dataset.phase === 'done'`, 40000), await ev(`document.querySelector('[data-investigation]')?.dataset.phase`));
  check('the mode was for one message', await chip() === null);

  console.log('\n[7] co-fold not set up');
  cofoldAvailable = false;
  await send('Page.reload');
  await waitFor(`!!document.querySelector('textarea') && document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`, 30000);
  await sleep(1200);
  await openMenu();
  check('Co-fold disabled, with the reason', await ev(`${menu}.querySelector('[data-menu-mode="cofold"]').disabled && ${menu}.querySelector('[data-menu-mode="cofold"]').textContent.includes('Not set up on this server')`));
  await key('ArrowDown'); await key('ArrowDown');
  check('the keyboard skips it', await ev(`document.activeElement?.dataset.menuPrompts !== undefined`), await ev(`document.activeElement?.textContent.slice(0, 20)`));
  await key('Escape');
  check('the welcome card for Co-fold says so too, and does nothing', await ev(`(() => { const b = [...document.querySelectorAll('[data-chat-empty] button')].find(b => b.textContent.includes('Co-fold a molecule')); b?.click(); return !!b && b.disabled && b.textContent.includes('Not set up on this server'); })()`) && await ev(`!document.querySelector('[data-mode-chip]')`));
  await openMenu();
  await ev(`${menu}.querySelector('[data-menu-prompts]').click()`);
  await sleep(120);
  await ev(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Predict').click()`);
  await sleep(120);
  await ev(`${menu}.querySelector('[data-prompt="Co-fold a molecule"]').click()`);
  await sleep(150);
  check('a Co-fold prompt spells the request out instead of switching on a mode that can\'t run', await chip() === null && await value() === 'Co-fold aspirin', `${await chip()} | ${await value()}`);
  await setText('');
  await ev(`document.querySelector('[data-composer-menu]').click()`);
  await waitFor(`!!${menu}`, 2000);
  await ev(`${menu}.querySelector('[data-menu-mode="investigate"]').click()`);
  await sleep(120);

  console.log('\n[8] a short window 1440 x 440');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 440, deviceScaleFactor: 2, mobile: false });
  await frames(); await sleep(500);
  await openMenu();
  const short = { ...(await fit()), ...(await scroller('[data-menu-scroll]')) };
  check('capped at 60% of the room above the composer, so the menu scrolls', short.height <= Math.round(short.room * 0.6) + 1 && short.scrolls && short.overflowY === 'auto' && Math.abs(short.gap - 8) <= 1, JSON.stringify(short));
  await key('End');
  const endSeen = await ev(`(() => { const el = ${menu}.querySelector('[data-menu-scroll]'), s = el.getBoundingClientRect(), a = document.activeElement.getBoundingClientRect(); return document.activeElement?.dataset.menuPrompts !== undefined && a.top >= s.top - 0.5 && a.bottom <= s.bottom + 0.5 && el.scrollTop >= el.scrollHeight - el.clientHeight - 1; })()`);
  check('End: the last item scrolls into view, all the way down', endSeen);
  await shot('menu-short-end', menuAndComposer);
  await key('Home');
  check('Home: back to the top', await ev(`document.activeElement?.dataset.menuItem === 'sequence-file' && ${menu}.querySelector('[data-menu-scroll]').scrollTop < 2`));
  await wheel(short.x, short.y, 200);
  check('the mouse wheel scrolls it too', (await scroller('[data-menu-scroll]')).scrollTop > 0);
  await key('Escape');

  console.log('\n[9] phone 390 x 844');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await frames(); await sleep(500);
  const phoneRow = await ev(`(() => { const row = document.querySelector('[data-composer-menu]').parentElement; const plus = document.querySelector('[data-composer-menu]').getBoundingClientRect(), send = document.querySelector('[data-chat-send]').getBoundingClientRect(), form = document.querySelector('[data-chat-composer]').getBoundingClientRect(); return { overflow: row.scrollWidth > row.clientWidth + 1, oneLine: Math.abs(plus.top - send.top) < 6, inside: send.right <= form.right + 0.5 }; })()`);
  check('the row with a chip fits one line', !phoneRow.overflow && phoneRow.oneLine && phoneRow.inside, JSON.stringify(phoneRow));
  await openMenu();
  check('the menu fits the window', await ev(`(() => { const m = ${menu}.getBoundingClientRect(); return m.left >= 0 && m.right <= innerWidth && m.top >= 0; })()`));
  const phone = await fit();
  check('...as wide as the composer there too', Math.abs(phone.left) <= 1 && Math.abs(phone.width) <= 1 && phone.height <= 320, JSON.stringify(phone));
  await shot('menu-phone', menuAndComposer);
  check('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors));
} finally { ws.close(); chrome.kill(); }
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
