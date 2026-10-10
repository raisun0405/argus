// The quiz card in the browser: shuffled options for one right answer, and "select all that apply"
// (checkboxes, Check button, partly right / missed / correct) for several.
import '../lib/ts-hooks.mjs';
import { BASE, CHROME, OUT, ROOT_URL } from '../lib/env.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const Q = await import(`${ROOT_URL}services/quiz.ts`);
const THEME = process.argv[2] ?? '';
mkdirSync(`${OUT}/shots`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };

const single = { question: 'Which residues form the catalytic dyad of HIV-1 protease?', options: ['Asp25 of each chain', 'Ile50 of each chain', 'Gly27 and Ala28', 'Lys45 and Met46'], correctAnswerIndex: 0,
  explanation: 'Each monomer contributes Asp25; together they activate the water that cuts the peptide bond.', answerHighlights: [{ chain: 'A', resi: [25], label: 'Asp25', category: 'active_site' }] };
const multi = { question: 'Which disulfide bonds link the A and B chains of insulin? (Select all that apply)', options: ['CysA7–CysB7', 'CysA6–CysA11', 'CysA20–CysB19', 'CysB7–CysB19'],
  correctAnswerIndex: 0, correctAnswerIndices: [0, 2], explanation: 'A7–B7 and A20–B19 join the two chains; A6–A11 is inside the A chain.',
  answerHighlights: [{ chain: 'A', resi: [7, 20], label: 'Cys A7/A20', category: 'other' }, { chain: 'B', resi: [7, 19], label: 'Cys B7/B19', category: 'other' }] };
const hiv = { pdbId: '1HSG', title: 'HIV-1 protease with indinavir (MK1)', measurements: [], summary: 'HIV-1 protease is a symmetric homodimer.', highlights: [{ chain: 'A', resi: [25], label: 'Catalytic Asp25', category: 'active_site' }], quiz: single };
const insulin = { pdbId: '1TRZ', title: 'Human Insulin', measurements: [], summary: 'Two chains held together by disulfide bonds.', highlights: [{ chain: 'A', resi: [7], label: 'Cys A7', category: 'other' }], quiz: multi };
const SEED = `(() => {
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; } return Math.abs(h).toString(36) + str.length; };
  const cache = {};
  for (const s of ['', '|grounded']) {
    cache[hash('show me hiv protease with its drug' + '1TRZ' + s)] = { timestamp: Date.now(), data: ${JSON.stringify(hiv)} };
    for (const ctx of ['1TRZ', '1HSG']) cache[hash('show me the bridges between insulin chains' + ctx + s)] = { timestamp: Date.now(), data: ${JSON.stringify(insulin)} };
  }
  localStorage.setItem('argus_analysis_cache', JSON.stringify(cache)); return true;
})()`;

