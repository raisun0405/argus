// api/report.ts under a flood: however many server instances take the reports, the site sends at most
// 2 alert emails an hour. Several instances = the same module imported under different URLs (each has its
// own memory, like Edge instances). Resend is simulated as its docs describe idempotency keys: a key is
// kept 24 hours; the same key with the same body gets the first answer and sends nothing; with another
// body, 409 invalid_idempotent_request; while the first request is still running, 409
// concurrent_idempotent_requests. No network, no real email.
//   node tf-report-ceiling.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

let clock = Date.parse('2026-10-10T08:00:00Z');
Date.now = () => clock;
const HOUR = 3600_000;
const nextHour = () => { clock = (Math.floor(clock / HOUR) + 1) * HOUR + 60_000; };

// --- Resend, simulated ---
const store = new Map(); // Idempotency key -> { body, at, answer }
const running = new Set();
const delivered = []; // Every email actually sent: { key, subject, text, at }
let asked = 0;
let failNext = 0; // Answer the next n new emails with a 500
let seq = 0;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== 'https://api.resend.com/emails') throw new Error(`unexpected fetch ${url}`);
  asked++;
  const key = init.headers?.['Idempotency-Key'];
  const body = init.body;
  const answer = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  if (key) {
    if (running.has(key)) return answer(409, { statusCode: 409, name: 'concurrent_idempotent_requests', message: 'Another request with the same idempotency key is in progress.' });
    const seen = store.get(key);
    if (seen && clock - seen.at < 24 * HOUR) {
      return seen.body === body ? answer(200, seen.answer) : answer(409, { statusCode: 409, name: 'invalid_idempotent_request', message: 'This idempotency key has already been used on a request that had a different payload.' });
    }
    running.add(key);
  }
  await new Promise(r => setTimeout(r, 2 + (seq++ % 7))); // The network: requests overlap
  if (key) running.delete(key);
  if (failNext > 0) { failNext--; return answer(500, { statusCode: 500, name: 'internal_server_error', message: 'Unexpected error' }); }
  const sent = { id: `email-${delivered.length + 1}` };
  const email = JSON.parse(body);
  delivered.push({ key, subject: email.subject, text: email.text, at: clock });
  if (key) store.set(key, { body, at: clock, answer: sent });
  return answer(200, sent);
};
const realError = console.error;
console.error = () => {};

process.env.RESEND_API_KEY = 're_test_key';
process.env.REPORTS_EMAIL = 'me@example.com';
const INSTANCES = 5;
const handlers = [];
for (let i = 0; i < INSTANCES; i++) handlers.push((await import(`${ROOT_URL}api/report.ts?instance=${i}`)).default);

let ipSeq = 0;
const letters = n => { let s = ''; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0); return s; };
const post = (handler, message, ip = `10.${(++ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`) => handler(new Request('https://argus.example/api/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://argus.example', 'User-Agent': 'TestBrowser/1.0', 'x-real-ip': ip },
  body: JSON.stringify({ kind: 'error', message, source: '/assets/app-abc.js:1:2', stack: 'at Viewer.draw (/assets/app-abc.js:1:2)', page: '/app', build: 'abc1234' }),
}));
let rand = 7;
const pick = () => { rand = (rand * 1103515245 + 12345) % 2147483648; return handlers[rand % INSTANCES]; };
// `count` distinct faults (letters, since numbers are blurred out of a fingerprint), 25 at a time, each to any instance
let faultSeq = 0;
const flood = async (count) => {
  const statuses = [];
  for (let i = 0; i < count; i += 25) {
    statuses.push(...(await Promise.all(Array.from({ length: Math.min(25, count - i) }, () => post(pick(), `Flood fault ${letters(faultSeq++)}`)))).map(r => r.status));
  }
  return statuses;
};
const inHour = start => delivered.filter(d => d.at >= start && d.at < start + HOUR);

