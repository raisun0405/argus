import React, { useEffect, useRef, useState } from 'react';
import type { Highlight, InteractionPartner, PartnerSearchResult, SimilarSearchResult, SimilarStructureHit } from '../../types';
import { SLOW_TOOLS, splitCitations } from '../../services/investigationPlan';
import type { InvestigationState, InvestigationStep } from '../../services/investigation';
import MarkedParts from './MarkedParts';

// --- INVESTIGATION ---
// Investigate mode's answer. While it runs: the steps as a checklist, each with its status, one line
// of result and its time (the slow ones say so up front). Once done: the write-up first, its
// citations a click away from their steps, the parts it marks in 3D, and the steps folded into one
// line that opens them again. A finished step or a citation shows its result in 3D.

interface InvestigationCardProps {
  state: InvestigationState;
  live: boolean; // The investigated structure is on screen, so steps and marks can show things in it
  structureTag: string; // "1HSG", "ESMFold"...
  onStop: () => void;
  onRetry: () => void;
  onOpenStructure: () => void; // Bring the investigated structure back into the viewer
  onShowStep: (step: InvestigationStep) => void;
  onFocus: (highlights: Highlight[]) => void;
  onOpenSimilar: (hit: SimilarStructureHit, result: SimilarSearchResult) => void;
  onOpenPartner: (partner: InteractionPartner, result: PartnerSearchResult) => void;
}

const Tick = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);
const Cross = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const Dash = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true"><path d="M6 12h12" /></svg>
);

const StatusIcon: React.FC<{ status: InvestigationStep['status'] }> = ({ status }) => {
  const box = 'relative z-10 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center';
  if (status === 'running') return <span aria-hidden="true" className={`${box} border-2 border-line-2 border-t-ink-strong animate-spin`} />;
  if (status === 'done') return <span className={`${box} bg-good/15 text-good`}><Tick /></span>;
  if (status === 'failed') return <span className={`${box} bg-bad/15 text-bad`}><Cross /></span>;
  if (status === 'skipped') return <span className={`${box} bg-chip text-ink-dim`}><Dash /></span>;
  return <span aria-hidden="true" className={`${box} border border-line-2 bg-canvas`} />;
};

const STATUS_WORDS: Record<InvestigationStep['status'], string> = { pending: 'waiting', running: 'running', done: 'done', failed: 'failed', skipped: 'skipped' };

const seconds = (ms: number) => `${ms < 10_000 ? (Math.max(ms, 100) / 1000).toFixed(1) : Math.round(ms / 1000)} s`;

/** Re-renders every second while something is running, for the live timers. */
const useTicking = (active: boolean) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
};

interface StepRowProps {
  step: InvestigationStep;
  last: boolean;
  live: boolean;
  flash: number; // Bumped when a citation points here
  rowRef: (el: HTMLLIElement | null) => void;
  onShow: () => void;
  onOpenSimilar: InvestigationCardProps['onOpenSimilar'];
  onOpenPartner: InvestigationCardProps['onOpenPartner'];
}

