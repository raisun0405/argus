// Keyboard, screen readers and contrast. Scripted answers, no AI calls.
//  1. phone: the bottom sheet takes focus when it opens, Escape closes it, and focus goes back
//  2. an answer is announced when it arrives
//  3. an explanation is a press on its term away, not a mouse-only tooltip
//  4. the focused chatbox's border stands out from what is around it (3:1)
import { BASE } from '../lib/env.mjs';
import { launch, sleep, tabSel } from '../lib/browser.mjs';
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

// A key pressed the way a keyboard does (an Enter needs its text, or a button won't activate)
const press = async (b, key) => {
  const keys = { Enter: { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, Escape: { code: 'Escape', windowsVirtualKeyCode: 27 } };
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...keys[key] });
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...keys[key], text: undefined });
  await sleep(400);
};

console.log('[1. phone: the bottom sheet]');
{
  const b = await launch(); // A phone
  const sheet = `document.querySelector('[data-phone-sheet]')`;
  const inspectorButton = `document.querySelector('button[aria-label="Show the inspector"]')`;
  try {
    await b.send('Page.navigate', { url: `${BASE}/app` });
    await b.waitFor(`!!(${tabSel('structure')})`, 40000);
    await sleep(3000);
    await b.click(tabSel('structure'));
    await b.waitFor(`!!${inspectorButton} && ${inspectorButton}.getBoundingClientRect().width > 0`, 15000);
    await b.ev(`${inspectorButton}.focus()`);
    await press(b, 'Enter');
    check('the sheet opens from the keyboard', (await b.waitFor(`!!${sheet}`, 5000)) >= 0);
    check('...and takes the focus', await b.ev(`!!${sheet} && ${sheet}.contains(document.activeElement)`), await b.ev(`document.activeElement?.outerHTML.slice(0, 80)`));
    check('...as a named dialog', await b.ev(`${sheet}.getAttribute('role') === 'dialog' && !!${sheet}.getAttribute('aria-label')`));
    await press(b, 'Escape');
    check('Escape closes it', (await b.waitFor(`!${sheet}`, 3000)) >= 0);
    check('...and the focus goes back to the button that opened it', await b.ev(`document.activeElement === ${inspectorButton}`), await b.ev(`document.activeElement?.outerHTML.slice(0, 80)`));
    check('no page errors', b.problems.length === 0, b.problems);
  } finally { b.close(); }
}

console.log('[2-4. desktop: announcements, explanations, the chatbox]');
{
  const b = await launch({ width: 1440, height: 900, dpr: 1 });
  try {
    // A headless page has no window focus, so focus() alone fires no focus events (and the chatbox
    // would never know it was focused); this gives it the focus a real window has
    await b.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Page.navigate', { url: `${BASE}/app` });
    await b.waitFor(`document.querySelector('[data-structure-id]')?.textContent.trim() === '1TRZ' && !!document.querySelector('textarea')`, 30000);
    await sleep(2500);

    // 2. An answer is read out when it arrives
    const announcer = `document.querySelector('[data-chat-announcer]')`;
    check('a polite live region waits for answers', await b.ev(`${announcer}?.getAttribute('aria-live') === 'polite'`));
    await b.say('show me hemoglobin');
    check('an answer is announced: its title, then its text', (await b.waitFor(`/^Answer: Human deoxyhemoglobin\\. Haemoglobin carries oxygen/.test(${announcer}?.textContent ?? '')`, 30000)) >= 0, await b.ev(`${announcer}?.textContent`));

    // 3. A label's meaning is a press away (here the inspector's "Shape")
    const shapeTerm = `[...document.querySelectorAll('aside[aria-label=Inspector] button[aria-expanded]')].find(x => x.textContent === 'Shape')`;
    check('the inspector\'s "Shape" is a button that explains it', await b.ev(`(${shapeTerm})?.getAttribute('aria-expanded') === 'false'`));
    await b.ev(`(${shapeTerm}).focus()`);
    await press(b, 'Enter');
    check('...Enter shows the explanation', (await b.ev(`(${shapeTerm}).getAttribute('aria-expanded')`)) === 'true' && /How the protein itself is drawn/.test(await b.ev(`document.getElementById((${shapeTerm}).getAttribute('aria-controls'))?.textContent ?? ''`)));
    await press(b, 'Enter');
    check('...and Enter again hides it', (await b.ev(`(${shapeTerm}).getAttribute('aria-expanded')`)) === 'false');
    check('no label of the inspector explains itself only in a title', !(await b.ev(`!!document.querySelector('aside[aria-label=Inspector] div[title]')`)));

    // 4. The focused chatbox's border against the page around it. The element that draws it (not the
    // first child: the glow under it comes first) eases to its new colour, and a headless page drawing a
    // structure is slow to give it frames, so it is measured once the easing has finished
    const box = `[...document.querySelectorAll('[data-chat-composer], [data-chat-composer] *')].find(el => { const s = getComputedStyle(el); return parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'; })`;
    await b.ev(`document.querySelector('[data-chat-composer] textarea').focus()`);
    await b.waitFor(`!!document.activeElement?.closest('[data-chat-composer]') && (${box}).getAnimations().length === 0`, 5000);
    const contrast = await b.ev(`(() => {
      const parse = c => (c.match(/[\\d.]+/g) ?? []).map(Number);
      const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const box = ${box};
      const border = box ? getComputedStyle(box).borderTopColor : '';
      const page = getComputedStyle(document.querySelector('[data-chat-column]')).backgroundColor;
      const [a, b2] = [L(parse(border)), L(parse(page))].sort((x, y) => y - x);
      return { ratio: Math.round(((a + 0.05) / (b2 + 0.05)) * 100) / 100, border, page, active: document.activeElement?.tagName + ' ' + (document.activeElement?.getAttribute('aria-label') ?? '') };
    })()`);
    check('the focused chatbox\'s border stands out (3:1)', contrast.ratio >= 3, contrast);
    check('no page errors', b.problems.length === 0, b.problems);
  } finally { b.close(); }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
