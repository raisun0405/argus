// --- ERROR REPORTS ---
// When the app's own code fails in a visitor's browser, a short report goes to /api/report, which
// writes it to the server log and, once set up, emails it (see api/report.ts), so a fault
// on the live site doesn't go unseen. Reported: errors and unhandled promise rejections whose code is
// this site's (not browser extensions or other sites' scripts), each once per page, at most five per
// page. A report holds the error's message, where in the app's code it happened, the page's path and
// the build, and nothing else from the page: no site address, query or #fragment (where a share link
// keeps its content).

declare const __BUILD_ID__: string; // vite.config.ts: the deployment's commit, or "local"

const ENDPOINT = '/api/report';
const MAX_PER_PAGE = 5;
// The visitor's connection or a request the app cancelled, not a fault in its code
const NOISE = /Failed to fetch|NetworkError|Load failed|network error|aborted|AbortError|ResizeObserver loop/i;

const sent = new Set<string>();
const ours = (url?: string | null) => Boolean(url && url.startsWith(location.origin + '/'));
// A code location without the site's address, or any query or #fragment after a path (the pages' inline
// scripts are located by the page's own address, share link and all)
const local = (text: string) => text.split(location.origin).join('').replace(/(\/[^\s()?#@]*)[?#][^\s()@]*?(?=:\d+:\d+|[\s()]|$)/g, '$1');

/** The first lines of a stack that are the app's own code, without the site's address. */
const ownFrames = (stack?: string) => (stack ?? '').split('\n').map(line => line.trim()).filter(line => line.includes(location.origin + '/')).slice(0, 8).map(local);

const report = (kind: 'error' | 'rejection', message: string, source: string | undefined, stack: string | undefined) => {
  if (!message || NOISE.test(message) || sent.size >= MAX_PER_PAGE) return;
  const frames = ownFrames(stack);
  if (!ours(source) && frames.length === 0) return;
  const key = `${message}|${frames[0] ?? source}`;
  if (sent.has(key)) return;
  sent.add(key);
  const body = JSON.stringify({
    kind,
    message: message.slice(0, 300),
    ...(ours(source) ? { source: local(source!) } : {}),
    stack: frames.join('\n').slice(0, 1500),
    page: location.pathname,
    build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'local',
  });
  try {
    // A beacon outlives the page; fetch with keepalive where beacons are unavailable
    if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never be what breaks the page
  }
};

/** Starts reporting the page's uncaught errors and unhandled promise rejections (once per page). */
export const startErrorReports = () => {
  if ((window as any).__errorReports) return;
  (window as any).__errorReports = true;
  window.addEventListener('error', event => {
    report('error', event.message || (event.error instanceof Error ? event.error.message : ''), event.filename, event.error instanceof Error ? event.error.stack : undefined);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason: unknown = event.reason;
    if (reason instanceof Error) report('rejection', reason.message || reason.name, undefined, reason.stack);
  });
};
