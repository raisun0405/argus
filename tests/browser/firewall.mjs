// What a visitor sees when the hosting's firewall (Vercel's bot check) stops a request to the site's own
// functions. Each request is answered in the browser with the challenge page Vercel sends (HTML, 403 or
// 429, x-vercel-mitigated: challenge), so nothing reaches a server and no AI credit is spent.
//   1. a question: "reload the page" at once, not a rate-limit wait and "the AI is busy"
//   2. co-fold: the same reason in its message
//   3. the services, in the page (dev server only: it imports the app's modules)
//   node cdp-firewall.mjs [base]
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
const DEV = /127\.0\.0\.1|localhost/.test(BASE);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };
const MESSAGE = "The site's check for automated traffic stopped this request. Reload the page, then try again.";
const REASON = "the site's check for automated traffic stopped the request; reload the page, then try again";
const CHECKPOINT = '<!doctype html><html><head><title>Vercel Security Checkpoint</title></head><body><p>We\'re verifying your browser</p></body></html>';
const challenge = (requestId, status) => ({
  requestId, responseCode: status,
  responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'x-vercel-mitigated', value: 'challenge' }],
  body: Buffer.from(CHECKPOINT).toString('base64'),
});
const json = (requestId, data) => ({ requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(data)).toString('base64') });
const answers = `document.querySelectorAll('[data-message="assistant"]').length`;
const LAST = `[...document.querySelectorAll('[data-message="assistant"]')].at(-1)`;

