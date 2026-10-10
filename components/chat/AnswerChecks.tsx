import React, { useId, useState } from 'react';
import type { AnswerChecks as Checks, CheckRow } from '../../services/answerChecks';

// --- WHAT WAS CHECKED ---
// One quiet line under an answer: what the app checked before showing it and what it fixed first
// (services/answerChecks.ts), with the details opening in place. Written from the checks' results,
// never by the AI.

const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);
const Redo = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" /><path d="M20.5 3.5V9H15" /></svg>
);
const Alert = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg>
);
const Ring = () => <span aria-hidden="true" className="block w-3 h-3 p-[1.5px]"><span className="block w-full h-full rounded-full border border-current" /></span>;

const ICON: Record<CheckRow['state'], { icon: React.ReactNode; tone: string }> = {
  ok: { icon: <Tick />, tone: 'text-good' },
  fixed: { icon: <Redo />, tone: 'text-good' },
  issue: { icon: <Alert />, tone: 'text-warn' },
  skipped: { icon: <Ring />, tone: 'text-ink-dim' },
};

/** Wrapped text that never strands a count from its noun ("2 / residues"), splits "protein name", or ends on a word alone. */
const tidy = (text: string) => text
  .replace(/(\d) (?=\S)/g, '$1 ')
  .replace(/protein name/g, 'protein name')
  .replace(/ (\S+)$/, ' $1');

const AnswerChecks: React.FC<{ checks: Checks }> = ({ checks }) => {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { icon, tone } = ICON[checks.status === 'issues' ? 'issue' : checks.status === 'unchecked' ? 'skipped' : 'ok'];
  const line = (
    <>
      <span className={`mt-1 flex-shrink-0 ${tone}`}>{icon}</span>
      <span className="min-w-0 text-pretty">{tidy(checks.summary)}</span>
    </>
  );

  // Nothing was checked: the line says why, and there's nothing more to open
  if (checks.rows.length === 0) {
    return (
      <p data-answer-checks data-checks-status={checks.status} className="mt-2.5 flex items-start gap-1.5 text-chat-meta leading-5 text-ink-dim">
        {line}
      </p>
    );
  }
  return (
    <div data-answer-checks data-checks-status={checks.status} className="mt-2.5">
      <button
        type="button"
        data-checks-toggle
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={detailsId}
        className="-mx-1 px-1 touch:py-1.5 max-w-full inline-flex items-start gap-1.5 rounded text-left text-chat-meta leading-5 text-ink-muted hover:text-ink-strong transition-colors"
      >
        {line}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`mt-[5px] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        // The rule sits under the line's icon, and the rows' text lines up with the line's
        <div id={detailsId} data-checks-details className="mt-1.5 ml-[5px] border-l border-line pl-3">
          <ul className="space-y-1">
            {checks.rows.map((row, i) => (
              <li key={i} data-check-row data-check-state={row.state} className="flex items-start gap-1.5 text-[12px] leading-5 text-ink">
                <span className={`mt-1 flex-shrink-0 ${ICON[row.state].tone}`}>{ICON[row.state].icon}</span>
                <span className="min-w-0 break-words">{tidy(row.text)}</span>
              </li>
            ))}
          </ul>
          {checks.source && <p className="mt-1.5 text-[11px] leading-4 text-ink-dim">{checks.source}</p>}
        </div>
      )}
    </div>
  );
};

export default AnswerChecks;
