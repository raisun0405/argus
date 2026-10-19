// api/report.ts and its email (services/alertEmail.ts): what it accepts, what it logs, and what it asks
// Resend (Resend simulated).
//   node tf-report-api.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
import { createHash } from 'node:crypto';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

// The clock, so each case can start a fresh hour (the site sends at most 2 alerts an hour)
let clock = Date.parse('2026-10-10T08:00:00Z');
Date.now = () => clock;
const nextHour = () => { clock = (Math.floor(clock / 3600_000) + 1) * 3600_000 + 60_000; };

// Resend, simulated: records every call; answers with `resendStatus` (or can't be reached); keeps
// idempotency keys as its docs say (another body under a used key: 409)
const calls = [];
const keysUsed = new Map();
let resendStatus = 200;
let unreachable = false;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ method: init.method ?? 'GET', url: String(url), body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} });
  if (unreachable) throw new TypeError('fetch failed');
  const key = init.headers?.['Idempotency-Key'];
  if (key && keysUsed.has(key) && keysUsed.get(key) !== init.body) return new Response(JSON.stringify({ statusCode: 409, name: 'invalid_idempotent_request' }), { status: 409 });
  if (resendStatus === 200) {
    if (key) keysUsed.set(key, init.body);
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  }
  return new Response(JSON.stringify({ statusCode: resendStatus, name: 'validation_error', message: 'You can only send testing emails to your own email address' }), { status: resendStatus });
};
const logs = [];
const realError = console.error;
console.error = (...args) => logs.push(args.join(' '));

const { default: handler } = await import(`${ROOT_URL}api/report.ts`);
const { browserName, pageLink, offSiteLinksRemoved } = await import(`${ROOT_URL}services/alertEmail.ts`);
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
let ip = 0;
const post = (body, { origin = 'http://127.0.0.1:3100', raw, sameIp, ua = 'TestBrowser/1.0' } = {}) => handler(new Request('http://127.0.0.1:3100/api/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, 'User-Agent': ua, 'x-real-ip': sameIp ?? `10.20.0.${++ip}` },
  body: raw ?? JSON.stringify(body),
}));
const sample = (message, line = 120) => ({ kind: 'error', message, source: `/assets/app-abc.js:1:${line}`, stack: `at Viewer.draw (/assets/app-abc.js:1:${line})\nat run (/assets/app-abc.js:1:9)`, page: '/app', build: 'abc1234' });
// The server's fingerprint, worked out the same way: the message with numbers blurred, and the function
const fp = msg => createHash('sha256').update(`${msg.replace(/\d+/g, '#')}|at Viewer.draw`).digest('hex').slice(0, 8);
const emails = () => calls.filter(c => c.method === 'POST' && c.url === 'https://api.resend.com/emails');

console.log('[what it accepts]');
check('GET is refused', (await handler(new Request('http://127.0.0.1:3100/api/report'))).status === 405);
check('another website is refused', (await post(sample('x'), { origin: 'https://evil.example' })).status === 403);
check('not JSON is refused', (await post(null, { raw: 'not json' })).status === 400);
check('no message is refused', (await post({ kind: 'error', message: '' })).status === 400);
check('an unknown kind is refused', (await post({ kind: 'warning', message: 'x' })).status === 400);
check('a report over 4,000 characters is refused', (await post(null, { raw: JSON.stringify({ kind: 'error', message: 'x'.repeat(5000) }) })).status === 413);
check('a page that is not a path is refused', (await post({ ...sample('Page case'), page: '/app — sign in again at evil.example' })).status === 400);
await post({ ...sample('Build case'), build: '<b>build</b> 1' });
check('a build that is not a commit is logged as unknown', logs.at(-1).includes('"build":"unknown"'));
check('a good report is taken (204)', (await post(sample('Cannot read properties of undefined (reading length)'))).status === 204);
check('...and logged, with the site, page, build and browser', logs.some(l => l.includes('[live-error') && l.includes('reading length') && l.includes('"page":"/app"') && l.includes('"build":"abc1234"') && l.includes('TestBrowser/1.0')));
check('...without an email when no key is set', calls.length === 0);
let limited = 0;
for (let i = 0; i < 11; i++) limited = (await post(sample(`rate ${i}`), { sameIp: '10.99.0.1' })).status;
check('the 11th report in a minute from one visitor is refused (429)', limited === 429);

