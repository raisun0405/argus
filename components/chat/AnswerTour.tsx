import React from 'react';

// --- AN ANSWER'S TOUR ---
// The tour an answer comes with, played from the answer itself: "Play the tour" and its length, then
// the step on screen with Back, Pause, Next and Stop while it plays. Before this, a tour that didn't
// start by itself waited behind the header's video button, where few people found it.

interface AnswerTourProps {
  steps: number;
  live: boolean; // The answer's structure is on screen (its steps point at residues there)
  disabled: boolean; // Another answer is on its way
  playing: { index: number; count: number } | null; // This answer's tour is the one playing (index -1: starting)
  paused: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onPrevious: () => void;
  onNext: () => void; // Past the last step, the tour is over
}

const BUTTON = 'h-7 touch:h-9 px-2.5 touch:px-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas/60 text-[12px] font-medium text-ink transition-colors enabled:hover:border-line-2 enabled:hover:text-ink-strong disabled:opacity-40 disabled:cursor-not-allowed';
const ICON_BUTTON = 'h-7 w-7 touch:h-9 touch:w-9 inline-flex items-center justify-center rounded-md border border-line bg-canvas/60 text-ink transition-colors enabled:hover:border-line-2 enabled:hover:text-ink-strong disabled:opacity-40 disabled:cursor-not-allowed';

const PlayIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>
);
const PauseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
);
const StopIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
);
const StepIcon: React.FC<{ back?: boolean }> = ({ back }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={back ? 'rotate-180' : ''}><path d="M5 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 5 5.5Z" /><rect x="17" y="5" width="2.5" height="14" rx="1" /></svg>
);

const AnswerTour: React.FC<AnswerTourProps> = ({ steps, live, disabled, playing, paused, onPlay, onPause, onStop, onPrevious, onNext }) => (
  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5" data-answer-tour={playing ? (paused ? 'paused' : 'playing') : 'ready'}>
    {playing ? (
      <>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrevious} disabled={playing.index <= 0} aria-label="Previous step" title="Previous step" className={ICON_BUTTON}>
            <StepIcon back />
          </button>
          <button type="button" onClick={onPause} className={BUTTON}>
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={onNext} disabled={playing.index < 0} aria-label={playing.index + 1 >= playing.count ? 'End the tour' : 'Next step'} title={playing.index + 1 >= playing.count ? 'End the tour' : 'Next step'} className={ICON_BUTTON}>
            <StepIcon />
          </button>
        </div>
        <button type="button" onClick={onStop} className={BUTTON}>
          <StopIcon />
          Stop
        </button>
        <span className="text-[11.5px] tabular-nums text-ink-dim" aria-live="polite">
          {playing.index < 0 ? 'Starting the tour…' : `${paused ? 'Paused · ' : ''}Step ${playing.index + 1} of ${playing.count}`}
        </span>
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={onPlay}
          disabled={!live || disabled}
          title={live ? undefined : "This answer's structure isn't on screen"}
          className={BUTTON}
        >
          <PlayIcon />
          Play the tour
        </button>
        <span className="text-[11.5px] tabular-nums text-ink-dim">{steps} {steps === 1 ? 'step' : 'steps'}</span>
      </>
    )}
  </div>
);

export default AnswerTour;
