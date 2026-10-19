import type { CofoldResult, ProteinAnalysis } from '../types';
import { normalizeAnalysis } from './normalizeAnalysis';
import { getPrediction, isEsmFoldId, restorePrediction, type EsmPrediction } from './esmfoldService';
import { getCofold, isCofoldId, restoreCofold } from './cofoldService';
import { cleanView, sharedAnswer, type SharedView, type SharedViewState } from './shareService';
import { FIREWALL_REASON, stoppedByFirewall } from './http';

// --- SAVED RESULTS (short links) ---
// A view a link can't carry is saved through /api/saved (a private Cloudflare R2 bucket) and opened
// by a short link: "/app#s=<22 characters>". That covers a co-folded complex, a comparison of two and
// a folded sequence (their structure exists only in the browser that made it, and is far too long for
// an address), and an answer whose tour or summary a plain link would have to cut. Saving sends the
// answer, the view and the predicted structures, nothing else from the page; a saved result is kept
// for good and never changes. Opening one checks everything in it again, as for a plain link.

export const SAVED_PREFIX = '#s=';
const API = '/api/saved';
const SAVED_ID = /^[A-Za-z0-9_-]{22}$/;
const VERSION = 1;

type Kind = 'view' | 'esmfold' | 'cofold';

interface SavedPayload {
  v: number;
  kind: Kind;
  a: ProteinAnalysis;
  s: SharedViewState;
  structures?: (EsmPrediction | CofoldResult)[];
}

/** A saved result once opened: the shared view, plus the prediction's card when it is a co-fold. */
export interface OpenedSaved extends SharedView {
  cofold?: { result: CofoldResult; origin: ProteinAnalysis };
}

/** Whether a short link can be made for what's on screen (a prediction must still be in memory). */
export const canSave = (analysis?: ProteinAnalysis | null): boolean => {
  if (!analysis) return false;
  if (isEsmFoldId(analysis.pdbId)) return Boolean(getPrediction(analysis.pdbId));
  if (isCofoldId(analysis.pdbId)) return Boolean(getCofold(analysis.pdbId));
  return true;
};

/** The predicted structures a view needs: the one on screen, and the folded sequence a co-fold was made from. */
const structuresFor = (pdbId: string): (EsmPrediction | CofoldResult)[] => {
  if (isEsmFoldId(pdbId)) {
    const prediction = getPrediction(pdbId);
    return prediction ? [prediction] : [];
  }
  if (!isCofoldId(pdbId)) return [];
  const result = getCofold(pdbId);
  if (!result) return [];
  const source = isEsmFoldId(result.request.structureId) ? getPrediction(result.request.structureId) : undefined;
  return source ? [result, source] : [result];
};

/** Saves the view on screen and returns its short link (base: the page address without fragment). */
export const saveView = async (analysis: ProteinAnalysis, view: SharedViewState, base: string): Promise<string> => {
  const answer = sharedAnswer(analysis);
  const structures = structuresFor(answer.pdbId);
  const kind: Kind = isCofoldId(answer.pdbId) ? 'cofold' : isEsmFoldId(answer.pdbId) ? 'esmfold' : 'view';
  if (kind !== 'view' && structures.length === 0) throw new Error('this prediction is no longer in memory; run it again to share it');
  const payload: SavedPayload = { v: VERSION, kind, a: answer, s: cleanView(view, answer), ...(structures.length ? { structures } : {}) };
  let res: Response;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('the server could not be reached');
  }
  if (stoppedByFirewall(res)) throw new Error(FIREWALL_REASON);
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.id !== 'string' || !SAVED_ID.test(body.id)) {
    throw new Error(typeof body?.error === 'string' ? body.error.charAt(0).toLowerCase() + body.error.slice(1) : `the server answered ${res.status}`);
  }
  return `${base}${SAVED_PREFIX}${body.id}`;
};

/** The structure a co-fold was made from, as an answer to go back to. */
const originOf = (result: CofoldResult): ProteinAnalysis => ({
  pdbId: result.request.structureId,
  title: result.request.proteinName || result.request.structureId,
  summary: '',
  highlights: [],
});

/** Opens a saved result from its payload: everything checked, predictions put back in memory. */
export const openPayload = (payload: any): OpenedSaved | { error: string } => {
  if (!payload || typeof payload !== 'object' || payload.v !== VERSION) return { error: 'it was made by a different version of Argus' };
  const analysis = normalizeAnalysis(payload.a);
  if (!analysis) return { error: 'it holds no structure Argus can open' };
  delete analysis.actions; // A link shows a view; it never runs actions
  const { quiz: _quiz, ...shared } = analysis; // Links never carry quizzes

  // Predictions first, so the one on screen can be loaded like any other structure
  const restored = new Set<string>();
  let cofold: CofoldResult | null = null;
  for (const s of (Array.isArray(payload.structures) ? payload.structures : []).slice(0, 4)) {
    const id = typeof s?.id === 'string' ? s.id : '';
    if (isEsmFoldId(id)) {
      const prediction = restorePrediction(s);
      if (prediction) restored.add(prediction.id);
    } else if (isCofoldId(id)) {
      const result = restoreCofold(s);
      if (result) {
        restored.add(result.id);
        if (result.id === shared.pdbId.toUpperCase()) cofold = result;
      }
    }
  }
  const predicted = isEsmFoldId(shared.pdbId) || isCofoldId(shared.pdbId);
  if (predicted && !restored.has(shared.pdbId.toUpperCase())) return { error: 'the prediction in it could not be read' };
  shared.pdbId = predicted ? shared.pdbId.toUpperCase() : shared.pdbId;
  return {
    analysis: shared,
    view: cleanView(payload.s, shared),
    ...(cofold ? { cofold: { result: cofold, origin: originOf(cofold) } } : {}),
  };
};

// A short link is opened before the app starts (index.tsx), so its first render already shows it
let opened: OpenedSaved | { error: string } | null = null;
export const openedSaved = () => opened;

/** Opens the saved result the page address points to, if any, for the app to start with. */
export const openSavedFromAddress = async () => {
  opened = await openSavedHash(window.location.hash).catch(() => ({ error: 'it could not be opened' }));
};

/** The saved result a page address points to: null when there is none, { error } when it can't be opened. */
export const openSavedHash = async (hash: string): Promise<OpenedSaved | { error: string } | null> => {
  if (!hash.startsWith(SAVED_PREFIX)) return null;
  const id = hash.slice(SAVED_PREFIX.length);
  if (!SAVED_ID.test(id)) return { error: 'the link is damaged or incomplete' };
  let res: Response;
  try {
    res = await fetch(`${API}?id=${id}`, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return { error: 'the server could not be reached' };
  }
  if (stoppedByFirewall(res)) return { error: FIREWALL_REASON };
  if (res.status === 404) return { error: 'nothing is saved under it' };
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) return { error: typeof payload?.error === 'string' ? payload.error.toLowerCase() : `the server answered ${res.status}` };
  return openPayload(payload);
};
