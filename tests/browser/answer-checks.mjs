// The line under each answer (what the app checked before showing it), with the AI's answers
// scripted and the checks themselves against live records:
//  1. a right answer: what was checked, the details, the sources
//  2. a wrong protein fixed on the retry: "Fixed, then checked", the fix named
//  3. the AI repeats it: "the answer describes another protein"
//  4. UniProt numbering fixed in place, no retry
//  5. a part not in the file that the retry doesn't fix: counted, listed, the retry said to be no better
//  6. an AlphaFold model
//  8. phone: the line fits, a tap opens the details
//   node cdp-checks.mjs [base]
import { BASE } from '../lib/env.mjs';
import { launch, sleep, OVERFLOW, tabSel } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const H = (chain, resi, label, category = 'active_site') => ({ chain, resi, label, category });
const HB = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen in red blood cells.', measurements: [],
  highlights: [H('A', [87], 'Proximal His87'), H('B', [92], 'Proximal His92'), H('A', [142], 'Heme', 'ligand')] };
const WRONG = { pdbId: '2JDF', title: 'Human Insulin Hexamer', summary: 'This X-ray structure shows human insulin assembled as a hexamer.', highlights: [], measurements: [] };
const FIXED = { pdbId: '2JDF', title: 'Human gamma-B crystallin', summary: 'A lens protein that keeps the eye lens clear.', highlights: [], measurements: [] };
const EGFR = { pdbId: '1M17', title: 'EGFR kinase with erlotinib', summary: 'Erlotinib binds the ATP site of the EGFR kinase domain, against the hinge.', measurements: [],
  highlights: [H('A', [793], 'Met793 (hinge)', 'binding_site')] };
const OFF = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'Haemoglobin carries oxygen.', measurements: [],
  highlights: [H('A', [87], 'Proximal His87'), H('A', [300], 'Asp300', 'other')] };
const AF = { pdbId: 'AF-P69905-F1', title: 'Hemoglobin subunit alpha', summary: 'The AlphaFold model of the alpha chain of haemoglobin.', measurements: [],
  highlights: [H('A', [88], 'Proximal histidine')] };
// The label names no amino acid; the text does, and gets one of the two wrong (87 is His, not Asp)
const MISNAMED = { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'The iron is held between Asp87 below and His58 above.', measurements: [],
  highlights: [H('A', [87, 58], 'Heme pocket')] };

let script = 'fixes';
const calls = [];
const answer = (query) => {
  calls.push(query);
  const q = query.toLowerCase();
  if (q.includes('[correction needed]')) {
    if (q.includes('2jdf')) return script === 'fixes' ? FIXED : WRONG;
    if (q.includes('asp300')) return OFF; // No better
    if (q.includes('asp87')) return MISNAMED; // No better
  }
  if (q.includes('heme pocket')) return MISNAMED;
  if (q.includes('residue 300')) return OFF;
  if (q.includes('alphafold')) return AF;
  if (q.includes('hemoglobin')) return HB;
  if (q.includes('egfr')) return EGFR;
  return WRONG;
};

const LAST = `[...document.querySelectorAll('[data-message="assistant"]')].at(-1)`;
const line = `(() => { const c = ${LAST}?.querySelector('[data-answer-checks]'); return c ? { status: c.dataset.checksStatus, text: c.textContent.replace(/\\s+/g, ' ').trim(), toggle: !!c.querySelector('[data-checks-toggle]') } : null; })()`;
const toggle = `(() => { const t = ${LAST}?.querySelector('[data-checks-toggle]'); if (!t) return false; t.click(); return true; })()`;
const details = `(() => { const m = ${LAST}; const d = m?.querySelector('[data-checks-details]'); return d ? { rows: [...d.querySelectorAll('[data-check-row]')].map(r => r.dataset.checkState + ': ' + r.textContent.replace(/\\s+/g, ' ').trim()), source: d.querySelector(':scope > p')?.textContent ?? '', expanded: m.querySelector('[data-checks-toggle]').getAttribute('aria-expanded') } : null; })()`;
const answers = `document.querySelectorAll('[data-message="assistant"]').length`;

