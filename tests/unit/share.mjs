// Unit tests for services/shareService.ts: round trip, validation of untrusted links, size limits.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

const { buildShareUrl, readShareHash, canShare, SHARE_PREFIX } = await import(`${ROOT_URL}services/shareService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const BASE = 'https://argus.example/';
const hashOf = (url) => url.slice(url.indexOf('#'));
const encode = (obj) => SHARE_PREFIX + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

const analysis = {
  pdbId: '4HHB', title: 'Human deoxyhemoglobin — α₂β₂', summary: 'Heme iron 2.0 Å from His92 (β). Ünïcödé ✓ 🧬',
  highlights: [{ chain: 'B', resi: [92], label: 'Proximal His', category: 'active_site' }, { chain: 'A', resi: [87, 58], label: 'His', category: 'binding_site' }],
  measurements: [{ start: { chain: 'B', resi: 92, atom: 'NE2' }, end: { chain: 'B', resi: 146 }, label: 'salt bridge' }],
  tour: [{ text: 'Step one', focus: [{ chain: 'A', resi: [87], category: 'active_site' }] }],
  quiz: { question: 'Q?', options: ['a', 'b'], correctAnswerIndex: 0, explanation: 'x' },
};
const view = { colorScheme: 'pockets', vizStyle: 'surface', alphaFold: 'P68871', opacity: 72.4, camera: [1.23456789, -2, 3, -150.5, 0.1, 0.2, 0.3, 0.927] };

// Round trip
{
  const url = buildShareUrl(analysis, view, BASE);
  check('link starts with the page address and #view=', url.startsWith(`${BASE}#view=`));
  check('link uses only URL-safe characters', /^#view=[A-Za-z0-9_-]+$/.test(hashOf(url)));
  const back = readShareHash(hashOf(url));
  check('round trip: answer intact (unicode included)', back.analysis.title === analysis.title && back.analysis.summary === analysis.summary, back.analysis.summary);
  check('round trip: highlights, measurements, tour', JSON.stringify(back.analysis.highlights) === JSON.stringify(analysis.highlights) && back.analysis.measurements.length === 1 && back.analysis.tour.length === 1);
  check('quizzes are never shared', back.analysis.quiz === undefined && !Buffer.from(hashOf(url).slice(6), 'base64url').toString().includes('"quiz"'));
  check('round trip: view settings', back.view.colorScheme === 'pockets' && back.view.vizStyle === 'surface' && back.view.alphaFold === 'P68871' && back.view.opacity === 72);
  check('camera rounded to 4 decimals', JSON.stringify(back.view.camera) === JSON.stringify([1.2346, -2, 3, -150.5, 0.1, 0.2, 0.3, 0.927]), JSON.stringify(back.view.camera));
  console.log(`  link length: ${url.length} characters`);
}

// What can be shared
check('PDB answers can be shared', canShare(analysis));
check('ESMFold predictions cannot (they live in one browser)', !canShare({ ...analysis, pdbId: 'ESM-1a2b3c4d' }));
check('no fragment -> null', readShareHash('') === null && readShareHash('#something') === null);

// Untrusted links
check('damaged base64 -> error', 'error' in readShareHash('#view=%%%'));
check('truncated link -> error', 'error' in readShareHash(hashOf(buildShareUrl(analysis, view, BASE)).slice(0, 40)));
check('empty -> error', 'error' in readShareHash('#view='));
check('not JSON -> error', 'error' in readShareHash(SHARE_PREFIX + Buffer.from('hello').toString('base64url')));
check('other version -> error naming it', /version/.test(readShareHash(encode({ v: 2, a: analysis })).error ?? ''));
check('no structure ID -> error', 'error' in readShareHash(encode({ v: 1, a: { title: 'x' } })));
check('bad structure ID (script) -> error', 'error' in readShareHash(encode({ v: 1, a: { ...analysis, pdbId: '<img src=x>' } })));
check('ESMFold ID in a link -> error', 'error' in readShareHash(encode({ v: 1, a: { ...analysis, pdbId: 'ESM-deadbeef' } })));
check('oversized fragment -> error', 'error' in readShareHash(SHARE_PREFIX + 'A'.repeat(20001)));
{
  const r = readShareHash(encode({ v: 1, a: { ...analysis, highlights: [{ chain: 'A', resi: 'x' }, { chain: 'B', resi: [5], category: 'evil' }] }, s: {
    colorScheme: 'javascript:alert(1)', vizStyle: 'hologram', alphaFold: 'p68871<script>', camera: [1, 2, 3, NaN, 5, 6, 7, 8], opacity: '100',
  } }));
  check('malformed highlights dropped, unknown category -> other', r.analysis.highlights.length === 1 && r.analysis.highlights[0].category === 'other');
  check('invalid view settings dropped', Object.keys(r.view).length === 0, JSON.stringify(r.view));
}
{
  const r = readShareHash(encode({ v: 1, a: { ...analysis, pdbId: 'AF-P68871-F1' }, s: { alphaFold: 'P69905', colorScheme: 'confidence' } }));
  check('AlphaFold switch ignored when the answer already is an AlphaFold model', r.view.alphaFold === undefined && r.view.colorScheme === 'confidence');
}
{
  const r = readShareHash(encode({ v: 1, a: analysis, s: { colorScheme: 'confidence' } }));
  check('confidence colouring dropped for an experimental entry', r.view.colorScheme === undefined);
}

// Size limits
{
  const long = { ...analysis, summary: 'x'.repeat(3900), tour: Array.from({ length: 8 }, (_, i) => ({ text: `Step ${i} `.padEnd(590, 'y'), focus: [{ chain: 'A', resi: Array.from({ length: 150 }, (_, j) => j + 1), category: 'other' }] })) };
  const url = buildShareUrl(long, view, BASE);
  const back = readShareHash(hashOf(url));
  check('long tour: link kept under 8,000 characters', url.length - BASE.length <= 8000 + 6, `${url.length} chars`);
  check('the tour is dropped first; the summary stays whole when that is enough', back.analysis.tour === undefined && back.analysis.summary.length === 3900);
}
{
  const crowded = { ...analysis, tour: undefined, summary: 'z'.repeat(3900), highlights: Array.from({ length: 12 }, (_, i) => ({ chain: 'A', resi: Array.from({ length: 60 }, (_, j) => 1000 + i * 60 + j), label: `Region ${i}`, category: 'other' })) };
  const back = readShareHash(hashOf(buildShareUrl(crowded, view, BASE)));
  check('still too long: the summary is trimmed, highlights kept', back.analysis.summary.length <= 1500 && back.analysis.summary.endsWith('…') && back.analysis.highlights.length === 12);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