console.log('\n[email, when set up]');
process.env.RESEND_API_KEY = 're_test_key';
process.env.REPORTS_EMAIL = ' me@example.com ';
calls.length = 0;
await post(sample('Viewer exploded'), { ua: CHROME_WIN });
const first = emails()[0];
check('a new kind of error: one email through Resend', calls.length === 1 && !!first, calls.map(c => `${c.method} ${c.url}`).join(', '));
check('...sent with the key, from the server', first?.headers?.Authorization === 'Bearer re_test_key');
check('...under the hour\'s first slot', first?.headers?.['Idempotency-Key'] === '127.0.0.1:3100/alerts/2026-10-10T08/0', first?.headers?.['Idempotency-Key']);
check('...to REPORTS_EMAIL, from Resend\'s shared sender', first?.body?.to === 'me@example.com' && /<onboarding@resend\.dev>$/.test(first?.body?.from ?? ''), `${first?.body?.from} -> ${first?.body?.to}`);
check('...subject: the message and its fingerprint', first?.body?.subject === `Live error: Viewer exploded [${fp('Viewer exploded')}]`, first?.body?.subject);
const html = first?.body?.html ?? '';
const body = first?.body?.text ?? '';
check('...an HTML email for phones: viewport, 600 px column, under 30 KB', html.startsWith('<!doctype html>') && html.includes('name="viewport"') && html.includes('max-width:600px') && html.length < 30_000, `${html.length} chars`);
check('...its status line, message, page, time, browser and build', html.includes('Uncaught error</p>') && html.includes('#dc2626') && html.includes('>Viewer exploded</h1>') && html.includes('>App</p>') && /\d{1,2} [A-Z][a-z]{2} 20\d\d, \d\d:\d\d UTC/.test(html) && html.includes('Chrome 141 on Windows') && html.includes('abc1234'));
check('...a button to the page, on the site itself', html.includes('href="http://127.0.0.1:3100/app"') && html.includes('>Open the app</a>'));
check('...the code location, function and file', html.includes('>Viewer.draw</span>') && html.includes('/<wbr>assets/<wbr>app-abc.js:<wbr>1:<wbr>120'));
check('...restrained: no purple, no coloured strip', !/#7c3aed|#6d28d9|#f5f3ff|border-top:\s*4px/i.test(html));
check('...and a plain-text copy with the same facts', body.startsWith('Uncaught error on 127.0.0.1:3100/app\n') && body.includes('\nViewer exploded\n') && body.includes('Build: abc1234') && body.includes('Browser: Chrome 141 on Windows') && body.includes('at Viewer.draw (/assets/app-abc.js:1:120)') && body.includes('Open the app: http://127.0.0.1:3100/app') && body.includes(`[live-error ${fp('Viewer exploded')}]`));
calls.length = 0;
await post(sample('Viewer exploded'));
check('the same error again: logged, not emailed again', calls.length === 0 && logs.at(-1).includes(`[live-error ${fp('Viewer exploded')}]`));
calls.length = 0;
await post(sample('Viewer exploded', 999));
check('...from another build too (other line numbers, same fingerprint)', calls.length === 0 && logs.at(-1).includes(`[live-error ${fp('Viewer exploded')}]`));
calls.length = 0;
await post(sample('Index 5 out of range'));
const firstWrites = calls.length;
calls.length = 0;
await post(sample('Index 7 out of range'));
check('numbers in a message don\'t make a new kind of error', firstWrites === 1 && calls.length === 0);
calls.length = 0;
await post(sample('Third fault this hour'));
check('a third new error in the hour: logged, not emailed (2 alerts an hour)', calls.length === 0 && logs.at(-1).includes('Third fault this hour'));
nextHour();
calls.length = 0;
await post(sample('Line one\n  line two'));
check('line breaks in a message stay out of the subject', emails()[0]?.body?.subject?.startsWith('Live error: Line one line two ['), emails()[0]?.body?.subject);
check('...and the alert counts the report the last hour held back', (emails()[0]?.body?.text ?? '').includes('1 other report reached this server since its last alert without an email: the site sends at most 2 alerts an hour.'));
calls.length = 0;
await post({ ...sample('Promise failed'), kind: 'rejection', page: '/' });
const rejection = emails()[0]?.body ?? {};
check('a rejection has its own status line and opening', (rejection.text ?? '').startsWith('Unhandled promise rejection on ') && rejection.html?.includes('Unhandled promise rejection</p>') && rejection.html?.includes('#d97706') && rejection.html?.includes('nothing handled the failure'));
check('...on the landing page, its button says so', rejection.html?.includes('>Landing page</p>') && rejection.html?.includes('>Open the landing page</a>'));
nextHour();
calls.length = 0;
await post({ ...sample('<img src=x onerror=alert(1)> "quoted" & <b>bold</b>'), page: '//evil.example/x' });
const hostile = emails()[0]?.body?.html ?? '';
check('what a report says can\'t become HTML in the email', !hostile.includes('<img') && !hostile.includes('<b>bold') && hostile.includes('&lt;img src=x onerror=alert(1)&gt; &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;'));
check('...and a page address can\'t send the button to another site', !/href="[^"]*evil\.example/.test(hostile) && !hostile.includes('Open the'));
calls.length = 0;
await post({ ...sample('Session expired, sign in again at https://evil.example/login or www.evil.example (see http://127.0.0.1:3100/app)'), stack: 'at Viewer.draw (https://evil.example/x.js:1:2)', page: '/app' });
const lure = emails()[0]?.body ?? {};
check('addresses of other sites are removed from the subject, the email and its text copy', !/evil\.example/.test(`${lure.subject} ${lure.html} ${lure.text}`) && (lure.subject ?? '').includes('[link removed]') && (lure.text ?? '').includes('sign in again at [link removed] or [link removed]'), lure.subject);
check('...the site\'s own address stays', (lure.text ?? '').includes('(see http://127.0.0.1:3100/app)'));
nextHour();
calls.length = 0;
process.env.REPORTS_EMAIL = 'not an address';
const badAddress = await post(sample('Bad address case'));
check('a REPORTS_EMAIL that is not an address: nothing sent, said in the log', badAddress.status === 204 && calls.length === 0 && logs.some(l => l.includes('REPORTS_EMAIL is not an email address')));
process.env.REPORTS_EMAIL = 'me@example.com';
calls.length = 0; resendStatus = 403;
const refused = await post(sample('Refused case'));
check('Resend refusing: the report is still taken and logged, with Resend\'s reason', refused.status === 204 && calls.length === 1 && logs.some(l => l.includes('[report] Resend 403: You can only send testing emails')));
calls.length = 0;
await post(sample('Refused case'));
check('...and for a minute after, Resend is left alone', calls.length === 0);
clock += 2 * 60_000;
calls.length = 0;
await post(sample('Refused case'));
check('...then the same error is tried again (a refusal doesn\'t silence it for 6 hours)', calls.length === 1);
resendStatus = 200; unreachable = true; calls.length = 0;
clock += 2 * 60_000;
const down = await post(sample('Unreachable case'));
check('Resend unreachable: the report is still taken and logged', down.status === 204 && calls.length === 1 && logs.some(l => l.includes('Unreachable case')) && logs.some(l => l.includes('[report] Resend could not be reached in time')));
unreachable = false;
nextHour();
calls.length = 0;
for (let i = 0; i < 8; i++) await post(sample(`Distinct fault ${'abcdefgh'[i]}`));
check('at most 2 emails an hour', emails().length === 2, `${emails().length} sent of 8`);

