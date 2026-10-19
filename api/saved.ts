// Vercel Edge Function: saved results behind short links (services/savedService.ts).
//
// A view whose answer can't travel in a link (a co-folded complex or a folded sequence: their
// structure exists only in the browser that made it, and is far too long for an address) is saved
// here and opened by an ID instead. The objects live in a private Cloudflare R2 bucket, reached through
// its S3 API: POST stores one under a random 128-bit ID, GET ?id= returns it. A saved object never
// changes, so a GET's answer is cached for good. Nothing is ever listed: only someone holding the link
// can open what it points to.

import { AwsClient } from 'aws4fetch';
import { readJsonBody } from '../services/requestBody';

export const config = { runtime: 'edge' };

// Same origins as /api/analyze: other websites can't save through this
const ALLOWED_ORIGINS = new Set<string>([
  // Any other address the app is served from goes here (the page's own address always passes)
]);

export const SAVED_ID = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url
const MAX_BODY_BYTES = 4_000_000; // A compared pair of large co-folds is about 2.5 MB; Vercel stops at 4.5
const SAVE_WINDOW_MS = 10 * 60_000;
const SAVE_MAX = 12; // Saves per visitor per 10 minutes
const READ_WINDOW_MS = 60_000;
const READ_MAX = 60;
const R2_TIMEOUT_MS = 10_000;
const KINDS = new Set(['view', 'esmfold', 'cofold']);
const PREDICTION_ID = /^(?:ESM|COFOLD)-[0-9A-Z]{6,8}$/;
const FOREVER = 'public, max-age=31536000, s-maxage=31536000, immutable';

const recent = new Map<string, number[]>();

function tooMany(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter(t => now - t < windowMs);
  if (times.length >= max) return true;
  times.push(now);
  recent.set(key, times);
  if (recent.size > 5000) {
    for (const [k, list] of recent) if (list.every(t => now - t >= SAVE_WINDOW_MS)) recent.delete(k);
  }
  return false;
}

// Refusals and failures are never cached
const json = (body: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

// A key pasted into a dashboard can carry a hidden line break or space, which breaks every signature
const setting = (name: string) => (process.env[name] ?? '').trim();

/** The bucket, or null when its keys aren't set. */
function bucket(): { client: AwsClient; base: string } | null {
  const [account, keyId, secret] = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].map(setting);
  if (!account || !keyId || !secret) return null;
  return {
    client: new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: 's3', region: 'auto' }),
    base: `https://${account}.r2.cloudflarestorage.com/${setting('R2_BUCKET') || 'argus-saved'}`,
  };
}

/**
 * For a refused request: which keys are set, without showing them. The key ID's first and last four
 * characters, the first 8 hex digits of the secret's SHA-256, and both lengths as set (R2's are 32 and
 * 64 characters): enough to tell a wrong key from a mangled one by comparing with the token's own.
 */
const keyFingerprint = async () => {
  const id = setting('R2_ACCESS_KEY_ID');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(setting('R2_SECRET_ACCESS_KEY'))));
  const hash = [...digest.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `key ${id.slice(0, 4)}…${id.slice(-4)}, secret sha256 ${hash}…, lengths as set ${(process.env.R2_ACCESS_KEY_ID ?? '').length}/${(process.env.R2_SECRET_ACCESS_KEY ?? '').length}`;
};

const objectKey = (id: string) => `v1/${id}.json.gz`;

const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const gzip = async (text: string) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzip = (body: ReadableStream<Uint8Array>) => new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();

/** What a saved object must look like; the page checks everything in it again when it opens one. */
function invalid(value: any): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'not an object';
  if (value.v !== 1) return 'unknown version';
  if (!KINDS.has(value.kind)) return 'unknown kind';
  if (!value.a || typeof value.a !== 'object' || typeof value.a.pdbId !== 'string') return 'no answer';
  if (value.s !== undefined && (typeof value.s !== 'object' || value.s === null || Array.isArray(value.s))) return 'bad view';
  const structures = value.structures ?? [];
  if (!Array.isArray(structures) || structures.length > 4) return 'bad structures';
  for (const s of structures) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !PREDICTION_ID.test(s.id) || typeof s.pdb !== 'string' || !s.pdb.includes('ATOM')) return 'bad structure';
  }
  if (value.kind !== 'view' && !structures.some((s: any) => s.id === value.a.pdbId)) return 'the structure on screen is missing';
  return null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  const origin = req.headers.get('origin') || '';
  const sameOrigin = origin !== '' && origin === new URL(req.url).origin;
  // Browsers leave Origin out of a same-origin GET, so a GET without one passes unless it comes from
  // another site's page; a save always carries its Origin
  const ownGet = req.method === 'GET' && origin === '' && req.headers.get('sec-fetch-site') !== 'cross-site';
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin && !ownGet) return json({ error: 'Forbidden origin' }, 403);
  const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';

  const store = bucket();
  if (!store) return json({ error: 'Saving is not set up on this server' }, 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), R2_TIMEOUT_MS);

  try {
    if (req.method === 'GET') {
      if (tooMany(`read:${visitor}`, READ_WINDOW_MS, READ_MAX)) return json({ error: 'Too many requests; please wait a moment' }, 429);
      const id = new URL(req.url).searchParams.get('id') ?? '';
      if (!SAVED_ID.test(id)) return json({ error: 'Not a saved link' }, 400);
      const res = await store.client.fetch(`${store.base}/${objectKey(id)}`, { signal: controller.signal });
      if (res.status === 404) return json({ error: 'Nothing is saved under this link' }, 404);
      if (!res.ok || !res.body) {
        console.error(`[saved] R2 ${res.status} reading ${id} (${await keyFingerprint()}): ${(await res.text().catch(() => '')).slice(0, 1500)}`);
        return json({ error: 'The saved result could not be read' }, 502);
      }
      return new Response(await gunzip(res.body), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': FOREVER } });
    }

    if (tooMany(`save:${visitor}`, SAVE_WINDOW_MS, SAVE_MAX)) return json({ error: 'Too many saves; please wait a few minutes' }, 429);
    const read = await readJsonBody(req, MAX_BODY_BYTES);
    if (!read.ok) return json({ error: read.error === 'too large' ? 'This result is too large to save' : 'Invalid JSON' }, read.error === 'too large' ? 413 : 400);
    const problem = invalid(read.value);
    if (problem) return json({ error: `Not a result Argus can save (${problem})` }, 400);

    const id = newId();
    const res = await store.client.fetch(`${store.base}/${objectKey(id)}`, {
      method: 'PUT',
      body: await gzip(JSON.stringify(read.value)),
      // A plain gzip file: with Content-Encoding set, fetch would unpack it on the way back
      headers: { 'Content-Type': 'application/gzip' },
      signal: controller.signal,
    });
    if (!res.ok) {
      // R2's whole answer: for a refused signature it says what it expected to be signed
      console.error(`[saved] R2 ${res.status} saving (${await keyFingerprint()}): ${(await res.text().catch(() => '')).slice(0, 1500)}`);
      return json({ error: 'The result could not be saved' }, 502);
    }
    return json({ id }, 201);
  } catch (e) {
    console.error(`[saved] ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: req.method === 'GET' ? 'The saved result could not be read' : 'The result could not be saved' }, 502);
  } finally {
    clearTimeout(timer);
  }
}