const ask = async (b, text, n) => {
  calls.length = 0;
  await b.say(text);
  await b.waitFor(`${answers} >= ${n} && !!${LAST}?.querySelector('[data-answer-checks]')`, 60000);
  await sleep(400);
  return b.ev(line);
};
const open = async (b) => { await b.ev(toggle); await sleep(150); return b.ev(details); };

const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);

  console.log('[1. a right answer]');
  let l = await ask(b, 'show me hemoglobin', 1);
  check('one quiet line: "Checked against 4HHB: protein name, 2 residues, 1 ligand"', l?.status === 'passed' && l.text === 'Checked against 4HHB: protein name, 2 residues, 1 ligand' && l.toggle, l);
  check('...no extra AI call', calls.length === 1, `${calls.length} calls`);
  check('details are closed until asked for', (await b.ev(details)) === null);
  let d = await open(b);
  check('details: the protein, the residues, the ligand, all ticked', d?.expanded === 'true' && d.rows.length === 3 && d.rows[0].startsWith('ok: Protein name matches 4HHB: ') && d.rows[1] === 'ok: 2 marked residues are in 4HHB' && d.rows[2] === 'ok: 1 marked ligand is in 4HHB', d);
  check('...and whose records they are', d?.source === 'Sources: RCSB, PDBe and UniProt', d?.source);
  await b.ev(toggle); await sleep(150);
  check('a second click closes them', (await b.ev(details)) === null);

  console.log('\n[2. a wrong protein, fixed on the retry]');
  l = await ask(b, 'load any experimental structure', 2);
  check('"Fixed, then checked against 2JDF: protein name"', l?.status === 'fixed' && l.text === 'Fixed, then checked against 2JDF: protein name', l);
  check('...after one retry', calls.length === 2, `${calls.length} calls`);
  d = await open(b);
  check('the fix says what the first answer got wrong', d?.rows.includes('fixed: The first answer called 2JDF "Human Insulin Hexamer", but 2JDF is Human gamma-B crystallin, so it went back to the AI once with 2JDF\'s records') && d.rows[0] === 'ok: Protein name matches 2JDF: Human gamma-B crystallin', d);

  console.log('\n[3. the AI repeats the mistake]');
  script = 'repeats';
  l = await ask(b, 'show me another experimental structure', 3);
  check('"Checked against 2JDF: the answer describes another protein"', l?.status === 'issues' && l.text === 'Checked against 2JDF: the answer describes another protein', l);
  d = await open(b);
  check('details: the heading was replaced, and the retry was no better', d?.rows[0] === 'issue: The answer describes a different protein from the one in 2JDF (Human gamma-B crystallin), so its heading is now 2JDF\'s own title' && d.rows.some(r => r.startsWith('skipped: The first answer called 2JDF "Human Insulin Hexamer"') && r.endsWith('the second answer was no better, so this is the first answer')), d);

  console.log('\n[4. UniProt numbering, fixed in place]');
  l = await ask(b, 'show EGFR with erlotinib', 4);
  check('"Fixed, then checked against 1M17: protein name, 1 residue", with no retry', l?.status === 'fixed' && l.text === 'Fixed, then checked against 1M17: protein name, 1 residue' && calls.length === 1, { l, calls: calls.length });
  d = await open(b);
  check('the fix: the UniProt number and the file\'s', d?.rows.includes('fixed: 1 residue number in UniProt numbering changed to 1M17\'s own (UniProt Met793 = A:Met769)'), d);

  console.log('\n[5. a part not in the file, which the retry doesn\'t fix]');
  l = await ask(b, 'show hemoglobin residue 300', 5);
  check('"Checked against 4HHB: 1 of 2 marked parts doesn\'t match the entry"', l?.status === 'issues' && l.text === 'Checked against 4HHB: 1 of 2 marked parts doesn\'t match the entry' && calls.length === 2, { l, calls: calls.length });
  d = await open(b);
  check('details: the part, and the retry that was no better', d?.rows.includes('issue: A:300 ("Asp300") is not in this file (chain A has residues 1-141)') && d.rows.includes('skipped: The first answer didn\'t match 4HHB in 1 place. It went back to the AI once, but the second answer was no better, so this is the first answer') && d.rows.includes('ok: 1 marked residue is in 4HHB'), d);

  console.log('\n[6. an AlphaFold model]');
  l = await ask(b, 'show the AlphaFold model of hemoglobin alpha', 6);
  check('"Checked against AF-P69905-F1: protein name, 1 residue"', l?.status === 'passed' && l.text === 'Checked against AF-P69905-F1: protein name, 1 residue', l);
  d = await open(b);
  check('details: "in the model", source UniProt', d?.rows[0] === 'ok: Protein name matches AF-P69905-F1: Hemoglobin subunit alpha' && d.rows[1] === 'ok: 1 marked residue is in the model' && d.source === 'Source: UniProt', d);

  console.log('\n[7. an amino acid the text names that the file doesn\'t hold]');
  l = await ask(b, 'show me the heme pocket', 7);
  check('"Checked against 4HHB: 1 of 2 amino acids it names doesn\'t match the entry"', l?.status === 'issues' && l.text === 'Checked against 4HHB: 1 of 2 amino acids it names doesn\'t match the entry', l);
  check('...and it went back to the AI once', calls.length === 2, `${calls.length} calls`);
  d = await open(b);
  check('the wrong one is named; the right one and both marked places still pass', d?.rows.includes('issue: The answer\'s text says Asp87, but residue 87 is His in this file') && d.rows.includes('ok: 2 marked residues are in 4HHB') && d.rows.includes('ok: 1 amino acid named in the answer is that amino acid in 4HHB'), d);
  check('every answer has its own line, in order', (await b.ev(`[...document.querySelectorAll('[data-answer-checks]')].map(c => c.dataset.checksStatus).join(',')`)) === 'passed,fixed,issues,fixed,issues,passed,issues');
  await b.shot('checks-desktop');
  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}

