import React from 'react';
import { percent, rangeText, rangesText, type EntryCoverage, type ExperimentalCoverage, type Range } from '../services/coverageService';

export type CoverageState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'entry'; proteins: EntryCoverage[] } // An experimental entry: the part of each protein it holds
  | { status: 'model'; experimental: ExperimentalCoverage | null; source?: { id: string; coverage: EntryCoverage | null } }; // An AlphaFold model

const MAX_PROTEINS = 6;
const MAX_RANGE_BUTTONS = 8;

/** The section's badge: the share of the protein shown (an entry with one protein) or resolved (a model). */
export const coverageBadge = (state: CoverageState | null): string | undefined => {
  if (state?.status === 'entry' && state.proteins.length === 1) return `${percent(state.proteins[0].present, state.proteins[0].length)}%`;
  if (state?.status === 'model' && state.experimental) return `${percent(state.experimental.resolved, state.experimental.length)}%`;
  return undefined;
};

/** The whole protein, 1 to its length, with the stretches present filled in. */
const Bar = ({ ranges, length, label }: { ranges: Range[]; length: number; label: string }) => (
  <div data-coverage-bar>
    <div role="img" aria-label={label} className="relative h-1.5 touch:h-2 rounded-full bg-line overflow-hidden">
      {ranges.map(([a, b]) => (
        <span key={a} className="absolute inset-y-0 bg-brand" style={{ left: `${((a - 1) / length) * 100}%`, width: `${Math.max(0.6, ((b - a + 1) / length) * 100)}%` }} />
      ))}
    </div>
    <div className="flex justify-between mt-0.5 text-[10px] touch:text-[11px] tabular-nums text-ink-dim" aria-hidden="true">
      <span>1</span>
      <span>{length}</span>
    </div>
  </div>
);

/** Stretches as buttons that select them in 3D (an AlphaFold model numbers its residues like UniProt). */
const RangeButtons = ({ ranges, kind, onSelect }: { ranges: Range[]; kind: string; onSelect?: (range: Range) => void }) => (
  <>
    {ranges.slice(0, MAX_RANGE_BUTTONS).map((r, i) => (
      <React.Fragment key={r[0]}>
        {i > 0 && ', '}
        {onSelect ? (
          <button
            type="button"
            data-coverage-range={`${kind}:${rangeText(r)}`}
            onClick={() => onSelect(r)}
            title={`Select residues ${rangeText(r)} and bring them into view`}
            // Padding gives each one something to hit between its neighbours, on a finger above all
            className="-mx-0.5 px-1 py-0.5 touch:px-1.5 touch:py-1.5 rounded underline decoration-line-2 underline-offset-2 hover:bg-chip/60 hover:text-brand-text hover:decoration-brand/50 transition-colors"
          >
            {rangeText(r)}
          </button>
        ) : rangeText(r)}
      </React.Fragment>
    ))}
    {ranges.length > MAX_RANGE_BUTTONS && <span className="text-ink-dim"> and {ranges.length - MAX_RANGE_BUTTONS} more</span>}
  </>
);

interface CoveragePanelProps {
  state: CoverageState;
  canOpenAlphaFold: (accession: string) => boolean;
  onOpenAlphaFold: (accession: string) => void;
  onSelect?: (range: Range) => void; // AlphaFold model: select a stretch
  onRetry: () => void;
}

/**
 * Coverage, in the inspector: on an experimental entry, which part of each protein it holds (resolved
 * residues, in UniProt numbering) and what is missing; on an AlphaFold model, which parts of the protein
 * experiments have resolved and which are known only from the prediction.
 */
