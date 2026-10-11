import { ProteinAnalysis } from "../types";
import { normalizeAnalysis } from "./normalizeAnalysis";
import { FIREWALL_MESSAGE, stoppedByFirewall } from "./http";

// --- CACHING (LocalStorage) ---
// Cache LLM responses client-side so repeat queries are instant and don't
// re-hit the serverless function / the AI credit.
const ANALYSIS_CACHE_KEY = 'argus_analysis_cache';
const MAX_CACHE_SIZE = 50;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  timestamp: number;
  data: T;
}

const getAnalysisFromCache = (key: string): ProteinAnalysis | null => {
  try {
    const cacheRaw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!cacheRaw) return null;

    const cache = JSON.parse(cacheRaw);
    const entry = cache[key] as CacheEntry<ProteinAnalysis>;
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL) {
      delete cache[key];
      localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cache));
      return null;
    }
    // Entries saved by older builds were never validated; a malformed one is treated as a miss
    return normalizeAnalysis(entry.data);
  } catch {
    return null;
  }
};

const saveAnalysisToCache = (key: string, data: ProteinAnalysis) => {
  try {
    const cacheRaw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    let cache = cacheRaw ? JSON.parse(cacheRaw) : {};

    cache[key] = { timestamp: Date.now(), data };

    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_SIZE) {
      const sortedKeys = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      const toRemove = sortedKeys.slice(0, keys.length - MAX_CACHE_SIZE);
      toRemove.forEach(k => delete cache[k]);
    }

    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("Failed to save to cache (likely quota exceeded)", e);
  }
};

const hashString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + str.length;
};

// --- API CALL ---
// All model logic lives in /api/analyze (Vercel Edge function: Nemotron on Nebius Token Factory).
// This client only knows how to talk to that endpoint — no API key in browser.

/**
 * Cache key for a question, or null when its answer shouldn't be cached. Answers made without
 * facts are cached separately, so they get redone once facts load; "Quiz me" always goes to the
 * model, since the same cached question for a day defeats the point.
 */
const cacheKeyFor = (query: string, currentContext?: ProteinAnalysis, structureFacts?: string | null) =>
  /\bquiz\b/i.test(query)
    ? null
    : hashString(query.toLowerCase() + (currentContext?.pdbId || '') + (structureFacts ? '|grounded' : ''));

/** Cache the answer finally shown for a question (after the structure check, see ReasoningEngine). */
export const rememberAnalysis = (
  query: string,
  currentContext: ProteinAnalysis | undefined,
  structureFacts: string | null | undefined,
  data: ProteinAnalysis
) => {
  const key = cacheKeyFor(query, currentContext, structureFacts);
  if (key) saveAnalysisToCache(key, data);
};

const MAX_RATE_LIMIT_WAIT_S = 20;

export const analyzeProteinQuery = async (
  query: string,
  currentContext?: ProteinAnalysis,
  structureFacts?: string | null, // UniProt/PDBe facts about the loaded structure (groundingService)
  options: {
    readCache?: boolean;
    writeCache?: boolean;
    onRateLimitWait?: (seconds: number) => void; // The AI is rate-limited: retrying once after this wait
    quiz?: boolean; // false: the app would leave a quiz out (services/quiz.ts), so the AI needn't write one
  } = {}
): Promise<ProteinAnalysis> => {
  const { readCache = true, writeCache = true, onRateLimitWait, quiz } = options;
  try {
    // 1. Cache check
    const cacheKey = cacheKeyFor(query, currentContext, structureFacts);
    const cachedData = readCache && cacheKey ? getAnalysisFromCache(cacheKey) : null;
    if (cachedData) {
      console.log("Analysis Cache Hit");
      return cachedData;
    }

    // 2. Call our serverless function (it only reads these context fields)
    const context = currentContext
      ? { pdbId: currentContext.pdbId, title: currentContext.title, highlights: currentContext.highlights }
      : undefined;
    const post = () => fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, currentContext: context, ...(structureFacts ? { structureFacts } : {}), ...(quiz === false ? { quiz: false } : {}) }),
    });
    let response = await post();

    // Rate limited: wait as long as the server suggests, within reason, and try once more
    if (response.status === 429 && !stoppedByFirewall(response)) {
      const suggested = Number(response.headers.get('retry-after'));
      const wait = Math.min(MAX_RATE_LIMIT_WAIT_S, Number.isFinite(suggested) && suggested > 0 ? Math.ceil(suggested) : 10);
      onRateLimitWait?.(wait);
      await new Promise(r => setTimeout(r, wait * 1000));
      response = await post();
    }

    if (stoppedByFirewall(response)) throw Object.assign(new Error(FIREWALL_MESSAGE), { status: response.status, firewall: true });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'unknown' }));
      throw Object.assign(new Error(`Analysis API error ${response.status}: ${err?.error || 'unknown'}`), {
        status: response.status,
      });
    }

    // 3. Validate (the function already does; this also covers an older deployment)
    const data = normalizeAnalysis(await response.json());
    if (!data) throw new Error('Analysis API returned an unusable answer');

    // 4. Save to cache
    if (writeCache && cacheKey) saveAnalysisToCache(cacheKey, data);

    return data;
  } catch (error) {
    console.error("Analyze Error:", error);
    throw error;
  }
};

/**
 * Audio generation is intentionally disabled in this build.
 *
 * While SPEECH_ENABLED is false the tour doesn't ask for narration at all and
 * runs on timed subtitles. With narration back, the caller
 * (ReasoningEngine.fetchAudioSafe) wraps this in a try/catch and a 6s timeout
 * race, so a failure still falls back to timed subtitles.
 */
export const SPEECH_ENABLED = false;

export const generateSpeech = async (
  _text: string,
  _existingContext?: AudioContext
): Promise<AudioBuffer> => {
  throw new Error("Audio generation is disabled in this build.");
};
