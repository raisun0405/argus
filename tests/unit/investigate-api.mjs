// api/investigate.ts with the AI (and UniProt) mocked: no real AI calls, no real key.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';

process.env.NEBIUS_API_KEY = 'test-key-not-real';
let aiReply = null; // (body) => Response
let lastAi = null;
let uniprotQueries = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.tokenfactory.nebius.com')) {
    lastAi = JSON.parse(init.body);
    return aiReply(lastAi);
  }
  if (u.includes('rest.uniprot.org')) {
    uniprotQueries.push(decodeURIComponent(u));
    return new Response(JSON.stringify({ results: [{ primaryAccession: 'P01116' }] }), { status: 200 });
  }
  return realFetch(url, init);
};
const completion = (content) => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const { default: handler } = await import(`${ROOT_URL}api/investigate.ts`);
let visitorSeq = 0;
const call = (body, { origin = 'http://127.0.0.1:3000', url = 'http://127.0.0.1:3000/api/investigate', raw, ip = `10.1.0.${++visitorSeq}`, method = 'POST' } = {}) =>
  handler(new Request(url, { method, headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Real-IP': ip }, ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}) }));

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const PLAN = { stage: 'plan', question: 'Are the disease mutations near a pocket?', current: { pdbId: '1TRZ', title: 'Human insulin' } };
const WRITE = { stage: 'write', question: 'Are the disease mutations near a pocket?', structure: { id: '4OBE', title: 'KRAS' }, steps: 3,
  findings: '[1] UniProt and PDBe annotations: KRAS...\n[2] Variant effects: 30 of 166 positions likely harmful.\n[3] Predicted pockets: pocket1 80%.',
  sets: [{ name: 'harmful', label: 'likely harmful positions', count: 30 }, { name: 'pocket1', label: 'pocket 1', count: 21 }, { name: 'Bad Name', label: 'x', count: 3 }, { name: 'zero', label: 'x', count: 0 }] };

console.log('\n[1] requests');
let res = await call(null, { method: 'GET' });
check('GET -> 405', res.status === 405, String(res.status));
aiReply = () => completion({ steps: [] });
res = await call(PLAN, { origin: 'https://evil.example' });
check('foreign origin -> 403', res.status === 403, String(res.status));
res = await call(PLAN, { origin: 'http://192.168.1.5:3100', url: 'http://192.168.1.5:3100/api/investigate' });
check('same-origin LAN dev -> 200', res.status === 200, String(res.status));
res = await call(null, { raw: '{not json' });
check('invalid JSON -> 400', res.status === 400);
res = await call({ stage: 'plan', current: { pdbId: '1TRZ' } });
check('no question -> 400', res.status === 400);
res = await call({ ...PLAN, question: 'x'.repeat(1001) });
check('question over 1000 characters -> 400', res.status === 400);
res = await call({ ...PLAN, stage: 'guess' });
check('unknown stage -> 400', res.status === 400 && (await res.json()).error.includes('stage'));
res = await call({ ...PLAN, current: { pdbId: 'bad id!' } });
check('plan without a valid current.pdbId -> 400', res.status === 400);

console.log('\n[2] plan');
aiReply = () => completion({ structure: '1trz', title: 'Mutations and pockets', steps: [{ tool: 'variants', why: 'harm' }, { tool: 'pockets' }, { tool: 'hack' }, { tool: 'relate', a: 'harmful', b: 'pocket1', within: 4 }] });
res = await call(PLAN);
let data = await res.json();
check('plan -> 200, cleaned (facts added, unknown tool dropped)', res.status === 200 && data.steps.map(s => s.tool).join() === 'facts,variants,pockets,relate', JSON.stringify(data));
check('plan keeps the structure and title', data.structure === '1TRZ' && data.title === 'Mutations and pockets');
check('plan prompt: the tools, the question and the structure', lastAi.messages[0].content.includes('- relate:') && lastAi.messages[1].content.includes('CURRENT STRUCTURE: 1TRZ (Human insulin)') && lastAi.messages[1].content.includes('Are the disease mutations near a pocket?'));
check('plan call: JSON mode, low reasoning effort', lastAi.response_format?.type === 'json_object' && lastAi.reasoning_effort === 'low' && lastAi.model === 'nvidia/nemotron-3-super-120b-a12b');
aiReply = () => completion({ structure: 'AF-Q99999-F1', alphafold: { gene: 'KRAS', taxId: 9606 }, steps: [] });
uniprotQueries = [];
data = await (await call(PLAN)).json();
check('AlphaFold: the accession comes from the gene symbol', data.structure === 'AF-P01116-F1' && uniprotQueries.some(q => q.includes('gene_exact:KRAS AND organism_id:9606')), `${data.structure} ${uniprotQueries[0] ?? ''}`);
aiReply = () => completion('```json\n{"steps": [{"tool": "ligands"}]}\n```');
data = await (await call(PLAN)).json();
// ...and the question (mutations near a pocket) puts its essential steps before the model's own
check('code fences tolerated', data.steps?.map(s => s.tool).join() === 'facts,variants,pockets,ligands,relate', JSON.stringify(data.steps?.map(s => s.tool)));
aiReply = () => completion('not json at all');
res = await call(PLAN);
check('invalid model JSON -> 502', res.status === 502);
aiReply = () => completion('[1,2]');
res = await call(PLAN);
check('model array -> 502', res.status === 502);
aiReply = () => new Response('{"error":"rate"}', { status: 429, headers: { 'retry-after': '7' } });
res = await call(PLAN);
check('the AI 429 -> 429 with Retry-After', res.status === 429 && res.headers.get('retry-after') === '7', `${res.status} ${res.headers.get('retry-after')}`);
aiReply = () => new Response('oops', { status: 500 });
res = await call(PLAN);
check('the AI 500 -> 502', res.status === 502);

console.log('\n[3] write');
aiReply = () => completion({ title: 'Yes, in pocket 1', answer: 'Six harmful positions line pocket 1 [2, 3] [9].', marks: [{ set: 'pocket1', label: 'Pocket 1' }, { set: 'Bad Name' }, { set: 'zero' }, { set: 'made_up' }], caveat: 'Predictions.' });
res = await call(WRITE);
data = await res.json();
check('write -> 200', res.status === 200, JSON.stringify(data));
check('citations cleaned against 3 steps', data.answer === 'Six harmful positions line pocket 1 [2][3].', data.answer);
check('marks: only valid sets that were sent', JSON.stringify(data.marks) === JSON.stringify([{ set: 'pocket1', label: 'Pocket 1' }]), JSON.stringify(data.marks));
check('write prompt: results with their line breaks, sets listed (bad ones dropped)', lastAi.messages[1].content.includes('RESULTS:\n[1] UniProt and PDBe annotations: KRAS...\n[2]')
  && lastAi.messages[1].content.includes('- harmful: likely harmful positions (30)') && !lastAi.messages[1].content.includes('Bad Name') && !lastAi.messages[1].content.includes('- zero'));
check('write call: medium reasoning effort', lastAi.reasoning_effort === 'medium');
res = await call({ ...WRITE, steps: 0 });
check('steps out of range -> 400', res.status === 400);
res = await call({ ...WRITE, steps: 7 });
check('more than 6 steps -> 400', res.status === 400);
res = await call({ ...WRITE, findings: '' });
check('no findings -> 400', res.status === 400);
res = await call({ ...WRITE, findings: 'x'.repeat(7001) });
check('findings over 7000 characters -> 400', res.status === 400);
aiReply = () => completion({ title: 'x', marks: [] });
res = await call(WRITE);
data = await res.json();
check('write-up without an answer -> 502, in the streamed reply', res.status === 200 && data.status === 502 && /unusable/.test(data.error), JSON.stringify(data));

console.log('\n[3b] the write-up and the check stream (Nemotron can take longer than the 25 s to start a reply)');
aiReply = () => new Promise(resolve => setTimeout(() => resolve(completion({ title: 'Slow', answer: 'Pocket 1 [3].', marks: [] })), 400));
let t0 = Date.now();
res = await call(WRITE);
const reader = res.body.getReader();
const first = await reader.read();
const firstAt = Date.now() - t0;
let text = new TextDecoder().decode(first.value);
for (let part = await reader.read(); !part.done; part = await reader.read()) text += new TextDecoder().decode(part.value);
check('the reply starts at once, with a space, before the AI has answered', res.status === 200 && text.startsWith(' ') && firstAt < 300, `first bytes after ${firstAt} ms`);
check('...then the write-up, as JSON', JSON.parse(text).answer === 'Pocket 1 [3].', text.trim().slice(0, 80));
check('streamed replies are never cached', res.headers.get('cache-control') === 'no-store' && res.headers.get('content-type') === 'application/json');
aiReply = () => completion({ title: 'x', answer: 'Pocket 1 [3].', marks: [] });
await call({ ...WRITE, retry: true });
check('the retry after a failure asks for low reasoning effort (a quicker answer)', lastAi.reasoning_effort === 'low', lastAi.reasoning_effort);
await call({ ...WRITE, retry: 'yes' });
check('...only when it is one (retry: true)', lastAi.reasoning_effort === 'medium', lastAi.reasoning_effort);
aiReply = () => new Response('{"error":"rate"}', { status: 429, headers: { 'retry-after': '7' } });
data = await (await call(WRITE)).json();
check('the AI 429 while writing: 429 and Retry-After in the streamed reply', data.status === 429 && data.retryAfter === 7 && /busy/.test(data.error), JSON.stringify(data));
aiReply = () => { throw new TypeError('fetch failed'); };
data = await (await call(WRITE)).json();
check('the AI unreachable while writing: 502 in the streamed reply', data.status === 502, JSON.stringify(data));
const CHECK = { stage: 'check', question: WRITE.question, results: WRITE.findings, sentences: [{ id: 0, text: 'Pocket 1 holds 6 harmful positions [2][3].', missing: [] }] };
aiReply = () => completion({ verdicts: [{ id: 0, verdict: 'keep' }] });
res = await call(CHECK);
text = await res.text();
check('the check streams too, its verdicts after the space', res.status === 200 && text.startsWith(' ') && JSON.parse(text).verdicts?.[0]?.verdict === 'keep', text.trim().slice(0, 80));
res = await call({ ...CHECK, sentences: [] });
check('a check with nothing to check -> 400, before any stream', res.status === 400);

console.log('\n[4] rate limit and key');
aiReply = () => completion({ steps: [] });
const statuses = [];
for (let i = 0; i < 17; i++) statuses.push((await call(PLAN, { ip: '10.9.9.9' })).status);
check('17th request in a minute from one visitor -> 429', statuses.slice(0, 16).every(s => s === 200) && statuses[16] === 429, statuses.join(','));
delete process.env.NEBIUS_API_KEY;
res = await call(PLAN);
check('no key -> 500', res.status === 500);

// A body is read no further than its cap (S5)
check('a 300 KB body is refused as too large (413)', (await call(null, { raw: JSON.stringify({ stage: 'plan', question: 'x', padding: 'p'.repeat(300_000) }) })).status === 413);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