console.log(`[a flood of distinct reports, ${INSTANCES} server instances]`);
let hourStart = Math.floor(clock / HOUR) * HOUR;
let asks = asked;
const statuses = await flood(400);
check('every report is still taken (204)', statuses.length === 400 && statuses.every(s => s === 204), [...new Set(statuses)].join(','));
check('one hour, 400 distinct reports: 2 emails for the whole site', inHour(hourStart).length === 2, `${inHour(hourStart).length} sent`);
check('...and Resend was asked only a few times', asked - asks <= 4 * INSTANCES, `${asked - asks} requests`);
const keys = inHour(hourStart).map(d => d.key);
check('...each under its own key: the site, the hour, the slot', keys.length === 2 && keys.includes('argus.example/alerts/2026-10-10T08/0') && keys.includes('argus.example/alerts/2026-10-10T08/1'), keys.join(', '));

nextHour();
hourStart = Math.floor(clock / HOUR) * HOUR;
await flood(200);
const second = inHour(hourStart);
check('the next hour: 2 more', second.length === 2, `${second.length} sent`);
check('...and an alert says how many reports its server held back', second.some(d => / other reports reached this server since its last alert without an email: the site sends at most 2 alerts an hour\./.test(d.text)), second.map(d => d.text.split('\n').at(-2)).join(' | '));

const before = delivered.length;
for (let h = 0; h < 24; h++) { nextHour(); await flood(30); }
check('a whole day of it: 48 emails, never more than 2 in an hour', delivered.length - before === 48, `${delivered.length - before} sent`);

console.log('\n[the same flood on two of the deployment\'s addresses]');
nextHour();
hourStart = Math.floor(clock / HOUR) * HOUR;
process.env.VERCEL_PROJECT_PRODUCTION_URL = 'argus.example';
const onHost = (handler, host, message) => handler(new Request(`https://${host}/api/report`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: `https://${host}`, 'User-Agent': 'TestBrowser/1.0', 'x-real-ip': `10.200.${++ipSeq >> 8 & 255}.${ipSeq & 255}` },
  body: JSON.stringify({ kind: 'error', message, source: '/assets/app-abc.js:1:2', stack: 'at Viewer.draw (/assets/app-abc.js:1:2)', page: '/app', build: 'abc1234' }),
}));
for (let i = 0; i < 60; i++) await onHost(pick(), i % 2 ? 'argus.example' : 'argus-git-main-team.example', `Host fault ${letters(faultSeq++)}`);
const hosts = inHour(hourStart);
check('2 emails between them: the count names the site by its production domain', hosts.length === 2 && hosts.every(d => d.key.startsWith('argus.example/alerts/')), hosts.map(d => d.key).join(', '));
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

console.log('\n[one instance, two faults at once, a fresh hour]');
nextHour();
hourStart = Math.floor(clock / HOUR) * HOUR;
const fresh = (await import(`${ROOT_URL}api/report.ts?instance=fresh`)).default;
await Promise.all([post(fresh, 'Pair fault one'), post(fresh, 'Pair fault two')]);
const pair = inHour(hourStart);
check('both emailed, one slot each', pair.length === 2 && new Set(pair.map(d => d.key)).size === 2, pair.map(d => d.key).join(', '));

console.log('\n[the same new fault twice at once]');
nextHour();
hourStart = Math.floor(clock / HOUR) * HOUR;
const twin = (await import(`${ROOT_URL}api/report.ts?instance=twin`)).default;
await Promise.all([post(twin, 'Twin fault'), post(twin, 'Twin fault')]);
check('one email', inHour(hourStart).length === 1, `${inHour(hourStart).length} sent`);

console.log('\n[Resend failing once]');
nextHour();
hourStart = Math.floor(clock / HOUR) * HOUR;
const flaky = (await import(`${ROOT_URL}api/report.ts?instance=flaky`)).default;
failNext = 1;
await post(flaky, 'Unlucky fault');
check('the email that failed is not sent', inHour(hourStart).length === 0);
clock += 30_000;
asks = asked;
await post(flaky, 'Unlucky fault');
check('...half a minute later Resend is left alone', asked === asks, `${asked - asks} requests`);
clock += 90_000;
await post(flaky, 'Unlucky fault');
check('...two minutes on, the same fault is emailed (not silenced for 6 hours)', inHour(hourStart).some(d => d.subject.startsWith('Live error: Unlucky fault')), inHour(hourStart).map(d => d.subject).join(' | ') || 'nothing sent');

console.error = realError;
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
