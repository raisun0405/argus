// The confidence map in the app, on a real AlphaFold DB model (AF-P04637-F1, fetched live): the tool on
// the toolbar, the map against AlphaFold DB's own picture of it, the parts it lists, lighting stretches
// up in 3D by dragging and from the list, the legend, Clear, Zoom, closing, the chat's plain requests,
// the facts sent with a question, no map on an experimental entry, and a phone (sheet, touch drag).
//   node cdp-pae.mjs [base]
import { BASE, FIXTURES } from '../lib/env.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { launch, sleep, OUT, OVERFLOW, tabSel } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
mkdirSync(`${OUT}/shots/pae`, { recursive: true });
const THEIR_PNG = readFileSync(`${FIXTURES}/pae/pae-P04637.png`).toString('base64');

const requests = [];
const answer = (query, context, body) => {
  requests.push({ query, facts: body?.structureFacts ?? '' });
  const q = query.toLowerCase();
  if (/p53|alphafold/.test(q)) return { pdbId: 'AF-P04637-F1', title: 'Cellular tumor antigen p53', summary: 'A canned answer about the predicted model.', highlights: [], measurements: [] };
  if (/h(a)?emoglobin/.test(q)) return { pdbId: '4HHB', title: 'Human deoxyhemoglobin', summary: 'A canned answer about haemoglobin.', highlights: [], measurements: [] };
  return { pdbId: context?.pdbId ?? 'AF-P04637-F1', title: context?.title ?? 'Structure', summary: 'A short canned answer about the structure on screen.', highlights: [], measurements: [] };
};

