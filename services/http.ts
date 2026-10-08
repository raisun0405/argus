// Small fetch helpers shared by the public-data services (EBI, AlphaFold DB, UniProt).

const REQUEST_TIMEOUT_MS = 25000;

/** Cache promises so concurrent callers share one request; failed requests are evicted. */
export const memoize = <T,>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> => {
  let pending = cache.get(key);
  if (!pending) {
    pending = load();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
};

/** GET with a timeout. Returns null on 404 (resource genuinely absent). */
export const fetchOrNull = async (url: string): Promise<Response | null> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response;
};
