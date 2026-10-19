// Small fetch helpers shared by the services: the public-data ones (EBI, AlphaFold DB, UniProt) and
// those that call the site's own functions.

const REQUEST_TIMEOUT_MS = 25000;
// How long an answer that the data isn't there is believed. A server can say "not found" for a moment
// (a deployment, a mirror catching up), and the session shouldn't take that as final.
const ABSENT_MS = 2 * 60_000;

/** A result saying the data isn't there: a 404 read as null, or nothing found. */
const isAbsent = (value: unknown) =>
  value === null || value === undefined || value === ''
  || (Array.isArray(value) && value.length === 0)
  || (value instanceof Map && value.size === 0);

/**
 * Cache promises so concurrent callers share one request. A failed request is evicted at once, and an
 * answer that the data isn't there after a couple of minutes, so either is asked for again; only when
 * the cached promise is still this one (a newer request may have replaced it).
 */
export const memoize = <T,>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>, absentMs = ABSENT_MS): Promise<T> => {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = load();
  cache.set(key, pending);
  const evict = () => { if (cache.get(key) === pending) cache.delete(key); };
  pending.then(value => { if (isAbsent(value)) setTimeout(evict, absentMs); }, evict);
  return pending;
};

/**
 * A Map that keeps only its newest `max` entries: one set past that drops the least recently used
 * (reading an entry counts as using it). The services keep what they fetch in these, so a long session
 * doesn't hold every structure, confidence map and file it ever loaded (a phone tab gave out). onEvict
 * hears of each entry dropped that way, for stores kept alongside.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private readonly max: number;
  private readonly onEvict?: (key: K) => void;
  constructor(max: number, onEvict?: (key: K) => void) {
    super();
    this.max = max;
    this.onEvict = onEvict;
  }
  get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    super.delete(key);
    super.set(key, value);
    return value;
  }
  set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.max) {
      const oldest = this.keys().next().value as K;
      super.delete(oldest);
      this.onEvict?.(oldest);
    }
    return this;
  }
}

/**
 * Whether the hosting's firewall stopped a request to the site's own functions before it reached them.
 * Vercel's bot check answers with its challenge page instead (403 or 429, HTML) and marks it
 * x-vercel-mitigated. A browser passes the check when it loads a page, so a reload is the way on.
 */
export const stoppedByFirewall = (response: Response) =>
  response.headers.has('x-vercel-mitigated')
  || ((response.status === 403 || response.status === 429) && (response.headers.get('content-type') ?? '').includes('text/html'));
export const FIREWALL_MESSAGE = "The site's check for automated traffic stopped this request. Reload the page, then try again.";
export const FIREWALL_REASON = "the site's check for automated traffic stopped the request; reload the page, then try again";

/**
 * A signal that aborts after `ms`, or as soon as the caller's own signal does (a Stop): for one request
 * of work the caller may cancel. Browsers without AbortSignal.any get the same from a controller.
 */
export const timeoutSignal = (ms: number, signal?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  for (const source of [signal, timeout]) {
    if (source.aborted) controller.abort(source.reason);
    else source.addEventListener('abort', () => controller.abort(source.reason), { once: true });
  }
  return controller.signal;
};

/** The error a cancelled wait rejects with, as fetch does: name "AbortError". */
export const abortError = () => new DOMException('Stopped', 'AbortError');

/** Waits `ms`, or rejects with an AbortError at once when the signal aborts. */
export const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const stop = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  signal?.addEventListener('abort', stop, { once: true });
});

/**
 * Shared work, waited for until the signal aborts: the caller stops waiting (AbortError), and the work
 * itself goes on for the others who share it.
 */
export const untilAborted = <T,>(work: Promise<T>, signal: AbortSignal): Promise<T> => new Promise<T>((resolve, reject) => {
  if (signal.aborted) return reject(abortError());
  const stop = () => reject(abortError());
  signal.addEventListener('abort', stop, { once: true });
  work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
});

/** GET with a timeout. Returns null on 404 (resource genuinely absent). */
export const fetchOrNull = async (url: string): Promise<Response | null> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response;
};
