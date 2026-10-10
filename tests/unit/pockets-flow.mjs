// loadPockets orchestration with PrankWeb mocked: conservation first, quick fallback after 25 s,
// upgrade, failures, abort, 404, network blips, insertion codes. Runs in real time (~50 s).
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

const T0 = Date.now();
const now = () => Date.now() - T0;
const calls = []; // { db, code, kind, at }
const behaviour = {}; // code -> (db, kind, scenarioStart) => Response | Error

const prediction = (pockets, extra = {}) => ({
  structure: { indices: ['A_10', 'A_11', 'A_12', 'A_184A', 'B_5'], sequence: ['L', 'G', 'S', 'D', 'K'] },
  pockets, metadata: { p2rank_version: '2.5.1' }, ...extra,
});
const pocket = (rank, probability, residues) => ({ name: `pocket${rank}`, rank: String(rank), score: '1', probability: String(probability), center: ['1', '2', '3'], residues, surface: [] });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const info = (status) => json({ id: 'X', database: 'db', status });

globalThis.fetch = async (url, init) => {
  const m = /prediction\/([^/]+)\/([^/]+)(\/public\/prediction\.json)?$/.exec(String(url));
  if (!m) throw new Error('unexpected URL ' + url);
  const [, db, code, pred] = m;
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  calls.push({ db, code, kind: pred ? 'prediction' : 'info', at: now() });
  const result = behaviour[code](db, pred ? 'prediction' : 'info');
  if (result instanceof Error) throw result;
  return result;
};

