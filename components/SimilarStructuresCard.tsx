import React, { useState } from 'react';
import type { ProteinAnalysis, SimilarSearchResult, SimilarStructureHit } from '../types';

interface SimilarStructuresCardProps {
  result: SimilarSearchResult;
  origin: ProteinAnalysis; // What was on screen when the search ran
  currentStructureId?: string; // Highlights the hit that is open
  onOpen: (hit: SimilarStructureHit) => void;
  onBack: () => void;
}

const INITIAL_ROWS = 6;

/**
 * Foldseek results inside a chat message: similar protein families (AlphaFold DB)
 * and experimental structures of other proteins (PDB). Clicking a row opens it.
 */
const SimilarStructuresCard: React.FC<SimilarStructuresCardProps> = ({ result, origin, currentStructureId, onOpen, onBack }) => {
  const [tab, setTab] = useState<'proteins' | 'experimental'>(result.proteins.length > 0 ? 'proteins' : 'experimental');
  const [expanded, setExpanded] = useState(false);

  const rows = tab === 'proteins' ? result.proteins : result.experimental;
  const visible = expanded ? rows : rows.slice(0, INITIAL_ROWS);
  const isAway = currentStructureId && currentStructureId.toUpperCase() !== origin.pdbId.toUpperCase();

  const selectTab = (next: 'proteins' | 'experimental') => {
    setTab(next);
    setExpanded(false);
  };

  return (
    <div className="mt-4 mb-1 bg-canvas rounded-xl border border-line shadow-quiz overflow-hidden">
      {/* Header */}
      <div className="bg-surface px-4 pt-3 pb-2.5 border-b border-line">
        <div className="flex items-center justify-between gap-2">
          {/* Same feature chip as the quiz card's "Quick Check" */}
          <span className="bg-brand/10 text-brand-fg text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-[0.18em] border border-brand/40">
            Similar structures
          </span>
          <span className="text-[10px] font-medium text-ink-dim">Foldseek</span>
        </div>
        <p className="mt-1 text-xs text-ink">
          Shape matches for <span className="font-semibold text-ink-strong">{result.queryLabel}</span>
        </p>

        <div className="mt-2.5 inline-flex rounded-lg border border-line bg-canvas p-0.5" role="tablist">
          {(['proteins', 'experimental'] as const).map(id => {
            const count = id === 'proteins' ? result.proteins.length : result.experimental.length;
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  active ? 'bg-chip text-ink-strong' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {id === 'proteins' ? 'Proteins' : 'Experimental'}
                <span className="ml-1 tabular-nums text-ink-dim">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      <div className="p-2">
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-muted">
            {tab === 'proteins' ? 'No similar proteins in AlphaFold DB.' : 'No experimental structures of other proteins with this fold.'}
          </p>
        ) : (
          <div className="space-y-1">
            {visible.map(hit => {
              const isOpen = currentStructureId?.toUpperCase() === hit.structureId.toUpperCase();
              const range = hit.identityRange[0] !== hit.identityRange[1] && hit.members > 1;
              return (
                <button
                  key={hit.structureId}
                  onClick={() => onOpen(hit)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                    isOpen ? 'border-brand/50 bg-brand/10' : 'border-transparent hover:border-line hover:bg-chip'
                  }`}
                  title={`Open ${hit.structureId}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-semibold text-ink-strong leading-snug line-clamp-2">{hit.name}</span>
                    <span className="flex-shrink-0 mt-0.5 text-[10px] font-semibold tabular-nums tracking-wide text-brand-fg">{hit.label}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ink-muted">
                    {hit.organism && <span className="italic">{hit.organism}</span>}
                    {hit.organism && <span className="text-ink-dim">·</span>}
                    <span className="tabular-nums">{Math.round(hit.identity)}% identical</span>
                    {hit.members > 1 && (
                      <>
                        <span className="text-ink-dim">·</span>
                        <span className="tabular-nums">
                          {tab === 'proteins' ? `${hit.members} species` : `${hit.members} entries`}
                          {range ? ` (${Math.round(hit.identityRange[0])}–${Math.round(hit.identityRange[1])}%)` : ''}
                        </span>
                      </>
                    )}
                    {hit.sameProtein && (
                      <span className="ml-0.5 px-1.5 py-px rounded border border-line text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                        Same protein
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {rows.length > INITIAL_ROWS && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-1 w-full px-2.5 py-1.5 rounded-md text-[11px] font-medium text-ink-muted hover:text-brand-text hover:bg-chip transition-colors text-left"
          >
            {expanded ? 'Show fewer' : `Show ${rows.length - INITIAL_ROWS} more`}
          </button>
        )}

        {tab === 'experimental' && result.sameProteinStructures > 0 && (
          <p className="px-2.5 pt-1.5 text-[10px] leading-snug text-ink-dim">
            {result.sameProteinStructures} more structures of this protein or close relatives (≥80% identical) not listed.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-line bg-surface flex items-center justify-between gap-3">
        <p className="text-[10px] leading-snug text-ink-dim">
          Same shape at low sequence identity usually means a distant relative.
        </p>
        {isAway && (
          <button
            onClick={onBack}
            className="flex-shrink-0 px-2 py-1 rounded-md border border-line bg-canvas text-[11px] font-medium text-ink hover:text-brand-text hover:border-brand/40 transition-colors"
          >
            Back to {/^ESM-/i.test(origin.pdbId) ? 'prediction' : /^COFOLD-/i.test(origin.pdbId) ? 'co-folded complex' : origin.pdbId}
          </button>
        )}
      </div>
    </div>
  );
};

export default SimilarStructuresCard;
