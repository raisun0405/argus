// The Quality section in the app, live: an X-ray entry (2OCJ) shows exactly what the validation report
// says (compared with /api/quality's answer, rounded the way the panel rounds), the section's badge, the
// wording of the percentile sets, the link to the full report, the facts sent with a question; an NMR
// entry (1D3Z); no Quality section on an AlphaFold model; a phone.
//   node cdp-quality.mjs [base]
import { BASE } from '../lib/env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, sleep, OUT, OVERFLOW } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
mkdirSync(`${OUT}/shots/quality`, { recursive: true });

const requests = [];
const answer = (query, context, body) => {
  requests.push({ query, facts: body?.structureFacts ?? '' });
  const q = query.toLowerCase();
  if (/alphafold/.test(q)) return { pdbId: 'AF-P04637-F1', title: 'Cellular tumor antigen p53', summary: 'A canned answer about the predicted model.', highlights: [], measurements: [] };
  if (/ubiquitin/.test(q)) return { pdbId: '1D3Z', title: 'Ubiquitin', summary: 'A canned answer about ubiquitin.', highlights: [], measurements: [] };
  if (/p53/.test(q)) return { pdbId: '2OCJ', title: 'Human p53 core domain', summary: 'A canned answer about the p53 core domain.', highlights: [], measurements: [] };
  return { pdbId: context?.pdbId ?? '2OCJ', title: context?.title ?? 'Structure', summary: 'A short canned answer about the structure on screen.', highlights: [], measurements: [] };
};
const V = 'window.__testViewer';
// Non-breaking hyphens ("X‑ray" in the panel) read as plain ones
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').replace(/\\u2011/g, '-').replace(/\\s+/g, ' ').trim()`;
const header = id => `[...document.querySelectorAll('[data-section="${id}"] button[aria-controls="inspector-${id}"]')].find(b => b.getBoundingClientRect().width > 0)`;
const badge = id => `(${header(id)}?.querySelector('span.rounded-full')?.textContent ?? '').trim()`;
const shownStructure = id => `(document.querySelector('[data-structure-id]')?.textContent ?? '').trim() === ${JSON.stringify(id)} && !!(${V}?.getModel?.())`;
const shot = async (b, name) => writeFileSync(`${OUT}/shots/quality/${name}.png`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const serverSays = (b, id) => b.ev(`fetch('/api/quality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '${id}' }) }).then(r => r.json())`);
const NAMES = { clashscore: 'Clashscore', rama: 'Ramachandran outliers', rota: 'Side-chain outliers', rsrz: 'Poor fit to the density', rfree: 'R-free, recalculated' };

const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);

  console.log('[an X-ray entry: 2OCJ]');
  await b.say('show me the p53 core domain');
  check('2OCJ opens', (await b.waitFor(shownStructure('2OCJ'), 60000)) >= 0);
  check('the Quality section is there, folded, with the resolution as its badge', (await b.waitFor(`${badge('quality')} === '2.05 Å'`, 30000)) >= 0 && await b.ev(`${header('quality')}.getAttribute('aria-expanded') === 'false'`), await b.ev(badge('quality')));
  await b.click(header('quality'));
  await b.waitFor(`document.querySelector('[data-quality-panel]')?.dataset.qualityStatus === 'ready'`, 30000);
  const q = await serverSays(b, '2ocj');
  check('the headline: method, resolution, deposited R-free', (await b.ev(text('[data-quality-headline]'))) === `X-ray · ${q.resolution} Å · R-free ${q.rFree}`, await b.ev(text('[data-quality-headline]')));
  const wrong = [];
  for (const m of q.metrics) {
    const row = await b.ev(text(`[data-quality-metric="${m.key}"]`));
    const value = `${m.key === 'rfree' ? m.value.toFixed(3) : String(m.value)}${['rama', 'rota', 'rsrz'].includes(m.key) ? '%' : ''}`;
    const expected = [NAMES[m.key], value, String(Math.round(m.absolute)), `Percentile among all X-ray structures (${m.absoluteOf.toLocaleString('en-US')}); ${Math.round(m.relative)} among X-ray structures of similar resolution (${m.relativeOf.toLocaleString('en-US')})`];
    if (!expected.every(part => row.includes(part))) wrong.push(`${m.key}: ${row.slice(0, 120)}`);
  }
  check(`each metric shows the report's value and percentiles (${q.metrics.map(m => m.key).join(', ')})`, q.metrics.length >= 4 && wrong.length === 0, wrong.join(' | ') || (await b.ev(text('[data-quality-metric="clashscore"]'))));
  check('...the bar is as long as the percentile', await b.ev(`(() => { const bar = document.querySelector('[data-quality-metric="clashscore"] [role=img] span'); return Math.abs(parseFloat(bar.style.width) - ${Math.max(1.5, q.metrics[0].absolute)}) < 0.01; })()`));
  check('...and the full report is one click away', (await b.ev(`document.querySelector('[data-quality-report-link]')?.href`)) === 'https://www.rcsb.org/structure/2OCJ');
  await b.say('how reliable is this structure?');
  await b.waitFor(`document.querySelectorAll('[data-message="assistant"]').length >= 2`, 30000);
  const clash = q.metrics.find(m => m.key === 'clashscore');
  check('a question about it goes with the quality facts', requests.at(-1)?.facts.includes('Structure quality (wwPDB validation report') && requests.at(-1)?.facts.includes(`Clashscore ${clash.value} → ${Math.round(clash.absolute)}`) && requests.at(-1)?.facts.includes('Ramachandran outliers'), (requests.at(-1)?.facts.match(/Structure quality[^\n]{0,200}/) ?? ['(none)'])[0]);
  await shot(b, 'xray');

  console.log('\n[an NMR entry: 1D3Z]');
  await b.say('show me ubiquitin');
  check('1D3Z opens', (await b.waitFor(shownStructure('1D3Z'), 60000)) >= 0);
  check('its badge says NMR', (await b.waitFor(`${badge('quality')} === 'NMR'`, 30000)) >= 0, await b.ev(badge('quality')));
  if (await b.ev(`${header('quality')}.getAttribute('aria-expanded') === 'false'`)) await b.click(header('quality'));
  await b.waitFor(`document.querySelector('[data-quality-panel]')?.dataset.qualityStatus === 'ready' && document.querySelector('[data-quality-headline]')?.textContent === 'NMR'`, 30000);
  const nmr = await b.ev(text('[data-quality-metric="clashscore"]'));
  check('...ranked among all structures and all NMR structures, no resolution', (await b.ev(text('[data-quality-headline]'))) === 'NMR' && nmr.includes('Percentile among all structures (') && nmr.includes('among all NMR structures ('), nmr.slice(0, 140));

  console.log('\n[an AlphaFold model]');
  await b.say('show me the alphafold model of p53');
  check('the AlphaFold model opens', (await b.waitFor(shownStructure('P04637'), 90000)) >= 0);
  await sleep(1000);
  check('no Quality section on a prediction (it has its confidence instead)', !(await b.ev(`!!document.querySelector('[data-section="quality"]')`)));
  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}

