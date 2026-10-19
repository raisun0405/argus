// Vercel Edge Function: an experimental entry's structure quality, from its official wwPDB validation
// report (services/qualityService.ts asks for it).
//
// The reports are gzipped XML on files.wwpdb.org, which browsers can't fetch (no CORS), so this reads
// one here: only its start, since the summary (the <Entry> element: resolution, R-free, clashscore,
// Ramachandran and side-chain outliers, fit to the data, and each one's percentile ranks with the size
// of the set it is ranked against) comes first, even in a report of many megabytes. Read from the
// report itself rather than from a copy of it: PDBe's API serves an older validation run (other
// side-chain outlier percentages and percentiles for the same entries).

import type { QualityMethod, QualityMetric, QualityMetricKey, QualityReport } from '../services/qualityService';
import { readJsonBody } from '../services/requestBody';

export const config = { runtime: 'edge' };

// Same origins as /api/analyze: other websites can't use this as a proxy
const ALLOWED_ORIGINS = new Set<string>([
  // Any other address the app is served from goes here (the page's own address always passes)
]);

const PDB_ID = /^[1-9][a-z0-9]{3}$/;
const REPORTS = 'https://files.wwpdb.org/pub/pdb/validation_reports';
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // Per visitor per minute; a page asks once per entry
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HEAD_CHARS = 64_000; // The summary sits in the first few thousand characters
const CACHE_MS = 24 * 60 * 60_000;
const MISSING_MS = 60 * 60_000; // A report not there yet may come with the entry's next update
const CACHE_MAX = 500;
const MAX_BODY_BYTES = 512;
// A GET's answer is kept by Vercel's CDN (s-maxage, then served stale while it refreshes) and by the
// browser (max-age), so a popular entry costs neither a function run nor a wwPDB request. Vercel strips
// s-maxage and stale-while-revalidate before the response leaves its CDN.
const REPORT_CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const MISSING_CACHE = 'public, max-age=600, s-maxage=3600';

// The report's own attribute names for each metric's value and percentiles
const METRICS: { key: QualityMetricKey; value: string; percentile: string }[] = [
  { key: 'clashscore', value: 'clashscore', percentile: 'clashscore' },
  { key: 'rama', value: 'percent-rama-outliers', percentile: 'percent-rama-outliers' },
  { key: 'rota', value: 'percent-rota-outliers', percentile: 'percent-rota-outliers' },
  { key: 'rsrz', value: 'percent-RSRZ-outliers', percentile: 'percent-RSRZ-outliers' },
  { key: 'rfree', value: 'DCC_Rfree', percentile: 'DCC_Rfree' },
];

const recent = new Map<string, number[]>();
const cache = new Map<string, { at: number; report: QualityReport }>();

function tooMany(visitor: string): boolean {
  const now = Date.now();
  const times = (recent.get(visitor) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX) return true;
  times.push(now);
  recent.set(visitor, times);
  if (recent.size > 5000) {
    for (const [key, list] of recent) if (list.every(t => now - t >= RATE_WINDOW_MS)) recent.delete(key);
  }
  return false;
}

