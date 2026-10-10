// The theme menu after the design pass: opens, hover lights a row without moving focus, the arrow
// keys move focus with a visible bar, Enter picks, the page's theme and the 3D background follow,
// Escape closes and returns focus to the button.
//   node cdp-theme-menu.mjs [base]
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const TRIGGER = `[...document.querySelectorAll('button')].find(b => /theme/i.test(b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width > 0)`;
const ITEMS = `[...document.querySelectorAll('[role="menuitemradio"]')]`;
const key = async (b, k, code) => { for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: k === 'Escape' ? 27 : k === 'Enter' ? 13 : 40, ...(k === 'Enter' && type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) }); await sleep(150); };

const b = await launch({ width: 1440, height: 900, dpr: 1 });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);
  await sleep(500);
  check('a theme button exists in the header', !!(await b.ev(`!!${TRIGGER}`)));
  await b.ev(`${TRIGGER}.click()`);
  await sleep(300);
  const n = await b.ev(`${ITEMS}.length`);
  check('the menu lists the six themes', n === 6, n);
  // Hover the third row: it lights, but focus stays where the menu put it
  const before = await b.ev(`document.activeElement?.textContent?.trim().slice(0, 12)`);
  const box = await b.ev(`(() => { const r = ${ITEMS}[2].getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await sleep(200);
  const after = await b.ev(`document.activeElement?.textContent?.trim().slice(0, 12)`);
  check('hovering a row does not move keyboard focus', before === after, { before, after });
  // Arrow down: focus moves, and the focused row carries the bar at its left edge
  await key(b, 'ArrowDown', 'ArrowDown');
  const focused = await b.ev(`(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { role: el.getAttribute('role'), text: el.textContent.trim().slice(0, 10), shadow: cs.boxShadow }; })()`);
  check('ArrowDown moves focus to a theme row', focused.role === 'menuitemradio', focused);
  check('...and the focused row shows a bar at its edge', /inset/.test(focused.shadow) && focused.shadow !== 'none', focused.shadow);
  // Enter picks it: the page theme and the 3D background change
  const was = await b.ev(`document.documentElement.getAttribute('data-theme') || 'mono'`);
  await key(b, 'Enter', 'Enter');
  await sleep(400);
  const now = await b.ev(`document.documentElement.getAttribute('data-theme')`);
  check('Enter applies the theme', now && now !== was, { was, now });
  check('the menu closed and the button has focus again', (await b.ev(`document.querySelectorAll('[role="menuitemradio"]').length`)) === 0 && (await b.ev(`document.activeElement === ${TRIGGER}`)), await b.ev(`document.activeElement?.tagName + ' ' + (document.activeElement?.getAttribute('aria-label') ?? '')`));
  const canvasBg = await b.ev(`getComputedStyle(document.body).backgroundColor`);
  check('the page background follows the theme', canvasBg !== 'rgb(9, 9, 11)', canvasBg);
  // Back to mono via a click
  await b.ev(`${TRIGGER}.click()`); await sleep(300);
  await b.ev(`${ITEMS}.find(i => /Mono/.test(i.textContent)).click()`); await sleep(400);
  check('clicking a row applies it too', (await b.ev(`document.documentElement.getAttribute('data-theme')`)) === 'mono');
  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally { b.close(); }
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
