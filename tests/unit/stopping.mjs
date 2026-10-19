// Stopping long work: the similar-structure search (Foldseek faked: a ticket that never leaves the queue) and
// the helpers every stoppable wait uses (services/http.ts).
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const http = await import(`${ROOT_URL}services/http.ts`);
const foldseek = await import(`${ROOT_URL}services/foldseekService.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const outcome = p => p.then(() => 'resolved', e => e?.name ?? String(e));

console.log('[the helpers]');
{
  const stop = new AbortController();
  const signal = http.timeoutSignal(60_000, stop.signal);
  check('timeoutSignal: not aborted to start with', !signal.aborted);
  stop.abort();
  check('...aborts as soon as the caller\'s signal does', signal.aborted);
  const short = http.timeoutSignal(30, new AbortController().signal);
  await sleep(80);
  check('...and on its own after the time limit (TimeoutError)', short.aborted && short.reason?.name === 'TimeoutError', short.reason?.name);
  check('...without a caller signal it is the time limit alone', http.timeoutSignal(60_000) instanceof AbortSignal);
  // Browsers without AbortSignal.any get the same from a controller
  const any = AbortSignal.any;
  AbortSignal.any = undefined;
  try {
    const stop2 = new AbortController();
    const fallback = http.timeoutSignal(60_000, stop2.signal);
    stop2.abort();
    const timed = http.timeoutSignal(30, new AbortController().signal);
    await sleep(80);
    check('...the same without AbortSignal.any', fallback.aborted && timed.aborted);
  } finally {
    AbortSignal.any = any;
  }
}
{
  const stop = new AbortController();
  const t = Date.now();
  setTimeout(() => stop.abort(), 50);
  const paused = await outcome(http.pause(5000, stop.signal));
  check('pause: a Stop ends the wait at once (AbortError)', paused === 'AbortError' && Date.now() - t < 500, `${paused} after ${Date.now() - t} ms`);
  check('...and without one it just waits', (await outcome(http.pause(20))) === 'resolved');
}
{
  let finished = false;
  const shared = sleep(150).then(() => { finished = true; return 'result'; });
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 30);
  const waited = await outcome(http.untilAborted(shared, stop.signal));
  check('untilAborted: the caller stops waiting (AbortError)...', waited === 'AbortError' && !finished, waited);
  check('...while the shared work goes on for the others', (await shared) === 'result' && finished);
  check('...and a caller who doesn\'t stop gets the result', (await http.untilAborted(Promise.resolve(7), new AbortController().signal)) === 7);
}

console.log('\n[the similar-structure search, stopped while queued]');
{
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push(u.replace('https://search.foldseek.com/api', ''));
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (u.endsWith('/ticket')) return new Response(JSON.stringify({ id: 'T1', status: 'PENDING' }), { status: 200 });
    if (u.includes('/ticket/T1')) return new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 });
    return new Response('{"results":[]}', { status: 200 });
  };
  try {
    const stop = new AbortController();
    const statuses = [];
    const query = { label: 'q', structureId: '1ABC', pdb: 'ATOM', excludePdbIds: [], excludeAccessions: [] };
    const search = foldseek.searchSimilarStructures(query, s => statuses.push(s), stop.signal);
    await sleep(2300); // One poll (every 2 s), then Stop during the next wait
    const t = Date.now();
    stop.abort();
    const ended = await outcome(search);
    const ms = Date.now() - t;
    const after = calls.length;
    await sleep(2500);
    check('Stop ends the search at once (AbortError)', ended === 'AbortError' && ms < 300, `${ended} after ${ms} ms`);
    check('...it had submitted and polled, saying it waits in the queue', calls[0] === '/ticket' && calls.includes('/ticket/T1') && statuses.includes('Waiting in the Foldseek queue…'), calls.join(' '));
    check('...and nothing is asked after it: no more polls, no result download', calls.length === after && !calls.some(c => c.startsWith('/result')), `${after} -> ${calls.length}: ${calls.join(' ')}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