// Refusals and failures are never cached
const json = (body: unknown, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
const reportJson = (report: QualityReport) => json(report, 200, report.missing ? MISSING_CACHE : REPORT_CACHE);

/** The attributes of the report's <Entry> element, read from the start of the gzipped file and no further. */
async function entryAttributes(body: ReadableStream<Uint8Array>): Promise<Map<string, string> | null> {
  const reader = body.pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  try {
    while (text.length < MAX_HEAD_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
      const start = text.indexOf('<Entry ');
      const end = start < 0 ? -1 : text.indexOf('>', start);
      if (end >= 0) {
        const tag = text.slice(start, end + 1);
        return new Map([...tag.matchAll(/\s([\w.:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
      }
    }
    return null;
  } finally {
    reader.cancel().catch(() => {}); // The rest of the report isn't needed
  }
}

/** No report for this entry. wwPDB's file store (S3 behind CloudFront) answers a missing file with 403
 *  AccessDenied, where it once answered 404; any other refusal is a failure, not a missing report. */
async function noReport(res: Response): Promise<boolean> {
  if (res.status === 404) return true;
  if (res.status !== 403) return false;
  return /<Code>(AccessDenied|NoSuchKey)<\/Code>/.test(await res.text().catch(() => ''));
}

/** A number the report gives, or null for "NotAvailable" and the like. */
const num = (value: string | undefined) => {
  if (value === undefined || !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  return Number(value);
};

function toReport(id: string, a: Map<string, string>): QualityReport {
  const bins = (a.get('percentilebins') ?? '').split(',');
  const method: QualityMethod = bins.includes('xray') ? 'xray' : bins.includes('em') ? 'em' : bins.includes('nmr') ? 'nmr' : 'other';
  const created = (a.get('XMLcreationDate') ?? '').match(/^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/);
  const metrics: QualityMetric[] = [];
  for (const m of METRICS) {
    const value = num(a.get(m.value));
    if (value === null) continue;
    metrics.push({
      key: m.key,
      value,
      absolute: num(a.get(`absolute-percentile-${m.percentile}`)),
      absoluteOf: num(a.get(`numPDBids-absolute-percentile-${m.percentile}`)),
      relative: num(a.get(`relative-percentile-${m.percentile}`)),
      relativeOf: num(a.get(`numPDBids-relative-percentile-${m.percentile}`)),
    });
  }
  return {
    id,
    method,
    resolution: num(a.get('PDB-resolution')) ?? num(a.get('EMDB-resolution')),
    r: num(a.get('PDB-R')),
    rFree: num(a.get('PDB-Rfree')),
    created: created ? `${created[1]} ${Number(created[2])}, ${created[3]}` : null,
    metrics,
  };
}

export default async function handler(req: Request): Promise<Response> {
  // The app asks by GET (/api/quality?id=4hhb), which can be cached; POST is still served for pages
  // opened before that
  if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405 });
  const origin = req.headers.get('origin') || '';
  const sameOrigin = origin !== '' && origin === new URL(req.url).origin;
  // Browsers leave Origin out of a same-origin GET, so a GET without one passes unless it comes from
  // another site's page (an image or script tag there)
  const ownGet = req.method === 'GET' && origin === '' && req.headers.get('sec-fetch-site') !== 'cross-site';
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin && !ownGet) return json({ error: 'Forbidden origin' }, 403);
  const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if (tooMany(visitor)) return json({ error: 'Too many requests; please wait a moment' }, 429);

  // A PDB ID is all it takes: a POST's body is read no further than a few hundred bytes
  let asked: unknown;
  if (req.method === 'GET') {
    asked = new URL(req.url).searchParams.get('id');
  } else {
    const read = await readJsonBody(req, MAX_BODY_BYTES);
    if (!read.ok) return json({ error: read.error === 'too large' ? 'Request too large' : 'Invalid JSON' }, read.error === 'too large' ? 413 : 400);
    asked = (read.value as any)?.id;
  }
  const id = typeof asked === 'string' ? asked.trim().toLowerCase() : '';
  if (!PDB_ID.test(id)) return json({ error: 'Not a PDB ID' }, 400);

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.report.missing ? MISSING_MS : CACHE_MS)) return reportJson(hit.report);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${REPORTS}/${id.slice(1, 3)}/${id}/${id}_validation.xml.gz`, { signal: controller.signal });
    let report: QualityReport;
    if (await noReport(res)) {
      report = { id, missing: true, method: 'other', resolution: null, r: null, rFree: null, created: null, metrics: [] };
    } else if (!res.ok || !res.body) {
      console.error(`[quality] wwPDB ${res.status} for ${id}`);
      return json({ error: 'The validation report could not be fetched' }, 502);
    } else {
      const attributes = await entryAttributes(res.body);
      if (!attributes) return json({ error: 'The validation report has no summary' }, 502);
      report = toReport(id, attributes);
    }
    cache.set(id, { at: Date.now(), report });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return reportJson(report);
  } catch (e) {
    console.error(`[quality] ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: 'The validation report could not be fetched' }, 502);
  } finally {
    clearTimeout(timer);
  }
}
