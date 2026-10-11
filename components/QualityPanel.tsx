import React from 'react';
import { METRIC_LABELS, formatValue, percentileSets, qualityHeadline, type QualityReport } from '../services/qualityService';
import { Explanation, Term, useExplain } from './Explain';

export type QualityState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; report: QualityReport };

/** The section's badge: the resolution, or the method when there is none (NMR). */
export const qualityBadge = (state: QualityState | null): string | undefined => {
  if (state?.status !== 'ready' || state.report.missing) return undefined;
  const q = state.report;
  return q.resolution !== null ? `${q.resolution} Å` : q.method === 'nmr' ? 'NMR' : undefined;
};

const rank = (p: number) => Math.round(p);
// "X-ray" never breaks at its hyphen on a narrow screen
const nb = (text: string) => text.replace(/X-ray/g, 'X‑ray');

/**
 * Structure quality, in the inspector: an experimental entry's method, resolution and R-free, and its
 * wwPDB validation scores, each with its percentile ranks against the archive (higher is better), as
 * the official validation report gives them.
 */
const QualityPanel: React.FC<{ state: QualityState; onRetry: () => void }> = ({ state, onRetry }) => {
  const explain = useExplain(); // What each metric means, a press on its name away
  if (state.status === 'loading') {
    return (
      <div data-quality-panel data-quality-status="loading" className="flex items-center gap-2.5 py-1">
        <div className="w-4 h-4 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-ink-muted">Reading the validation report…</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div data-quality-panel data-quality-status="error" className="space-y-2.5">
        <p className="text-xs leading-snug text-bad">Couldn't read the validation report: {state.error}.</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-2.5 py-1 rounded-md border border-line bg-input text-[11px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
  const q = state.report;
  if (q.missing) {
    return <p data-quality-panel data-quality-status="missing" className="text-[11px] touch:text-[13px] leading-snug text-ink-muted">This entry has no wwPDB validation report yet.</p>;
  }
  const sets = percentileSets(q.method);
  return (
    <div data-quality-panel data-quality-status="ready" className="space-y-3 min-w-0">
      <p data-quality-headline className="text-xs touch:text-[14px] font-semibold text-ink-strong tabular-nums">{nb(qualityHeadline(q))}</p>
      <div className="space-y-2.5">
        {q.metrics.map(m => {
          const label = METRIC_LABELS[m.key];
          return (
            <div key={m.key} data-quality-metric={m.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <Term {...explain.term(m.key)} className="min-w-0 truncate text-[11px] touch:text-[13px] font-medium text-ink">{label.name}</Term>
                <span className="flex-shrink-0 text-[11px] touch:text-[13px] tabular-nums text-ink-strong">{formatValue(m)}</span>
              </div>
              {explain.open === m.key && <Explanation id={explain.id(m.key)} className="mt-0.5">{label.hint}</Explanation>}
              {m.absolute !== null && (
                <>
                  <div className="mt-1 flex items-center gap-2">
                    <div role="img" aria-label={`Percentile ${rank(m.absolute)} of 100 among ${sets.absolute}`} className="relative flex-1 h-1.5 touch:h-2 rounded-full bg-line overflow-hidden">
                      <span className="absolute inset-y-0 left-0 bg-brand rounded-full" style={{ width: `${Math.max(1.5, m.absolute)}%` }} />
                    </div>
                    <span className="w-6 flex-shrink-0 text-right text-[11px] touch:text-[13px] tabular-nums text-ink-strong" title={`Percentile ${m.absolute}`}>{rank(m.absolute)}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] touch:text-[12px] leading-snug text-ink-dim tabular-nums">
                    {nb(`Percentile among ${sets.absolute}${m.absoluteOf ? ` (${m.absoluteOf.toLocaleString('en-US')})` : ''}`)}
                    {m.relative !== null ? nb(`; ${rank(m.relative)} among ${sets.relative}${m.relativeOf ? ` (${m.relativeOf.toLocaleString('en-US')})` : ''}`) : ''}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="pt-2 border-t border-line text-[10px] touch:text-[12px] leading-snug text-ink-dim">
        From the wwPDB validation report{q.created ? ` (${q.created})` : ''}. Percentile ranks run from 0 to 100; higher is better.{' '}
        <a
          href={`https://www.rcsb.org/structure/${q.id.toUpperCase()}`}
          target="_blank"
          rel="noopener noreferrer"
          data-quality-report-link
          className="underline decoration-line-2 underline-offset-2 hover:text-ink-strong transition-colors"
        >
          Full report on RCSB
        </a>
      </p>
    </div>
  );
};

export default QualityPanel;
