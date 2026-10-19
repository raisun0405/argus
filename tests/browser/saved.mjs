// Saved results behind short links, end to end in headless Chrome: a co-folded complex, a folded sequence and
// a view too long for a plain link are saved, and each short link reopens what was saved, card and all. A
// short answer still gets a plain link (nothing stored). /api/saved is answered here from a store in this
// script (no R2 keys needed), /api/cofold with the canned 3PTB prediction (no GPU), ESMFold with a fixture.
// Also: storage down, a link with nothing behind it, and a saved result that has been tampered with.
import { launch, sleep, BASE } from '../lib/browser.mjs';
import { FIXTURES } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const json = (body, status = 200) => ({ responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') });
const cannedCofold = {
  pdb: readFileSync(`${FIXTURES}/cofold-3PTB-server.pdb`, 'utf8'),
  chains: [{ id: 'A', length: 223 }], ligand: { chain: 'L', resn: 'BEN' }, cofactors: [],
  scores: { confidence: 0.989, ptm: 0.994, iptm: 0.991, ligandIptm: 0.991, proteinIptm: 0, plddt: 0.989, iplddt: 0.985, pde: 0.257, ipde: 0.298 },
  affinity: { log10Ic50: 2.25, binderProbability: 0.8359375 }, template: '3PTB', seconds: 11.6,
};
const esmPdb = readFileSync(`${FIXTURES}/1TRZ.pdb`, 'utf8').split('\n').filter(l => l.startsWith('ATOM')).join('\n') + '\nEND\n';
const SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWSTPSELGHAGLNGDILVWNPVLEDAFELSSMGIRVDADTLKHQLALTGDEDRLELEWHQALLRGEMPQTIGGGIGQSRLTMLLLQLPHIGQVQAGVWPAACRESVPALL';

// Answers: trypsin for the co-fold, a short one, and one whose tour and summary are too long for a plain link
const LONG = { pdbId: '1TRZ', title: 'Insulin, long', summary: 'Insulin. '.repeat(440).trim(), measurements: [],
  highlights: [{ chain: 'A', resi: [6, 11], label: 'Disulfide', category: 'active_site' }],
  tour: Array.from({ length: 8 }, (_, i) => ({ text: `Step ${i + 1}: ${'the chains fold around their disulfides. '.repeat(14).trim()}`, focus: [{ chain: 'B', resi: [i + 1], label: `B${i + 1}`, category: 'other' }] })) };
const answer = (query) => /trypsin/i.test(query)
  ? { pdbId: '3PTB', title: 'Trypsin with benzamidine', summary: 'Trypsin answer.', highlights: [{ chain: 'A', resi: [189], label: 'S1 pocket Asp189', category: 'binding_site' }], measurements: [] }
  : /long/i.test(query) ? LONG
  : { pdbId: '4HHB', title: 'Haemoglobin', summary: 'Haemoglobin carries oxygen.', highlights: [{ chain: 'A', resi: [87], label: 'His87', category: 'binding_site' }], measurements: [] };

const store = new Map();
const posts = [];
let saveBroken = false;
let tamper = null; // (payload) => payload, for the next read
const onPaused = (p, send) => {
  const url = p.request.url;
  const reply = (r) => send('Fetch.fulfillRequest', { requestId: p.requestId, ...r });
  if (url.includes('/api/cofold')) {
    if (p.request.method !== 'POST') return reply(json({ available: true }));
    return setTimeout(() => reply(json(`   ${JSON.stringify(cannedCofold)}`)), 800);
  }
  // Another site: its answer needs the CORS header, as the real one sends
  if (url.includes('esmatlas.com')) return reply({ responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(esmPdb).toString('base64') });
  if (url.includes('/api/saved')) {
    if (p.request.method === 'POST') {
      posts.push(JSON.parse(p.request.postData ?? 'null'));
      if (saveBroken) return reply(json({ error: 'Saving is not set up on this server' }, 503));
      const id = `test${String(store.size).padStart(4, '0')}${'x'.repeat(14)}`;
      store.set(id, p.request.postData);
      return reply(json({ id }, 201));
    }
    const id = new URL(url).searchParams.get('id');
    if (!store.has(id)) return reply(json({ error: 'Nothing is saved under this link' }, 404));
    let body = store.get(id);
    if (tamper) { body = JSON.stringify(tamper(JSON.parse(body))); tamper = null; }
    return reply(json(body));
  }
  send('Fetch.continueRequest', { requestId: p.requestId });
};

const b = await launch({ width: 1440, height: 900, dpr: 1, answer, intercept: ['*/api/cofold*', '*/api/saved*', '*api.esmatlas.com*'], onPaused });
const badge = `(document.querySelector('[data-structure-id]')?.textContent ?? '').trim()`;
const card = `[...document.querySelectorAll('[data-chat-column] p')].filter(p => p.querySelector('svg') && /^Co-foldBoltz-2$/.test(p.textContent.trim())).pop()?.closest('.rounded-xl')`;
const shareButton = `document.querySelector('button[aria-label="Share this view"]')`;
const sharedLabel = `[...document.querySelectorAll('[data-message="assistant"] p')].some(s => s.textContent === 'Shared view')`;
const lastAssistant = `[...document.querySelectorAll('[data-message="assistant"]')].map(m => m.textContent).pop() ?? ''`;
const desktop = async () => {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
};
const fresh = async (url = `${BASE}/app`) => {
  await b.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await b.send('Page.navigate', { url });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);
};
// The Share button's link: copied (the clipboard is stubbed), or the reason it couldn't be made
const share = async () => {
  await b.ev(`(() => { window.__copied.length = 0; return true; })()`);
  await b.click(shareButton);
  await b.waitFor(`window.__copied.length > 0 || document.querySelector('[data-share-status]')?.dataset.shareStatus === 'failed'`, 15000);
  return b.ev(`window.__copied[0] ?? ('FAILED ' + (document.querySelector('[data-share-status]')?.textContent ?? ''))`);
};
const SHORT = new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/app#s=[A-Za-z0-9_-]{22}$`);

try {
  await desktop();
  console.log('[1. a short answer: a plain link, nothing stored]');
  await fresh();
  await b.say('show me haemoglobin');
  await b.waitFor(`${badge} === '4HHB'`, 30000);
  const plain = await share();
  check('a plain #view= link', plain.startsWith(`${BASE}/app#view=`), plain.slice(0, 80));
  check('...and nothing was saved', posts.length === 0, posts.length);

  console.log('\n[2. an answer too long for a plain link: saved, reopened whole]');
  await b.say('give me the long version');
  await b.waitFor(`${badge} === '1TRZ'`, 30000);
  await sleep(500);
  const longLink = await share();
  check('a short link', SHORT.test(longLink), longLink);
  check('...that saved the whole tour and summary', posts.at(-1)?.kind === 'view' && posts.at(-1)?.a.tour?.length === 8 && posts.at(-1)?.a.summary.length === LONG.summary.length && !posts.at(-1)?.structures, JSON.stringify(posts.at(-1))?.slice(0, 120));
  await fresh(longLink);
  check('the short link opens it, labelled as shared', (await b.waitFor(`${badge} === '1TRZ' && ${sharedLabel}`, 30000)) >= 0, await b.ev(badge));
  check('...with the whole summary', await b.ev(`[...document.querySelectorAll('[data-message="assistant"]')].some(m => m.textContent.includes(${JSON.stringify(LONG.summary.slice(-60))}))`));
  check('...and its tour on offer', await b.ev(`[...document.querySelectorAll('button')].some(x => /Play the tour/.test(x.textContent))`));
  check('the short link stays in the address bar', (await b.ev('location.hash')).startsWith('#s='));
  saveBroken = true;
  const fallback = await share();
  check('storage down: the trimmed plain link is copied instead', fallback.startsWith(`${BASE}/app#view=`), fallback.slice(0, 80));
  saveBroken = false;

  console.log('\n[3. a co-folded complex]');
  await fresh();
  await b.say('show me trypsin with benzamidine');
  await b.waitFor(`${badge} === '3PTB'`, 30000);
  await sleep(1500);
  await b.say('cofold benzamidine');
  check('the co-fold card arrives', (await b.waitFor(`!!(${card})`, 60000)) >= 0, (await b.ev(lastAssistant)).slice(0, 160));
  await b.waitFor(`${badge} === 'Boltz-2'`, 15000);
  check('Share is on for the complex', await b.ev(`!(${shareButton}).disabled`), await b.ev(`(${shareButton}).title`));
  const cofoldLink = await share();
  check('a short link', SHORT.test(cofoldLink), cofoldLink);
  const saved = posts.at(-1);
  check('...that saved the prediction itself', saved?.kind === 'cofold' && /^COFOLD-/.test(saved?.a.pdbId) && saved?.structures?.[0]?.id === saved?.a.pdbId && saved.structures[0].pdb.includes('ATOM'), JSON.stringify(saved)?.slice(0, 160));
  const cardBefore = (await b.ev(`(${card})?.textContent ?? ''`)).replace(/\s+/g, ' ');
  const postsBefore = posts.length;
  await fresh(cofoldLink);
  check('the short link opens the complex in the viewer', (await b.waitFor(`${badge} === 'Boltz-2'`, 30000)) >= 0, await b.ev(badge));
  check('...labelled as shared, with its card as made', (await b.waitFor(`${sharedLabel} && !!(${card})`, 10000)) >= 0 && (await b.ev(`(${card})?.textContent ?? ''`)).replace(/\s+/g, ' ') === cardBefore,
    (await b.ev(`(${card})?.textContent ?? ''`)).slice(0, 160));
  check('...nothing saved again, no new prediction run', posts.length === postsBefore &&!(await b.ev(`document.body.textContent.includes('Boltz-2 is predicting')`)));
  await b.click(`[...(${card}).querySelectorAll('button')].find(x => x.textContent.startsWith('Back to'))`);
  check('the card goes back to the structure it was made from', (await b.waitFor(`${badge} === '3PTB'`, 20000)) >= 0, await b.ev(badge));

  console.log('\n[4. a folded sequence]');
  await fresh();
  await b.say(`fold this sequence: ${SEQUENCE.slice(0, 120)}`);
  check('the fold opens', (await b.waitFor(`${badge} === 'ESMFold'`, 30000)) >= 0, `${await b.ev(badge)}: ${(await b.ev(lastAssistant)).slice(0, 200)}`);
  const esmLink = await share();
  check('a short link', SHORT.test(esmLink), esmLink);
  check('...that saved the prediction', posts.at(-1)?.kind === 'esmfold' && /^ESM-/.test(posts.at(-1)?.structures?.[0]?.id ?? ''), JSON.stringify(posts.at(-1))?.slice(0, 120));
  const esmBadge = await b.ev(badge);
  await fresh(esmLink);
  check('the short link opens the fold', (await b.waitFor(`${badge} === ${JSON.stringify(esmBadge)} && ${sharedLabel}`, 30000)) >= 0, await b.ev(badge));
  saveBroken = true;
  const esmBroken = await share();
  check('storage down: the button says why there is no link', /^FAILED Couldn't make a link: saving is not set up/.test(esmBroken), esmBroken);
  saveBroken = false;

  console.log('\n[5. links that cannot be opened]');
  await fresh(`${BASE}/app#s=${'n'.repeat(22)}`);
  check('nothing saved under it: said so, default view instead', (await b.waitFor(`/This share link couldn't be opened: nothing is saved under it/.test(document.body.textContent)`, 20000)) >= 0, (await b.ev(lastAssistant)).slice(0, 160));
  tamper = (payload) => ({ ...payload, structures: payload.structures.map(s => ({ ...s, contacts: [{ chain: 'A', resi: 'x' }] })) });
  await fresh(cofoldLink);
  check('a tampered prediction is refused', (await b.waitFor(`/This share link couldn't be opened: the prediction in it could not be read/.test(document.body.textContent)`, 20000)) >= 0, (await b.ev(lastAssistant)).slice(0, 160));
  await fresh(`${BASE}/app#s=short`);
  check('a damaged link is refused without asking the server', (await b.waitFor(`/the link is damaged or incomplete/.test(document.body.textContent)`, 20000)) >= 0);

  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} catch (e) {
  check(`ran without an error (${e.message})`, false);
} finally {
  b.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
