// Error reports in the browser: which faults are reported (the app's own code only, once each, five a
// page at most), what a report holds, and that the server logs it. Reports are caught as they leave the
// page (navigator.sendBeacon wrapped) and still sent on to the server.
import { BASE } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';
import { launch, sleep } from '../lib/browser.mjs';
// The dev server's output saved to a file (DEV_LOG): then the test also checks the server logged the reports
const LOG = process.env.DEV_LOG;
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const CATCH = `(() => { window.__beacons = []; const send = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => { data.text().then(t => window.__beacons.push({ url: String(url), body: JSON.parse(t) })); return send(url, data); }; })()`;
const count = `window.__beacons.length`;
const last = `window.__beacons.at(-1)?.body`;
// A real fault, uncaught, in a file this site serves: the 3D viewer library (public/vendor) asked to
// build a viewer in no element, from a timer
const realFault = `(setTimeout(() => window.$3Dmol.createViewer(null)), true)`;
const fakeError = (msg, file, stackLine) => `window.dispatchEvent(new ErrorEvent('error', { message: ${JSON.stringify(msg)}, filename: ${file}, lineno: 3, colno: 7, error: Object.assign(new Error(${JSON.stringify(msg)}), { stack: 'Error: ' + ${JSON.stringify(msg)} + '\\n    at fn (' + ${stackLine} + ')' }) })), true`;

const b = await launch({ width: 1440, height: 900, dpr: 1 });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: CATCH });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!(window.__testViewer && window.__testViewer.getModel && window.__testViewer.getModel())`, 60000);
  await sleep(1500);
  check('a normal load reports nothing', (await b.ev(count)) === 0, String(await b.ev(count)));

  console.log('\n[the app]');
  await b.ev(realFault);
  await sleep(800);
  const r1 = await b.ev(last);
  check("a real uncaught error in the site's own code is reported", (await b.ev(count)) === 1 && !!r1?.message && /\/vendor\/3Dmol/.test(r1?.stack ?? ''), `${r1?.message} | ${(r1?.stack ?? '').split('\n')[0]}`);
  check('...with the page, the build, and no site address in it', r1?.page === '/app' && r1?.build === 'local' && r1?.kind === 'error' && !JSON.stringify(r1).includes(BASE), JSON.stringify(r1)?.slice(0, 160));
  await b.ev(realFault);
  await sleep(800);
  check('the same error again is not reported twice', (await b.ev(count)) === 1);
  await b.ev(fakeError('Third-party fault', `'https://other.example/widget.js'`, `'https://other.example/widget.js:1:1'`));
  await b.ev(fakeError('Extension fault', `'chrome-extension://abcdef/content.js'`, `'chrome-extension://abcdef/content.js:2:2'`));
  await b.ev(`window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: '' })), true`);
  await sleep(600);
  check('other sites\', extensions\' and hidden cross-origin errors are not reported', (await b.ev(count)) === 1, String(await b.ev(count)));
  await b.ev(`Promise.reject(Object.assign(new Error('Async fault'), { stack: 'Error: Async fault\\n    at load (' + location.origin + '/services/loader.ts:3:1)' })), true`);
  await sleep(800);
  const r2 = await b.ev(last);
  check('an unhandled rejection in the app\'s code is reported', r2?.kind === 'rejection' && r2?.message === 'Async fault' && r2?.stack.includes('/services/loader.ts'), JSON.stringify(r2)?.slice(0, 140));
  await b.ev(`Promise.reject(new TypeError('Failed to fetch')), true`);
  await sleep(600);
  check('a dropped connection ("Failed to fetch") is not reported', (await b.ev(count)) === 2);
  for (const n of [1, 2, 3, 4]) await b.ev(fakeError(`Fault number ${n}`, `location.origin + '/components/Panel.tsx'`, `location.origin + '/components/Panel.tsx:${n}:1'`));
  await sleep(800);
  check('at most five reports from one page', (await b.ev(count)) === 5, String(await b.ev(count)));
  check('every report went to /api/report', (await b.ev(`window.__beacons.every(x => x.url.endsWith('/api/report'))`)));

  console.log('\n[the landing page]');
  await b.send('Page.navigate', { url: `${BASE}/` });
  await b.waitFor(`document.readyState === 'complete'`, 30000);
  await sleep(1200);
  await b.ev(fakeError('Landing fault', `location.origin + '/landing/page.js'`, `location.origin + '/landing/page.js:9:2'`));
  await sleep(800);
  const r3 = await b.ev(last);
  check('a fault on the landing page is reported too', (await b.ev(count)) === 1 && r3?.page === '/', JSON.stringify(r3)?.slice(0, 120));

  console.log('\n[a share link in the address]');
  // The pages' inline scripts are located by the page's own address, query and #fragment included
  await b.ev(`history.replaceState(null, '', '/?ref=x1#view=SECRETVIEW'), true`);
  await b.ev(fakeError('Inline fault', `location.href`, `location.href + ':4:9'`));
  await sleep(800);
  const r4 = await b.ev(last);
  check("a fault located by the page's address: reported without its query or #fragment", (await b.ev(count)) === 2 && r4?.source === '/' && r4?.stack === 'at fn (/:4:9)' && !/SECRETVIEW|ref=x1/.test(JSON.stringify(r4)), JSON.stringify(r4)?.slice(0, 160));
  // And a real one: a script added to the page with code of its own
  await b.ev(`(() => { const s = document.createElement('script'); s.textContent = 'setTimeout(function inlineFault() { null.boom; })'; document.head.appendChild(s); return true; })()`);
  await sleep(800);
  const all = await b.ev(`JSON.stringify(window.__beacons.map(x => x.body))`);
  check('...a real inline-script fault leaks neither either', !/SECRETVIEW|ref=x1/.test(all), `${await b.ev(count)} reports; last: ${JSON.stringify(await b.ev(last))?.slice(0, 160)}`);
} finally {
  b.close();
}

if (LOG) {
  console.log('\n[the server]');
  await sleep(1000);
  const log = readFileSync(LOG, 'utf8');
  check('the server logged the reports', /\[live-error [0-9a-f]{8}\].*Async fault/.test(log) && /\[live-error [0-9a-f]{8}\].*"page":"\/"/.test(log));
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