console.log('\n[a phone]');
const p = await launch({ width: 390, height: 844, dpr: 2, answer });
try {
  await p.send('Page.navigate', { url: `${BASE}/app` });
  await p.waitFor(`!!document.querySelector('textarea')`, 30000);
  await p.say('show me the p53 core domain');
  check('2OCJ opens', (await p.waitFor(shownStructure('2OCJ'), 60000)) >= 0);
  const toggle = `[...document.querySelectorAll('button[aria-label="Show the inspector"]')].find(b => b.getBoundingClientRect().width > 0)`;
  await p.waitFor(`!!(${toggle})`, 15000);
  await sleep(500);
  await p.tap(toggle);
  await p.waitFor(`!!(${header('quality')})`, 10000);
  await p.ev(`${header('quality')}.scrollIntoView({ block: 'center' })`);
  await p.tap(header('quality'));
  check('the sheet has the section, and it opens', (await p.waitFor(`document.querySelector('[data-phone-sheet] [data-quality-panel]')?.dataset.qualityStatus === 'ready'`, 30000)) >= 0);
  await p.ev(`document.querySelector('[data-quality-panel]').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const overflow = await p.ev(OVERFLOW);
  check('nothing sticks out sideways', !overflow.scroll && overflow.out.length === 0, JSON.stringify(overflow.out.slice(0, 3)));
  await shot(p, 'phone');
} finally {
  p.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
