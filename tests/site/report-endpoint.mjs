// The error-report endpoint on a live site, with requests it refuses before it logs or emails anything.
// They go from inside a browser on the site (a plain image page, so the app's own error reports never
// fire): with Bot Protection on, a script's request would be stopped before it reached the endpoint.
//   node tf-report-live.mjs <base>
import { launch } from '../lib/browser.mjs';
const BASE = (process.argv[2] ?? 'https://argus.raisun.dev').replace(/\/$/, '');
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

console.log(`[the report endpoint on ${BASE}]`);
const b = await launch({ width: 1200, height: 800, dpr: 1, canned: false });
try {
  await b.send('Page.navigate', { url: `${BASE}/social-preview.jpg` });
  await b.waitFor(`document.readyState === 'complete'`, 30000);
  const statuses = await b.ev(`(async () => {
    const post = (body) => fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then(r => r.status);
    return {
      get: (await fetch('/api/report')).status,
      notJson: await post('not json'),
      notAPath: await post(JSON.stringify({ kind: 'error', message: 'Report endpoint check', page: '/app — not a path', build: 'check' })),
    };
  })()`);
  check('GET is refused (405)', statuses.get === 405, `status ${statuses.get}`);
  check('not JSON is refused (400)', statuses.notJson === 400, `status ${statuses.notJson}`);
  check('a report whose page is not a path is refused (400)', statuses.notAPath === 400, `status ${statuses.notAPath}`);
} finally {
  b.close();
}
// Another website's page can't file a report: its browser sends that site's Origin. A script claims the
// same; the bot check may stop it even before the endpoint does
const res = await fetch(`${BASE}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.invalid' }, body: '{}' });
const stopped = res.headers.has('x-vercel-mitigated');
check(`another website is refused (${stopped ? 'stopped by the bot check first' : res.status})`, res.status === 403 || stopped, `status ${res.status}`);
await res.body?.cancel();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
