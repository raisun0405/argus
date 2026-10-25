// The residue under the pointer and the tool forms: sweeping the sequence strip changes nothing on the
// page but the status line (it used to re-render the whole workspace per residue), the strip's hover
// tint, the Overlay form's message (readable, announced, tied to its field), Co-fold's reason it is
// unavailable while an answer is coming, and on a phone, a tap on the structure says what is there.
//   node hover-and-forms.mjs [base]
import { launch, sleep, BASE, tabSel } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const V = 'window.__testViewer';
const statusLine = `(document.querySelector('[data-status-line]')?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;
const toolButton = label => `[...document.querySelectorAll('[role=toolbar][aria-label=Tools] button')].find(b => b.textContent.includes(${JSON.stringify(label)}))`;

// An answer held back until released: the chat stays busy meanwhile
let release = null;
const answer = (query, context) => {
  const q = query.toLowerCase();
  if (/h(a)?emoglobin/.test(q)) return { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'A canned answer about haemoglobin.', highlights: [], measurements: [] };
  const reply = { pdbId: context?.pdbId ?? '4HHB', title: context?.title ?? 'Structure', summary: 'A short canned answer about the structure on screen.', highlights: [], measurements: [] };
  if (/hold/.test(q)) return new Promise(r => { release = () => r(reply); });
  return reply;
};

// Co-fold counts as set up, whatever keys the dev server holds
const cofoldSetUp = {
  intercept: ['*/api/cofold*'],
  onPaused: (p, send) => (p.request.method === 'GET' ? send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"available":true}').toString('base64') }) : send('Fetch.continueRequest', { requestId: p.requestId })),
};

// ---------------- Desktop ----------------
const b = await launch({ width: 1440, height: 900, dpr: 1, answer, ...cofoldSetUp });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);
  await b.say('show me haemoglobin');
  check('haemoglobin opens', (await b.waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '4HHB' && document.querySelectorAll('[data-resi]').length > 100`, 60000)) >= 0);
  await sleep(1500);

  console.log('\n[sweeping the sequence strip]');
  // Every element the page changes while the pointer crosses residues, outside the status line
  await b.ev(`(() => {
    window.__changed = [];
    window.__watch = new MutationObserver(list => { for (const m of list) { const el = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (!el?.closest('[data-status-line]')) window.__changed.push((el?.tagName ?? '?') + (m.attributeName ? '@' + m.attributeName : '')); } });
    window.__watch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    return true;
  })()`);
  // The cells in sight: the strip scrolls, its cells further along sit under the inspector, and the
  // inspector's resize handle reaches a few pixels into the strip
  const cells = await b.ev(`(() => {
    const track = document.querySelector('[data-resi]').closest('.overflow-x-auto').getBoundingClientRect();
    return [...document.querySelectorAll('[data-resi]')].map(c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, resi: c.dataset.resi }; })
      .filter(p => p.x > track.left && p.x < track.right - 12).slice(0, 80);
  })()`);
  const started = Date.now();
  for (const c of cells) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await b.frame();
  const took = Date.now() - started;
  const last = cells.at(-1);
  const said = await b.ev(statusLine);
  check(`the status line names the residue under the pointer (${cells.length} crossed in ${took} ms)`, cells.length >= 40 && new RegExp(`^[A-Z][a-z]{2}${last.resi} · chain A$`).test(said), said);
  const changed = await b.ev(`(window.__watch.disconnect(), window.__changed)`);
  check('nothing else on the page changes while sweeping', changed.length === 0, `${changed.length}: ${[...new Set(changed)].slice(0, 6).join(', ')}`);
  // Read once the colour has eased in (the cells have transition-colors)
  await b.waitFor(`document.querySelector('[data-resi="${last.resi}"]').getAnimations().length === 0`, 2000);
  const tint = await b.ev(`(() => { const c = document.querySelector('[data-resi="${last.resi}"]'); return [getComputedStyle(c).backgroundColor, c.matches(':hover')]; })()`);
  check('the residue under the pointer is tinted (by CSS)', tint[1] && tint[0] !== 'rgba(0, 0, 0, 0)', JSON.stringify(tint));
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 450 });
  await sleep(200);
  check('leaving the strip clears the status line', !(await b.ev(statusLine)).includes(`chain A`), await b.ev(statusLine));

  console.log('\n[the Overlay form]');
  await b.click(toolButton('Overlay'));
  const field = `document.querySelector('[aria-label="PDB ID of the structure to lay over"]')`;
  check('the Overlay picker opens', (await b.waitFor(`!!${field}`, 15000)) >= 0);
  const region = `document.getElementById(${field}.closest('form').parentElement.querySelector('[role=status]')?.id ?? '')`;
  check('its message region is there before anything is typed (so a change is heard)', await b.ev(`!!${region} && ${region}.textContent === ''`));
  await b.ev(`(() => { const f = ${field}; f.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, '1A'); f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(200);
  const message = await b.ev(`(() => { const p = ${region}; return { text: p.textContent, size: parseFloat(getComputedStyle(p).fontSize), field: ${field}.getAttribute('aria-describedby') === p.id, button: ${field}.closest('form').querySelector('button[type=submit]').getAttribute('aria-describedby') === p.id }; })()`);
  check('a short ID: "A PDB ID is four characters, like 1AKE", at a readable size', message.text === 'A PDB ID is four characters, like 1AKE' && message.size >= 11.5, JSON.stringify(message));
  check('...tied to the field and to the button it disables', message.field && message.button);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);

  console.log('\n[Co-fold while an answer is coming]');
  check('Co-fold is on the toolbar', (await b.waitFor(`!!(${toolButton('Co-fold')})`, 10000)) >= 0);
  await b.say('hold this answer for a moment');
  await sleep(500);
  await b.click(toolButton('Co-fold'));
  const alert = `[...document.querySelectorAll('[role=alert]')].find(p => /current answer/.test(p.textContent))`;
  check('the reason shows at once, nothing typed, as an alert', (await b.waitFor(`!!(${alert})`, 10000)) >= 0);
  check('...tied to the molecule field and the Co-fold button', await b.ev(`(() => { const p = ${alert}; return document.querySelector('[aria-label^="Molecule to co-fold"]').getAttribute('aria-describedby') === p.id && [...document.querySelectorAll('button[type=submit]')].some(x => x.getAttribute('aria-describedby') === p.id && x.disabled); })()`));
  release?.();
  check('...and it goes once the answer has arrived', (await b.waitFor(`!(${alert})`, 15000)) >= 0);
  check('no errors in the page', b.problems.length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}

// ---------------- Phone ----------------
const p = await launch({ answer });
try {
  await p.send('Page.navigate', { url: `${BASE}/app` });
  await p.waitFor(`!!document.querySelector('textarea')`, 30000);
  await p.say('show me haemoglobin');
  await p.waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '4HHB' && !!${V}?.getModel?.()`, 60000);
  // The 3D view, from the switch in the header
  await p.click(tabSel('structure'));
  await sleep(2500);
  console.log('\n[phone: a tap on the structure]');
  // A residue near the middle of the view, where it is in the picture (3Dmol gives page coordinates)
  const spot = await p.ev(`(() => {
    const canvas = document.querySelector('canvas:not([data-chat-column] canvas)').getBoundingClientRect();
    let best = null;
    for (const a of ${V}.selectedAtoms({ atom: 'CA' })) {
      const { x, y } = ${V}.modelToScreen({ x: a.x, y: a.y, z: a.z });
      const d = Math.hypot(x - (canvas.left + canvas.width / 2), y - (canvas.top + canvas.height / 2));
      if (!best || d < best.d) best = { x, y, d, label: a.resn + a.resi };
    }
    return best;
  })()`);
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: spot.x, y: spot.y }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const shown = await p.waitFor(`!!document.querySelector('[data-viewer-tooltip]')`, 3000);
  check('a tap shows what is under the finger (what "tap one" promises)', shown >= 0, shown >= 0 ? (await p.ev(`document.querySelector('[data-viewer-tooltip]').textContent`)).slice(0, 60) : `tapped near ${spot?.label}`);
  if (shown >= 0) {
    const tip = await p.ev(`(() => { const r = document.querySelector('[data-viewer-tooltip]').getBoundingClientRect(); return { cx: r.left + r.width / 2, bottom: r.bottom }; })()`);
    check('...just above where the finger landed', Math.abs(tip.cx - spot.x) < 4 && tip.bottom <= spot.y && spot.y - tip.bottom < 30, JSON.stringify({ tip, spot: { x: spot.x, y: spot.y } }));
    check('...and the residue is picked, as before', /1 selected/.test(await p.ev(statusLine)), await p.ev(statusLine));
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: spot.x + 60, y: spot.y + 60 }] });
    await sleep(100);
    check('the next touch puts it away', !(await p.ev(`!!document.querySelector('[data-viewer-tooltip]')`)));
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  check('no errors in the page', p.problems.length === 0, p.problems.slice(0, 3).join(' | '));
} finally {
  p.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