const StepRow: React.FC<StepRowProps> = ({ step, last, live, flash, rowRef, onShow, onOpenSimilar, onOpenPartner }) => {
  const { status, result } = step;
  const elapsed = step.startedAt ? (step.finishedAt ?? Date.now()) - step.startedAt : 0;
  const timing = status === 'done' || status === 'failed' ? seconds(elapsed) : status === 'running' && elapsed >= 1000 ? seconds(elapsed) : '';
  const detail =
    status === 'done' ? result?.summary
    : status === 'failed' ? `Failed: ${step.note ?? 'no reason given'}`
    : status === 'skipped' ? (step.note === 'stopped' ? 'Stopped before it finished' : `Skipped: ${step.note ?? 'not needed'}`)
    : [step.plan.why, status === 'running' && SLOW_TOOLS.has(step.plan.tool) ? 'can take up to a minute' : ''].filter(Boolean).join(' · ');
  const showable = live && status === 'done' && Boolean(result?.view || result?.sets.length);

  const body = (
    <>
      <div className="flex items-baseline gap-2">
        <span className={`min-w-0 text-chat-aside font-medium leading-snug ${
          status === 'running' ? 'argus-shimmer' : status === 'done' ? 'text-ink-strong' : status === 'pending' ? 'text-ink-dim' : 'text-ink-muted'
        }`}>
          {step.label}
        </span>
        {timing && <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-ink-dim">{timing}</span>}
      </div>
      {detail && <p className={`mt-0.5 text-chat-meta leading-snug ${status === 'failed' ? 'text-bad/90' : 'text-ink-muted'}`}>{detail}</p>}
    </>
  );

  // Lists (partners, similar folds): their first entries, each a click away
  const partners = status === 'done' ? result?.partners : undefined;
  const similar = status === 'done' ? result?.similar : undefined;
  const hits = similar ? [...similar.proteins, ...similar.experimental].slice(0, 3) : [];
  const listButton = 'max-w-full truncate h-6 px-2 rounded-md border border-line bg-canvas/40 text-[11.5px] text-ink hover:border-line-2 hover:text-ink-strong transition-colors';

  return (
    <li ref={rowRef} data-step={step.index} data-step-status={status} className="relative flex gap-2.5">
      {/* The rail: each step's mark, joined to the next by a line */}
      <div className="flex flex-col items-center pt-[3px]" aria-hidden="true">
        <StatusIcon status={status} />
        {!last && <span className="mt-1 mb-[-3px] w-px flex-1 bg-line" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? '' : 'pb-2.5'}`}>
        <span className="sr-only">Step {step.index}, {STATUS_WORDS[status]}: </span>
        {showable ? (
          <button
            key={flash}
            type="button"
            onClick={onShow}
            title="Show this in 3D"
            className={`-mx-2 -my-1 w-[calc(100%+1rem)] px-2 py-1 rounded-md text-left hover:bg-chip/50 transition-colors ${flash ? 'argus-flash' : ''}`}
          >
            {body}
          </button>
        ) : (
          <div key={flash} className={`-mx-2 -my-1 px-2 py-1 rounded-md ${flash ? 'argus-flash' : ''}`}>{body}</div>
        )}
        {partners && partners.partners.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {partners.partners.slice(0, 3).map(p => (
              p.bestComplex
                ? <button key={p.name} type="button" className={listButton} onClick={() => onOpenPartner(p, partners)} title={`Open ${p.bestComplex}, which holds both proteins`}>{p.name} · {p.bestComplex}</button>
                : <span key={p.name} className="h-6 px-2 inline-flex items-center rounded-md border border-line text-[11.5px] text-ink-muted">{p.name}</span>
            ))}
          </div>
        )}
        {similar && hits.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {hits.map(hit => (
              <button key={hit.structureId} type="button" className={listButton} onClick={() => onOpenSimilar(hit, similar)} title={`Open ${hit.label}`}>
                {hit.name} · {hit.probability.toFixed(2)}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
};

// A citation never starts a line or leaves its punctuation behind: it stays with the word before it
// (a no-break space, or a word joiner when there's no space) and the punctuation after it
const JOIN = '⁠';
type AnswerPart = ReturnType<typeof splitCitations>[number];
const gluedText = (parts: AnswerPart[], i: number) => {
  let text = (parts[i] as { text: string }).text;
  if (parts[i + 1] && 'cite' in parts[i + 1]) text = /\s$/.test(text) ? text.replace(/[ \t]+$/, ' ') : `${text}${JOIN}`;
  if (i > 0 && 'cite' in parts[i - 1] && /^[.,;:!?)\]]/.test(text)) text = `${JOIN}${text}`;
  return text;
};

/** A step-like row for the work around the steps: planning, writing up. */
const BusyRow: React.FC<{ label: string; detail?: string }> = ({ label, detail }) => (
  <li className="relative flex gap-2.5" data-step-status="running">
    <div className="pt-[3px]" aria-hidden="true"><StatusIcon status="running" /></div>
    <div className="min-w-0 flex-1">
      <span className="text-chat-aside font-medium leading-snug argus-shimmer">{label}</span>
      {detail && <p className="mt-0.5 text-chat-meta leading-snug text-ink-muted">{detail}</p>}
    </div>
  </li>
);

const InvestigationCard: React.FC<InvestigationCardProps> = ({
  state, live, structureTag, onStop, onRetry, onOpenStructure, onShowStep, onFocus, onOpenSimilar, onOpenPartner,
}) => {
  const { phase, steps, writeUp } = state;
  const working = phase === 'planning' || phase === 'running' || phase === 'writing';
  useTicking(working);
  const [traceOpen, setTraceOpen] = useState(false);
  const [flash, setFlash] = useState<{ index: number; seq: number } | null>(null);
  const rows = useRef(new Map<number, HTMLLIElement>());

  const finished = steps.filter(s => s.status === 'done').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const elapsed = (state.finishedAt ?? Date.now()) - state.startedAt;
  const statusText =
    phase === 'planning' ? 'Planning'
    : phase === 'running' ? `${finished} of ${steps.length} done`
    : phase === 'writing' ? 'Writing up'
    : phase === 'done' ? seconds(elapsed)
    : phase === 'stopped' ? 'Stopped'
    : 'Failed';
  const title = phase === 'done' ? writeUp?.title || state.title : state.title;
  const showTrace = phase !== 'done' || traceOpen;
  const answerParts = writeUp ? splitCitations(writeUp.answer) : [];

  // A citation: open the steps, bring its step into view, flash it, and show it in 3D
  const cite = (index: number) => {
    const step = steps.find(s => s.index === index);
    if (!step) return;
    setTraceOpen(true);
    setFlash(f => ({ index, seq: (f?.seq ?? 0) + 1 }));
    requestAnimationFrame(() => rows.current.get(index)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    if (live && step.status === 'done') onShowStep(step);
  };

  return (
    <div data-investigation data-phase={phase} className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3" /><path d="M7.5 15h9" /></svg>
        <span>Investigation</span>
        <span aria-live="polite" className="ml-auto tabular-nums">{statusText}</span>
      </div>
      <div className="mt-0.5 flex items-start gap-2">
        <h3 data-answer-title className={`min-w-0 text-chat-title font-semibold leading-snug tracking-tight ${title ? 'text-ink-strong' : 'text-ink-muted'}`}>
          {title || 'Planning the investigation'}
        </h3>
        {state.structure && (
          live || phase !== 'done'
            ? <span className="ml-auto mt-px flex-shrink-0 px-1.5 py-0.5 rounded-md border border-line bg-chip/70 text-[10.5px] font-semibold tracking-wide tabular-nums text-ink-strong">{structureTag}</span>
            : (
              <button type="button" onClick={onOpenStructure} title={`Open ${structureTag} again to see this investigation in 3D`} className="ml-auto mt-px flex-shrink-0 px-1.5 py-0.5 rounded-md border border-line bg-chip/70 text-[10.5px] font-semibold tracking-wide tabular-nums text-ink-strong hover:border-line-2 transition-colors">
                {structureTag} · View in 3D
              </button>
            )
        )}
      </div>
      {state.planSource === 'fallback' && (
        <p className="mt-1 text-chat-meta text-ink-dim">Planned from the question's wording: the AI couldn't plan this one.</p>
      )}
      {state.unavailable && (
        <p className="mt-1 text-chat-meta text-ink-dim">The plan named {state.unavailable}, which couldn't be opened, so this looks at {structureTag} instead.</p>
      )}

      {/* The answer, once written */}
      {phase === 'done' && writeUp && (
        <>
          <p className="mt-2 whitespace-pre-wrap break-words text-chat leading-relaxed text-ink" data-investigation-answer>
            {answerParts.map((part, i) =>
              'cite' in part ? (
                <React.Fragment key={i}>
                  <button
                    type="button"
                    data-cite={part.cite}
                    onClick={() => cite(part.cite)}
                    title={`Step ${part.cite}: ${steps.find(s => s.index === part.cite)?.label ?? ''}`}
                    className="inline-flex items-center justify-center align-[1px] min-w-[17px] h-[17px] px-1 mx-[1px] rounded-[5px] bg-chip text-[10.5px] font-semibold leading-none tabular-nums text-ink-muted hover:text-ink-strong hover:bg-line transition-colors"
                  >
                    {part.cite}
                  </button>
                  {'cite' in (answerParts[i + 1] ?? {}) ? JOIN : ''}
                </React.Fragment>
              ) : (
                <React.Fragment key={i}>{gluedText(answerParts, i)}</React.Fragment>
              )
            )}
          </p>
          {writeUp.caveat && <p className="mt-2 text-chat-meta leading-snug text-ink-dim">{writeUp.caveat}</p>}
          {writeUp.fallback && (
            <p className="mt-2 text-chat-meta leading-snug text-ink-dim">The AI couldn't write this up, so these are the step results as they came.</p>
          )}
          {writeUp.highlights.length > 0 && <MarkedParts highlights={writeUp.highlights} live={live} onFocus={onFocus} />}
        </>
      )}

      {phase === 'failed' && (
        <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-bad/30 bg-bad/[0.06] px-3 py-2.5">
          <p className="min-w-0 flex-1 text-chat-aside leading-relaxed text-ink">Couldn't finish the investigation: {state.error ?? 'something went wrong'}.</p>
          <button type="button" onClick={onRetry} className="flex-shrink-0 h-7 px-2.5 rounded-md border border-line bg-canvas/60 text-[12px] font-medium text-ink hover:border-line-2 hover:text-ink-strong transition-colors">
            Retry
          </button>
        </div>
      )}
      {phase === 'stopped' && (
        <p className="mt-2 text-chat-aside text-ink-muted">
          {steps.length ? `Stopped after ${finished} of ${steps.length} steps.` : 'Stopped before any step ran.'}
        </p>
      )}

      {/* Once done, the steps fold into one line */}
      {phase === 'done' && (
        <button
          type="button"
          data-trace-toggle
          aria-expanded={traceOpen}
          onClick={() => setTraceOpen(o => !o)}
          className="mt-3 -mx-2 w-[calc(100%+1rem)] h-8 px-2 flex items-center gap-2 rounded-md text-chat-meta text-ink-muted hover:bg-chip/50 hover:text-ink-strong transition-colors"
        >
          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-good/15 text-good flex items-center justify-center"><Tick /></span>
          <span className="min-w-0 truncate">
            Investigation complete · {steps.length} {steps.length === 1 ? 'step' : 'steps'}{failed ? `, ${failed} failed` : ''} · {seconds(elapsed)}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`ml-auto flex-shrink-0 transition-transform ${traceOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}

      {showTrace && (
        <ol className={`${phase === 'done' ? 'mt-2' : 'mt-3'} space-y-0`} aria-label="Steps">
          {phase === 'planning' && <BusyRow label="Choosing the tools for this question" detail={state.notice} />}
          {steps.map((step, i) => (
            <StepRow
              key={step.index}
              step={step}
              last={i === steps.length - 1 && phase !== 'writing'}
              live={live}
              flash={flash?.index === step.index ? flash.seq : 0}
              rowRef={el => { if (el) rows.current.set(step.index, el); else rows.current.delete(step.index); }}
              onShow={() => onShowStep(step)}
              onOpenSimilar={onOpenSimilar}
              onOpenPartner={onOpenPartner}
            />
          ))}
          {phase === 'writing' && <BusyRow label="Writing up the findings" detail={state.notice ?? 'From these results only'} />}
        </ol>
      )}

      {working && (
        <button
          type="button"
          data-stop
          onClick={onStop}
          className="mt-3 h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas/50 text-[12px] font-medium text-ink-muted hover:border-line-2 hover:text-ink-strong transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
          Stop
        </button>
      )}
    </div>
  );
};

export default InvestigationCard;
