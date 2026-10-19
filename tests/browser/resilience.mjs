// What the app does when something fails, each failure simulated for real. Scripted answers, no AI calls.
//  1. D8  a broken quality report: its panel says it couldn't be read, nothing crashes
//     R4  the 3D workspace hits a fault while drawing (the dev server's TestFault): it alone is replaced, the
//         chat stays, Try again recovers
//  2. R4  the boundary itself: catches, shows its note, retries, resets, reports; the three notes render
//  3. D4  the structure download stalls: an error with Try again after ~20 s, not "loading" forever
//  4. P5  a second answer that can't be checked doesn't replace a first that could, and nothing claims "Fixed"
//   node cdp-resilience.mjs [base]     (dev server only: part 2 imports the app's modules)
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const desktop = async (b) => {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
};
const H = (chain, resi, label, category = 'active_site') => ({ chain, resi, label, category });
const answers = `document.querySelectorAll('[data-message="assistant"]').length`;
const LAST = `[...document.querySelectorAll('[data-message="assistant"]')].at(-1)`;
const visible = sel => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.getBoundingClientRect().width > 0; })()`;

// --- 1. A broken quality report, then the 3D workspace failing while drawing ---
console.log('[1. a broken quality report, then the 3D workspace hits a fault while drawing]');
{
  let breakQuality = false;
  const reports = [];
  const b = await launch({
    width: 1440, height: 900, dpr: 1,
    answer: () => ({ pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen.', highlights: [H('A', [87], 'Proximal His87')], measurements: [] }),
    intercept: ['*/api/quality*', '*/api/report*'],
    onPaused: (params, send) => {
      const url = params.request.url;
      if (url.includes('/api/report')) {
        reports.push(params.request.postData ?? '');
        return send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204 });
      }
      if (url.includes('/api/quality') && breakQuality) {
        // A report missing its metrics: it once crashed the Quality panel while drawing (D8)
        const body = Buffer.from(JSON.stringify({ id: '4hhb', method: 'xray', resolution: 1.74 })).toString('base64');
        return send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body });
      }
      send('Fetch.continueRequest', { requestId: params.requestId });
    },
  });
  try {
    await desktop(b);
    await b.send('Page.navigate', { url: `${BASE}/app` });
    await b.waitFor(`!!document.querySelector('textarea')`, 30000);
    await sleep(2500); // The first structure's own quality report, unbroken
    breakQuality = true;
    await b.say('show me hemoglobin');
    await b.waitFor(`${answers} >= 1`, 60000);
    await b.waitFor(`(document.querySelector('[data-structure-id]')?.textContent ?? '').includes('4HHB')`, 30000);
    await sleep(2500);
    // Open the inspector's Quality section: the report is checked before it is drawn (D8)
    await b.ev(`[...document.querySelectorAll('aside button')].find(x => x.textContent.trim().startsWith('Quality'))?.click()`);
    const refused = await b.waitFor(`document.querySelector('[data-quality-panel]')?.dataset.qualityStatus === 'error'`, 10000);
    check('the broken report: the panel says it came back incomplete...', refused >= 0 && /incomplete/.test(await b.ev(`document.querySelector('[data-quality-panel]')?.textContent ?? ''`)), await b.ev(`document.querySelector('[data-quality-panel]')?.textContent ?? '(no panel)'`));
    check('...with Try again, and nothing crashed', (await b.ev(`!![...document.querySelectorAll('[data-quality-panel] button')].find(x => /Try again/.test(x.textContent))`)) && !(await b.ev(`!!document.querySelector('[data-crash]')`)));
    await sleep(500);
    check('...nor was anything reported as a fault in the app', !reports.some(r => /metrics|map|undefined/.test(r)), reports.map(r => r.slice(0, 120)));

    // A fault while drawing the workspace, on demand (TestFault, on the dev server only)
    if (!/127\.0\.0\.1|localhost/.test(BASE)) console.log("  (fault on demand skipped: it needs the dev server)");
    else {
      await b.ev(`(() => { window.__argusFault = 'workspace'; return true; })()`);
      await b.say('show me hemoglobin again'); // Anything that redraws the app
      const crashed = await b.waitFor(visible('[data-crash="workspace"]'), 10000);
      check('a fault while drawing: the workspace is replaced by its note', crashed >= 0);
      check('...the page is not blank, and the app-wide note is not needed', !(await b.ev(`!!document.querySelector('[data-crash="app"]')`)) && (await b.ev(`document.getElementById('root').innerText.length`)) > 50);
      await b.waitFor(`${answers} >= 2`, 30000);
      const said = await b.ev(`[...document.querySelectorAll('[data-message="assistant"]')].map(m => m.textContent.slice(0, 80))`);
      // (The second answer about the same structure shows without its title)
      check('the conversation carries on beside it', said.length === 2 && said.every(s => s.includes('Haemoglobin carries oxygen')), said);
      check('the note says the conversation is safe and offers Try again', (await b.ev(`document.querySelector('[data-crash="workspace"]')?.textContent ?? ''`)).includes('Your conversation is safe') && (await b.ev(`!![...document.querySelectorAll('[data-crash="workspace"] button')].find(x => x.textContent === 'Try again')`)));
      await sleep(500);
      check('the fault was reported, like any other fault in the app', reports.some(r => /workspace test fault/.test(r)), reports.map(r => r.slice(0, 120)));
      await b.ev(`(() => { delete window.__argusFault; return true; })()`);
      await b.ev(`[...document.querySelectorAll('[data-crash="workspace"] button')].find(x => x.textContent === 'Try again')?.click()`);
      const back = await b.waitFor(`!document.querySelector('[data-crash="workspace"]') && ${visible('canvas:not([data-chat-column] canvas)')}`, 15000);
      check('Try again draws the workspace again', back >= 0);
      check('...and the chat is still there', (await b.ev(answers)) === 2, await b.ev(answers));
    }
  } finally { b.close(); }
}

// --- 2. The boundary itself, in the page, through the app's own modules ---
console.log('\n[2. the boundary itself]');
if (!/127\.0\.0\.1|localhost/.test(BASE)) console.log("  (skipped: it needs the dev server, which serves the app's modules)");
else {
  const reports = [];
  const b = await launch({
    width: 1440, height: 900, dpr: 1,
    intercept: ['*/api/report*'],
    onPaused: (params, send) => { reports.push(params.request.postData ?? ''); send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204 }); },
  });
  try {
    await desktop(b);
    await b.send('Page.navigate', { url: `${BASE}/app` });
    await b.waitFor(`!!document.querySelector('textarea')`, 30000);
    const r = await b.ev(`(async () => {
      const tick = () => new Promise(res => setTimeout(res, 80));
      // The same React the app runs on: the URLs its own modules import
      const src = await (await fetch('/components/ErrorBoundary.tsx')).text();
      const reactUrl = src.match(/["'](\\/node_modules\\/\\.vite\\/deps\\/react\\.js[^"']*)["']/)[1];
      const React = (await import(reactUrl)).default;
      const dom = await import(reactUrl.replace('/react.js', '/react-dom_client.js'));
      const createRoot = dom.createRoot ?? dom.default.createRoot; // The dev server wraps it as a default export
      const mod = await import('/components/ErrorBoundary.tsx');
      const h = React.createElement;
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      let boom = false, key = 0;
      const Bomb = () => { if (boom) throw new Error('boundary test fault'); return h('p', { 'data-ok': '' }, 'drawn'); };
      const draw = () => root.render(h(mod.default, { resetKey: key, fallback: retry => h('div', null, h(mod.MessageCrash), h('button', { 'data-retry': '', onClick: retry }, 'retry')) }, h(Bomb)));
      const state = () => host.querySelector('[data-ok]') ? 'drawn' : host.querySelector('[data-crash="message"]') ? 'note' : 'other';
      const out = {};
      draw(); await tick(); out.first = state();
      boom = true; draw(); await tick(); out.fault = state();
      boom = false; host.querySelector('[data-retry]').click(); await tick(); out.retried = state();
      boom = true; draw(); await tick(); boom = false; key = 1; draw(); await tick(); out.reset = state();
      // The three notes
      root.render(h(mod.AppCrash)); await tick();
      out.app = { text: host.textContent, buttons: [...host.querySelectorAll('button')].map(x => x.textContent) };
      root.render(h(mod.PaneCrash, { onRetry: () => {}, headerStart: h('span', { 'data-switch': '' }, 'Chat | 3D') })); await tick();
      out.pane = { text: host.textContent, switchInHeader: !!host.querySelector('.border-b [data-switch]') };
      root.render(h(mod.MessageCrash)); await tick();
      out.message = host.textContent;
      root.unmount(); host.remove();
      return out;
    })()`);
    check('children draw normally', r.first === 'drawn', r);
    check('a fault while drawing shows the note instead', r.fault === 'note', r);
    check('retry draws the children again', r.retried === 'drawn', r);
    check('a new resetKey (another structure) draws them again by itself', r.reset === 'drawn', r);
    check('the app-wide note: "Something went wrong", Reload and Start fresh', r.app.text.includes('Something went wrong') && r.app.buttons.join('|') === 'Reload|Start fresh', r.app);
    check('the workspace note keeps the phone\'s Chat | 3D switch in its header', r.pane.switchInHeader && r.pane.text.includes('The 3D view hit a problem'), r.pane);
    check('the message note', r.message.includes("This message couldn't be shown"), r.message);
    await sleep(400);
    check('a caught fault is reported', reports.some(x => x.includes('boundary test fault')), reports.map(x => x.slice(0, 100)));
  } finally { b.close(); }
}

// --- 3. The structure download stalls ---
console.log('\n[3. the structure download stalls]');
{
  let hold = true;
  const b = await launch({
    width: 1440, height: 900, dpr: 1,
    intercept: ['*files.rcsb.org/download/*'],
    onPaused: (params, send) => {
      if (hold) { hold = false; return; } // The first download never answers
      send('Fetch.continueRequest', { requestId: params.requestId });
    },
  });
  try {
    await desktop(b);
    const t0 = Date.now();
    await b.send('Page.navigate', { url: `${BASE}/app` });
    await b.waitFor(`!!document.querySelector('textarea')`, 30000);
    check('while it stalls, the workspace says it is drawing', (await b.waitFor(`document.body.innerText.includes('Drawing the structure')`, 8000)) >= 0);
    const failed = await b.waitFor(`document.body.innerText.includes("didn't send 1TRZ in time")`, 40000);
    const took = Math.round((Date.now() - t0) / 1000);
    check(`after about 20 s it says so instead of loading forever (${took} s)`, failed >= 0 && took >= 15 && took <= 45, `${took} s`);
    const retry = `[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Try again')`;
    check('...with Try again', !!(await b.ev(`!!${retry}`)));
    await b.ev(`${retry}?.click()`);
    const loaded = await b.waitFor(`!document.body.innerText.includes("didn't send 1TRZ in time") && !document.body.innerText.includes('Drawing the structure') && ${visible('canvas:not([data-chat-column] canvas)')}`, 30000);
    check('Try again downloads it afresh and draws it', loaded >= 0);
  } finally { b.close(); }
}