const CoveragePanel: React.FC<CoveragePanelProps> = ({ state, canOpenAlphaFold, onOpenAlphaFold, onSelect, onRetry }) => {
  if (state.status === 'loading') {
    return (
      <div data-coverage-panel data-coverage-status="loading" className="flex items-center gap-2.5 py-1">
        <div className="w-4 h-4 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-ink-muted">Matching the residues to the whole protein…</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div data-coverage-panel data-coverage-status="error" className="space-y-2.5">
        <p className="text-xs leading-snug text-bad">Couldn't work out the coverage: {state.error}.</p>
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

  if (state.status === 'entry') {
    if (state.proteins.length === 0) {
      return <p data-coverage-panel data-coverage-status="entry" className="text-[11px] touch:text-[13px] leading-snug text-ink-muted">No chain here matches a UniProt protein.</p>;
    }
    return (
      <div data-coverage-panel data-coverage-status="entry" className="space-y-3 min-w-0">
        {state.proteins.slice(0, MAX_PROTEINS).map(p => (
          <div key={p.accession} data-coverage-protein={p.accession} className="space-y-1.5 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="min-w-0 truncate text-xs touch:text-[14px] font-semibold text-ink-strong" title={p.identifier}>{p.identifier}</span>
              <span className="flex-shrink-0 text-[10px] touch:text-[12px] text-ink-dim tabular-nums">{p.accession} · chain{p.chains.length > 1 ? 's' : ''} {p.chains.join(', ')}</span>
            </div>
            <Bar ranges={p.ranges} length={p.length} label={`Residues ${rangesText(p.ranges)} of ${p.length}`} />
            <p data-coverage-ranges className="text-[11px] touch:text-[13px] leading-snug text-ink tabular-nums">
              {p.missing.length === 0 ? `All ${p.length} residues are here.` : `Residues ${rangesText(p.ranges)} of ${p.length} · ${percent(p.present, p.length)}%`}
            </p>
            {p.missing.length > 0 && (
              <p data-coverage-missing className="text-[11px] touch:text-[13px] leading-snug text-ink-muted tabular-nums">Not in this entry: {rangesText(p.missing)}</p>
            )}
            {p.renumbered && <p className="text-[10px] touch:text-[12px] leading-snug text-ink-dim">UniProt numbering; this file numbers the residues differently.</p>}
            {p.missing.length > 0 && canOpenAlphaFold(p.accession) && (
              <button
                type="button"
                data-coverage-open-af={p.accession}
                onClick={() => onOpenAlphaFold(p.accession)}
                className="px-2.5 py-1 touch:py-2 rounded-md border border-line bg-input text-[11px] touch:text-[13px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
              >
                Open the AlphaFold model of all {p.length}
              </button>
            )}
          </div>
        ))}
        {state.proteins.length > MAX_PROTEINS && <p className="text-[10px] text-ink-dim">and {state.proteins.length - MAX_PROTEINS} more proteins</p>}
        <p className="pt-2 border-t border-line text-[10px] touch:text-[12px] leading-snug text-ink-dim">
          Residues resolved in this file, matched to UniProt positions (SIFTS). Residues the experiment didn't resolve don't count.
        </p>
      </div>
    );
  }

  const e = state.experimental;
  return (
    <div data-coverage-panel data-coverage-status="model" className="space-y-3 min-w-0">
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Resolved by experiments</p>
        {!e || e.entries === 0 ? (
          <p data-coverage-ranges className="text-[11px] touch:text-[13px] leading-snug text-ink">No PDB entry resolves any part of this protein: the whole model is a prediction.</p>
        ) : (
          <>
            <Bar ranges={e.ranges} length={e.length} label={`Resolved in PDB entries: residues ${rangesText(e.ranges)} of ${e.length}`} />
            <p data-coverage-ranges className="text-[11px] touch:text-[13px] leading-snug text-ink tabular-nums">
              Residues <RangeButtons ranges={e.ranges} kind="resolved" onSelect={onSelect} /> · {percent(e.resolved, e.length)}% · {e.entries} PDB entr{e.entries === 1 ? 'y' : 'ies'}
            </p>
            <p data-coverage-missing className="text-[11px] touch:text-[13px] leading-snug text-ink-muted tabular-nums">
              {e.missing.length === 0 ? 'Every residue is resolved in at least one entry.' : <>Only predicted: <RangeButtons ranges={e.missing} kind="predicted" onSelect={onSelect} /></>}
            </p>
          </>
        )}
      </div>
      {state.source && (
        <div className="space-y-1.5" data-coverage-source={state.source.id}>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">In {state.source.id}</p>
          {state.source.coverage ? (
            <>
              <Bar ranges={state.source.coverage.ranges} length={state.source.coverage.length} label={`${state.source.id}: residues ${rangesText(state.source.coverage.ranges)}`} />
              <p className="text-[11px] touch:text-[13px] leading-snug text-ink tabular-nums">
                Residues <RangeButtons ranges={state.source.coverage.ranges} kind="source" onSelect={onSelect} /> · {percent(state.source.coverage.present, state.source.coverage.length)}%
              </p>
            </>
          ) : (
            <p className="text-[11px] touch:text-[13px] leading-snug text-ink-muted">This protein isn't in {state.source.id}.</p>
          )}
        </div>
      )}
      <p className="pt-2 border-t border-line text-[10px] touch:text-[12px] leading-snug text-ink-dim">
        From PDBe-KB: the residues resolved in the best chain of each PDB entry of this protein. Pick a stretch to select it in the model.
      </p>
    </div>
  );
};

export default CoveragePanel;
