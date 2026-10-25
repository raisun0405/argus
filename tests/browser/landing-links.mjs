// The landing page at / and the app at /app, wired together: old share links (/#view=…) forwarded to
// /app, the landing's Open Argus buttons, its share preview, and the app's About Argus link and
// palette command opening the landing in a new tab. node cdp-landing-links.mjs [base]
import { BASE, CHROME, OUT, ROOT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-links-${Date.now()}`,
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
const opened = new Map(); // new tabs: targetId -> url
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') problems.push(`EXC ${m.params.exceptionDetails?.exception?.description}`.slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) problems.push(`console.${m.params.type} ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`.slice(0, 300));
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) problems.push(`HTTP ${m.params.response.status} ${m.params.response.url.slice(0, 120)}`);
  if ((m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') && m.params.targetInfo.type === 'page' && m.params.targetInfo.targetId !== page.id)
    opened.set(m.params.targetInfo.targetId, m.params.targetInfo.url);
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { if (await ev(expr).catch(() => false)) return Date.now() - s; await sleep(250); } return -1; };
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const appReady = `!!document.querySelector('[data-structure-id]') && !!document.querySelector('canvas:not([data-chat-column] canvas)')`;
const newTab = async (since, t = 5000) => { const s = Date.now(); while (Date.now() - s < t) { const urls = [...opened.entries()].filter(([id]) => !since.has(id)).map(([, u]) => u).filter((u) => u && u !== 'about:blank'); if (urls.length) return urls; await sleep(200); } return []; };

// A real link the app made (the toolkit's share preview), in the shape links had before the move
const shareUrl = JSON.parse(readFileSync(`${ROOT}/public/landing/data/kras-tools.json`, 'utf8')).share.url;
const payload = shareUrl.slice(shareUrl.indexOf('#'));

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Target.setDiscoverTargets', { discover: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('[1] an old share link, /#view=…');
  await send('Page.navigate', { url: `${BASE}/${payload}` });
  check('forwarded to /app with the same fragment', (await waitFor(`location.pathname === '/app' && location.hash === ${JSON.stringify(payload)}`, 15000)) >= 0, await ev('location.pathname + location.hash.slice(0, 24)'));
  check('the app opens it', (await waitFor(appReady, 30000)) >= 0);
  check('as a shared view', (await waitFor(`[...document.querySelectorAll('[data-message="assistant"] p')].some(s => s.textContent === 'Shared view')`, 30000)) >= 0);
  check('of the structure in the link', (await waitFor(`document.querySelector('[data-structure-id]')?.textContent === '6OIM'`, 30000)) >= 0, await ev(`document.querySelector('[data-structure-id]')?.textContent`));
  check('the landing was not left in the history', await ev('history.length') <= 2, `history ${await ev('history.length')}`);

  console.log('\n[2] the landing page');
  await send('Page.navigate', { url: `${BASE}/` });
  check('stays on / without a link', (await waitFor(`document.documentElement.dataset.stage === 'ready'`, 20000)) >= 0 && (await ev('location.pathname')) === '/');
  check('the metal buttons mounted', (await waitFor(`document.querySelectorAll('.metal-host.is-metal').length === 3`, 15000)) >= 0, await ev(`document.querySelectorAll('.metal-host.is-metal').length`));
  const opens = await ev(`[...document.querySelectorAll('a')].filter(a => /Open Argus/.test(a.textContent)).map(a => [a.getAttribute('href'), a.target || '', a.textContent.trim()])`);
  check('every Open Argus goes to /app, same tab, no arrows', opens.length >= 3 && opens.every(([href, target, text]) => href === '/app' && !target && text === 'Open Argus'), JSON.stringify(opens));
  await ev(`document.querySelectorAll('.tk-tab')[7].click()`);
  await sleep(1200);
  const shareHref = await ev(`[...document.querySelectorAll('[data-tk-body] a')].find(a => /Open this view in Argus/.test(a.textContent))?.getAttribute('href') ?? ''`);
  check('the share preview links to /app#view= on this site', shareHref.startsWith('/app#view='), shareHref.slice(0, 30));
  const shown = await ev(`[document.querySelector('[data-app-address]').textContent, document.querySelector('.share-base')?.textContent ?? '']`);
  check('the address bar and the share preview name this site', shown.every((text) => text === `${new URL(BASE).host}/app`), JSON.stringify(shown));
  await ev(`scrollTo(0, 0)`);
  await sleep(300);
  await ev(`document.querySelector('.metal-host.is-metal a').click()`);
  check('Open Argus opens the app', (await waitFor(`location.pathname === '/app'`, 10000)) >= 0 && (await waitFor(appReady, 30000)) >= 0);

  console.log('\n[3] the app: About Argus');
  check('the welcome screen has the About link', (await waitFor(`!!document.querySelector('[data-about-link]')`, 10000)) >= 0);
  const about = await ev(`(() => { const a = document.querySelector('[data-about-link]'); return [a.getAttribute('href'), a.target, a.rel, a.textContent.trim()]; })()`);
  check('to /, in a new tab', about[0] === '/' && about[1] === '_blank' && about[2].includes('noopener'), JSON.stringify(about));
  let before = new Set(opened.keys());
  await ev(`document.querySelector('[data-about-link]').click()`);
  let tabs = await newTab(before);
  check('clicking it opens the landing in a new tab', tabs.some((u) => u === `${BASE}/`), JSON.stringify(tabs));
  check('the app stays where it was', (await ev('location.pathname')) === '/app');

  await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))`);
  check('the palette opens', (await waitFor(`!!document.querySelector('[aria-label="Command palette"]')`, 3000)) >= 0);
  await ev(`(() => { const i = document.querySelector('input[aria-label="Search commands"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'about'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(400);
  const found = await ev(`[...document.querySelectorAll('#command-results [role=option]')].map(o => o.textContent.trim())`);
  check('"about" finds About Argus', found.some((t) => t.startsWith('About Argus')), JSON.stringify(found.slice(0, 3)));
  before = new Set(opened.keys());
  await ev(`[...document.querySelectorAll('#command-results [role=option]')].find(o => o.textContent.trim().startsWith('About Argus')).click()`);
  tabs = await newTab(before);
  check('running it opens the landing in a new tab', tabs.some((u) => u === `${BASE}/`), JSON.stringify(tabs));
  check('and closes the palette', (await waitFor(`!document.querySelector('[aria-label="Command palette"]')`, 3000)) >= 0);

  console.log('\n[4] /app/ and a query');
  for (const url of [`${BASE}/app/`, `${BASE}/app?theme=crimson`]) {
    await send('Page.navigate', { url });
    check(`${url.slice(BASE.length)} opens the app`, (await waitFor(appReady, 30000)) >= 0);
  }
  check('the theme from the query applies', await ev(`document.documentElement.dataset.theme`) === 'crimson', await ev(`document.documentElement.dataset.theme`));

  check('no console errors, exceptions or failed requests', problems.length === 0, problems.length ? JSON.stringify([...new Set(problems)], null, 1) : '');
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
} finally { ws.close(); chrome.kill(); }
