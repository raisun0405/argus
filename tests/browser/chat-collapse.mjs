// Folding the chat away on a desktop hides it and never unmounts it. Scripted answers, no AI calls.
//  1. a finished conversation survives folding and unfolding; folded, the chat takes no room
//  2. a tour started before folding can still be stopped after unfolding
//  3. an answer still on its way when the chat is folded arrives, and is there when it comes back
//  4. the chat isn't left "busy": the viewer's Find similar works again afterwards
//   node cdp-chat-collapse.mjs [base]
import { BASE } from '../lib/env.mjs';
import { launch, sleep, cannedAnswer } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

let delay = 0; // ms the scripted AI takes to reply
const answer = (query, context) => {
  const data = cannedAnswer(query, context);
  return delay ? new Promise(resolve => setTimeout(() => resolve(data), delay)) : data;
};

const answers = `document.querySelectorAll('[data-message="assistant"]').length`;
const lastAnswer = `([...document.querySelectorAll('[data-message="assistant"]')].at(-1)?.textContent ?? '')`;
const width = sel => `(document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect().width ?? 0)`;
const canvasWidth = width('canvas:not([data-chat-column] canvas)');
const similarDisabled = `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Find similar'))?.disabled`;
const stopTour = `[...document.querySelectorAll('button[aria-label="Stop the tour"]')].find(b => b.getBoundingClientRect().width > 0)`;

const b = await launch({ width: 1440, height: 900, dpr: 1, answer });
const fold = async () => {
  await b.ev(`document.activeElement?.blur()`); // B in the message box would type a "b"
  for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, ...(type === 'keyDown' ? { text: 'b' } : {}) });
  await sleep(500);
};
try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);

  console.log('[1. a finished conversation]');
  await b.say('show me hemoglobin');
  await b.waitFor(`${answers} >= 1`, 60000);
  await sleep(800);
  const before = { answers: await b.ev(answers), canvas: await b.ev(canvasWidth), chat: await b.ev(width('[data-chat-column]')) };
  await fold();
  // The viewer resizes on its own frame: on a live site still drawing the structure that can take longer than the fold's wait
  await b.waitFor(`${canvasWidth} > ${before.canvas + 200}`, 5000);
  const folded = { chat: await b.ev(width('[data-chat-column]')), composer: await b.ev(width('textarea')), canvas: await b.ev(canvasWidth), inPage: await b.ev(`!!document.querySelector('[data-chat-column]')`) };
  check('folded, the chat takes no room but is still in the page', folded.chat === 0 && folded.composer === 0 && folded.inPage, folded);
  check('...and the 3D view gets its width', folded.canvas > before.canvas + 200, { before: before.canvas, after: folded.canvas });
  await fold();
  check('unfolded, the conversation is still there', (await b.ev(answers)) === before.answers && (await b.ev(lastAnswer)).includes('Human deoxyhemoglobin'), `${await b.ev(answers)} answer(s), had ${before.answers}`);
  check('...at its old width', Math.abs((await b.ev(width('[data-chat-column]'))) - before.chat) <= 1, { before: before.chat, after: await b.ev(width('[data-chat-column]')) });

  console.log('\n[2. a tour started before folding]');
  await b.say('play the tour');
  check('the tour plays', (await b.waitFor(`!!${stopTour}`, 10000)) >= 0);
  await fold();
  await fold();
  check('after folding and unfolding, the chat still offers Stop', !!(await b.ev(`!!${stopTour}`)));
  await b.ev(`${stopTour}?.click()`); // Missing on a broken build: the check above has already said so
  check('...and Stop stops it', (await b.waitFor(`!${stopTour}`, 5000)) >= 0);
  // Stopped on its first step, the whole structure, the camera flies back to the answer's parts: some
  // fifty frames, queued faster than this headless page draws them in software. The next resize (the
  // fold below) waited for all of them, 11-12 s. The flight starts on the viewer's next render; once
  // it has, reading the picture back waits for its last frame
  await sleep(500);
  await b.waitFor(`!window.__testViewer?.isAnimated?.()`, 20000);
  await b.ev(`(window.__testViewer?.pngURI?.(), true)`);

  console.log('\n[3. an answer still on its way]');
  delay = 3000;
  const had = await b.ev(answers);
  await b.say('show me trypsin');
  await sleep(600);
  check('the answer is on its way, and the viewer\'s Find similar waits for it', (await b.ev(answers)) === had && (await b.ev(similarDisabled)) === true, { answers: await b.ev(answers), similarDisabled: await b.ev(similarDisabled) });
  await fold();
  await sleep(delay + 1500); // It arrives while the chat is folded

  console.log('\n[4. the chat is not left busy]');
  // Still folded: the answer has arrived, so the chat's tools must be free again without unfolding it
  check('folded, once the answer is in, the viewer\'s Find similar works again', (await b.waitFor(`${similarDisabled} === false`, 5000)) >= 0, await b.ev(similarDisabled));

  await fold();
  check('unfolded, the answer that arrived meanwhile is there', (await b.ev(answers)) === had + 1 && (await b.ev(lastAnswer)).includes('Trypsin'), `${await b.ev(answers)} answer(s); last: ${(await b.ev(lastAnswer)).slice(0, 60)}`);
  check('...and the structure it named is on screen', (await b.waitFor(`(document.querySelector('[data-structure-id]')?.textContent ?? '').includes('3PTB')`, 15000)) >= 0, await b.ev(`document.querySelector('[data-structure-id]')?.textContent`));

  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} finally {
  b.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
