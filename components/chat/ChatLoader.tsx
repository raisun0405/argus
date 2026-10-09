import React, { Suspense, lazy } from 'react';
import { THEMES } from '../../themes';
import { useTheme } from '../../useTheme';
import { ORB_STATES, type ChatLook, type LoaderOrb } from './chatLook';

// The orbs' animation comes in its own file, so the app's first screen doesn't wait for it
const ThinkingOrb = lazy(() => import('thinking-orbs').then(m => ({ default: m.ThinkingOrb })));

/** One of the four orbs, inked for the active theme (light dots on dark themes, dark on light ones). */
export const Orb: React.FC<{ kind: LoaderOrb; size: 20 | 32 | 64; speed?: number; paused?: boolean; label?: string; className?: string }> = ({ kind, size, speed = 1, paused = false, label, className }) => {
  const [themeId] = useTheme();
  return (
    // Until it arrives, an empty space of the orb's size keeps the layout still
    <Suspense fallback={<span className={className} style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />}>
      <ThinkingOrb
        state={ORB_STATES[kind]}
        size={size}
        speed={speed}
        paused={paused}
        theme={THEMES[themeId].colorScheme === 'light' ? 'light' : 'dark'}
        className={className}
        {...(label ? { 'aria-label': label } : { 'aria-hidden': true, role: 'presentation' })}
      />
    </Suspense>
  );
};

/** The sliding strip of an indeterminate progress bar, for tool runs that take tens of seconds. */
export const ProgressStrip: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`h-[2px] rounded-full bg-line overflow-hidden ${className}`} aria-hidden="true">
    <div className="h-full w-1/3 argus-progress-strip" style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--c-ink-strong) / 0.85), transparent)' }} />
  </div>
);

/**
 * A step's text with its clock ("… with Beta-trypsin… 12 s") kept whole: the clock stays joined to
 * the word before it, so a wrap never leaves "s" or "12 s" alone on a line, and its digits keep one
 * width while they count.
 */
export const PhaseText: React.FC<{ phase: string }> = ({ phase }) => {
  const m = phase.match(/^(.*\s)?(\S+)\s(\d+ s)(\W.*)?$/);
  if (!m) return <>{phase}</>;
  const [, head = '', word, clock, tail = ''] = m;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">{word} <span className="tabular-nums">{clock}</span></span>
      {tail}
    </>
  );
};

interface ChatLoaderProps {
  kind: 'think' | 'work'; // An answer being written, or a tool running
  phase: string;
  look: ChatLook;
}

/**
 * What the chat shows while it waits: an orb (the answer's or the tool's) and the current step as a
 * shimmering line. Tool runs also get a sliding strip, since they take tens of seconds.
 */
const ChatLoader: React.FC<ChatLoaderProps> = ({ kind, phase, look }) => {
  const orb = kind === 'think' ? look.thinkingOrb : look.workingOrb;
  const label = kind === 'think' ? 'Working on an answer' : 'Running a tool';

  if (look.loader === 'pill') {
    return (
      <div role="status" aria-live="polite" aria-label={label} className="flex justify-start argus-rise" data-chat-loader>
        <div className="inline-flex max-w-full items-center gap-3 pl-1.5 pr-5 py-1.5 rounded-full bg-surface/80 backdrop-blur-md border border-line shadow-float">
          <Orb kind={orb} size={32} speed={look.orbSpeed} />
          <div className="min-w-0">
            <p className="text-chat-aside font-medium leading-snug argus-shimmer break-words"><PhaseText phase={phase} /></p>
            {kind === 'work' && <ProgressStrip className="mt-1.5 w-36" />}
          </div>
        </div>
      </div>
    );
  }

  if (look.loader === 'avatar') {
    return (
      <div role="status" aria-live="polite" aria-label={label} className="flex items-start gap-3 argus-rise" data-chat-loader>
        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center"><Orb kind={orb} size={32} speed={look.orbSpeed} /></div>
        <div className="min-w-0 pt-1.5">
          <p className="text-chat-aside font-medium leading-snug argus-shimmer break-words"><PhaseText phase={phase} /></p>
          {kind === 'work' && <ProgressStrip className="mt-2 w-44" />}
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex items-start gap-2.5 argus-rise" data-chat-loader>
      <div className="flex-shrink-0 w-5 h-5 mt-px flex items-center justify-center"><Orb kind={orb} size={20} speed={look.orbSpeed} /></div>
      <div className="min-w-0">
        <p className="text-chat-aside font-medium leading-5 argus-shimmer break-words"><PhaseText phase={phase} /></p>
        {kind === 'work' && <ProgressStrip className="mt-1.5 w-40" />}
      </div>
    </div>
  );
};

export default ChatLoader;