const V = 'window.__testViewer';
const colourAt = resi => `(() => { const a = ${V}.selectedAtoms({ resi: ${resi}, atom: 'CA' })[0]; const f = a?.style?.cartoon?.colorfunc; return f ? f(a) : a?.style?.cartoon?.color ?? null; })()`;
// AlphaFold DB's per-residue confidence colour for a residue, from its B-factor
const plddtAt = resi => `(() => { const b = ${V}.selectedAtoms({ resi: ${resi}, atom: 'CA' })[0]?.b; return b > 90 ? '#0053D6' : b > 70 ? '#65CBF3' : b > 50 ? '#FFDB13' : '#FF7D45'; })()`;
const toolButton = label => `[...document.querySelectorAll('[role=toolbar][aria-label=Tools] button')].find(b => b.textContent.includes(${JSON.stringify(label)}))`;
const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;
const lastReceipt = `([...document.querySelectorAll('[data-action-receipt]')].at(-1)?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;
const BLUE = '#60a5fa', ORANGE = '#fb923c';

/** Where a cell of the map is on the page (aligned row a, scored column s, 0-based). */
const cellPoint = (b, s, a) => b.ev(`(() => { const c = document.querySelector('[data-pae-map]'); const r = c.getBoundingClientRect(); return { x: r.left + (${s} + 0.5) / 393 * r.width, y: r.top + (${a} + 0.5) / 393 * r.height }; })()`);
const mouseDrag = async (b, from, to) => {
  const p = await cellPoint(b, ...from), q = await cellPoint(b, ...to);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 4; k++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (q.x - p.x) * k / 4, y: p.y + (q.y - p.y) * k / 4, button: 'left', buttons: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', clickCount: 1 });
  await sleep(400);
};
const openP53 = async b => {
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);
  await b.say('show me the alphafold model of p53');
  // An AlphaFold model's badge shows its accession
  return b.waitFor(`(document.querySelector('[data-structure-id]')?.textContent ?? '').trim() === 'P04637' && !!(${V}?.getModel?.()) && ${V}.selectedAtoms({ resi: 200, atom: 'CA' }).length === 1`, 90000);
};

// ---------------- Desktop ----------------
const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  console.log('[desktop: an AlphaFold model]');
  check('the AlphaFold model opens', (await openP53(b)) >= 0);
  await b.waitFor(`!!(${toolButton('Confidence map')})`, 20000);
  check('the toolbar offers the confidence map', await b.ev(`!!(${toolButton('Confidence map')})`));
  check('the structure starts in per-residue confidence colours', (await b.ev(colourAt(200))) === (await b.ev(plddtAt(200))));

  await b.click(toolButton('Confidence map'));
  const readyMs = await b.waitFor(`document.querySelector('[data-pae-panel]')?.dataset.paeStatus === 'ready' && document.querySelector('[data-pae-map]')?.width > 50`, 30000);
  check('opening it shows the map', readyMs >= 0, `${readyMs} ms`);
  check('...the button reads as open, the colours stay per-residue confidence until something is lit up', await b.ev(`${toolButton('Confidence map')}?.getAttribute('aria-pressed') === 'true' || ${toolButton('Confidence map')}?.className.includes('bg-chip')`) && (await b.ev(colourAt(200))) === (await b.ev(plddtAt(200))));
  check('...with the confidence legend under it', (await b.ev(`[...document.querySelectorAll('.argus-legend, .argus-legend')].some(l => l.textContent.includes('Model confidence'))`)));

  // The map, against AlphaFold DB's own picture of it, resized to the same pixels
  const cmp = await b.ev(`(async () => {
    const c = document.querySelector('[data-pae-map]'); const S = c.width;
    const mine = c.getContext('2d').getImageData(0, 0, S, S).data;
    const img = new Image(); img.src = 'data:image/png;base64,${THEIR_PNG}'; await img.decode();
    const t = document.createElement('canvas'); t.width = S; t.height = S; const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, S, S);
    const theirs = g.getImageData(0, 0, S, S).data;
    let diff = 0; const L1 = [], L2 = [];
    for (let k = 0; k < mine.length; k += 4) { diff += Math.abs(mine[k] - theirs[k]) + Math.abs(mine[k + 1] - theirs[k + 1]) + Math.abs(mine[k + 2] - theirs[k + 2]); L1.push(mine[k] + mine[k + 1] + mine[k + 2]); L2.push(theirs[k] + theirs[k + 1] + theirs[k + 2]); }
    const n = L1.length, m1 = L1.reduce((s, v) => s + v, 0) / n, m2 = L2.reduce((s, v) => s + v, 0) / n;
    let num = 0, d1 = 0, d2 = 0; for (let k = 0; k < n; k++) { num += (L1[k] - m1) * (L2[k] - m2); d1 += (L1[k] - m1) ** 2; d2 += (L2[k] - m2) ** 2; }
    return { S, meanDiff: diff / (3 * n), r: num / Math.sqrt(d1 * d2) };
  })()`);
  check("the map matches AlphaFold DB's own picture of it (same colours, same way round)", cmp.r > 0.97 && cmp.meanDiff < 12, `r ${cmp.r.toFixed(4)}, mean colour difference ${cmp.meanDiff.toFixed(1)}/255 at ${cmp.S}px`);
  check('the parts it lists: 98–291 and 325–354, 20.3 Å between them', await b.ev(`!!document.querySelector('[data-pae-part="98–291"]') && !!document.querySelector('[data-pae-part="325–354"]') && document.querySelectorAll('[data-pae-part]').length === 2`) && (await b.ev(text('[data-pae-between="98–291|325–354"]'))).includes('20.3 Å'));
  writeFileSync(`${OUT}/shots/pae/desktop-open.png`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  console.log('\n[lighting stretches up]');
  const announced = `(document.querySelector('[data-pae-readout] [aria-live]')?.textContent ?? '').trim()`;
  const over = await cellPoint(b, 199, 99);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: over.x, y: over.y });
  await sleep(200);
  const hovered = await b.ev(text('[data-pae-readout]'));
  check('the value under the pointer shows, but is not announced on every move', /^Residue 200 lined up on 100: [\d.]+ Å$/.test(hovered) && (await b.ev(announced)) === '' && await b.ev(`!!document.querySelector('[data-pae-readout] p[aria-hidden=true]')`), hovered);
  await mouseDrag(b, [329, 149], [349, 249]);
  const readout = await b.ev(text('[data-pae-readout]'));
  check('dragging lights up a block: scored 330–350, lined up on 150–250', readout.includes('Residues 330–350') && readout.includes('Residues 150–250') && readout.includes('between them'), readout.slice(0, 160));
  check('...and what it lit up is announced', (await b.ev(announced)).includes('Residues 330–350'));
  check('...in 3D: the scored stretch blue, the other orange, the rest grey', (await b.ev(colourAt(340))) === BLUE && (await b.ev(colourAt(200))) === ORANGE && ![BLUE, ORANGE, await b.ev(plddtAt(50))].includes(await b.ev(colourAt(50))));
  const legend = await b.ev(text('[data-pae-legend]'));
  check('...and the legend says which is which and how sure AlphaFold is', legend.includes('330–350') && legend.includes('150–250') && /Å expected error between them/.test(legend), legend.slice(0, 140));
  writeFileSync(`${OUT}/shots/pae/desktop-lit.png`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  const viewBefore = JSON.stringify(await b.ev(`${V}.getView()`));
  await b.click(`document.querySelector('[data-pae-zoom]')`);
  await sleep(1200);
  check('Zoom brings them into view (the camera moves)', JSON.stringify(await b.ev(`${V}.getView()`)) !== viewBefore);

  await b.click(`document.querySelector('[data-pae-clear]')`);
  await sleep(400);
  check('Clear: per-residue confidence again, no map legend', (await b.ev(colourAt(340))) === (await b.ev(plddtAt(340))) && !(await b.ev(`!!document.querySelector('[data-pae-legend]')`)));

  await b.click(`document.querySelector('[data-pae-part="98–291"]')`);
  await sleep(400);
  check('a part from the list lights up on its own (blue), the rest grey', (await b.ev(colourAt(200))) === BLUE && (await b.ev(colourAt(340))) !== ORANGE && (await b.ev(colourAt(340))) !== BLUE && (await b.ev(text('[data-pae-readout]'))).includes('within'));
  await b.click(`document.querySelector('[data-pae-between="98–291|325–354"]')`);
  await sleep(400);
  const between = await b.ev(text('[data-pae-readout]'));
  check('"Between them": both parts lit up, and AlphaFold isn\'t sure how they are arranged', (await b.ev(colourAt(200))) === BLUE && (await b.ev(colourAt(340))) === ORANGE && between.includes('20.3 Å') && between.includes('not reliably placed'), between.slice(0, 160));

  await b.click(toolButton('Confidence map'));
  await sleep(500);
  check('closing it: back to per-residue confidence, the panel gone', !(await b.ev(`!!document.querySelector('[data-pae-panel]')`)) && (await b.ev(colourAt(200))) === (await b.ev(plddtAt(200))));

  console.log('\n[the chat]');
  await b.say('what does the confidence map say about this model?');
  await b.waitFor(`document.querySelectorAll('[data-message="assistant"]').length >= 2`, 30000);
  const asked = requests.at(-1);
  check('a question about the model goes with the map\'s facts', asked?.facts.includes('AlphaFold confidence map') && asked.facts.includes('98–291') && asked.facts.includes('325–354'), (asked?.facts.match(/AlphaFold confidence map[^\n]{0,140}/) ?? [''])[0]);
  await b.say('confidence map');
  await sleep(1500);
  check('"confidence map" opens it, and says so', (await b.ev(lastReceipt)).includes('Confidence map opened') && (await b.ev(`!!document.querySelector('[data-pae-panel]')`)), await b.ev(lastReceipt));
  await b.say('close the confidence map');
  await sleep(1200);
  check('"close the confidence map" closes it', (await b.ev(lastReceipt)).includes('Confidence map closed') && !(await b.ev(`!!document.querySelector('[data-pae-panel]')`)), await b.ev(lastReceipt));

  console.log('\n[an experimental entry]');
  await b.say('show me haemoglobin');
  await b.waitFor(`(document.querySelector('[data-structure-id]')?.textContent ?? '').includes('4HHB') && !!(${V}?.getModel?.())`, 60000);
  await sleep(1500);
  check('no confidence map on the toolbar', !(await b.ev(`!!(${toolButton('Confidence map')})`)));
  await b.say('confidence map');
  await sleep(1200);
  check('...and asking for one says why not', (await b.ev(lastReceipt)).includes("Couldn't open the confidence map") && (await b.ev(lastReceipt)).includes('AlphaFold'), await b.ev(lastReceipt));
  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}

// ---------------- Phone ----------------
console.log('\n[a phone]');
const p = await launch({ width: 390, height: 844, dpr: 2, answer });
try {
  await p.send('Page.navigate', { url: `${BASE}/app` });
  check('the AlphaFold model opens', (await openP53(p)) >= 0);
  await p.waitFor(`!!document.querySelector('[data-structure-id]') && document.querySelector('[data-structure-id]').getBoundingClientRect().width > 0`, 20000);
  await sleep(800);
  await p.tap(`[...document.querySelectorAll('button')].find(b => /^Tools/.test(b.getAttribute('aria-label') ?? '') && b.getBoundingClientRect().width > 0)`);
  await p.waitFor(`!!document.querySelector('[data-phone-tool="pae"]')`, 10000);
  check('the tools list offers the confidence map, explained', (await p.ev(text('[data-phone-tool="pae"]'))).includes('How sure AlphaFold is'));
  await p.tap(`document.querySelector('[data-phone-tool="pae"]')`);
  await p.waitFor(`document.querySelector('[data-phone-sheet] [data-pae-panel]')?.dataset.paeStatus === 'ready' && document.querySelector('[data-pae-map]')?.width > 50`, 30000);
  check('it opens in the sheet', await p.ev(`!!document.querySelector('[data-phone-sheet] [data-pae-map]')`));
  await p.ev(`document.querySelector('[data-pae-map]').scrollIntoView({ block: 'center' })`);
  await sleep(500);
  const from = await cellPoint(p, 329, 149), to = await cellPoint(p, 349, 249);
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let k = 1; k <= 5; k++) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * k / 5, y: from.y + (to.y - from.y) * k / 5 }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  const r = await p.ev(text('[data-pae-readout]'));
  check('a finger drag on the map lights up a block (the sheet doesn\'t scroll instead)', r.includes('Residues 330–350') && r.includes('Residues 150–250'), r.slice(0, 120));
  check('...coloured in 3D', (await p.ev(colourAt(340))) === BLUE && (await p.ev(colourAt(200))) === ORANGE);
  const overflow = await p.ev(OVERFLOW);
  check('nothing sticks out sideways', !overflow.scroll && overflow.out.length === 0, JSON.stringify(overflow.out.slice(0, 3)));
  writeFileSync(`${OUT}/shots/pae/phone-sheet.png`, Buffer.from((await p.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
} finally {
  p.close();
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