const port = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${OUT}/chrome-profile-quiz-${Date.now()}`, '--window-size=1440,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let page;
for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!page) await sleep(250); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r?.result?.value; };
const frames = async () => { for (let i = 0; i < 4; i++) { await ev(`new Promise((r) => requestAnimationFrame(() => r(true)))`); await sleep(80); } };
// A crop of the last quiz card, at 2x
const shot = async (name) => {
  await frames();
  const clip = await ev(`(() => { const q = [...document.querySelectorAll('[data-quiz]')].pop(); q.scrollIntoView({ block: 'center' }); const r = q.getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24, scale: 1 }; })()`);
  await frames();
  const { result } = await send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(`${OUT}/shots/${name}${THEME ? '-' + THEME : ''}.png`, Buffer.from(result.data, 'base64'));
};
const say = async (text) => {
  await ev(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await ev(`document.querySelector('[data-chat-send]').click()`);
};
const waitFor = async (expr, tries = 80) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await sleep(250); } return false; };
// The last quiz card's rows, in screen order
const rows = () => ev(`[...[...document.querySelectorAll('[data-quiz]')].pop().querySelectorAll('[data-quiz-option]')].map(b => ({ text: b.querySelector('span.flex-1').textContent, state: b.dataset.quizOption, role: b.getAttribute('role'), checked: b.getAttribute('aria-checked'), pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, round: b.querySelector('span[aria-hidden]').className.includes('rounded-full'), missed: b.textContent.includes('Missed') }))`);
const card = (sel) => `[...document.querySelectorAll('[data-quiz]')].pop()${sel}`;
const clickOption = (text) => ev(`[...${card('')}.querySelectorAll('[data-quiz-option]')].find(b => b.querySelector('span.flex-1').textContent === ${JSON.stringify(text)}).click()`);
const status = () => ev(`${card(`.querySelector('[role=status]')`)}?.innerText.replace(/\\n+/g, '\\n') ?? null`);

try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  if (THEME) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('argus-theme', '${THEME}'); } catch (e) {}` });
  await send('Page.navigate', { url: `${BASE}/app` });
  await waitFor(`!!document.querySelector('textarea') && document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ'`);
  await sleep(2500);
  await ev(SEED);

  console.log('\n[1] one right answer: shuffled, radio circles, instant result');
  await say('Show me HIV protease with its drug');
  check('answer with a quiz shown', await waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1HSG' && !!document.querySelector('[data-quiz]')`));
  await sleep(1500);
  let r = await rows();
  const expected = Q.quizOrder(single.question, 4).map(i => single.options[i]);
  check('options in the shuffled order', JSON.stringify(r.map(x => x.text)) === JSON.stringify(expected), r.map(x => x.text).join(' | '));
  const rightAt = r.findIndex(x => x.text === single.options[0]);
  check('the right answer is no longer first', rightAt !== 0, `shown at position ${rightAt + 1}`);
  check('no "Select all that apply" label', !(await ev(`!!${card(`.querySelector('[data-quiz-multi]')`)}`)));
  check('radio circles + aria-pressed, no Check button', r.every(x => x.round && x.pressed === 'false' && x.role === null) && !(await ev(`[...${card('')}.querySelectorAll('button')].some(b => b.textContent.trim() === 'Check')`)));
  await shot('quiz-single-open');
  await clickOption('Ile50 of each chain');
  await sleep(500);
  r = await rows();
  check('wrong pick -> marked wrong, right answer shown, rest dimmed', r.find(x => x.text === 'Ile50 of each chain').state === 'wrong' && r.find(x => x.text === single.options[0]).state === 'right' && r.filter(x => x.state === 'other').length === 2, r.map(x => x.state).join(','));
  check('all locked', r.every(x => x.disabled));
  check('"Not quite" + explanation', (await status())?.startsWith('Not quite\nEach monomer contributes Asp25'), JSON.stringify(await status()));
  await shot('quiz-single-wrong');

  console.log('\n[2] several right answers: checkboxes, Check button, partly right');
  await say('Show me the bridges between insulin chains');
  check('answer with a second quiz shown', await waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ' && document.querySelectorAll('[data-quiz]').length === 2`));
  await sleep(1500);
  check('"Select all that apply" label shown', await ev(`${card(`.querySelector('[data-quiz-multi]')`)}?.textContent === 'Select all that apply'`));
  const question = await ev(card(`.querySelector('h3').textContent`));
  check('question shown without its own "(Select all that apply)"', question === 'Which disulfide bonds link the A and B chains of insulin?', JSON.stringify(question));
  r = await rows();
  check('options in the shuffled order', JSON.stringify(r.map(x => x.text)) === JSON.stringify(Q.quizOrder(multi.question, 4).map(i => multi.options[i])), r.map(x => x.text).join(' | '));
  check('checkboxes: role=checkbox, aria-checked=false, square', r.every(x => x.role === 'checkbox' && x.checked === 'false' && !x.round));
  const checkButton = card(`.querySelector('button:not([data-quiz-option])')`);
  check('Check disabled until something is picked', await ev(`${checkButton}.disabled && ${checkButton}.textContent === 'Check'`));
  check('hint "Pick every right answer"', await ev(`${card('')}.innerText.includes('Pick every right answer')`));
  await shot('quiz-multi-open');
  await clickOption('CysA7–CysB7');
  await sleep(200);
  r = await rows();
  check('a pick is ticked, nothing marked yet', r.find(x => x.text === 'CysA7–CysB7').checked === 'true' && r.find(x => x.text === 'CysA7–CysB7').state === 'picked' && !(await status()));
  check('Check enabled, "1 picked"', await ev(`!${checkButton}.disabled && ${card('')}.innerText.includes('1 picked')`));
  await clickOption('CysA7–CysB7');
  await sleep(150);
  check('clicking again unticks it', (await rows()).find(x => x.text === 'CysA7–CysB7').checked === 'false' && await ev(`${checkButton}.disabled`));
  await clickOption('CysA7–CysB7');
  await clickOption('CysA6–CysA11');
  await sleep(200);
  await shot('quiz-multi-picked');
  await ev(`${checkButton}.click()`);
  await sleep(500);
  r = await rows();
  const state = (t) => r.find(x => x.text === t);
  check('right pick -> right', state('CysA7–CysB7').state === 'right');
  check('wrong pick -> wrong', state('CysA6–CysA11').state === 'wrong');
  check('right one not picked -> missed, labelled', state('CysA20–CysB19').state === 'missed' && state('CysA20–CysB19').missed);
  check('the rest -> dimmed', state('CysB7–CysB19').state === 'other');
  check('all locked, Check button gone', r.every(x => x.disabled) && !(await ev(`[...${card('')}.querySelectorAll('button')].some(b => b.textContent.trim() === 'Check')`)));
  const partly = await status();
  check('"Partly right · 1 of 2 found, 1 wrong"', partly?.startsWith('Partly right · 1 of 2 found, 1 wrong\nA7–B7'), JSON.stringify(partly));
  check('no "Showing it in 3D" when not fully right', !partly?.includes('Showing it in 3D'));
  await shot('quiz-multi-partly');

  console.log('\n[3] several right answers: all of them picked');
  await say('Show me the bridges between insulin chains');
  check('third quiz shown', await waitFor(`document.querySelectorAll('[data-quiz]').length === 3`));
  await sleep(1200);
  await clickOption('CysA20–CysB19');
  await clickOption('CysA7–CysB7');
  await sleep(150);
  check('"2 picked"', await ev(`${card('')}.innerText.includes('2 picked')`));
  await ev(`${checkButton}.click()`);
  await sleep(600);
  r = await rows();
  check('both right, nothing missed', r.filter(x => x.state === 'right').length === 2 && !r.some(x => x.state === 'missed' || x.state === 'wrong'), r.map(x => x.state).join(','));
  const correct = await status();
  check('"Correct" + "Showing it in 3D"', correct?.startsWith('Correct\n') && correct.includes('Showing it in 3D'), JSON.stringify(correct));
  await shot('quiz-multi-correct');

  console.log('\n[4] only right ones, but not all of them');
  await say('Show me the bridges between insulin chains');
  await waitFor(`document.querySelectorAll('[data-quiz]').length === 4`);
  await sleep(1200);
  await clickOption('CysA20–CysB19');
  await ev(`${checkButton}.click()`);
  await sleep(500);
  check('"Partly right · 1 of 2 found"', (await status())?.startsWith('Partly right · 1 of 2 found\n'), JSON.stringify(await status()));

  console.log('\n[5] only wrong ones');
  await say('Show me the bridges between insulin chains');
  await waitFor(`document.querySelectorAll('[data-quiz]').length === 5`);
  await sleep(1200);
  await clickOption('CysB7–CysB19');
  await ev(`${checkButton}.click()`);
  await sleep(500);
  check('"Not quite"', (await status())?.startsWith('Not quite\n'), JSON.stringify(await status()));
  const missed = (await rows()).filter(x => x.state === 'missed').length;
  check('both right ones shown as missed', missed === 2);
  check('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors));
} finally { ws.close(); chrome.kill(); }
console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
process.exit(failures ? 1 : 0);
