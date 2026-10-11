// An answer's tour. Scripted answers, no AI calls.
//  1. a question that asks for a tour ("explain it like a journey") plays its answer's tour at once, the
//     quiz waiting until the tour is over; Pause and Stop work from the answer
//  2. an answer to any other question keeps its tour ready to play from the answer, its quiz shown
//  3. a tour of named parts goes to the AI (whose tour keeps to them), never to the plain command
//  4. the plain "tour" still plays the tour on screen without asking the AI
import { BASE } from '../lib/env.mjs';
import { launch, sleep } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const H = (chain, resi, label, category = 'other') => ({ chain, resi, label, category });
const QUIZ = {
  question: "Which bonds join insulin's A and B chains?", options: ['Disulfide bonds', 'Salt bridges', 'Zinc coordination', 'Backbone hydrogen bonds only'],
  correctAnswerIndex: 0, explanation: 'A7–B7 and A20–B19 are disulfide bonds.', answerHighlights: [H('A', [7], 'Cys A7')],
};
const STEPS = [
  { text: 'Insulin is two short chains, A and B, seen whole here for a moment.', focus: [] },
  { text: 'Here the A7 to B7 disulfide ties the two chains together.', focus: [H('A', [7], 'Cys A7'), H('B', [7], 'Cys B7')] },
];
const answer = (query, context) => {
  const base = { pdbId: context?.pdbId ?? '1TRZ', title: 'Human insulin', summary: 'Insulin is a small hormone made of two chains.', highlights: [H('A', [6, 11], 'Intrachain disulfide')], measurements: [] };
  // A tour of named parts: only those parts
  if (/disulfides only|chain a/i.test(query)) return { ...base, tour: [{ text: 'The A7 to B7 disulfide.', focus: [H('A', [7], 'Cys A7')] }, { text: 'The A20 to B19 disulfide.', focus: [H('A', [20], 'Cys A20')] }] };
  return { ...base, tour: STEPS, quiz: QUIZ };
};

const assistants = `document.querySelectorAll('[data-message="assistant"]').length`;
const last = `[...document.querySelectorAll('[data-message="assistant"]')].at(-1)`;
const tagged = (tag) => `document.querySelector('[data-t="${tag}"]')`;
// In brackets: "x ?? null === 'playing'" would read as "x ?? (null === 'playing')"
const tourState = (m) => `((${m})?.querySelector('[data-answer-tour]')?.dataset.answerTour ?? null)`;
const rowText = (m) => `((${m})?.querySelector('[data-answer-tour]')?.textContent ?? '')`;
const rowButton = (m, text) => `[...((${m})?.querySelectorAll('[data-answer-tour] button') ?? [])].find(b => b.textContent.trim() === ${JSON.stringify(text)})`;
const quizShown = (m) => `(() => { const q = (${m})?.querySelector('[data-quiz]'); return !!q && q.getClientRects().length > 0; })()`;
const quizWaits = (m) => `!!(${m})?.querySelector('[data-quiz-waits]')`;
const headerButton = (label) => `[...document.querySelectorAll('button[aria-label="${label}"]')].find(b => b.getBoundingClientRect().width > 0)`;
const receipt = (m) => `[...((${m})?.querySelectorAll('[data-action-receipt] li') ?? [])].map(li => li.dataset.actionState + ':' + li.textContent)`;

