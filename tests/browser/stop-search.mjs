// Stopping a similar-structure search from the chat (D5). Foldseek is answered here with a ticket that never
// leaves the queue, as on a busy day: the loader offers Stop, Stop ends the search at once (the chat says so,
// the composer and the viewer's tools come back), and Foldseek is asked nothing more afterwards.
import { launch, sleep, BASE } from '../lib/browser.mjs';

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!ok) failures++; };

const requests = [];
const json = (body) => ({ responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
const b = await launch({
  width: 1440, height: 900, dpr: 1, intercept: ['*search.foldseek.com*'],
  onPaused: (p, send) => {
    const path = new URL(p.request.url).pathname;
    requests.push(`${p.request.method} ${path}`);
    // Submitted, then queued for good
    send('Fetch.fulfillRequest', { requestId: p.requestId, ...json(path.endsWith('/ticket') ? { id: 'T1', status: 'PENDING' } : { status: 'PENDING' }) });
  },
});
const findSimilar = `document.querySelector('button[aria-label="Find similar"]')`;
const stop = `document.querySelector('button[data-stop]')`;
const lastAssistant = `[...document.querySelectorAll('[data-message="assistant"]')].map(m => m.textContent).pop() ?? ''`;

try {
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.send('Page.navigate', { url: `${BASE}/app` });
  await b.waitFor(`!!document.querySelector('textarea')`, 30000);
  check('Find similar is ready on the default structure', (await b.waitFor(`!!(${findSimilar}) && !(${findSimilar}).disabled`, 30000)) >= 0);

  await b.click(findSimilar);
  check('the search starts: the loader offers Stop', (await b.waitFor(`!!(${stop}) && !!document.querySelector('[data-chat-loader]')`, 10000)) >= 0);
  check('...and says it waits in the queue', (await b.waitFor(`/Waiting in the Foldseek queue/.test(document.querySelector('[data-chat-loader]')?.textContent ?? '')`, 10000)) >= 0, await b.ev(`document.querySelector('[data-chat-loader]')?.textContent ?? ''`));
  check('Stop sits outside the live region (a screen reader hears the steps, not the button)', await b.ev(`!document.querySelector('[data-chat-loader] [data-stop]') && (${stop}).textContent.trim() === 'Stop'`));
  check('meanwhile the composer and the viewer\'s tools wait', await b.ev(`document.querySelector('textarea').disabled || (${findSimilar}).disabled`));
  await sleep(2500); // A poll or two
  const before = requests.filter(r => r.includes('/ticket/T1')).length;

  const t = Date.now();
  await b.click(stop);
  const stopped = await b.waitFor(`/Stopped the structure search\\./.test(${lastAssistant}) && !document.querySelector('[data-chat-loader]')`, 5000);
  const ms = Date.now() - t;
  check('Stop: the chat says so at once, and the loader goes', stopped >= 0 && ms < 1500, `${ms} ms: ${(await b.ev(lastAssistant)).slice(0, 80)}`);
  check('...not as an error', !(await b.ev(`[...document.querySelectorAll('[data-message="assistant"]')].pop()?.querySelector('[role="alert"]')`)));
  check('...the composer and Find similar are back', (await b.waitFor(`!document.querySelector('textarea').disabled && !(${findSimilar}).disabled`, 5000)) >= 0);
  const at = requests.length;
  await sleep(4500); // Two more polls' worth, had it kept going
  check('Foldseek was polled while queued...', before >= 1, requests.join(' | '));
  check('...and asked nothing after Stop: no more polls, no result download', requests.length === at && !requests.some(r => r.includes('/result/')), requests.slice(at).join(' | ') || `${at} requests`);

  check('no errors in the page', b.problems.filter(p => !/favicon|ResizeObserver|Failed to load resource/.test(p)).length === 0, b.problems.slice(0, 3).join(' | '));
} catch (e) {
  check(`ran without an error (${e.message})`, false);
} finally {
  b.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