const { loadPockets, pocketFactsLine, PocketError } = await import(`${ROOT_URL}services/pocketService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++; };
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; console.log('UNHANDLED', e); });
const count = (code, db, kind = 'info') => calls.filter(c => c.code === code && (!db || c.db === db) && c.kind === kind).length;
const isQuick = (db) => db === 'v4';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const P1 = prediction([pocket(1, 0.9, ['A_10', 'A_11', 'A_12', 'A_184A', 'B_5']), pocket(2, 0.02, ['A_10'])]);
const P2 = prediction([pocket(1, 0.4, ['A_11'])]);

// A: conservation ready at once -> no quick request
behaviour['9AAA'] = (db, kind) => (kind === 'info' ? info('successful') : json(P1));
// B: conservation finishes at ~40 s, quick at its second poll -> quick at ~28 s, then the upgrade
let bStart;
behaviour['9BBB'] = (db, kind) => {
  if (kind === 'prediction') return json(isQuick(db) ? P2 : P1);
  if (isQuick(db)) return info(count('9BBB', 'v4') >= 2 ? 'successful' : 'queued');
  return info(now() - bStart >= 40000 ? 'successful' : 'running');
};
// C: conservation fails -> quick straight away, no upgrade
behaviour['9CCC'] = (db, kind) => (kind === 'prediction' ? json(P2) : info(isQuick(db) ? 'successful' : 'failed'));
// D: both fail
behaviour['9DDD'] = () => info('failed');
// E: conservation runs forever; aborted after 5 s
behaviour['9EEE'] = () => info('running');
// F: unknown to PrankWeb
behaviour['9FFF'] = () => json({}, 404);
// G: first call leaves a cached quick result; second call shows it at once and upgrades when conservation lands
let gPhase = 1, gPhase2Start = 0;
behaviour['9GGG'] = (db, kind) => {
  if (kind === 'prediction') return json(isQuick(db) ? P2 : P1);
  if (isQuick(db)) return info('successful');
  return gPhase === 1 ? info('failed') : info(now() - gPhase2Start >= 6000 ? 'successful' : 'running');
};
// I: two network blips are tolerated, three are not
let iFails = 0, jFails = 0;
behaviour['9III'] = (db, kind) => (kind === 'prediction' ? json(P1) : (++iFails <= 2 ? new TypeError('fetch failed') : info('successful')));
behaviour['9JJJ'] = () => (++jFails, new TypeError('fetch failed'));

const scenarios = [];

scenarios.push((async () => {
  const t = now();
  const p = await loadPockets('9AAA', null, new AbortController().signal);
  check('A: conservation result returned', p.model === 'conservation' && p.pockets.length === 2);
  check('A: quick model never asked', count('9AAA', 'v4') === 0);
  check('A: fast', now() - t < 2000, `${now() - t} ms`);
  check('A: insertion code parsed and residue typed', p.pockets[0].residues.some(r => r.resi === 184 && r.icode === 'A' && r.aa === 'D'));
  check('A: probability parsed', p.pockets[0].probability === 0.9);
  const facts = pocketFactsLine('9AAA');
  check('A: facts compact runs and insertion codes; weak pocket left out', facts.endsWith('#1 90%: A 10-12 184A; B 5'), facts);
})());

scenarios.push((async () => {
  bStart = now();
  const upgrades = [];
  const progress = [];
  const p = await loadPockets('9BBB', null, new AbortController().signal, {
    onProgress: (x) => progress.push({ ...x, at: now() - bStart }),
    onUpgrade: (u) => upgrades.push({ u, at: now() - bStart }),
  });
  const at = now() - bStart;
  check('B: quick result first', p.model === 'quick', p.model);
  check('B: quick asked only after ~25 s', calls.find(c => c.code === '9BBB' && c.db === 'v4').at - bStart >= 24000);
  check('B: quick result at ~28 s', at >= 25000 && at < 36000, `${at} ms`);
  check('B: progress reported running, then quick flag', progress.some(x => x.status === 'running' && !x.quick) && progress.some(x => x.quick));
  await sleep(20000);
  check('B: upgrade delivered once, conservation model, after ~40 s', upgrades.length === 1 && upgrades[0].u.model === 'conservation' && upgrades[0].at >= 40000, `${upgrades.length} upgrades at ${upgrades[0]?.at}`);
  check('B: quick polling stopped after its result', count('9BBB', 'v4') <= 3, String(count('9BBB', 'v4')));
  check('B: facts now use the conservation result', pocketFactsLine('9BBB').includes('#1 90%'));
})());

scenarios.push((async () => {
  const t = now();
  let upgraded = false;
  const p = await loadPockets('9CCC', null, new AbortController().signal, { onUpgrade: () => { upgraded = true; } });
  check('C: conservation failed -> quick at once', p.model === 'quick' && now() - t < 3000, `${now() - t} ms`);
  await sleep(4000);
  check('C: no upgrade', !upgraded);
})());

scenarios.push((async () => {
  try { await loadPockets('9DDD', null, new AbortController().signal); check('D: rejects', false); }
  catch (e) { check('D: both failed -> PocketError', e instanceof PocketError && /could not analyse/.test(e.message), e.message); }
})());

scenarios.push((async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);
  try { await loadPockets('9EEE', null, controller.signal); check('E: rejects', false); }
  catch (e) { check('E: abort -> AbortError', e?.name === 'AbortError', e?.name); }
  const n = calls.filter(c => c.code === '9EEE').length;
  await sleep(8000);
  check('E: polling stops after abort', calls.filter(c => c.code === '9EEE').length === n, `${n} -> ${calls.filter(c => c.code === '9EEE').length}`);
})());

scenarios.push((async () => {
  try { await loadPockets('9FFF', null, new AbortController().signal); check('F: rejects', false); }
  catch (e) { check('F: 404 -> PocketError', e instanceof PocketError && /no prediction/.test(e.message), e.message); }
})());

scenarios.push((async () => {
  const first = await loadPockets('9GGG', null, new AbortController().signal);
  check('G: first call falls back to quick', first.model === 'quick');
  gPhase = 2; gPhase2Start = now();
  const upgrades = [];
  const t = now();
  const second = await loadPockets('9GGG', null, new AbortController().signal, { onUpgrade: (u) => upgrades.push(u) });
  check('G: cached quick result shown at once', second === first && now() - t < 500, `${now() - t} ms`);
  await sleep(12000);
  check('G: conservation upgrade follows', upgrades.length === 1 && upgrades[0].model === 'conservation');
})());

scenarios.push((async () => {
  const p = await loadPockets('9III', null, new AbortController().signal);
  check('I: two network blips tolerated', p.model === 'conservation');
  try { await loadPockets('9JJJ', null, new AbortController().signal); check('J: rejects', false); }
  catch (e) { check('J: third consecutive blip fails', /fetch failed/.test(e.message), e.message); }
})());

scenarios.push((async () => {
  try { await loadPockets('ESM-1234abcd', null, new AbortController().signal); check('K: rejects', false); }
  catch (e) { check('K: ESMFold prediction -> PocketError', e instanceof PocketError, e.message); }
})());

await Promise.all(scenarios);
await sleep(1000);
check('no unhandled rejections', unhandled === 0, String(unhandled));
console.log(failures ? `\n${failures} FAILED` : '\nall passed', `(${Math.round(now() / 1000)} s)`);
