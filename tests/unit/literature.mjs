// Investigate's literature step (Tavily): the plan rules, the source filter, the step runner, and the
// server's "search" stage. Offline except the last part: one real Tavily search (2 credits), run only when TAVILY_API_KEY is set.
import '../lib/ts-hooks.mjs';
import { ROOT_URL } from '../lib/env.mjs';
import { readFileSync } from 'node:fs';
const P = await import(`${ROOT_URL}services/investigationPlan.ts`);
const I = await import(`${ROOT_URL}services/investigation.ts`);

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
const tools = (plan) => plan?.steps.map(s => s.tool === 'relate' ? `relate(${s.a},${s.b})` : s.tool === 'literature' ? `literature("${s.query}")` : s.tool).join(' ');

console.log('\n[1] the plan');
let plan = P.normalizePlan({ steps: [{ tool: 'literature', query: 'KRAS G12C "sotorasib" [resistance]', why: 'what trials report.' }] }, '6OIM', 'q');
check('literature kept with its words; quotes and brackets dropped', tools(plan) === 'facts literature("KRAS G12C sotorasib resistance")', tools(plan));
check('its why in sentence case, no full stop', plan.steps[1].why === 'What trials report', plan.steps[1].why);
plan = P.normalizePlan({ steps: [{ tool: 'literature' }] }, '6OIM', 'What do studies say about sotorasib?');
check('no words: the question is searched', plan.steps[1]?.query === 'What do studies say about sotorasib?', tools(plan));
plan = P.normalizePlan({ steps: [{ tool: 'literature' }] }, '6OIM');
check('no words and no question: no literature step', tools(plan) === 'facts', tools(plan));
plan = P.normalizePlan({ steps: [{ tool: 'literature', query: 'a b c' }, { tool: 'literature', query: 'other words' }] }, '6OIM', 'q');
check('literature once', tools(plan) === 'facts literature("a b c")', tools(plan));
plan = P.normalizePlan({ steps: [{ tool: 'literature', query: 'x'.repeat(400) }] }, '6OIM', 'q');
check('words capped at 160 characters', plan.steps[1].query.length === 160);
plan = P.normalizePlan({ steps: ['variants', 'pockets', 'ligands', 'partners', 'similar', 'literature'].map(tool => ({ tool, query: 'kras' })) }, '6OIM', 'q');
check('still at most 6 steps', plan.steps.length === 6, tools(plan));
check('label', P.stepLabel({ tool: 'literature' }) === 'Published research (Tavily)');
plan = P.fallbackPlan('What does published research say about KRAS G12C inhibitors?', '6OIM');
check('fallback plan: a research question gets a literature step', plan.steps.some(s => s.tool === 'literature' && /KRAS G12C inhibitors/.test(s.query)), tools(plan));
plan = P.fallbackPlan('Where are the pockets?', '1HSG');
check('fallback plan: a structure question gets none', !plan.steps.some(s => s.tool === 'literature'), tools(plan));

