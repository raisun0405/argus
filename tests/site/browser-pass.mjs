// With Bot Protection on: does a browser still get the app and reach the AI functions? Loads the live app in
// Chrome, then posts an empty body to each AI function from inside the page (the function refuses it before
// any AI call, so no credit is spent) and asks for one quality report. Run once as headless Chrome says it
// is, once with a normal Chrome user agent. Error reports are kept in the browser (on a live site they
// would be emailed).
//   node tf-browser-pass.mjs <base>
import { launch, sleep } from '../lib/browser.mjs';
const BASE = (process.argv[2] ?? 'https://argus-zeta-rouge.vercel.app').replace(/\/$/, '');
const NORMAL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

for (const [label, ua] of [['headless Chrome as it is', null], ['Chrome with a normal user agent', NORMAL_UA]]) {
  console.log(`[${label}, ${BASE}]`);
  const b = await launch({
    width: 1440, height: 900, dpr: 1, canned: false, intercept: ['*/api/report*'],
    onPaused: (params, send) => send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204 }),
  });
  try {
    if (ua) await b.send('Network.setUserAgentOverride', { userAgent: ua });
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: `${BASE}/app` });
    const loaded = await b.waitFor(`!!document.querySelector('textarea')`, 45000);
    const page = await b.ev(`({ title: document.title, checkpoint: /Security Checkpoint|verifying your browser/i.test(document.body?.innerText ?? '') })`);
    check('the app loads', loaded >= 0, page);
    if (loaded >= 0) {
      const results = await b.ev(`(async () => {
        const out = {};
        for (const route of ['analyze', 'investigate', 'cofold']) {
          const r = await fetch('/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          out[route] = { status: r.status, mitigated: r.headers.get('x-vercel-mitigated'), type: r.headers.get('content-type') };
        }
        return out;
      })()`);
      for (const [route, r] of Object.entries(results)) {
        check(`/api/${route} from the page reaches the function`, !r.mitigated && r.status === 400 && /json/.test(r.type ?? ''), r);
      }
      // A quality report by GET, as the app asks: each pass is a fresh browser, so the second one's copy
      // comes from Vercel's CDN rather than the function
      const quality = await b.ev(`fetch('/api/quality?id=4hhb').then(async r => ({ status: r.status, id: (await r.json()).id, cache: r.headers.get('cache-control'), vercel: r.headers.get('x-vercel-cache') }))`);
      check('/api/quality by GET serves the report, kept an hour by the browser', quality.status === 200 && quality.id === '4hhb' && /max-age=3600/.test(quality.cache ?? ''), quality);
      if (ua) check('...and the second fresh browser gets the CDN\'s copy', /HIT|STALE/.test(quality.vercel ?? ''), quality);
    }
  } finally {
    b.close();
  }
  await sleep(500);
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
