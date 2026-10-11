import type { ProteinAnalysis, Quiz } from '../types';

// --- QUIZ ---
// The quiz card's rules that don't belong in the component: the order its options are shown in, which
// options are right, and how an answer is marked.

/**
 * The options' display order (position -> option index). AI models tend to put the right answer
 * first (5 of 8 quizzes in a check on 2026-10-06), so the card shuffles them; seeded by the question,
 * the order stays the same each time that quiz is shown.
 */
export const quizOrder = (seed: string, count: number): number[] => {
  let h = 2166136261; // FNV-1a over the seed...
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const random = () => { // ...driving mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

/**
 * The question without a "(Select all that apply)" of its own: the card shows that label itself
 * when several options are right, and radio buttons when one is.
 */
export const quizQuestion = (question: string): string =>
  question
    .replace(/^[([]?(?:select|choose|pick|mark|tick) all that apply[.!]?[)\]]?\s*[:.\-–—]?\s*/i, '')
    .replace(/\s*[-–—:]?\s*[([]?(?:select|choose|pick|mark|tick) all that apply[.!]?[)\]]?[.!]?$/i, '')
    .trim() || question;

/** The quiz's right options: one, or several for "select all that apply". */
export const rightAnswers = (quiz: Quiz): number[] => quiz.correctAnswerIndices ?? [quiz.correctAnswerIndex];

/** Correct: every right option and nothing else picked. Partly: some right ones picked. */
export const markQuiz = (right: number[], picked: number[]): 'correct' | 'partly' | 'wrong' => {
  const isRight = new Set(right);
  const chosen = new Set(picked);
  const hits = [...chosen].filter(i => isRight.has(i)).length;
  if (hits === isRight.size && chosen.size === isRight.size) return 'correct';
  return hits > 0 ? 'partly' : 'wrong';
};

// --- HOW OFTEN ---
// The AI writes a quiz for nearly every answer that explains how something works, which is most of
// what people ask, so a few questions in a row brought a question under every answer (3 of 6 answers
// in a check on 2026-10-11, two of them back to back). Each request stands alone, so the AI can't
// space them out itself: the app does. A quiz the user didn't ask for is left out while one of the
// last QUIZ_GAP answers had one; a quiz asked for ("Quiz me on...", "test me") is always kept.

export const QUIZ_GAP = 2;

const QUIZ_ASKED = /\b(?:quiz|quizzes|test me|test us|test my|question me|check my understanding|ask me (?:a |some )?questions?)\b/i;

/** The user asks to be quizzed. */
export const asksForQuiz = (text: string): boolean => QUIZ_ASKED.test(text.replace(/\s+/g, ' '));

/** Whether an answer may come with a quiz nobody asked for, given the answers shown before it (oldest first). */
export const quizWelcome = (earlier: { quiz?: unknown }[]): boolean => !earlier.slice(-QUIZ_GAP).some(answer => answer.quiz);

/** The answer without its quiz. */
export const withoutQuiz = (answer: ProteinAnalysis): ProteinAnalysis => {
  const { quiz, ...rest } = answer;
  return quiz ? rest : answer;
};
