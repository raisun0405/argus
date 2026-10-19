// --- REQUEST BODIES ---
// The site's functions read a request's body only up to a size. A declared length over it is refused
// before anything is read, and a body sent without one stops being read once past it. Each function used
// to read the whole body first, however large, and only then check: in 128 MB of memory.

/** The request's body as text, or null when it is larger than `maxBytes` (read no further than that). */
export const readBody = async (req: Request, maxBytes: number): Promise<string | null> => {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

/** The request's body as JSON: 'too large' past `maxBytes`, 'invalid' when it doesn't parse. */
export const readJsonBody = async (req: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; error: 'too large' | 'invalid' }> => {
  const text = await readBody(req, maxBytes).catch(() => '');
  if (text === null) return { ok: false, error: 'too large' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'invalid' };
  }
};
