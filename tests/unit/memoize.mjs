// services/http.ts memoize: an answer that the data isn't there expires; failures are evicted at once,
// and only while still the cached promise; real data stays. No network.
//   node tf-memoize-unit.mjs <project root>
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
const { memoize } = await import(`${ROOT_URL}services/http.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const TTL = 60; // ms, instead of the app's two minutes

for (const [label, value] of [['null (a 404)', null], ['an empty list', []], ['an empty map', new Map()], ['an empty string', '']]) {
  const cache = new Map();
  let calls = 0;
  const load = async () => { calls++; return value; };
  await memoize(cache, 'k', load, TTL);
  await memoize(cache, 'k', load, TTL);
  check(`${label}: shared while fresh`, calls === 1, `${calls} loads`);
  await wait(TTL + 40);
  await memoize(cache, 'k', load, TTL);
  check(`${label}: asked again once it has expired`, calls === 2, `${calls} loads`);
}

{
  const cache = new Map();
  let calls = 0;
  const load = async () => { calls++; return { residues: 42 }; };
  await memoize(cache, 'k', load, TTL);
  await wait(TTL + 40);
  await memoize(cache, 'k', load, TTL);
  check('real data is never expired', calls === 1, `${calls} loads`);
}

{
  const cache = new Map();
  let calls = 0;
  const load = async () => { calls++; throw new Error('upstream 500'); };
  await memoize(cache, 'k', load, TTL).catch(() => {});
  await wait(5);
  check('a failure is evicted at once', !cache.has('k'));
  await memoize(cache, 'k', load, TTL).catch(() => {});
  check('...so the next call asks again', calls === 2, `${calls} loads`);
}

{
  // A slow failure must not evict the request that replaced it meanwhile
  const cache = new Map();
  const slow = memoize(cache, 'k', () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 30)), TTL);
  const replacement = Promise.resolve('fresh');
  cache.set('k', replacement);
  await slow.catch(() => {});
  await wait(5);
  check('a late failure leaves a newer cached request alone', cache.get('k') === replacement);
}

{
  // Same for a late "not found": its expiry mustn't remove what replaced it
  const cache = new Map();
  await memoize(cache, 'k', async () => null, TTL);
  const replacement = Promise.resolve({ ok: 1 });
  cache.set('k', replacement);
  await wait(TTL + 40);
  check('an expiring "not found" leaves a newer cached request alone', cache.get('k') === replacement);
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
