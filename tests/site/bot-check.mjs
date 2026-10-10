// Does a script reach the AI functions, or does the hosting's bot check stop it first? Sends what a script
// would (Node's fetch, the site's own Origin claimed) with an empty body, so a request that does get through
// is refused by the function before any AI call. Reports, per function: through (the function answered) or
// stopped (Vercel's challenge: x-vercel-mitigated).
//   node tf-bot-check.mjs <base> [expect: through|stopped]
const BASE = (process.argv[2] ?? 'https://argus-zeta-rouge.vercel.app').replace(/\/$/, '');
const EXPECT = process.argv[3] ?? 'stopped';
let failures = 0;
console.log(`[a script calling the AI functions on ${BASE}]`);
for (const route of ['analyze', 'investigate', 'cofold']) {
  const res = await fetch(`${BASE}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(BASE).origin }, body: '{}' });
  const mitigated = res.headers.get('x-vercel-mitigated');
  const outcome = mitigated ? 'stopped' : 'through';
  const ok = !EXPECT || EXPECT === outcome;
  if (!ok) failures++;
  console.log(`  ${EXPECT ? (ok ? 'PASS' : 'FAIL') + '  ' : ''}/api/${route}: ${outcome} (${res.status}${mitigated ? `, x-vercel-mitigated: ${mitigated}` : ''}, ${res.headers.get('content-type') ?? 'no type'})`);
  await res.body?.cancel();
}
if (EXPECT) console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
