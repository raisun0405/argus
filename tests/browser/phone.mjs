// The app on a phone (390x844, touch): one pane at a time behind a Chat | 3D switch in each header,
// tools named in a sheet, the inspector and open tools rising from the bottom over a canvas that
// keeps the space above, a sequence that scrolls on a swipe and picks on a tap, 16px text fields,
// finger-sized buttons, no sideways scroll, and the same on its side. Answers are canned.
import { launch, BASE, sleep, tabSel, viewerCanvas, OVERFLOW } from '../lib/browser.mjs';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? ' — ' + detail : ''}`); if (!ok) failures++; };
// Co-fold counts as set up, whatever keys the dev server holds
const b = await launch({
  intercept: ['*/api/cofold*'],
  onPaused: (p, send) => (p.request.method === 'GET' ? send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"available":true}').toString('base64') }) : send('Fetch.continueRequest', { requestId: p.requestId })),
});
const { ev, waitFor, shot, click, say } = b;
const visible = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(el => el.getBoundingClientRect().width > 0)`;
const activePane = `${visible('[role=tab][aria-selected=true]')}?.dataset.pane`;
const sheet = `document.querySelector('[data-phone-sheet]')`;
const box = (js) => ev(`(() => { const el = ${js}; if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
const toolsButton = `[...document.querySelectorAll('[data-sheet-toggle]')].find(b => /^Tools/.test(b.getAttribute('aria-label')))`;

try {
  await b.send('Page.navigate', { url: `${BASE}/app` });
  check('loads with the pane switch in the chat header', (await waitFor(`!!(${tabSel('chat')}) && !!(${tabSel('structure')})`, 40000)) >= 0);
  await sleep(4000);
  check('opens on the chat', (await ev(activePane)) === 'chat');
  check('no sideways page scroll', !(await ev(OVERFLOW)).scroll);
  const composer = await box(`document.querySelector('[data-chat-composer]')`);
  check('the chatbox is on screen, at the bottom', composer && composer.b <= 844 && composer.b > 760, JSON.stringify(composer));
  check('its text is 16px, so iOS does not zoom in on it', (await ev(`getComputedStyle(document.querySelector('textarea')).fontSize`)) === '16px');
  const headerButtons = await ev(`[...document.querySelectorAll('[data-chat-column] .z-30 button')].filter(b => b.getBoundingClientRect().width > 0 && !b.closest('[role=tablist]')).map(b => Math.round(b.getBoundingClientRect().height))`);
  check('the chat header\'s buttons are finger-sized', headerButtons.length >= 3 && headerButtons.every((h) => h >= 36), JSON.stringify(headerButtons));

  console.log('\n[a new structure]');
  await say('Show me hemoglobin');
  check('the phone shows the structure it opened', (await waitFor(`document.querySelector('[data-structure-id]')?.textContent === '4HHB' && ${activePane} === 'structure'`, 30000)) >= 0);
  await sleep(4000);
  const header = await ev(`(() => { const h = document.querySelector('[data-structure-id]').parentElement.parentElement; return { w: h.clientWidth, overflow: h.scrollWidth - h.clientWidth }; })()`);
  check('the structure header fits', header.w <= 390 && header.overflow <= 1, JSON.stringify(header));
  check('the tools are one labelled button', (await ev(`(${toolsButton})?.textContent.trim()`)) === 'Tools');
  check('the name is under the canvas', /Human deoxyhemoglobin/.test(await ev(`document.querySelector('[data-structure-id]').closest('.flex-col').lastElementChild.textContent`)));
  check('the canvas has the full width', (await box(viewerCanvas)).w >= 388);
  check('no keyboard hints on a touch screen', !(await ev(`[...document.querySelectorAll('kbd')].some(k => k.getBoundingClientRect().width > 0)`)));
  await shot('phone-structure');

  console.log('\n[the inspector]');
  const fullHeight = (await box(viewerCanvas)).h;
  await click(`document.querySelector('button[aria-label="Show the inspector"]')`);
  await sleep(900);
  const sh = await box(sheet);
  const canvas = await box(viewerCanvas);
  check('rises from the bottom, inside the screen', sh && sh.l === 0 && sh.r === 390 && sh.b <= 844 && sh.t > 300, JSON.stringify(sh));
  check('the canvas keeps the width and takes the space above', canvas.w >= 388 && canvas.h < fullHeight - 200 && canvas.b <= sh.t + 1, JSON.stringify({ canvas, fullHeight }));
  check('it holds Focus, Style and Layers', await ev(`['focus', 'style', 'layers'].every(id => !!${sheet}.querySelector('[data-section="' + id + '"]'))`));
  await click(`${sheet}.querySelector('button[aria-label="Expand"]')`);
  await sleep(600);
  check('expands to most of the height', (await box(sheet)).h > 600, JSON.stringify(await box(sheet)));
  await click(`${sheet}.querySelector('button[aria-label="Close"]')`);
  await sleep(600);
  check('and closes', !(await ev(`!!${sheet}`)));
  check('the canvas gets its height back', (await box(viewerCanvas)).h >= fullHeight - 2);

  console.log('\n[tools]');
  await click(toolsButton);
  await sleep(600);
  const tools = await ev(`[...document.querySelectorAll('[data-phone-tool]')].map(b => b.querySelector('.font-semibold')?.textContent + ' | ' + Math.round(b.getBoundingClientRect().height))`);
  check('each tool named and explained, finger-sized', tools.length >= 6 && tools.every((t) => +t.split(' | ')[1] >= 52), JSON.stringify(tools));
  await click(`document.querySelector('[data-phone-tool="pockets"]')`);
  check('Pockets opens its panel in the sheet', (await waitFor(`!!${sheet}?.querySelector('[data-section="pockets"]')`, 5000)) >= 0);
  check('...first in the sheet', await ev(`${sheet}.querySelector('[data-section]')?.dataset.section === 'pockets'`));
  check('the header button says what is open', /Pockets/.test(await ev(`(${toolsButton})?.getAttribute('aria-label')`)));
  check('pockets predicted', (await waitFor(`/Pocket 1/.test(${sheet}?.textContent ?? '')`, 60000)) >= 0);
  await shot('phone-pockets');
  await click(`${sheet}.querySelector('button[aria-label="Close Pocket Radar"]')`);
  await sleep(700);
  check('closing the tool puts the sheet away too', !(await ev(`!!${sheet}`)));
  check('...and the button is Tools again', (await ev(`(${toolsButton})?.textContent.trim()`)) === 'Tools');
  await click(toolsButton); await sleep(400);
  await click(`document.querySelector('[data-phone-tool="cofold"]')`);
  check('Co-fold opens its form in the sheet, with a way back', (await waitFor(`!!${sheet}?.querySelector('input[aria-label^="Molecule to co-fold"]') && !!${sheet}.querySelector('button[aria-label="Back"]')`, 4000)) >= 0);
  check('...without throwing the keyboard up', !(await ev(`document.activeElement?.matches?.('input, textarea')`)));
  await click(`${sheet}.querySelector('button[aria-label="Back"]')`); await sleep(400);
  check('Back returns to the list of tools', await ev(`!!document.querySelector('[data-phone-tool="pockets"]')`));
  await ev(`document.querySelector('[data-structure-id]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(400);
  check('a tap elsewhere puts the list away', !(await ev(`!!${sheet}`)));

  console.log('\n[the sequence]');
  const swipe = async (from, to) => {
    const strip = await box(`document.querySelector('[data-resi]').closest('.overflow-x-auto')`);
    const y = strip.t + 28;
    await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
    for (let i = 1; i <= 8; i++) await b.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * i) / 8, y }] });
    await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // A quick swipe sets the strip coasting for most of a second, and a tap while it moves only stops
    // it, as on any phone: wait until it has come to rest
    let last = -1;
    for (let k = 0; k < 20; k++) {
      await sleep(150);
      const now = await ev(`document.querySelector('[data-resi]').closest('.overflow-x-auto').scrollLeft`);
      if (now === last) break;
      last = now;
    }
  };
  const scrolledBefore = await ev(`document.querySelector('[data-resi]').closest('.overflow-x-auto').scrollLeft`);
  await swipe(360, 220);
  check('a swipe scrolls the strip', (await ev(`document.querySelector('[data-resi]').closest('.overflow-x-auto').scrollLeft`)) > scrolledBefore + 40);
  check('...and picks nothing', !(await ev(`/\\d+ selected/.test(document.body.textContent)`)));
  await b.tap(`[...document.querySelectorAll('[data-resi]')].find(c => { const r = c.getBoundingClientRect(); return r.left > 200 && r.right < 380; })`);
  await sleep(800);
  check('a tap picks', await ev(`/1 selected/.test(document.body.textContent)`));
  await click(tabSel('chat')); await sleep(600);
  check('chat tab: the conversation is still there', await ev(`/deoxyhemoglobin/i.test(document.querySelector('[data-chat-column]').textContent)`));
  await click(tabSel('structure')); await sleep(1000);
  check('back on the structure: the pick survived', await ev(`/1 selected/.test(document.body.textContent)`));
  check('...and the canvas is drawn at full width', (await box(viewerCanvas)).w >= 388);

  console.log('\n[the tour]');
  await click(tabSel('chat')); await sleep(400);
  await click(`[...document.querySelectorAll('button')].find(b => /Cinematic Tour/.test(b.title) && b.getBoundingClientRect().width > 0)`);
  check('a tour shows the structure', (await waitFor(`${activePane} === 'structure'`, 6000)) >= 0);
  check('...with Pause and Stop beside the narration', (await waitFor(`!!${visible('[aria-label="Pause the tour"]')} && !!${visible('[aria-label="Stop the tour"]')}`, 6000)) >= 0);
  await click(visible('[aria-label="Stop the tour"]')); await sleep(500);
  check('Stop ends it', !(await ev(`!!${visible('[aria-label="Stop the tour"]')}`)));

  console.log('\n[a follow-up about the same structure]');
  await click(tabSel('chat')); await sleep(400);
  await say('Where is the proximal histidine in hemoglobin');
  await sleep(2500);
  check('stays on the chat to be read', (await ev(activePane)) === 'chat');
  check('the 3D switch carries a dot', /updated/.test(await ev(`${visible('[data-pane="structure"]')}?.getAttribute('aria-label')`)));

  console.log('\n[on its side]');
  await b.setSize(844, 390);
  await sleep(1200);
  check('still one pane at a time', await ev(`!!${visible('[data-pane="structure"]')}`));
  check('no sideways scroll', !(await ev(OVERFLOW)).scroll);
  await click(tabSel('structure')); await sleep(1200);
  check('the canvas has the whole width', (await box(viewerCanvas)).w >= 840);
  await shot('phone-landscape');

  check('no console errors or exceptions', b.problems.length === 0, b.problems.join(' | ').slice(0, 400));
  check('no AI calls beyond the canned ones', b.calls.length === 2, JSON.stringify(b.calls));
} catch (e) {
  console.log('ERROR', e.stack);
  failures++;
} finally {
  b.close();
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
}