console.log('\n[still happening, 7 hours later]');
nextHour();
clock += 7 * 3600_000;
calls.length = 0;
await post(sample('Viewer exploded'));
const again = emails()[0]?.body ?? {};
check('the same error after its 6 quiet hours: emailed again, in the same thread', again.subject === `Live error: Viewer exploded [${fp('Viewer exploded')}]`, again.subject);
check('...as "still happening", saying how often it was seen since', again.html?.includes('Still happening · Uncaught error</p>') && again.html?.includes('Seen 3 more times on this server since the last email about it') && (again.text ?? '').startsWith('Still happening · Uncaught error on '));
check('...with a grey dot, not a colour of its own', again.html?.includes('#a1a1aa; font-size:12px;">&#9679;') && !/#7c3aed/i.test(again.html ?? ''));

console.log('\n[the email\'s helpers]');
const names = {
  [CHROME_WIN]: 'Chrome 141 on Windows',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0': 'Edge 141 on Windows',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1': 'Safari 18 on iPhone',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1': 'Chrome 141 on iPhone',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15': 'Safari 18 on Mac',
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36': 'Chrome 141 on Android',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36': 'Samsung Internet 28 on Android',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0': 'Firefox 143 on Linux',
  '': 'Unknown browser',
};
const wrongNames = Object.entries(names).filter(([ua, want]) => browserName(ua) !== want).map(([ua, want]) => `${browserName(ua)} (wanted ${want})`);
check('browser names', wrongNames.length === 0, wrongNames.join('; '));
const links = [
  ['https://argus.example', '/app', 'https://argus.example/app'],
  ['https://argus.example', '/', 'https://argus.example/'],
  ['https://argus.example', '//evil.example/x', null],
  ['https://argus.example', '/\\evil.example', null],
  ['https://argus.example', 'javascript:alert(1)', null],
  ['https://argus.example', 'https://evil.example/', null],
];
const wrongLinks = links.filter(([o, p, want]) => pageLink(o, p) !== want).map(([o, p, want]) => `${p} -> ${pageLink(o, p)} (wanted ${want})`);
check('the button only ever links to a page on the site', wrongLinks.length === 0, wrongLinks.join('; '));
const texts = [
  ['see https://evil.example/a?b=1 now', 'see [link removed] now'],
  ['at www.evil.example', 'at [link removed]'],
  ['HTTPS://EVIL.EXAMPLE', '[link removed]'],
  ['ftp://evil.example/file', '[link removed]'],
  ['https://argus.example.evil.example/x', '[link removed]'],
  ['https://argus.example/app and https://argus.example/assets/x.js:1:2', 'https://argus.example/app and https://argus.example/assets/x.js:1:2'],
  ["Cannot read properties of undefined (reading 'map')", "Cannot read properties of undefined (reading 'map')"],
  ['x.map is not a function at index.js', 'x.map is not a function at index.js'],
];
const wrongTexts = texts.filter(([value, want]) => offSiteLinksRemoved(value, 'https://argus.example') !== want).map(([value, want]) => `${value} -> ${offSiteLinksRemoved(value, 'https://argus.example')} (wanted ${want})`);
check('only other sites\' addresses are removed, nothing else in a message', wrongTexts.length === 0, wrongTexts.join('; '));

// A body is read no further than its cap (S5)
check('a 50 KB report is refused as too large (413)', (await post(null, { raw: JSON.stringify({ message: 'm'.repeat(50_000) }) })).status === 413);
console.error = realError;
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
