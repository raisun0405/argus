import type { AtomSpec, Highlight, Measurement, ProteinAnalysis, Quiz, TourStep } from '../types';
import { normalizeActionIds } from './chatActions';

// --- ANSWER VALIDATION ---
// JSON mode guarantees valid JSON, not our shape: a reply with "resi": 45, a quiz
// without options or a missing pdbId would crash the chat while rendering. Both
// /api/analyze and the browser (fresh and cached answers) pass replies through
// here, so only well-formed fields survive. Pure TypeScript, no browser APIs.

const CATEGORIES = new Set(['active_site', 'binding_site', 'ligand', 'substrate', 'metal', 'cofactor', 'mutation', 'other']);
const MAX_ITEMS = 40;

const text = (value: unknown, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const chainId = (value: unknown) => {
  const chain = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  return chain.length > 0 && chain.length <= 4 ? chain : null;
};

/** 45, "45" or [45, "46"] -> [45, 46]; anything that isn't a whole number is dropped. */
const residues = (value: unknown) =>
  [...new Set((Array.isArray(value) ? value : [value]).map(Number).filter(Number.isInteger))].slice(0, 200);

const highlight = (value: any): Highlight | null => {
  const chain = chainId(value?.chain);
  const resi = residues(value?.resi);
  if (!chain || resi.length === 0) return null;
  const label = text(value?.label, 120);
  return {
    chain,
    resi,
    ...(label ? { label } : {}),
    category: CATEGORIES.has(value?.category) ? value.category : 'other',
  };
};

const highlights = (value: unknown): Highlight[] =>
  (Array.isArray(value) ? value : []).map(highlight).filter((h): h is Highlight => h !== null).slice(0, MAX_ITEMS);

/** Well-formed highlights only (also used to cap the context the browser sends). */
export const normalizeHighlights = highlights;

const atom = (value: any): AtomSpec | null => {
  const chain = chainId(value?.chain);
  const [resi] = residues(value?.resi);
  if (!chain || resi === undefined) return null;
  const name = text(value?.atom, 8);
  return { chain, resi, ...(name ? { atom: name } : {}) };
};

const measurements = (value: unknown): Measurement[] =>
  (Array.isArray(value) ? value : [])
    .map((m: any) => {
      const start = atom(m?.start);
      const end = atom(m?.end);
      const label = text(m?.label, 120);
      return start && end ? { start, end, ...(label ? { label } : {}) } : null;
    })
    .filter((m): m is Measurement => m !== null)
    .slice(0, 10);

const tour = (value: unknown): TourStep[] =>
  (Array.isArray(value) ? value : [])
    .map((step: any) => {
      const narration = text(step?.text, 600);
      return narration ? { text: narration, focus: highlights(step?.focus) } : null;
    })
    .filter((s): s is TourStep => s !== null)
    .slice(0, 8);

// "A) ", "(b) ", "1. "... at the start of an option
const OPTION_LABEL = /^\(?([A-Fa-f]|[1-6])[).:]\s+/;

/** Options labelled in sequence (A, B, C... or 1, 2, 3...) lose the labels: the quiz card shuffles them. */
const unlabel = (options: { option: string; index: number }[]) => {
  const labels = options.map(k => k.option.match(OPTION_LABEL)?.[1].toUpperCase());
  const inSequence = (first: number) => labels.every((l, i) => l === String.fromCharCode(first + options[i].index));
  return options.length > 1 && (inSequence(65) || inSequence(49))
    ? options.map(k => ({ ...k, option: k.option.replace(OPTION_LABEL, '') }))
    : options;
};

const quiz = (value: any): Quiz | null => {
  const question = text(value?.question, 400);
  // Empty options are dropped; the right answers are counted among the options that remain
  const kept = unlabel((Array.isArray(value?.options) ? value.options : []).slice(0, 6)
    .map((o: unknown, index: number) => ({ option: text(o, 200), index }))
    .filter((k: { option: string }) => k.option));
  const options: string[] = kept.map(k => k.option);
  // "correctAnswerIndices" for select-all-that-apply, else "correctAnswerIndex"
  const given: unknown[] = Array.isArray(value?.correctAnswerIndices) && value.correctAnswerIndices.length > 0
    ? value.correctAnswerIndices
    : [value?.correctAnswerIndex];
  const right = [...new Set(given
    .map(Number)
    .filter(Number.isInteger)
    .map(i => kept.findIndex((k: { index: number }) => k.index === i))
    .filter(i => i >= 0))].sort((a, b) => a - b);
  // A quiz needs a right answer and at least one wrong one
  if (!question || options.length < 2 || right.length === 0 || right.length === options.length) return null;
  const answers = highlights(value?.answerHighlights);
  return {
    question,
    options,
    correctAnswerIndex: right[0],
    ...(right.length > 1 ? { correctAnswerIndices: right } : {}),
    explanation: text(value?.explanation, 800),
    ...(answers.length ? { answerHighlights: answers } : {}),
  };
};

/**
 * A well-formed ProteinAnalysis, or null when the reply has no usable structure ID.
 * Unknown fields are dropped; malformed highlights, tour steps and quizzes are removed.
 */
export const normalizeAnalysis = (raw: unknown): ProteinAnalysis | null => {
  const data = raw as any;
  const pdbId = text(data?.pdbId, 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(pdbId)) return null;
  const steps = tour(data?.tour);
  const check = quiz(data?.quiz);
  const actions = normalizeActionIds(data?.actions);
  return {
    pdbId,
    title: text(data?.title, 200) || pdbId,
    summary: text(data?.summary),
    highlights: highlights(data?.highlights),
    measurements: measurements(data?.measurements),
    ...(steps.length ? { tour: steps } : {}),
    ...(check ? { quiz: check } : {}),
    ...(actions.length ? { actions } : {}),
  };
};