const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
// Ask, wait for the answer, and tag it so it can be found again
const ask = async (text, tag) => {
  const before = await b.ev(assistants);
  await b.say(text);
  const ms = await b.waitFor(`${assistants} > ${before}`, 30000);
  if (ms >= 0) await b.ev(`(${last}).dataset.t = ${JSON.stringify(tag)}`);
  return ms >= 0;
};
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ' && !!document.querySelector('textarea')`, 30000);
  await sleep(2500);

  console.log('[1. "explain me this protein like a journey"]');
  check('answered', await ask('explain me this protein like a journey', 'journey'));
  const j = tagged('journey');
  check('its tour plays by itself', (await b.waitFor(`${tourState(j)} === 'playing'`, 15000)) >= 0, await b.ev(tourState(j)));
  check('...the header can stop it too', !!(await b.ev(`!!${headerButton('Stop the tour')}`)));
  check('...the answer says the tour started', (await b.waitFor(`${receipt(j)}.includes('done:Tour started')`, 5000)) >= 0, await b.ev(receipt(j)));
  check('...and shows the step', (await b.waitFor(`/Step [12] of 2/.test(${rowText(j)})`, 8000)) >= 0, await b.ev(rowText(j)));
  check('the quiz waits for the tour', !(await b.ev(quizShown(j))) && (await b.ev(quizWaits(j))), { shown: await b.ev(quizShown(j)), waits: await b.ev(quizWaits(j)) });
  await b.shot('tour-journey-playing');

  await b.click(rowButton(j, 'Pause'));
  await sleep(300);
  const pausedAt = await b.ev(rowText(j));
  check('Pause in the answer pauses it', (await b.ev(tourState(j))) === 'paused' && /Paused · Step/.test(pausedAt) && !!(await b.ev(`!!${headerButton('Resume the tour')}`)), pausedAt);
  await sleep(4500); // longer than a step
  check('...and it stays on its step', (await b.ev(rowText(j))) === pausedAt && (await b.ev(tourState(j))) === 'paused', await b.ev(rowText(j)));
  await b.click(rowButton(j, 'Resume'));
  await sleep(300);
  check('Resume carries on', (await b.ev(tourState(j))) === 'playing');

  check('the tour ends by itself', (await b.waitFor(`${tourState(j)} === 'ready'`, 20000)) >= 0, await b.ev(tourState(j)));
  check('...then the quiz is shown', (await b.ev(quizShown(j))) && !(await b.ev(quizWaits(j))));
  check('...and the header has no tour controls left', !(await b.ev(`!!${headerButton('Stop the tour')}`)));
  check('the answer offers it again, with its length', /Play the tour\s*2 steps/.test(await b.ev(rowText(j))), await b.ev(rowText(j)));

  await b.click(rowButton(j, 'Play the tour'));
  check('played again from the answer', (await b.waitFor(`${tourState(j)} === 'playing'`, 5000)) >= 0);
  check('...the quiz stays shown this time', await b.ev(quizShown(j)));
  await b.click(rowButton(j, 'Stop'));
  await sleep(300);
  check('Stop in the answer stops it', (await b.ev(tourState(j))) === 'ready' && !(await b.ev(`!!${headerButton('Stop the tour')}`)));

  console.log('[2. a question that asks for no tour]');
  const calls = b.calls.length;
  check('answered', await ask('explain how the chains are held together', 'plain'));
  const p = tagged('plain');
  await sleep(1500);
  check('its tour waits to be played', (await b.ev(tourState(p))) === 'ready' && !(await b.ev(`!!${headerButton('Stop the tour')}`)), await b.ev(tourState(p)));
  check('...its quiz is shown at once', (await b.ev(quizShown(p))) && !(await b.ev(quizWaits(p))));
  check('...it went to the AI', b.calls.length === calls + 1, b.calls.slice(calls));
  await b.shot('tour-ready');
  await b.click(rowButton(p, 'Play the tour'));
  check('Play the tour in the answer plays it', (await b.waitFor(`${tourState(p)} === 'playing'`, 5000)) >= 0);
  check('...its quiz stays shown', await b.ev(quizShown(p)));
  await b.click(rowButton(j, 'Play the tour'));
  check("an earlier answer's tour takes over", (await b.waitFor(`${tourState(j)} === 'playing' && ${tourState(p)} === 'ready'`, 5000)) >= 0, { journey: await b.ev(tourState(j)), plain: await b.ev(tourState(p)) });
  await b.click(rowButton(j, 'Stop'));
  await sleep(300);

  console.log('[3. a tour of named parts]');
  for (const [text, tag] of [['give me a tour of the disulfides only', 'scoped'], ['play the tour of chain A', 'chain']]) {
    const before = b.calls.length;
    check(`"${text}": answered`, await ask(text, tag));
    check('...by the AI, with the question as asked', b.calls.length === before + 1 && b.calls.at(-1) === text, b.calls.slice(before));
    const s = tagged(tag);
    check('...and its own tour plays', (await b.waitFor(`${tourState(s)} === 'playing'`, 15000)) >= 0 && /of 2|Starting/.test(await b.ev(rowText(s))), await b.ev(rowText(s)));
    await b.click(rowButton(s, 'Stop'));
    await sleep(300);
  }

  console.log('[4. the plain "tour"]');
  const plainCalls = b.calls.length;
  await b.say('tour');
  check('plays the tour on screen', (await b.waitFor(`!!${headerButton('Stop the tour')}`, 8000)) >= 0);
  check("...the latest answer's", (await b.ev(tourState(tagged('chain')))) === 'playing', await b.ev(tourState(tagged('chain'))));
  check('...without asking the AI', b.calls.length === plainCalls, b.calls.slice(plainCalls));
  await b.click(headerButton('Stop the tour'));

  check('no page errors', b.problems.length === 0, b.problems);
} finally { b.close(); }
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
