import React from 'react';
import type { ActionResult } from '../../services/chatActions';

// --- WHAT THE CHAT CHANGED ---
// Each change a request made, as it actually happened: a tick when done, a cross and the reason when
// it couldn't be, a hollow ring while it waits for its structure to load. Written by the app from the
// results, never by the AI, so it can't claim a change that didn't happen.

const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);
const Cross = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

const ActionReceipt: React.FC<{ results: ActionResult[] }> = ({ results }) => (
  <ul data-action-receipt aria-label="What changed" aria-live="polite" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-chat-meta leading-5">
    {results.map((r, i) => (
      <li
        key={i}
        data-action-state={r.pending ? 'pending' : r.ok ? 'done' : 'failed'}
        className={`inline-flex items-start gap-1.5 ${r.ok ? 'text-ink' : 'text-ink-muted'}`}
      >
        <span className={`mt-1 flex-shrink-0 ${r.pending ? 'text-ink-dim' : r.ok ? 'text-good' : 'text-bad'}`}>
          {r.pending ? <span className="block w-3 h-3 rounded-full border border-current animate-pulse" /> : r.ok ? <Tick /> : <Cross />}
        </span>
        <span>
          {r.label}
          {r.note && <span className="text-ink-dim">: {r.note}</span>}
        </span>
      </li>
    ))}
  </ul>
);

export default ActionReceipt;
