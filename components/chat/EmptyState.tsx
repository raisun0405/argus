import React from 'react';
import type { ChatLook } from './chatLook';
import type { ComposerMode } from './ComposerMenu';
import { Orb } from './ChatLoader';

// --- EMPTY STATE ---
// Before the first question: what Argus is, what is on screen, and four ways to begin. The cards
// send straight away, except Co-fold, which needs a molecule and so switches the composer to it.

interface EmptyStateProps {
  subject?: string; // The structure on screen
  look: ChatLook;
  onSend: (text: string) => void;
  onMode: (mode: ComposerMode) => void;
  cofoldReady?: boolean | null; // false: this server can't co-fold, so that card says so instead
}

const icon = (path: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);

const EmptyState: React.FC<EmptyStateProps> = ({ subject, look, onSend, onMode, cofoldReady = null }) => {
  const it = subject ?? 'this structure';
  const noCofold = cofoldReady === false;
  const cards: { title: string; hint: string; icon: React.ReactNode; run: () => void; disabled?: boolean }[] = [
    { title: `Explain ${it}`, hint: 'How it works, residue by residue', icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>), run: () => onSend(`Explain how ${it} works`) },
    { title: 'Quiz me', hint: 'A question on what is on screen', icon: icon(<><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></>), run: () => onSend(`Quiz me on ${it}`) },
    { title: 'Show me HIV protease', hint: 'With the drug that blocks it', icon: icon(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>), run: () => onSend('Show me HIV protease with its drug') },
    { title: 'Co-fold a molecule', hint: noCofold ? 'Not set up on this server' : 'Predict how it binds, and how strongly', icon: icon(<><path d="M9 3.5 15 7v7l-6 3.5L3 14V7z" /><path d="m15 14 3.6 2.2" /><circle cx="20.4" cy="17.6" r="2.1" /></>), run: () => onMode('cofold'), disabled: noCofold },
  ];
  const compact = look.density === 'compact';
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center px-2 py-8 argus-rise" data-chat-empty>
      {/* The orb comes in hand-tuned sizes (64, 32, 20): Compact shows the 64 at three quarters */}
      <div className={`grid place-items-center ${compact ? 'w-12 h-12' : 'w-16 h-16'}`}>
        <Orb kind="ring" size={64} speed={0.7 * look.orbSpeed} className={compact ? 'scale-75' : undefined} />
      </div>
      <h2 className={`font-semibold tracking-tight text-ink-strong ${compact ? 'mt-4 text-[17px]' : 'mt-5 text-[19px]'}`}>What would you like to explore?</h2>
      <p className="mt-1.5 max-w-[30ch] text-chat-aside leading-relaxed text-ink-muted">
        Argus, your molecular co-scientist. {subject ? <><span className="text-ink">{subject}</span> is on screen: ask about it, or start somewhere new.</> : 'Ask about any protein, or paste a sequence.'}
      </p>
      <div className={`w-full max-w-[340px] grid grid-cols-2 gap-2 text-left ${compact ? 'mt-5' : 'mt-6'}`}>
        {cards.map(card => (
          <button
            key={card.title}
            type="button"
            onClick={card.run}
            disabled={card.disabled}
            title={card.disabled ? "Co-folding isn't set up on this server (it needs an NVIDIA API key)" : undefined}
            className={`group text-left rounded-xl border border-line bg-surface/50 backdrop-blur px-3 enabled:hover:border-line-2 enabled:hover:bg-surface/80 disabled:opacity-55 disabled:cursor-not-allowed transition-colors ${compact ? 'py-2' : 'py-2.5'}`}
          >
            <span className="flex items-center gap-1.5 text-ink-muted group-hover:text-ink-strong transition-colors">{card.icon}</span>
            <span className="mt-1.5 block text-chat-meta font-medium leading-snug text-ink-strong line-clamp-2">{card.title}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">{card.hint}</span>
          </button>
        ))}
      </div>
      {/* The landing page, in a new tab, so nothing here is lost */}
      <a href="/" target="_blank" rel="noopener" data-about-link className="mt-5 touch:mt-3 touch:px-3 touch:py-2.5 text-[11.5px] touch:text-[13px] text-ink-dim underline-offset-4 hover:text-ink-muted hover:underline transition-colors">
        About Argus
      </a>
    </div>
  );
};

export default EmptyState;
