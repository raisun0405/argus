// Small fetch helpers shared by the public-data services (EBI, AlphaFold DB, UniProt).

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

/** GET with a timeout. Returns null on 404 (resource genuinely absent). */
export const fetchOrNull = async (url: string): Promise<Response | null> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response;
};
