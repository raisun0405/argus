// An answer's tour. Scripted answers, no AI calls.
//  1. a question that asks for a tour ("explain it like a journey") plays its answer's tour at once, the
//     quiz waiting until the tour is over; Pause and Stop work from the answer
//  2. an answer to any other question keeps its tour ready to play from the answer, its quiz shown
//  3. a tour of named parts goes to the AI (whose tour keeps to them), never to the plain command
//  4. the plain "tour" still plays the tour on screen without asking the AI
//  5. while a tour plays, "pause", "next", "go back", "resume", "stop" steer it without the AI, and the
//     answer's Back and Next buttons move between steps
//  6. after a tour, "again", "go back to step 2" and (after another answer) "repeat the tour" replay it
//     without the AI; "step 5" of a two-step tour says there is none
//  7. "give more tour of same" asks the AI for new steps, told the tour so far, and the tour carries on
//     at the first new one; "more" during a tour asks once it ends
//  8. "give me a full tour" asks for the whole structure's tour (five steps, a short one ~7 s), which
//     "full tour" then replays; right after its quiz, "again" asks for the next question
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
// The app's request for a tour of the whole structure gets five steps, whole first and last
const WHOLE = [
  { text: 'Insulin as a whole: chains A and B side by side.', focus: [] },
  { text: 'The A7 to B7 disulfide ties the two chains together.', focus: [H('A', [7], 'Cys A7'), H('B', [7], 'Cys B7')] },
  { text: 'The A20 to B19 disulfide is the second tie between them.', focus: [H('A', [20], 'Cys A20'), H('B', [19], 'Cys B19')] },
  { text: 'Inside chain A, cysteine A6 bonds to A11.', focus: [H('A', [6, 11], 'Cys A6 / A11')] },
  { text: 'Back to the whole: three disulfides hold its shape.', focus: [] },
];
// ...and "more" two new steps after the tour so far
// (long enough to stay up a while: a check of a step on screen mustn't race it)
const MORE = (n) => [
  { text: `New step ${n + 1}: the central helix of chain B, which runs from residue nine to residue nineteen and carries the zinc-binding histidine on its surface.`, focus: [H('B', [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'B-chain helix')] },
  { text: `New step ${n + 2}: histidine B10, where zinc binds, so that six insulin molecules gather around two zinc ions in the hexamer that the pancreas stores.`, focus: [H('B', [10], 'His B10')] },
];
const bodies = []; // What the app sent the AI
const answer = (query, context, body) => {
  bodies.push(body);
  const base = { pdbId: context?.pdbId ?? '1TRZ', title: 'Human insulin', summary: 'Insulin is a small hormone made of two chains.', highlights: [H('A', [6, 11], 'Intrachain disulfide')], measurements: [] };
  if (body?.tourSoFar?.length) return { ...base, tour: MORE(body.tourSoFar.length) };
  if (/full tour of this whole structure/i.test(query)) return { ...base, tour: WHOLE, quiz: QUIZ };
  if (/what is insulin made of|take me through it/i.test(query)) return { ...base, ...(/take me/i.test(query) ? { tour: STEPS } : {}) }; // No quiz
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

  // Paused straight away: two steps are soon over (a screenshot taken first could outlast them)
  await b.click(rowButton(j, 'Pause'));
  await sleep(300);
  const pausedAt = await b.ev(rowText(j));
  check('Pause in the answer pauses it', (await b.ev(tourState(j))) === 'paused' && /Paused · Step/.test(pausedAt) && !!(await b.ev(`!!${headerButton('Resume the tour')}`)), pausedAt);
  await b.shot('tour-journey-paused');
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
  // Its quiz is asked for: one nobody asked for would be held back this soon after the journey's
  check('answered', await ask('quiz me on how the chains are held together', 'plain'));
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
  await sleep(300);

  console.log('[5. steering a playing tour: words in the chat, Back and Next in the answer]');
  const receipts = `document.querySelectorAll('[data-action-receipt]').length`;
  const lastReceipt = `([...document.querySelectorAll('[data-action-receipt] li')].at(-1)?.dataset.actionState ?? '') + ':' + ([...document.querySelectorAll('[data-action-receipt] li')].at(-1)?.textContent ?? '')`;
  const steer = async (text) => { const before = await b.ev(receipts); await b.say(text); await b.waitFor(`${receipts} > ${before}`, 8000); await sleep(400); return b.ev(lastReceipt); };
  const stepButton = (label) => `[...((${j})?.querySelectorAll('button[aria-label="${label}"]') ?? [])][0]`;
  await b.click(rowButton(j, 'Play the tour'));
  await b.waitFor(`${tourState(j)} === 'playing' && /Step 1 of 2/.test(${rowText(j)})`, 8000);
  const steerCalls = b.calls.length;
  let r = await steer('pause');
  check('"pause" pauses it', (await b.ev(tourState(j))) === 'paused' && r === 'done:Tour paused', `${r} / ${await b.ev(tourState(j))}`);
  r = await steer('next');
  check('"next" moves to step 2, still paused', (await b.waitFor(`/Paused · Step 2 of 2/.test(${rowText(j)})`, 3000)) >= 0 && r === 'done:Step 2 of 2', `${r} / ${await b.ev(rowText(j))}`);
  r = await steer('go back');
  check('"go back" returns to step 1', (await b.waitFor(`/Paused · Step 1 of 2/.test(${rowText(j)})`, 3000)) >= 0 && r === 'done:Step 1 of 2', `${r} / ${await b.ev(rowText(j))}`);
  r = await steer('resume');
  check('"resume" plays on', (await b.ev(tourState(j))) === 'playing' && r === 'done:Tour resumed', `${r} / ${await b.ev(tourState(j))}`);
  await steer('wait'); // Paused again, so the steps stay put while the buttons are tried
  check('Previous step is off on the first step', await b.ev(`${stepButton('Previous step')}?.disabled === true`));
  await b.click(stepButton('Next step'));
  check('Next step in the answer moves to step 2', (await b.waitFor(`/Step 2 of 2/.test(${rowText(j)})`, 3000)) >= 0, await b.ev(rowText(j)));
  check('...where it is the end of the tour', !!(await b.ev(`!!${stepButton('End the tour')}`)));
  await b.click(stepButton('Previous step'));
  check('Previous step goes back to step 1', (await b.waitFor(`/Step 1 of 2/.test(${rowText(j)})`, 3000)) >= 0, await b.ev(rowText(j)));
  r = await steer('stop');
  check('"stop" stops it', (await b.ev(tourState(j))) === 'ready' && r === 'done:Tour stopped' && !(await b.ev(`!!${headerButton('Stop the tour')}`)), `${r} / ${await b.ev(tourState(j))}`);
  check('none of these went to the AI', b.calls.length === steerCalls, b.calls.slice(steerCalls));
  await b.say('next'); // No tour playing: a question as usual
  for (let i = 0; i < 40 && b.calls.length === steerCalls; i++) await sleep(250);
  check('with no tour playing, "next" is a question for the AI', b.calls.length === steerCalls + 1, b.calls.slice(steerCalls));
  await b.waitFor(`${tourState(last)} === 'ready'`, 30000); // Its answer, in before going on

  // Answers with a tour, counted and tagged as they come (a reply that only reports isn't one)
  const tours = `document.querySelectorAll('[data-message="assistant"] [data-answer-tour]').length`;
  const lastWithTour = `[...document.querySelectorAll('[data-message="assistant"]')].filter(m => m.querySelector('[data-answer-tour]')).at(-1)`;
  const newTour = async (before, tag) => {
    const ok = (await b.waitFor(`${tours} > ${before}`, 30000)) >= 0;
    if (ok) await b.ev(`(${lastWithTour}).dataset.t = ${JSON.stringify(tag)}`);
    return ok;
  };
  const callsReach = async (n) => { for (let i = 0; i < 80 && b.calls.length < n; i++) await sleep(250); return b.calls.length >= n; };
  // Ends a tour if it still plays, with the header's Stop: one replayed from its last step can be over
  // by now (a headless page stalls), and a typed "stop" would then be a question for the AI
  const endTour = async () => { await b.click(headerButton('Stop the tour')); await sleep(300); };
  // A reply that asks the AI is soon followed by the answer's own receipts: looked for anywhere, not last
  const said = (text) => b.ev(`[...document.querySelectorAll('[data-action-receipt] li')].some(li => li.dataset.actionState + ':' + li.textContent === ${JSON.stringify(text)})`);

  console.log('[6. after a tour: "again", a step, and the tour after another answer]');
  check('answered', await ask('take me through it', 'take'));
  const t = tagged('take');
  check('its tour plays by itself', (await b.waitFor(`${tourState(t)} === 'playing'`, 15000)) >= 0, await b.ev(tourState(t)));
  await endTour();
  const replayCalls = b.calls.length;
  r = await steer('again');
  check('"again" right after it plays the same tour, from step 1', r === 'done:Tour started' && (await b.waitFor(`${tourState(t)} === 'playing' && /Step 1 of 2/.test(${rowText(t)})`, 5000)) >= 0, `${r} / ${await b.ev(rowText(t))}`);
  await endTour();
  r = await steer('go back to step 2');
  check('"go back to step 2" plays it from step 2', r === 'done:Tour from step 2' && (await b.waitFor(`${tourState(t)} === 'playing' && /Step 2 of 2/.test(${rowText(t)})`, 5000)) >= 0, `${r} / ${await b.ev(rowText(t))}`);
  await endTour();
  r = await steer('step 5');
  check('"step 5" of a two-step tour says there is none', r === "failed:Couldn't go to step 5: this tour has 2 steps", r);
  check('none of these went to the AI', b.calls.length === replayCalls, b.calls.slice(replayCalls));
  check('answered', await ask('what is insulin made of?', 'notour')); // An answer without a tour
  const afterCalls = b.calls.length;
  r = await steer('repeat the tour');
  check('after another answer, "repeat the tour" still plays that tour, with no AI call', r === 'done:Tour started' && (await b.waitFor(`${tourState(t)} === 'playing' && /Step 1 of 2/.test(${rowText(t)})`, 5000)) >= 0 && b.calls.length === afterCalls, `${r} / ${await b.ev(rowText(t))}`);
  await endTour();

  console.log('[7. "more": new steps after the ones seen, as one longer tour]');
  const moreCalls = b.calls.length;
  let toursBefore = await b.ev(tours);
  await steer('give more tour of same');
  check('"give more tour of same" asks the AI for more steps', await said('done:Asking the AI for more steps'));
  check('...telling it the tour so far', (await callsReach(moreCalls + 1)) && bodies.at(-1)?.tourSoFar?.length === 2 && bodies.at(-1).tourSoFar[1].text === STEPS[1].text, JSON.stringify(bodies.at(-1)?.tourSoFar));
  check('...answered', await newTour(toursBefore, 'more'));
  const m = tagged('more');
  check('...and the tour carries on at its first new step: 3 of 4', (await b.waitFor(`${tourState(m)} === 'playing' && /Step 3 of 4/.test(${rowText(m)})`, 15000)) >= 0, await b.ev(rowText(m)));
  check('...as its answer says', (await b.ev(receipt(m))).includes('done:Tour from step 3'), JSON.stringify(await b.ev(receipt(m))));
  await steer('pause'); // Held there, so what follows can't race its steps
  r = await steer('more');
  check('"more" while it plays waits for its end', r === 'done:More steps follow at the end of this tour', r);
  toursBefore = await b.ev(tours);
  const queued = b.calls.length;
  await steer('next');
  await steer('next'); // Past its last step: the end
  check('...then asks for steps after all four', (await callsReach(queued + 1)) && bodies.at(-1)?.tourSoFar?.length === 4, JSON.stringify(bodies.at(-1)?.tourSoFar?.map(s => s.text)));
  // Where it started, from its answer's receipt: the steps on screen may have moved on by the time they're read
  check('...which carry on from step 5 of 6', (await newTour(toursBefore, 'more2')) && (await b.waitFor(`${receipt(tagged('more2'))}.includes('done:Tour from step 5') && /of 6|6 steps/.test(${rowText(tagged('more2'))})`, 15000)) >= 0, { receipt: await b.ev(receipt(tagged('more2'))), row: await b.ev(rowText(tagged('more2'))) });
  await endTour();
  r = await steer('repeat the tour');
  check('"repeat the tour" then plays all six from the start', r === 'done:Tour started' && (await b.waitFor(`${tourState(tagged('more2'))} === 'playing' && /Step 1 of 6/.test(${rowText(tagged('more2'))})`, 5000)) >= 0, `${r} / ${await b.ev(rowText(tagged('more2')))}`);
  await endTour();

  console.log('[8. a full tour]');
  const wholeCalls = b.calls.length;
  toursBefore = await b.ev(tours);
  // When each step of the five comes up, timed in the page (from here, the time a step is first seen
  // can be late by however long the page takes to answer)
  await b.ev(`(() => {
    window.__stepAt = {};
    const timer = setInterval(() => {
      for (const row of document.querySelectorAll('[data-answer-tour]')) {
        const step = /Step (\\d+) of 5/.exec(row.textContent)?.[1];
        if (step && !(step in window.__stepAt)) window.__stepAt[step] = performance.now();
      }
    }, 50);
    setTimeout(() => clearInterval(timer), 90000);
    return true;
  })()`);
  await steer('give me a full tour');
  check('"give me a full tour" asks the AI for a tour of the whole structure', (await said('done:Asking the AI for a full tour')) && (await callsReach(wholeCalls + 1)) && b.calls.at(-1) === 'Give me a full tour of this whole structure, in 5 to 7 steps.', b.calls.at(-1));
  check('...answered', await newTour(toursBefore, 'whole'));
  const w = tagged('whole');
  check('...and its five steps play', (await b.waitFor(`${tourState(w)} === 'playing' && /Step 1 of 5/.test(${rowText(w)})`, 15000)) >= 0, await b.ev(rowText(w)));
  // A short step stays up for the camera's second, 5 s to read it, and a second's pause: 7 s (it was
  // 3.6 s). Only the least is checked: drawn in software, this headless page can stall the next step
  await b.waitFor(`/Step 2 of 5/.test(${rowText(w)})`, 20000);
  const stepMs = Math.round(await b.ev(`window.__stepAt[2] - window.__stepAt[1]`));
  check('a short step stays up 7 s (it was 3.6 s)', stepMs >= 6500, `${stepMs} ms`);
  r = await steer('play the tour again');
  check('"play the tour again" during it starts it over', r === 'done:Tour from the start · Step 1 of 5' && (await b.waitFor(`/Step 1 of 5/.test(${rowText(w)})`, 3000)) >= 0, `${r} / ${await b.ev(rowText(w))}`);
  await endTour();
  r = await steer('full tour');
  check('"full tour" again plays it, with no new AI call', r === 'done:Tour started' && (await b.waitFor(`${tourState(w)} === 'playing'`, 5000)) >= 0 && b.calls.length === wholeCalls + 1, `${r} / ${b.calls.length - wholeCalls} calls`);
  await endTour();
  // Its answer came with a quiz, shown once the tour ended: a bare "again" now asks for the next question
  const quizCalls = b.calls.length;
  await b.say('again');
  check('right after a quiz, "again" is a request for its next question', (await callsReach(quizCalls + 1)) && bodies.at(-1)?.quiz === true && b.calls.at(-1) === 'again', JSON.stringify({ quiz: bodies.at(-1)?.quiz, query: b.calls.at(-1) }));
  await b.waitFor(`document.querySelectorAll('[data-quiz]').length > 0`, 30000);

  check('no page errors', b.problems.length === 0, b.problems);
} finally { b.close(); }
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
