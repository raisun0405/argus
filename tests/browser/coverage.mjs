// The Coverage section in the app, live data: an experimental entry (1TUP: p53 94–289 of 393), its
// AlphaFold model opened from the section (what experiments resolve, the entry it came from, picking a
// stretch selects it), a two-protein entry (4HHB, renumbered), the facts sent with questions, a phone.
//   node cdp-coverage.mjs [base]
import { BASE } from '../lib/env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, sleep, OUT, OVERFLOW } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
mkdirSync(`${OUT}/shots/coverage`, { recursive: true });

const requests = [];
const answer = (query, context, body) => {
  requests.push({ query, facts: body?.structureFacts ?? '' });
  const q = query.toLowerCase();
  if (/alphafold/.test(q)) return { pdbId: 'AF-P04637-F1', title: 'Cellular tumor antigen p53', summary: 'A canned answer about the predicted model.', highlights: [], measurements: [] };
  if (/p53/.test(q)) return { pdbId: '1TUP', title: 'Tumor suppressor p53 bound to DNA', summary: 'A canned answer about the p53 core domain.', highlights: [], measurements: [] };
  if (/h(a)?emoglobin/.test(q)) return { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'A canned answer about haemoglobin.', highlights: [], measurements: [] };
  return { pdbId: context?.pdbId ?? '1TUP', title: context?.title ?? 'Structure', summary: 'A short canned answer about the structure on screen.', highlights: [], measurements: [] };
};
const V = 'window.__testViewer';
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;
const header = id => `[...document.querySelectorAll('[data-section="${id}"] button[aria-controls="inspector-${id}"]')].find(b => b.getBoundingClientRect().width > 0)`;
const badge = id => `(${header(id)}?.querySelector('span.rounded-full')?.textContent ?? '').trim()`;
const shownStructure = id => `(document.querySelector('[data-structure-id]')?.textContent ?? '').trim() === ${JSON.stringify(id)} && !!(${V}?.getModel?.())`;
const shot = async (b, name) => writeFileSync(`${OUT}/shots/coverage/${name}.png`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);

  console.log('[an experimental entry: 1TUP]');
  await b.say('show me the p53 core domain');
  check('1TUP opens', (await b.waitFor(shownStructure('1TUP'), 60000)) >= 0);
  check('the inspector has a Coverage section, folded at first', await b.ev(`${header('coverage')}?.getAttribute('aria-expanded') === 'false'`));
  await b.click(header('coverage'));
  check('opening it works out the coverage', (await b.waitFor(`document.querySelector('[data-coverage-panel]')?.dataset.coverageStatus === 'entry'`, 60000)) >= 0);
  const p53 = await b.ev(text('[data-coverage-protein="P04637"]'));
  check('p53: residues 94–289 of 393 · 49%, chains A–C', p53.includes('Residues 94–289 of 393 · 49%') && p53.includes('chains A, B, C'), p53.slice(0, 120));
  check('...not in this entry: 1–93, 290–393', (await b.ev(text('[data-coverage-protein="P04637"] [data-coverage-missing]'))) === 'Not in this entry: 1–93, 290–393');
  check('...the section badge says 49%', (await b.ev(badge('coverage'))) === '49%', await b.ev(badge('coverage')));
  check('...and offers the AlphaFold model for the rest', await b.ev(`!!document.querySelector('[data-coverage-open-af="P04637"]')`));
  await b.say('what is missing from this structure?');
  await b.waitFor(`document.querySelectorAll('[data-message="assistant"]').length >= 2`, 30000);
  check('a question about it goes with the coverage', requests.at(-1)?.facts.includes('this entry holds UniProt 94–289 of 393 (49%); not in it: 1–93, 290–393'), (requests.at(-1)?.facts.match(/[^\n]*this entry holds[^\n]*/) ?? ['(none)'])[0]);
  await shot(b, 'entry');

  console.log('\n[its AlphaFold model, opened from the section]');
  await b.click(`document.querySelector('[data-coverage-open-af="P04637"]')`);
  check('the AlphaFold model opens', (await b.waitFor(shownStructure('P04637'), 90000)) >= 0);
  check('...the section now says what experiments resolve', (await b.waitFor(`document.querySelector('[data-coverage-panel]')?.dataset.coverageStatus === 'model'`, 60000)) >= 0);
  const resolved = await b.ev(text('[data-coverage-panel] [data-coverage-ranges]'));
  const entries = Number((resolved.match(/(\d+) PDB entries/) ?? [])[1]);
  check('...resolved stretches, share and number of entries', /^Residues .*\d+% · \d+ PDB entries$/.test(resolved) && entries > 100, resolved);
  check('...what is only predicted', (await b.ev(text('[data-coverage-panel] [data-coverage-missing]'))).startsWith('Only predicted:'), await b.ev(text('[data-coverage-panel] [data-coverage-missing]')));
  check('...and the entry it was opened from: 94–289 · 49%', (await b.ev(text('[data-coverage-source="1TUP"]'))).includes('94–289 · 49%'), await b.ev(text('[data-coverage-source="1TUP"]')));
  const predicted = await b.ev(`document.querySelector('[data-coverage-range^="predicted:"]')?.dataset.coverageRange ?? ''`);
  const [from, to] = predicted.split(':')[1].split('–').map(Number);
  await b.click(`document.querySelector('[data-coverage-range="${predicted}"]')`);
  await sleep(1200);
  const focusBadge = Number(await b.ev(badge('focus')));
  check(`picking a stretch (${predicted.split(':')[1]}) selects exactly those residues`, focusBadge === to - (to ? from : 0) + 1, `${focusBadge} selected`);
  await shot(b, 'model');

  console.log('\n[an answer about the AlphaFold model itself]');
  // The chat answers about its answer's structure: the AlphaFold model, when the answer chose it
  await b.say('show me the alphafold model of p53');
  await b.waitFor(`document.querySelectorAll('[data-message="assistant"]').length >= 3`, 30000);
  await b.waitFor(`${shownStructure('P04637')} && /\\d+%/.test(${badge('coverage')})`, 60000);
  await b.say('which parts of this model have been solved by experiment?');
  await b.waitFor(`document.querySelectorAll('[data-message="assistant"]').length >= 4`, 30000);
  // New PDB entries move the numbers (residue 69 got resolved in October 2026), so the line is checked for
  // agreeing with itself: what it calls known only from the prediction is exactly what it lists as unresolved
  const facts = requests.at(-1)?.facts ?? '';
  const expand = list => list.split(', ').flatMap(r => { const [a, b = a] = r.split('–').map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i); });
  const resolvedList = facts.match(/resolve residues ([\d–, ]+) \(\d+% of (\d+)\)/);
  const onlyPredicted = facts.match(/known only from this prediction: ([\d–, ]+)\./);
  const agrees = !!resolvedList && !!onlyPredicted && (() => {
    const resolved = new Set(expand(resolvedList[1])), missing = expand(onlyPredicted[1]);
    return missing.length > 0 && missing.every(n => !resolved.has(n)) && resolved.size + missing.length === Number(resolvedList[2]);
  })();
  check('a question about the model goes with what experiments resolve, and what only the prediction shows', facts.includes('Experimental structures of this protein (PDBe-KB') && agrees, (facts.match(/Experimental structures[^\n]{0,320}/) ?? ['(none)'])[0]);

  console.log('\n[two proteins, renumbered: 4HHB]');
  await b.say('show me haemoglobin');
  check('4HHB opens', (await b.waitFor(shownStructure('4HHB'), 60000)) >= 0);
  if (await b.ev(`${header('coverage')}?.getAttribute('aria-expanded') === 'false'`)) await b.click(header('coverage'));
  await b.waitFor(`document.querySelector('[data-coverage-panel]')?.dataset.coverageStatus === 'entry' && document.querySelectorAll('[data-coverage-protein]').length === 2`, 60000);
  const hba = await b.ev(text('[data-coverage-protein="P69905"]')), hbb = await b.ev(text('[data-coverage-protein="P68871"]'));
  check('alpha: 2–142 of 142 · 99%, missing 1, renumbered', hba.includes('Residues 2–142 of 142 · 99%') && hba.includes('Not in this entry: 1') && hba.includes('numbers the residues differently'), hba.slice(0, 140));
  check('beta: 2–147 of 147 · 99%', hbb.includes('Residues 2–147 of 147 · 99%'), hbb.slice(0, 100));
  check('no single badge for two proteins', (await b.ev(badge('coverage'))) === '');
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
  check('1TUP opens', (await p.waitFor(shownStructure('1TUP'), 60000)) >= 0);
  // The inspector's button (the Tools button carries data-sheet-toggle too)
  const toggle = `[...document.querySelectorAll('button[aria-label="Show the inspector"]')].find(b => b.getBoundingClientRect().width > 0)`;
  await p.waitFor(`!!(${toggle})`, 15000);
  await sleep(500);
  await p.tap(toggle);
  await p.waitFor(`!!(${header('coverage')})`, 10000);
  await p.ev(`${header('coverage')}.scrollIntoView({ block: 'center' })`);
  await p.tap(header('coverage'));
  check('the sheet has the section, and it opens', (await p.waitFor(`document.querySelector('[data-phone-sheet] [data-coverage-panel]')?.dataset.coverageStatus === 'entry'`, 60000)) >= 0);
  await p.ev(`document.querySelector('[data-coverage-panel]').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const overflow = await p.ev(OVERFLOW);
  check('nothing sticks out sideways', !overflow.scroll && overflow.out.length === 0, JSON.stringify(overflow.out.slice(0, 3)));
  await shot(p, 'phone');
} finally {
  p.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