console.log('\n[2] the sources');
const long = (s) => `${s} `.repeat(40).trim();
const raw = [
  { title: 'A PMC paper', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', content: long('Sotorasib binds the switch-II pocket.') },
  { title: 'Not https', url: 'http://pubmed.ncbi.nlm.nih.gov/1/', content: long('x y z') },
  { title: 'A blog', url: 'https://someblog.com/kras', content: long('blog text') },
  { title: 'A lookalike', url: 'https://evilnature.com/x', content: long('fake') },
  { title: 'A stub', url: 'https://www.cell.com/abc', content: 'Small-Molecule Reactivation of Mutant p53 to Wild- ...' },
  { title: 'Same page again', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', content: long('dup') },
  { title: 'Nature paper', url: 'https://www.nature.com/articles/s1', content: 'in abnormally high concentrations of GTP-bound KRAS [...] the drug traps it. ' + long('More text here.') },
  { title: 'PubMed abstract', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', content: long('Abstract sentence.') },
  { title: 'ScienceDirect', url: 'https://www.sciencedirect.com/science/article/pii/1', content: long('Body text.') },
  { title: 'Fifth good one', url: 'https://www.biorxiv.org/content/1', content: long('Preprint text.') },
];
const sources = P.normalizeSources(raw);
check('listed https sites only, no stub, no repeat, at most 4', sources.map(s => s.title).join('|') === 'A PMC paper|Nature paper|PubMed abstract|ScienceDirect', sources.map(s => s.title).join('|'));
check('site names', sources.map(s => s.site).join('|') === 'PMC|Nature|PubMed|ScienceDirect', sources.map(s => s.site).join('|'));
check('excerpts at most ~600 characters', sources.every(s => s.excerpt.length <= 601), sources.map(s => s.excerpt.length).join(','));
check('a sentence cut at its end', /\.$/.test(sources[0].excerpt), sources[0].excerpt.slice(-30));
check('a mid-sentence opening (and the gap after it) is dropped', sources[1].excerpt.startsWith('More text here.'), sources[1].excerpt.slice(0, 60));
check('own sources pass through unchanged', JSON.stringify(P.normalizeSources(sources)) === JSON.stringify(sources));
check('rubbish in, nothing out', P.normalizeSources(null).length === 0 && P.normalizeSources([{}, 'x', 5]).length === 0);
const frag = P.normalizeSources([{ title: 'A fragment start', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9/', content: '…for corrector function (26), shows similar efficacy as VX-809. ' + long('The corrector FDL169 shows sixty percent of the efficacy.') }])[0];
check('an opening fragment without its subject is dropped', frag && frag.excerpt.startsWith('The corrector FDL169'), frag?.excerpt.slice(0, 60));
const gap = P.normalizeSources([{ title: 'A paper with a gap', url: 'https://www.nature.com/articles/s9', content: 'The trial was suspended. [...] It did not improve lung function. ' + long('Other text here.') }])[0];
check('a gap in the text stays marked [...]', gap && gap.excerpt.includes('suspended. [...] It did not'), gap?.excerpt.slice(0, 80));
check('literatureSite', P.literatureSite('https://academic.oup.com/nar/x') === 'Oxford Academic' && P.literatureSite('https://nature.com.evil.io/x') === null && P.literatureSite('notaurl') === null);

console.log('\n[3] the step');
const PDB = 'ATOM      1  CA  GLY A   1       0.000   0.000   0.000  1.00 20.00           C\nEND';
const base = { structure: async () => PDB, facts: async () => null, variants: async () => { throw new Error('x'); }, pockets: async () => { throw new Error('x'); }, ligands: () => [], proteins: async () => [], partners: async () => { throw new Error('x'); }, similar: async () => { throw new Error('x'); } };
const litPlan = { structure: '6OIM', title: 't', steps: [{ tool: 'facts', why: '' }, { tool: 'literature', why: 'w', query: 'KRAS G12C sotorasib' }] };
let searched = null;
let steps = await I.runInvestigationSteps('6OIM', PDB, litPlan, () => {}, new AbortController().signal, { ...base, literature: async (q) => { searched = q; return sources; } });
const lit = steps[1];
check('searches the planned words', searched === 'KRAS G12C sotorasib');
check('done, with its papers attached', lit.status === 'done' && lit.result.sources.length === 4);
check('summary', lit.result.summary === '4 papers found for “KRAS G12C sotorasib”', lit.result.summary);
check('evidence: lettered papers with title, site and excerpt', /^A search of scientific publications for "KRAS G12C sotorasib" found these papers/.test(lit.result.evidence)
  && lit.result.evidence.includes('\n(a) "A PMC paper" (PMC): Sotorasib binds') && lit.result.evidence.includes('\n(d) "ScienceDirect" (ScienceDirect): '));
const findings = I.findingsText(steps);
check('findings carry it under its step number', findings.includes('[2] Published research (Tavily): A search of scientific publications'), findings.slice(0, 160));
check('makes no sets (nothing to mark)', I.markableSets(steps).length === 0);
steps = await I.runInvestigationSteps('6OIM', PDB, litPlan, () => {}, new AbortController().signal, { ...base, literature: async () => [] });
check('nothing found: done, says so', steps[1].status === 'done' && /No papers found/.test(steps[1].result.summary) && /found no relevant papers/.test(steps[1].result.evidence));
steps = await I.runInvestigationSteps('6OIM', PDB, litPlan, () => {}, new AbortController().signal, { ...base, literature: async () => { throw Object.assign(new Error('Investigate API error 503: not set up'), { status: 503 }); } });
check('not set up on the server: skipped, not failed', steps[1].status === 'skipped' && /unavailable here/.test(steps[1].note), `${steps[1].status} ${steps[1].note}`);
steps = await I.runInvestigationSteps('6OIM', PDB, litPlan, () => {}, new AbortController().signal, { ...base, literature: async () => { throw Object.assign(new Error('Investigate API error 504: The literature search took too long'), { status: 504 }); } });
check('a timeout: failed with its reason', steps[1].status === 'failed' && /took too long/.test(steps[1].note), steps[1].note);
const fb = I.fallbackWriteUp(steps.map((s, i) => (i === 1 ? { ...lit } : s)), 't');
check('fallback write-up cites it', /4 papers found .*\[2\]/.test(fb.answer), fb.answer);

console.log('\n[3b] citations, sentences and the check');
const cc = (s) => P.cleanCitations(s, 4);
check('【3】 -> [3]', cc('Claim 【3】.') === 'Claim [3].', cc('Claim 【3】.'));
check('([2]) -> [2]', cc('Claim ([2]).') === 'Claim [2].', cc('Claim ([2]).'));
check('[3][a] -> [3a]', cc('Claim [3][a].') === 'Claim [3a].', cc('Claim [3][a].'));
check('([3]a) -> [3a]', cc('Claim ([3]a).') === 'Claim [3a].', cc('Claim ([3]a).'));
check('a citation after the full stop moves before it', cc('First claim. [3] Second claim [2].') === 'First claim [3]. Second claim [2].', cc('First claim. [3] Second claim [2].'));
check('[3a, 3b] split; [9a] out of range dropped', cc('Claim [3a, 3b][9a].') === 'Claim [3a][3b].', cc('Claim [3a, 3b][9a].'));
check('old forms still work: [1, 3], [2-3], [2][2]', cc('A [1, 3]. B [2-3]. C [2][2].') === 'A [1][3]. B [2][3]. C [2].', cc('A [1, 3]. B [2-3]. C [2][2].'));
check('splitCitations reads [3a]', JSON.stringify(P.splitCitations('X [3a] y [2].')) === JSON.stringify([{ text: 'X ' }, { cite: 3, paper: 'a' }, { text: ' y ' }, { cite: 2 }, { text: '.' }]));
check('stripCitations drops [3a]', P.stripCitations('X [3a] and y [2].') === 'X and y.', P.stripCitations('X [3a] and y [2].'));
const ans = 'Pocket 1 is 98% likely [2]. Studies report e.g. a 0.98 score [3a].\nA second paragraph [3b]! Last one';
const parts = P.splitSentences(ans);
check('sentences join back exactly', parts.map(p => p.text + p.gap).join('') === ans);
check('split at stops and line breaks, not inside "e.g." or "0.98"', parts.map(p => p.text).join(' | ') === 'Pocket 1 is 98% likely [2]. | Studies report e.g. a 0.98 score [3a]. | A second paragraph [3b]! | Last one', parts.map(p => p.text).join(' | '));
const sents = [{ id: 1, text: 'Studies report X [3a].' }, { id: 4, text: 'One paper found Y [3b].' }, { id: 6, text: 'Z [3c].' }];
const verdicts = P.normalizeCheck({ verdicts: [{ id: 1, verdict: 'fix', text: 'Studies report a narrower X' }, { id: 4, verdict: 'fix' }, { id: 6, verdict: 'drop' }, { id: 99, verdict: 'drop' }] }, sents);
check('a fix keeps its citations; a fix without text is kept; unknown ids ignored', JSON.stringify(verdicts) === JSON.stringify([
  { id: 1, verdict: 'fix', text: 'Studies report a narrower X [3a].' }, { id: 4, verdict: 'keep' }, { id: 6, verdict: 'drop' }]), JSON.stringify(verdicts));
check('no verdicts: everything kept', P.normalizeCheck(null, sents).every(v => v.verdict === 'keep'));
const abbr = P.splitSentences('Seen in E. coli and B. subtilis [2]. It binds chain A. Then more [3].').map(p => p.text);
check('a stop before a lowercase word is not an end; "chain A." still is', JSON.stringify(abbr) === JSON.stringify(['Seen in E. coli and B. subtilis [2].', 'It binds chain A.', 'Then more [3].']), JSON.stringify(abbr));
const bare = [{ id: 0, text: 'A claim with no citation.' }, { id: 1, text: 'Another one.' }, { id: 2, text: 'A third.' }];
const bareV = P.normalizeCheck({ verdicts: [{ id: 0, verdict: 'fix', text: 'A narrower claim.' }, { id: 1, verdict: 'fix', text: 'Another one [3a].' }, { id: 2, verdict: 'keep' }] }, bare);
const draft = 'First claim [2]. Second claim [3a]. Third claim [3b]. Fourth [2].';
const applied = P.applyCheck(draft, [{ id: 0, verdict: 'keep' }, { id: 1, verdict: 'fix', text: 'First  claim [3a].' }, { id: 2, verdict: 'drop' }, { id: 3, verdict: 'fix', text: 'Fourth, narrower [2].' }], 3);
check('applyCheck: fixes in place, drops gone, a fix repeating an earlier sentence gone too', JSON.stringify(applied) === JSON.stringify({ answer: 'First claim [2]. Fourth, narrower [2].', fixed: 1, dropped: 2 }), JSON.stringify(applied));
check('applyCheck: no verdicts, the answer as it was', P.applyCheck(draft, [], 3).answer === draft);
const citedW = 'A study of widget W12X found 0.75 efficiency and 40% yield in 2019.';
const mt = (s, q = 'What is known about widget W12X?', c = citedW) => JSON.stringify(P.missingTerms(s, q, c));
check('missingTerms: everything in the source, nothing missing', mt('Widget W12X reached 0.75 efficiency and 40% yield [3a].') === '[]', mt('Widget W12X reached 0.75 efficiency and 40% yield [3a].'));
check('missingTerms: a code and numbers the source lacks', mt('Widget W13Y reached 0.80 efficiency in 2021 [3a].') === '["W13Y","0.80","2021"]', mt('Widget W13Y reached 0.80 efficiency in 2021 [3a].'));
check('missingTerms: a name the question asks about that the source lacks', mt('The frobnicator binds the gizmo [2].', 'How does the frobnicator bind the gizmo?', 'Gizmo contacts: none listed.') === '["frobnicator"]', mt('The frobnicator binds the gizmo [2].', 'How does the frobnicator bind the gizmo?', 'Gizmo contacts: none listed.'));
check('missingTerms: asking words, "3D", spelling (COX-1 vs COX1) and an uncited sentence are not flagged', mt('Published research on the 3D shape of COX-1 [2].', 'What published research covers COX-1?', 'COX1 shape') === '[]' && mt('Widget W99Z is new.', undefined, '') === '[]', mt('Published research on the 3D shape of COX-1 [2].', 'What published research covers COX-1?', 'COX1 shape'));
const papersQ = { 3: [
  { title: 'Widget binding study', excerpt: 'The widget binds the gizmo with high affinity in vitro. [...] Later work found no effect in mice.' },
  { title: 'Second paper', excerpt: 'Gizmo levels rose by 40% after treatment with the widget.' },
] };
const qg = a => P.quoteGate(a, papersQ, 3);
const qa = a => JSON.stringify(qg(a));
const okQuote = 'One study reports "the widget binds the gizmo with high affinity" [3a].';
check('quoteGate: a quote found in the paper it cites stays as it is', qa(okQuote) === JSON.stringify({ answer: okQuote, dropped: 0 }), qa(okQuote));
check('quoteGate: a quote found in another paper of the step is cited to that paper', qg('One study reports "gizmo levels rose by 40% after treatment" [3a].').answer === 'One study reports "gizmo levels rose by 40% after treatment" [3b].', qa('One study reports "gizmo levels rose by 40% after treatment" [3a].'));
check('quoteGate: a quote citing the whole step gets its paper', qg('A study reports "gizmo levels rose by 40% after treatment" [3].').answer.endsWith('[3b].'), qa('A study reports "gizmo levels rose by 40% after treatment" [3].'));
const mixed = 'Residue A12 lines pocket 1 [2]. The widget strongly binds the gizmo [3a]. One study reports "high affinity in vitro later work found no effect" [3a]. The search found no paper on dosing [3].';
check('quoteGate: tool sentences and "found nothing" lines stay; a paraphrase and a quote across a gap go', qa(mixed) === JSON.stringify({ answer: 'Residue A12 lines pocket 1 [2]. The search found no paper on dosing [3].', dropped: 2 }), qa(mixed));
check('quoteGate: too many words around the quote, or a quote under five words, go', qg('In a large careful multi-year study across many hospitals in several countries the authors report "the widget binds the gizmo with high affinity" [3a]. One study says "binds the gizmo" [3a].').dropped === 2);
const picked = [
  { paper: '3a', quote: 'the widget binds the gizmo with high affinity' },
  { paper: '3a', quote: 'Gizmo levels rose by 40% after treatment' },
  { paper: '3b', quote: 'the widget cures every known disease' },
  { paper: '3a', quote: 'The widget binds the gizmo with high affinity.' },
];
const aq = P.addQuotes('The search found two papers [3].', picked, papersQ);
check('addQuotes: verified quotes added with code-written words, moved to their real paper; unfound and repeated ones left out',
  JSON.stringify(aq) === JSON.stringify({ answer: 'The search found two papers [3]. One paper reports “the widget binds the gizmo with high affinity” [3a]. Another paper reports “Gizmo levels rose by 40% after treatment” [3b].', added: 2, dropped: 2 }), JSON.stringify(aq));
const nw = P.normalizeWrite({ answer: 'X [1].', quotes: [{ paper: '[3a]', quote: '"the widget binds the gizmo"' }, { paper: '9a', quote: 'a b c d e f' }, { paper: '3b', quote: 'too short' }] }, [], 3);
check('normalizeWrite: quotes keep a real step and paper, lose their quote marks, and need five words', JSON.stringify(nw?.quotes) === JSON.stringify([{ paper: '3a', quote: 'the widget binds the gizmo' }]), JSON.stringify(nw?.quotes));
const finalA = 'One paper reports “the widget binds the gizmo with high affinity” [3a].';
check('safeTitle: kept when its words are in the answer or question, dropped when it claims more',
  P.safeTitle('Widget binds the gizmo', 'How does the widget bind the gizmo?', finalA) === 'Widget binds the gizmo'
  && P.safeTitle('Widget binds gizmo irreversibly', 'How does the widget bind the gizmo?', finalA) === ''
  && P.safeTitle('Widget binds at A12', 'How does the widget bind the gizmo?', finalA) === '');
check('an uncited sentence: a fix without a citation drops it, one adding a citation stands', JSON.stringify(bareV) === JSON.stringify([
  { id: 0, verdict: 'drop' }, { id: 1, verdict: 'fix', text: 'Another one [3a].' }, { id: 2, verdict: 'keep' }]), JSON.stringify(bareV));

console.log('\n[4] the server');
const TAVILY = process.env.TAVILY_API_KEY;
const { default: handler } = await import(`${ROOT_URL}api/investigate.ts`);
let ip = 0;
const api = async (body) => {
  const res = await handler(new Request('http://127.0.0.1:3250/api/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3250', 'x-real-ip': `10.2.0.${++ip}` }, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
delete process.env.TAVILY_API_KEY;
let r = await api({ stage: 'search', question: 'kras', query: 'KRAS G12C sotorasib' });
check('no key: 503, says it is not set up', r.status === 503 && /not set up/.test(r.data.error), `${r.status} ${r.data.error}`);
process.env.TAVILY_API_KEY = TAVILY ?? 'not-a-real-key'; // The checks before the search never use it
r = await api({ stage: 'search', question: 'kras', query: 'ab' });
check('too few words: 400', r.status === 400, `${r.status} ${r.data.error}`);
r = await api({ stage: 'search', question: 'kras', query: 'x'.repeat(161) });
check('too many: 400', r.status === 400, `${r.status} ${r.data.error}`);
r = await api({ stage: 'nope', question: 'kras' });
check("unknown stage names all four", r.status === 400 && /"plan", "search", "write" or "check"/.test(r.data.error), r.data.error);
if (TAVILY) {
const t = Date.now();
r = await api({ stage: 'search', question: 'kras', query: 'KRAS G12C sotorasib switch-II pocket' });
const got = r.data.sources ?? [];
check('real search: 200 with papers', r.status === 200 && got.length >= 2, `${r.status} ${got.length} papers, ${Date.now() - t} ms`);
check('every paper from a listed site, with a real excerpt', got.every(s => P.literatureSite(s.url) === s.site && s.excerpt.length >= 200), got.map(s => s.site).join(', '));
for (const s of got) console.log(`     ${s.site}: ${s.title.slice(0, 90)}`);
} else console.log('  (the real search is skipped: set TAVILY_API_KEY to run it)');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
