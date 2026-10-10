import React, { useMemo, useState } from 'react';
import { Quiz } from '../types';
import { markQuiz, quizOrder, quizQuestion, rightAnswers } from '../services/quiz';

interface QuizCardProps {
  quiz: Quiz;
  onCorrectAnswer: () => void;
}

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
);
const CrossIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

/**
 * A one-question check, laid out like a poll: rounded rows with a radio
 * circle, then the right answer marked, a wrong pick marked, and the explanation underneath. A
 * question with several right answers ("select all that apply") gets checkboxes and a Check
 * button, then marks right picks, wrong picks and right answers missed. The options are shuffled
 * (services/quiz), since AI models tend to put the right one first.
 */
const QuizCard: React.FC<QuizCardProps> = ({ quiz, onCorrectAnswer }) => {
  const right = rightAnswers(quiz);
  const multi = right.length > 1;
  const order = useMemo(() => quizOrder(quiz.question, quiz.options.length), [quiz.question, quiz.options.length]);
  const [picked, setPicked] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const result = checked ? markQuiz(right, picked) : null;
  const found = picked.filter(i => right.includes(i)).length;
  const wrongPicks = picked.length - found;

  const finish = (choice: number[]) => {
    setPicked(choice);
    setChecked(true);
    if (markQuiz(right, choice) === 'correct') onCorrectAnswer();
  };
  const choose = (index: number) => {
    if (checked) return;
    if (!multi) return finish([index]);
    setPicked(p => (p.includes(index) ? p.filter(i => i !== index) : [...p, index]));
  };

  return (
    <div className="mt-4 mb-1 rounded-2xl border border-line bg-surface/50 backdrop-blur overflow-hidden" data-quiz>
      <div className="px-4 pt-3.5 pb-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>
          Quick check
          {multi && <span className="ml-auto h-[18px] px-2 rounded-full bg-chip text-[10.5px] leading-[18px] text-ink-muted" data-quiz-multi>Select all that apply</span>}
        </p>
        <h3 className="mt-1 text-chat font-semibold leading-snug tracking-tight text-ink-strong">{quizQuestion(quiz.question)}</h3>
      </div>

      <div className="px-3 pb-3 space-y-1.5" role="group" aria-label="Answers">
        {order.map(idx => {
          const isRight = right.includes(idx);
          const isPicked = picked.includes(idx);
          // Before checking: picked or open. After: a right answer (picked, or the one right answer of a
          // single-answer quiz), a right answer missed, a wrong pick, or an option nobody needed
          const state = !checked
            ? (isPicked ? 'picked' : 'open')
            : isRight ? (isPicked || !multi ? 'right' : 'missed') : isPicked ? 'wrong' : 'other';
          return (
            <button
              key={idx}
              type="button"
              onClick={() => choose(idx)}
              disabled={checked}
              {...(multi ? { role: 'checkbox', 'aria-checked': isPicked } : { 'aria-pressed': isPicked })}
              data-quiz-option={state}
              className={`w-full flex items-center gap-3 rounded-xl border px-3 py-chat-option-y text-left text-chat-aside font-medium transition-all ${
                state === 'right' ? 'border-good/45 bg-good/[0.08] text-ink-strong'
                : state === 'missed' ? 'border-dashed border-good/55 text-ink'
                : state === 'wrong' ? 'border-bad/45 bg-bad/[0.08] text-ink-strong'
                : state === 'other' ? 'border-line text-ink-muted' // Quieter, still readable: the explanation refers to them
                : state === 'picked' ? 'border-line-2 bg-chip/60 text-ink-strong'
                : 'border-line bg-canvas/30 text-ink hover:border-line-2 hover:bg-chip/40 group'
              }`}
            >
              {/* Circles when one answer is right, squares when several are (like radio buttons and checkboxes) */}
              <span
                aria-hidden="true"
                className={`flex-shrink-0 w-[18px] h-[18px] border-2 flex items-center justify-center ${multi ? 'rounded-[5px]' : 'rounded-full'} ${
                  state === 'right' ? 'border-good bg-good text-canvas'
                  : state === 'missed' ? 'border-good/70'
                  : state === 'wrong' ? 'border-bad bg-bad text-canvas'
                  : state === 'picked' ? 'border-ink-strong bg-ink-strong text-canvas'
                  : 'border-line-2 group-hover:border-ink-muted'
                }`}
              >
                {(state === 'right' || state === 'picked') && <CheckIcon />}
                {state === 'wrong' && <CrossIcon />}
              </span>
              <span className="min-w-0 flex-1">{quiz.options[idx]}</span>
              {state === 'missed' && <span className="flex-shrink-0 text-[10.5px] font-medium text-good">Missed</span>}
            </button>
          );
        })}

        {multi && !checked && (
          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => finish(picked)}
              disabled={picked.length === 0}
              className="h-7 px-3 rounded-md bg-brand text-brand-ink text-xs font-semibold transition-all hover:bg-brand-dark disabled:bg-chip disabled:text-ink-dim disabled:cursor-not-allowed"
            >
              Check
            </button>
            <span className="text-[11px] text-ink-dim">{picked.length === 0 ? 'Pick every right answer' : `${picked.length} picked`}</span>
          </div>
        )}
      </div>

      {result && (
        <div className={`px-4 py-3 border-t argus-rise ${result === 'correct' ? 'border-good/25 bg-good/[0.05]' : 'border-line bg-canvas/30'}`} role="status">
          <p className={`text-[12px] font-semibold ${result === 'correct' ? 'text-good' : result === 'partly' ? 'text-warn' : 'text-ink-muted'}`}>
            {result === 'correct' ? 'Correct'
              : result === 'partly' ? `Partly right · ${found} of ${right.length} found${wrongPicks ? `, ${wrongPicks} wrong` : ''}`
              : 'Not quite'}
          </p>
          <p className="mt-0.5 text-chat-aside leading-relaxed text-ink">{quiz.explanation}</p>
          {result === 'correct' && quiz.answerHighlights && (
            <p className="mt-1.5 text-[11px] text-ink-dim">Showing it in 3D</p>
          )}
        </div>
      )}
    </div>
  );
};

export default QuizCard;
