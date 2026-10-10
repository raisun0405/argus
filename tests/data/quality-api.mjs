// api/quality.ts against independent sources, live: every raw value it reads from the wwPDB validation
// report must equal RCSB's data API, every percentile must equal a separate parse of the whole report
// file, and requests it shouldn't serve are refused.
//   node tf-quality-api.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
import { gunzipSync } from 'node:zlib';
const { default: handler } = await import(`${ROOT_URL}api/quality.ts`);
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
let ip = 0;
const ask = (body, { origin = 'http://127.0.0.1:3100', method = 'POST' } = {}) => handler(new Request('http://127.0.0.1:3100/api/quality', {
  method, headers: { 'Content-Type': 'application/json', Origin: origin, 'x-real-ip': `10.30.0.${++ip}` }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
}));

console.log('[what it serves]');
check('GET is refused', (await ask(null, { method: 'GET' })).status === 405);
check('another website is refused', (await ask({ id: '2ocj' }, { origin: 'https://evil.example' })).status === 403);
check('something that is no PDB ID is refused', (await ask({ id: '../etc' })).status === 400 && (await ask({ id: 'AF-P04637-F1' })).status === 400);
// An ID with no report: the first candidate wwPDB doesn't have
let absent = null;
for (const id of ['9zzz', '9zzy', '9zzx', '9zzw']) {
  const head = await fetch(`https://files.wwpdb.org/pub/pdb/validation_reports/${id.slice(1, 3)}/${id}/${id}_validation.xml.gz`, { method: 'HEAD' });
  if (head.status === 404) { absent = id; break; }
}
if (absent) {
  const r = await (await ask({ id: absent })).json();
  check(`an entry without a report (${absent}) says so`, r.missing === true && r.metrics.length === 0);
}

console.log('\n[every value against RCSB, every percentile against the report file itself]');
const candidates = ['2OCJ', '1TUP', '4HHB', '3PTB', '1HSG', '6M0J', '6VXX', '7A5F', '1D3Z', '2K39', '2MZD'];
const query = `{ entries(entry_ids: ${JSON.stringify(candidates)}) { rcsb_id rcsb_entry_info { resolution_combined experimental_method } pdbx_vrpt_summary_geometry { clashscore percent_ramachandran_outliers percent_rotamer_outliers } pdbx_vrpt_summary_diffraction { percent_RSRZ_outliers } } }`;
const rcsb = (await (await fetch('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json()).data.entries;
const methods = new Set();
let values = 0, valuesOk = 0, percentiles = 0, percentilesOk = 0;
for (const e of rcsb) {
  const id = e.rcsb_id.toLowerCase();
  const res = await ask({ id });
  const q = await res.json();
  if (res.status !== 200 || q.missing) { check(`${e.rcsb_id}: a report`, false, `${res.status} ${JSON.stringify(q).slice(0, 80)}`); continue; }
  methods.add(q.method);
  const g = e.pdbx_vrpt_summary_geometry?.[0] ?? {};
  const want = { clashscore: g.clashscore, rama: g.percent_ramachandran_outliers, rota: g.percent_rotamer_outliers, rsrz: e.pdbx_vrpt_summary_diffraction?.[0]?.percent_RSRZ_outliers };
  const mismatched = [];
  for (const [key, expected] of Object.entries(want)) {
    if (expected === undefined || expected === null) continue;
    values++;
    const got = q.metrics.find(m => m.key === key)?.value;
    if (got === expected) valuesOk++; else mismatched.push(`${key} ${got} vs RCSB ${expected}`);
  }
  const res0 = e.rcsb_entry_info?.resolution_combined?.[0];
  if (typeof res0 === 'number') { values++; if (q.resolution === res0) valuesOk++; else mismatched.push(`resolution ${q.resolution} vs RCSB ${res0}`); }
  // The whole report file, parsed separately: attribute names matched only where they start
  const xml = gunzipSync(Buffer.from(await (await fetch(`https://files.wwpdb.org/pub/pdb/validation_reports/${id.slice(1, 3)}/${id}/${id}_validation.xml.gz`)).arrayBuffer())).toString('utf8');
  const entryTag = xml.slice(xml.indexOf('<Entry '), xml.indexOf('>', xml.indexOf('<Entry ')) + 1);
  const attr = name => { const m = entryTag.match(new RegExp(`\\s${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="([^"]*)"`)); return m && /^-?\d+(\.\d+)?$/.test(m[1]) ? Number(m[1]) : null; };
  const names = { clashscore: 'clashscore', rama: 'percent-rama-outliers', rota: 'percent-rota-outliers', rsrz: 'percent-RSRZ-outliers', rfree: 'DCC_Rfree' };
  for (const m of q.metrics) {
    for (const [field, prefix] of [['absolute', 'absolute-percentile-'], ['relative', 'relative-percentile-'], ['absoluteOf', 'numPDBids-absolute-percentile-'], ['relativeOf', 'numPDBids-relative-percentile-']]) {
      percentiles++;
      const expected = attr(prefix + names[m.key]);
      if (m[field] === expected) percentilesOk++; else mismatched.push(`${m.key}.${field} ${m[field]} vs file ${expected}`);
    }
  }
  console.log(`    ${e.rcsb_id} ${e.rcsb_entry_info?.experimental_method} → ${q.method}${q.resolution ? ` ${q.resolution} Å` : ''}${q.rFree ? `, R-free ${q.rFree}` : ''}: ${q.metrics.map(m => `${m.key} ${m.value} (${m.absolute}/${m.relative})`).join(', ')}${mismatched.length ? `  <- ${mismatched.join('; ')}` : ''}`);
}
check('every raw value equals RCSB\'s (clashscore, Ramachandran, side-chain, RSRZ, resolution)', values > 30 && valuesOk === values, `${valuesOk} of ${values}`);
check('every percentile and set size equals the report file\'s', percentiles > 60 && percentilesOk === percentiles, `${percentilesOk} of ${percentiles}`);
check('X-ray, cryo-EM and NMR entries all covered', ['xray', 'em', 'nmr'].every(m => methods.has(m)), [...methods].join(', '));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
