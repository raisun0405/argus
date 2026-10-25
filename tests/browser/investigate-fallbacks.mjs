// Investigate mode when the AI fails: the plan from the question's words, the step results instead of a
// write-up, and a planned entry that can't be opened. /api/investigate is answered by this script.
import { BASE, CHROME, OUT } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-invfb-${Date.now()}`, '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const pageErrors = [];
let answer = () => ({ status: 502, body: { error: 'upstream' } }); // (stage, body) => response
const seen = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
  if (m.method === 'Fetch.requestPaused' && m.params.request.url.includes('files.rcsb.org')) {
    // The entry the plan names is no entry: RCSB answers 404 for its file here (9ZZZ was released in
    // October 2026, and no unused four-character ID can be relied on)
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' });
  } else if (m.method === 'Fetch.requestPaused') {
    const body = JSON.parse(m.params.request.postData ?? '{}');
    seen.push(body.stage);
    const { status, body: reply } = answer(body.stage, body);
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(reply)).toString('base64') });
  }
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r?.result?.value; };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(250); } return false; };
const card = `[...document.querySelectorAll('[data-investigation]')].pop()`;
const say = async (text) => {
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await ev(`document.querySelector('[data-chat-send]').click()`);
};
const shot = async (name) => {
  const clip = await ev(`(() => { const c = ${card}.closest('[data-message]'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: Math.min(r.height + 20, 1600), scale: 1 }; })()`);
  await sleep(300);
  const { result } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  writeFileSync(`${OUT}/shots/${name}.png`, Buffer.from(result.data, 'base64'));
};

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/investigate*', requestStage: 'Request' }, { urlPattern: '*files.rcsb.org/download/9ZZZ*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`!!document.querySelector('textarea') && document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`);
  await sleep(1500);

  console.log('\n[1] the AI fails both times');
  answer = () => ({ status: 502, body: { error: 'Model returned invalid JSON' } });
  await say('investigate: which mutations are likely harmful here?');
  check('finished anyway', await waitFor(`${card}?.dataset.phase === 'done'`, 60000), await ev(`${card}?.dataset.phase`));
  check('both AI calls were tried, each once more after its 502', JSON.stringify(seen) === JSON.stringify(['plan', 'plan', 'write', 'write']), JSON.stringify(seen));
  check('planned from the question\'s words, and says so', /Planned from the question's wording/.test(await ev(`${card}.innerText`)));
  check('the step results stand in for the write-up, and it says so', /The AI couldn't write this up/.test(await ev(`${card}.innerText`)) && await ev(`${card}.querySelectorAll('[data-cite]').length >= 2`));
  check('steps: annotations and variant effects (the question asks about mutations)', /UniProt and PDBe annotations/.test(await ev(`(${card}.querySelector('[data-trace-toggle]').click(), new Promise(r => setTimeout(() => r(${card}.innerText), 300)))`)) && /Variant effects/.test(await ev(`${card}.innerText`)));
  await shot('investigate-fallback-ai');

  console.log('\n[2] the plan names an entry that doesn\'t exist');
  await sleep(500);
  seen.length = 0;
  answer = (stage) => stage === 'plan'
    ? { status: 200, body: { structure: '9ZZZ', title: 'Zinc in insulin', steps: [{ tool: 'facts', why: 'Annotations' }, { tool: 'ligands', why: 'What holds the zinc' }] } }
    : { status: 200, body: { title: 'Zinc held by histidines', answer: 'Each zinc sits between the B10 histidines of three chains [2].', marks: [{ set: 'ligand', label: 'Zinc contacts' }] } };
  await say('investigate: what holds the zinc?');
  check('finished on the structure on screen', await waitFor(`${card}?.dataset.phase === 'done'`, 60000) && await ev(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`), await ev(`${card}?.dataset.phase`));
  check('says the planned entry couldn\'t be opened', /The plan named 9ZZZ, which couldn't be opened, so this looks at 1TRZ instead/.test(await ev(`${card}.innerText`)), await ev(`${card}.innerText.slice(0, 300)`));
  check('the write-up\'s mark comes from the ligand step', await ev(`[...${card}.closest('[data-message]').querySelectorAll('[data-highlight-chip] .truncate')].some(e => e.textContent === 'Zinc contacts')`));
  await shot('investigate-fallback-structure');
  check('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors));
} finally { ws.close(); chrome.kill(); }
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
