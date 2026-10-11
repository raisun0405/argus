import React, { useId, useState } from 'react';

// --- A TERM AND WHAT IT MEANS ---
// Explanations that lived in title tooltips reached only a mouse: never the keyboard, a screen reader's
// browse mode, or a phone. Here the term is a small button with a dotted underline, and pressing it (a
// click, a tap, Enter) shows the explanation as text below it: WAI-ARIA's disclosure pattern. A group
// (a card's scores, a panel's metrics) shows one explanation at a time.

/** One group's open explanation, and what its terms and its explanation need. */
export const useExplain = () => {
  const [open, setOpen] = useState<string | null>(null);
  const base = useId();
  return {
    open,
    /** Props for the Term of `key`. */
    term: (key: string) => ({
      expanded: open === key,
      controls: `${base}-${key}`,
      onToggle: () => setOpen(current => (current === key ? null : key)),
    }),
    /** The id the explanation of `key` takes (what its Term controls). */
    id: (key: string) => `${base}-${key}`,
  };
};

interface TermProps {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}

/** The term: as it was written, with a dotted underline, a button that shows or hides what it means. */
export const Term: React.FC<TermProps> = ({ expanded, controls, onToggle, className = '', children }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={expanded}
    aria-controls={expanded ? controls : undefined}
    // The padding widens the target for a finger without moving the text
    className={`-my-1 py-1 touch:-my-2 touch:py-2 text-left underline decoration-dotted decoration-ink-dim underline-offset-[3px] hover:decoration-ink-muted cursor-help ${className}`}
  >
    {children}
  </button>
);

/** What the term means, under it while its Term is pressed. */
export const Explanation: React.FC<{ id: string; className?: string; children: React.ReactNode }> = ({ id, className = '', children }) => (
  <p id={id} data-explanation className={`text-[11px] touch:text-[13px] leading-snug text-ink-muted argus-rise ${className}`}>
    {children}
  </p>
);
