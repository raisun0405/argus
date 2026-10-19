// api/saved.ts with Cloudflare R2 faked: no real bucket, no real keys. What it stores, how it signs, what it
// refuses, and what it caches.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
import { gunzipSync } from 'node:zlib';

const R2 = 'https://acct123.r2.cloudflarestorage.com/argus-saved/';
const objects = new Map();
const r2Calls = [];
let r2Fails = null; // 'status' | 'throw'
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  if (!request.url.startsWith(R2)) return realFetch(input, init);
  r2Calls.push({ method: request.method, url: request.url, auth: request.headers.get('authorization') ?? '', type: request.headers.get('content-type') });
  if (r2Fails === 'throw') throw new Error('network down');
  if (r2Fails === 'status') return new Response('<Error><Code>InternalError</Code></Error>', { status: 500 });
  const key = request.url.slice(R2.length);
  if (request.method === 'PUT') {
    objects.set(key, new Uint8Array(await request.arrayBuffer()));
    return new Response(null, { status: 200 });
  }
  return objects.has(key) ? new Response(objects.get(key), { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
};

const { default: handler } = await import(`${ROOT_URL}api/saved.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
let ip = 0;
const SITE = 'http://127.0.0.1:3100';
const post = (body, { origin = SITE, visitor = `10.40.0.${++ip}`, raw } = {}) => handler(new Request(`${SITE}/api/saved`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'x-real-ip': visitor }, body: raw ?? JSON.stringify(body),
}));
const get = (id, headers = { 'Sec-Fetch-Site': 'same-origin' }) => handler(new Request(`${SITE}/api/saved?id=${encodeURIComponent(id)}`, { headers: { 'x-real-ip': `10.41.0.${++ip}`, ...headers } }));
const cacheOf = res => res.headers.get('cache-control') ?? '';

const VIEW = { v: 1, kind: 'view', a: { pdbId: '1TRZ', title: 'Insulin', summary: 's', highlights: [] }, s: { colorScheme: 'chain' } };
const PDB = 'ATOM      1  CA  ALA A   1      11.104  13.207   2.100  1.00 90.00           C\nEND\n';
const COFOLD = { v: 1, kind: 'cofold', a: { pdbId: 'COFOLD-ABC1234', title: 'x', summary: '', highlights: [] }, s: {}, structures: [{ id: 'COFOLD-ABC1234', pdb: PDB }] };

console.log('[not set up]');
check('no keys: 503, nothing stored', (await post(VIEW)).status === 503 && r2Calls.length === 0);
process.env.R2_ACCOUNT_ID = 'acct123';
process.env.R2_ACCESS_KEY_ID = 'AKIDTEST';
process.env.R2_SECRET_ACCESS_KEY = 'not-a-real-secret';

console.log('\n[saving]');
let res = await post(VIEW);
let body = await res.json();
check('a view is saved: 201 with a 22-character ID', res.status === 201 && /^[A-Za-z0-9_-]{22}$/.test(body.id ?? ''), `${res.status} ${JSON.stringify(body)}`);
const put = r2Calls.at(-1);
check('...under v1/<id>.json.gz, signed for R2 (SigV4, region auto, s3)', put?.method === 'PUT' && put.url === `${R2}v1/${body.id}.json.gz` && /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/auto\/s3\/aws4_request/.test(put.auth), JSON.stringify(put));
check('...as a gzip file holding exactly what was sent', put?.type === 'application/gzip' && JSON.stringify(JSON.parse(gunzipSync(objects.get(`v1/${body.id}.json.gz`)).toString())) === JSON.stringify(VIEW));
const id = body.id;
const ids = new Set([id]);
for (let i = 0; i < 5; i++) ids.add((await (await post(VIEW)).json()).id);
check('every save gets a new ID', ids.size === 6);
check('a co-fold with its structure is saved', (await post(COFOLD)).status === 201);

console.log('\n[refused when saving]');
const calls = r2Calls.length;
check('another website: 403', (await post(VIEW, { origin: 'https://evil.example' })).status === 403);
check('no Origin on a save: 403', (await handler(new Request(`${SITE}/api/saved`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(VIEW) }))).status === 403);
check('invalid JSON: 400', (await post(null, { raw: '{nope' })).status === 400);
check('another version: 400', (await post({ ...VIEW, v: 2 })).status === 400);
check('an unknown kind: 400', (await post({ ...VIEW, kind: 'anything' })).status === 400);
check('no answer: 400', (await post({ ...VIEW, a: undefined })).status === 400);
check('a co-fold without its structure: 400', (await post({ ...COFOLD, structures: [] })).status === 400);
check('a structure that is not a prediction ID: 400', (await post({ ...COFOLD, structures: [{ id: '../../x', pdb: PDB }] })).status === 400);
check('a structure with no atoms: 400', (await post({ ...COFOLD, structures: [{ id: 'COFOLD-ABC1234', pdb: 'hello' }] })).status === 400);
check('more than four structures: 400', (await post({ ...COFOLD, structures: Array(5).fill(COFOLD.structures[0]) })).status === 400);
check('over 4 MB: 413', (await post({ ...VIEW, padding: 'p'.repeat(4_100_000) })).status === 413);
check('...and none of these reached the bucket', r2Calls.length === calls, `${r2Calls.length - calls} calls`);
check('PUT: 405 with Allow', await (async () => { const r = await handler(new Request(`${SITE}/api/saved`, { method: 'PUT' })); return r.status === 405 && r.headers.get('allow') === 'GET, POST'; })());
const statuses = [];
for (let i = 0; i < 13; i++) statuses.push((await post(VIEW, { visitor: '10.49.9.9' })).status);
check('13th save in 10 minutes from one visitor: 429', statuses.slice(0, 12).every(s => s === 201) && statuses[12] === 429, statuses.join(','));

console.log('\n[opening]');
res = await get(id);
check('GET ?id= returns what was saved', res.status === 200 && JSON.stringify(await res.json()) === JSON.stringify(VIEW));
check('...cached for good (it never changes)', /immutable/.test(cacheOf(res)) && /s-maxage=31536000/.test(cacheOf(res)), cacheOf(res));
res = await get('n'.repeat(22));
check('an ID with nothing saved: 404, not cached', res.status === 404 && cacheOf(res) === 'no-store', `${res.status} ${cacheOf(res)}`);
check('something that is no ID: 400 without asking the bucket', await (async () => { const before = r2Calls.length; const r = await get('../v1/x'); return r.status === 400 && r2Calls.length === before; })());
check('another website\'s Origin: 403', (await get(id, { Origin: 'https://evil.example' })).status === 403);
check('a cross-site fetch without an Origin: 403', (await get(id, { 'Sec-Fetch-Site': 'cross-site' })).status === 403);

console.log('\n[the bucket failing]');
r2Fails = 'status';
res = await post(VIEW);
check('R2 answers 500 to a save: 502, never cached', res.status === 502 && cacheOf(res) === 'no-store');
check('...and to a read: 502', (await get(id)).status === 502);
r2Fails = 'throw';
check('R2 unreachable: 502 for both', (await post(VIEW)).status === 502 && (await get(id)).status === 502);
r2Fails = null;

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