console.log('\n[8. phone]');
const p = await launch({ width: 390, height: 844, dpr: 3, answer });
try {
  await p.send('Page.navigate', { url: `${BASE}/app` });
  await p.waitFor(`!!document.querySelector('textarea')`, 30000);
  calls.length = 0;
  await p.say('show me hemoglobin');
  await p.waitFor(`!!${LAST}?.querySelector('[data-answer-checks]')`, 60000);
  await sleep(800);
  // A new structure opens the 3D view on a phone: back to the chat
  await p.tap(tabSel('chat'));
  await sleep(500);
  await p.ev(`${LAST}.querySelector('[data-answer-checks]').scrollIntoView({ block: 'center' })`);
  await sleep(300);
  const box = await p.ev(`(() => { const t = ${LAST}.querySelector('[data-checks-toggle]'); const r = t.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, top: r.top, w: innerWidth, h: innerHeight }; })()`);
  check('the line sits inside the screen, at least 32 px tall to tap', box.left >= 0 && box.right <= box.w && box.top > 0 && box.top < box.h && box.height >= 32, box);
  await p.tap(`${LAST}.querySelector('[data-checks-toggle]')`);
  await sleep(300);
  const d = await p.ev(details);
  check('a tap opens the details', d?.expanded === 'true' && d.rows.length === 3, d);
  const overflow = await p.ev(OVERFLOW);
  check('nothing sticks out sideways', !overflow.scroll && overflow.out.length === 0, overflow);
  await p.shot('checks-phone');
  check('no errors in the page', p.problems.filter(x => !/favicon|ResizeObserver|Failed to load resource/.test(x)).length === 0, p.problems.slice(0, 3).join(' | '));
} finally {
  p.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
