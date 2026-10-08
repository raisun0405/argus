import type { ProteinAnalysis } from '../types';
import { normalizeAnalysis } from './normalizeAnalysis';
import { isEsmFoldId } from './esmfoldService';
import { parseAlphaFoldId } from './alphafoldService';
import { isCofoldId } from './cofoldService';

// --- SHAREABLE VIEW LINKS ---
// "Share" copies a link that reopens the current view: the answer on screen (structure, title,
// summary, highlights, measurements, tour) and how it is shown (colouring, visual mode, the
// AlphaFold switch, the camera). Everything travels in the URL fragment, which browsers never send
// to a server, so no backend or storage is involved. An opened link goes through the same
// validation as the AI's replies, and the chat labels it as shared rather than generated.

export const SHARE_PREFIX = '#view=';
const VERSION = 1;
const MAX_LINK_CHARS = 8000; // Long tours and summaries are trimmed to stay well inside URL limits
const MAX_HASH_CHARS = 20000; // Longer fragments are refused when opening
const MAX_SHARED_SUMMARY = 1500;

const COLOR_SCHEMES = new Set(['element', 'rainbow', 'hydrophobicity', 'chain', 'residue', 'pathogenicity', 'confidence', 'pockets', 'interactions']);
const VIZ_STYLES = new Set(['cartoon', 'stick', 'sphere', 'surface']);
const ACCESSION = /^[A-Z0-9]{6,10}$/;

export interface SharedViewState {
  colorScheme?: string;
  vizStyle?: string;
  alphaFold?: string; // UniProt accession of the AlphaFold model opened from the experimental entry
  opacity?: number; // Structure opacity, 0-100
  camera?: number[]; // 3Dmol getView(): position, zoom and rotation quaternion (8 numbers)
}

export interface SharedView {
  analysis: ProteinAnalysis;
  view: SharedViewState;
}

/** Folded sequences and co-folded complexes live only in the browser that made them, so they can't be shared (yet). */
export const canShare = (analysis?: ProteinAnalysis | null) => Boolean(analysis && !isEsmFoldId(analysis.pdbId) && !isCofoldId(analysis.pdbId));

const toBase64Url = (text: string) => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (data: string) => {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
};

/** Only the settings that make sense for this answer, in the expected shape. */
const cleanView = (raw: unknown, analysis: ProteinAnalysis): SharedViewState => {
  const view = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fromExperimental = !parseAlphaFoldId(analysis.pdbId);
  const alphaFold = fromExperimental && typeof view.alphaFold === 'string' && ACCESSION.test(view.alphaFold) ? view.alphaFold : undefined;
  const predicted = !fromExperimental || Boolean(alphaFold);
  const colorScheme = typeof view.colorScheme === 'string' && COLOR_SCHEMES.has(view.colorScheme)
    && (view.colorScheme !== 'confidence' || predicted) ? view.colorScheme : undefined;
  const vizStyle = typeof view.vizStyle === 'string' && VIZ_STYLES.has(view.vizStyle) ? view.vizStyle : undefined;
  const opacity = typeof view.opacity === 'number' && Number.isFinite(view.opacity) ? Math.round(Math.min(100, Math.max(0, view.opacity))) : undefined;
  const camera = Array.isArray(view.camera) && view.camera.length === 8 && view.camera.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e5)
    ? (view.camera as number[]).map(v => Math.round(v * 1e4) / 1e4)
    : undefined;
  return {
    ...(colorScheme ? { colorScheme } : {}),
    ...(vizStyle ? { vizStyle } : {}),
    ...(alphaFold ? { alphaFold } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(camera ? { camera } : {}),
  };
};

/** A link reopening this answer and view (base: the page address without fragment). */
export const buildShareUrl = (analysis: ProteinAnalysis, view: SharedViewState, base: string): string => {
  const answer: ProteinAnalysis = {
    pdbId: analysis.pdbId,
    title: analysis.title,
    summary: analysis.summary,
    highlights: analysis.highlights,
    ...(analysis.measurements?.length ? { measurements: analysis.measurements } : {}),
    ...(analysis.tour?.length ? { tour: analysis.tour } : {}),
  };
  const encode = () => toBase64Url(JSON.stringify({ v: VERSION, a: answer, s: cleanView(view, answer) }));
  let encoded = encode();
  if (encoded.length > MAX_LINK_CHARS && answer.tour) {
    delete answer.tour;
    encoded = encode();
  }
  if (encoded.length > MAX_LINK_CHARS && answer.summary.length > MAX_SHARED_SUMMARY) {
    answer.summary = `${answer.summary.slice(0, MAX_SHARED_SUMMARY - 1)}…`;
    encoded = encode();
  }
  return `${base}${SHARE_PREFIX}${encoded}`;
};

/** The view in a page fragment: null when there is none, { error } when it can't be opened. */
export const readShareHash = (hash: string): SharedView | { error: string } | null => {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  const data = hash.slice(SHARE_PREFIX.length);
  if (!data || data.length > MAX_HASH_CHARS || !/^[A-Za-z0-9_-]+$/.test(data)) return { error: 'the link is damaged or incomplete' };
  let payload: any;
  try {
    payload = JSON.parse(fromBase64Url(data));
  } catch {
    return { error: 'the link is damaged or incomplete' };
  }
  if (payload?.v !== VERSION) return { error: 'it was made by a different version of Argus' };
  const analysis = normalizeAnalysis(payload?.a);
  if (!analysis || isEsmFoldId(analysis.pdbId) || isCofoldId(analysis.pdbId)) return { error: 'it holds no structure Argus can open' };
  delete analysis.actions; // A link shows a view; it never runs actions
  const { quiz: _quiz, ...shared } = analysis; // Links never carry quizzes
  return { analysis: shared, view: cleanView(payload?.s, shared) };
};