// --- 4. A second answer that can't be checked ---
console.log('\n[4. a second answer that can\'t be checked]');
for (const scenario of ['residues', 'protein']) {
  const first = scenario === 'residues'
    ? { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen.', highlights: [H('A', [87], 'Proximal His87'), H('A', [300], 'Asp300', 'other')], measurements: [] }
    : { pdbId: '2JDF', title: 'Human Insulin Hexamer', summary: 'Insulin stored as a hexamer.', highlights: [], measurements: [] };
  // The retry moves to 1A3N, whose PDBe records never arrive, so it can't be checked
  const second = { pdbId: '1A3N', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin, as the retry describes it.', highlights: [H('A', [87], 'Proximal His87')], measurements: [] };
  const calls = [];
  const b = await launch({
    width: 1440, height: 900, dpr: 1,
    answer: (query) => { calls.push(query); return /\[Correction needed\]/.test(query) ? second : first; },
    intercept: ['*ebi.ac.uk/pdbe/*'],
    onPaused: (params, send) => { if (/1a3n/i.test(params.request.url)) return; send('Fetch.continueRequest', { requestId: params.requestId }); },
  });
  try {
    await desktop(b);
    await b.send('Page.navigate', { url: `${BASE}/app` });
    await b.waitFor(`!!document.querySelector('textarea')`, 30000);
    await b.say(scenario === 'residues' ? 'show me hemoglobin residue 300' : 'load any experimental structure');
    await b.waitFor(`!!${LAST}?.querySelector('[data-answer-checks]')`, 90000);
    await sleep(500);
    const line = await b.ev(`${LAST}.querySelector('[data-answer-checks]').textContent.replace(/\\s+/g, ' ').trim()`);
    const heading = await b.ev(`(${LAST}.querySelector('[data-answer-title]')?.textContent ?? '')`);
    const text = await b.ev(`${LAST}.textContent`);
    check(`${scenario}: the answer went back to the AI once`, calls.length === 2, `${calls.length} calls`);
    if (scenario === 'residues') {
      check('residues: the first answer stands (its faults known) rather than one that couldn\'t be checked', text.includes('Haemoglobin carries oxygen') && !text.includes('as the retry describes it'), text.slice(0, 120));
      check('...and the line still counts its fault', line === "Checked against 4HHB: 1 of 2 marked parts doesn't match the entry", line);
      await b.ev(`${LAST}.querySelector('[data-checks-toggle]').click()`); await sleep(200);
      const rows = await b.ev(`[...${LAST}.querySelectorAll('[data-check-row]')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
      check('...with the reason in its details', rows.some(r => r.endsWith("the second answer couldn't be checked, so this is the first answer")), rows);
    } else {
      check('protein: the second answer replaces one that named the wrong protein', text.includes('as the retry describes it') && heading.includes('deoxyhemoglobin'), text.slice(0, 120));
      check('...but the line doesn\'t claim it was fixed and checked', !/^Fixed/.test(line) && !/Fixed, then checked/.test(line), line);
    }
  } finally { b.close(); }
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