let status = 429;
const asked = { analyze: 0, cofoldGet: 0, cofoldPost: 0, analyzeAt: [] };
const b = await launch({
  width: 1440, height: 900, dpr: 1, canned: false,
  intercept: ['*/api/analyze*', '*/api/cofold*', '*/api/report*'],
  onPaused: (params, send) => {
    const { url, method } = params.request;
    // Error reports stay in the browser: on a live site they would be emailed
    if (url.includes('/api/report')) return send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204 });
    if (url.includes('/api/analyze')) { asked.analyze++; asked.analyzeAt.push(Date.now()); return send('Fetch.fulfillRequest', challenge(params.requestId, status)); }
    if (url.includes('/api/cofold') && method === 'GET') { asked.cofoldGet++; return send('Fetch.fulfillRequest', json(params.requestId, { available: true })); }
    if (url.includes('/api/cofold')) { asked.cofoldPost++; return send('Fetch.fulfillRequest', challenge(params.requestId, 403)); }
    send('Fetch.continueRequest', { requestId: params.requestId });
  },
});
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea') && !!document.querySelector('[data-structure-id]')`, 30000);
  await sleep(2500);

  console.log('[1. a question the firewall stops]');
  for (const code of [429, 403]) {
    status = code;
    const before = await b.ev(answers);
    const calls = asked.analyze;
    await b.say(`what binds here ${code}`);
    await b.waitFor(`${answers} > ${before}`, 40000);
    // From the question's first request to the answer on screen (the facts gathered before it don't count)
    const took = asked.analyzeAt.length > calls ? Date.now() - asked.analyzeAt[calls] : Infinity;
    const text = (await b.ev(`${LAST}?.textContent ?? ''`)).trim();
    check(`${code}: the answer asks for a reload`, text.includes(MESSAGE), text.slice(0, 140));
    check(`${code}: ...at once, without a rate-limit wait (${(took / 1000).toFixed(1)} s)`, took < 5000, `${took} ms`);
    check(`${code}: ...asked once, not again after a wait`, asked.analyze - calls === 1, `${asked.analyze - calls} requests`);
    check(`${code}: ...with Try again beside it`, await b.ev(`!![...(${LAST}?.querySelectorAll('button') ?? [])].find(x => /try again/i.test(x.textContent))`));
  }

  console.log('\n[2. co-fold the firewall stops]');
  {
    const before = await b.ev(answers);
    await b.say('cofold ATP');
    await b.waitFor(`${answers} > ${before} && /co-fold/i.test(${LAST}?.textContent ?? '')`, 90000);
    const text = (await b.ev(`${LAST}?.textContent ?? ''`)).trim();
    check('the co-fold message gives the reason and the way on', text.includes(`Couldn't co-fold ATP: ${REASON}.`), text.slice(0, 160));
    check('...after one request', asked.cofoldPost === 1, `${asked.cofoldPost} requests`);
  }

  console.log('\n[3. the services, in the page]');
  if (!DEV) {
    console.log('  (skipped: it needs the dev server, which serves the app\'s modules)');
  } else {
    const r = await b.ev(`(async () => {
      const http = await import('/services/http.ts');
      const page = (status, headers) => new Response('<html></html>', { status, headers });
      const reads = {
        challenge403: http.stoppedByFirewall(page(403, { 'content-type': 'text/html', 'x-vercel-mitigated': 'challenge' })),
        challenge429: http.stoppedByFirewall(page(429, { 'content-type': 'text/html', 'x-vercel-mitigated': 'challenge' })),
        deny: http.stoppedByFirewall(page(403, { 'x-vercel-mitigated': 'deny' })),
        htmlWithoutHeader: http.stoppedByFirewall(page(403, { 'content-type': 'text/html' })),
        rateLimitJson: http.stoppedByFirewall(new Response('{"error":"busy"}', { status: 429, headers: { 'content-type': 'application/json' } })),
        serverError: http.stoppedByFirewall(page(500, { 'content-type': 'text/html' })),
        ok: http.stoppedByFirewall(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })),
      };
      const realFetch = window.fetch;
      let calls = 0;
      let mode = 'challenge';
      window.fetch = async (url, init) => {
        if (String(url).startsWith('/api/')) {
          calls++;
          if (mode === 'challenge') return page(429, { 'content-type': 'text/html', 'x-vercel-mitigated': 'challenge' });
          return new Response(JSON.stringify({ available: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return realFetch(url, init);
      };
      const attempt = async (fn) => { const t = Date.now(); calls = 0; try { await fn(); return { ok: true }; } catch (e) { return { message: e.message, firewall: !!e.firewall, ms: Date.now() - t, calls }; } };
      try {
        const analysis = await import('/services/analysisService.ts');
        const investigation = await import('/services/investigation.ts');
        const quality = await import('/services/qualityService.ts');
        // Its own copy of the module: the app's has asked about availability already
        const cofold = await import('/services/cofoldService.ts?firewall-test');
        const ask = await attempt(() => analysis.analyzeProteinQuery('firewall test question', undefined, null, { readCache: false, writeCache: false }));
        const plan = await attempt(() => investigation.requestPlan('firewall test', { pdbId: '1TRZ', title: 'Insulin' }));
        const report = await attempt(() => quality.fetchQuality('9zzz'));
        calls = 0;
        const firstAvailable = await cofold.cofoldAvailable();
        mode = 'answer';
        const secondAvailable = await cofold.cofoldAvailable();
        return { reads, ask, plan, report, firstAvailable, secondAvailable, availabilityCalls: calls };
      } finally {
        window.fetch = realFetch;
      }
    })()`);
    const want = { challenge403: true, challenge429: true, deny: true, htmlWithoutHeader: true, rateLimitJson: false, serverError: false, ok: false };
    const wrong = Object.entries(want).filter(([k, v]) => r.reads[k] !== v).map(([k]) => `${k}=${r.reads[k]}`);
    check('a firewall answer is told apart from the server\'s own errors', wrong.length === 0, wrong.join(', '));
    check('a question: the firewall\'s message, at once, one request', r.ask.message === MESSAGE && r.ask.firewall && r.ask.ms < 2000 && r.ask.calls === 1, r.ask);
    check('an investigation\'s plan: the same, so it falls back at once', r.plan.message === MESSAGE && r.plan.firewall && r.plan.ms < 2000 && r.plan.calls === 1, r.plan);
    check('the quality report: the reason, for its panel', r.report.message === REASON, r.report);
    check('co-fold\'s availability is asked again after a stopped request, not ruled out for the visit', r.firstAvailable === false && r.secondAvailable === true, { first: r.firstAvailable, second: r.secondAvailable, calls: r.availabilityCalls });
  }
  check('no exceptions in the page', !b.problems.some(p => p.startsWith('EXC')), b.problems.filter(p => p.startsWith('EXC')).slice(0, 2));
} finally {
  b.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
