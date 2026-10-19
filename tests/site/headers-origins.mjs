// A live site's security headers, origin check and browser permissions. The headers are read by a browser
// on the site (with Bot Protection on, a script's request would get the bot check's challenge instead);
// the origin check is tried by scripts claiming other sites, refused by the function or stopped by the
// bot check before it. Invalid request bodies only, so no AI call, email or GPU job is triggered.
//   node probe-postdeploy.mjs <base>
import { launch, sleep } from '../lib/browser.mjs';
const BASE = (process.argv[2] ?? 'https://argus-zeta-rouge.vercel.app').replace(/\/$/, '');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const WANT = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
};
// The app's own error reports stay in the browser: on a live site they would be emailed
const b = await launch({
  width: 1440, height: 900, dpr: 1, intercept: ['*/api/report*'],
  onPaused: (p, send) => send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204 }),
});
try {
  console.log(`[headers on ${BASE}]`);
  await b.send('Page.navigate', { url: `${BASE}/social-preview.jpg` });
  await b.waitFor(`document.readyState === 'complete'`, 30000);
  const pages = await b.ev(`(async () => {
    const out = {};
    for (const path of ['/', '/app', '/app.html']) {
      const r = await fetch(path);
      out[path] = { status: r.status, headers: Object.fromEntries(${JSON.stringify(Object.keys(WANT))}.map(k => [k, r.headers.get(k)])) };
    }
    const asset = (await (await fetch('/app')).text()).match(/\\/assets\\/[\\w.-]+\\.js/)?.[0];
    const a = asset ? await fetch(asset) : null;
    out.asset = a && { path: asset, cache: a.headers.get('cache-control'), nosniff: a.headers.get('x-content-type-options'), type: a.headers.get('content-type') };
    return out;
  })()`);
  for (const path of ['/', '/app', '/app.html']) {
    const { status, headers } = pages[path];
    const wrong = Object.entries(WANT).filter(([k, v]) => headers[k] !== v).map(([k]) => `${k}=${headers[k]}`);
    check(`${path.padEnd(9)} ${status} carries all five security headers`, status === 200 && wrong.length === 0, wrong.join(' | '));
  }
  check('a script asset keeps its one-year cache and gains nosniff', pages.asset?.cache?.includes('immutable') && pages.asset?.nosniff === 'nosniff', pages.asset);
  check('...and is still served as JavaScript (nosniff would refuse anything else)', /javascript/.test(pages.asset?.type ?? ''), pages.asset?.type);

  console.log('\n[the browser]');
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);
  await sleep(1500);
  const policy = await b.ev(`(() => { const p = document.featurePolicy; return p ? { microphone: p.allowsFeature('microphone'), camera: p.allowsFeature('camera'), geolocation: p.allowsFeature('geolocation') } : null; })()`);
  check('voice input still allowed: the page may use the microphone', policy?.microphone === true, policy);
  check('camera and location are off', policy?.camera === false && policy?.geolocation === false, policy);
  check('the 3D view still draws', !!(await b.ev(`document.querySelector('canvas:not([data-chat-column] canvas)')?.getBoundingClientRect().width > 0`)));
  check('no console errors or warnings from the headers', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}

console.log('\n[origins]');
const post = async (route, origin) => {
  const res = await fetch(`${BASE}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}' });
  await res.body?.cancel();
  return res.headers.has('x-vercel-mitigated') ? 'stopped by the bot check' : res.status;
};
for (const route of ['analyze', 'investigate', 'quality', 'report']) {
  for (const [label, origin] of [['a request claiming localhost:3000', 'http://localhost:3000'], ['a foreign site', 'https://example.invalid']]) {
    const outcome = await post(route, origin);
    check(`/api/${route}: ${label} is refused (${outcome})`, outcome === 403 || outcome === 'stopped by the bot check', String(outcome));
  }
}
// The app asks /api/quality by GET. An ID that is no PDB ID: the origin check comes first, and nothing is
// cached or fetched from wwPDB
const getQuality = async headers => {
  const res = await fetch(`${BASE}/api/quality?id=x`, { headers });
  await res.body?.cancel();
  return res.headers.has('x-vercel-mitigated') ? 'stopped by the bot check' : res.status;
};
for (const [label, headers] of [['a foreign site', { origin: 'https://example.invalid' }], ['a cross-site fetch without an Origin', { 'sec-fetch-site': 'cross-site' }]]) {
  const outcome = await getQuality(headers);
  check(`/api/quality by GET: ${label} is refused (${outcome})`, outcome === 403 || outcome === 'stopped by the bot check', String(outcome));
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
