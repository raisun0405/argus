import React, { useState } from 'react';
import { NetworkIcon } from './icons';
import type { InteractionPartner, PartnerSearchResult, ProteinAnalysis } from '../types';

interface PartnersCardProps {
  result: PartnerSearchResult;
  origin: ProteinAnalysis; // What was on screen when the search ran
  currentStructureId?: string; // Marks the complex that is open
  onOpenComplex: (partner: InteractionPartner) => void;
  onBack: () => void;
}

const INITIAL_ROWS = 6;

/**
 * STRING interaction partners inside a chat message, best first. Partners that have been solved
 * together with the protein offer the best-resolved complex, which opens with the interface marked.
 */
const PartnersCard: React.FC<PartnersCardProps> = ({ result, origin, currentStructureId, onOpenComplex, onBack }) => {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? result.partners : result.partners.slice(0, INITIAL_ROWS);
  const isAway = currentStructureId && currentStructureId.toUpperCase() !== origin.pdbId.toUpperCase();
  const searchedIn = result.query.structureKeys[0];

  return (
    <div className="mt-4 mb-1 bg-canvas rounded-xl border border-line shadow-quiz overflow-hidden">
      {/* Header */}
      <div className="bg-surface px-4 pt-3 pb-2.5 border-b border-line">
        {/* The same heading as the quiz card's "Quick check": the tool's icon and name, the source at the right */}
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
          <NetworkIcon size={12} />
          Interaction partners
          <span className="ml-auto text-[10px]">STRING</span>
        </p>
        <p className="mt-1 text-xs text-ink">
          Proteins that work with <span className="font-semibold text-ink-strong">{result.name}</span>, by confidence
        </p>
      </div>

      {/* Rows */}
      <div className="p-2">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-muted">STRING lists no partners of medium confidence (0.4) or higher.</p>
        ) : (
          <div className="space-y-1">
            {rows.map(partner => {
              const isOpen = Boolean(partner.bestComplex) && currentStructureId?.toUpperCase() === partner.bestComplex;
              const chainsHere = partner.accession ? result.query.chainsHere[partner.accession] : undefined;
              const more = (partner.complexes ?? 0) - 1;
              return (
                <div
                  key={partner.accession ?? partner.name}
                  className={`px-2.5 py-2 rounded-lg border transition-colors ${isOpen ? 'border-brand/50 bg-brand/10' : 'border-transparent hover:border-line hover:bg-chip'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[13px] font-semibold text-ink-strong leading-snug">{partner.name}</span>
                      {partner.description && (
                        <span className="ml-1.5 text-[11px] text-ink-muted leading-snug" title={partner.description}>
                          {partner.description.length > 48 ? `${partner.description.slice(0, 46)}…` : partner.description}
                        </span>
                      )}
                    </div>
                    <span className="flex-shrink-0 mt-0.5 text-[11px] font-semibold tabular-nums text-ink" title="STRING combined confidence (0-1)">
                      {partner.score.toFixed(3)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-muted">
                    {partner.evidence.map((label, i) => (
                      <React.Fragment key={label}>
                        {i > 0 && <span className="text-ink-dim">·</span>}
                        <span>{label}</span>
                      </React.Fragment>
                    ))}
                    {chainsHere && chainsHere.length > 0 && (
                      <span className="ml-0.5 px-1.5 py-px rounded border border-line text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-dim">
                        In {searchedIn} · {chainsHere.length > 1 ? 'chains' : 'chain'} {chainsHere.join(', ')}
                      </span>
                    )}
                    <span className="ml-auto">
                      {partner.bestComplex ? (
                        <button
                          onClick={() => onOpenComplex(partner)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium tabular-nums transition-colors ${
                            isOpen ? 'border-brand/50 text-brand-text' : 'border-line bg-input text-ink hover:border-brand/40 hover:text-brand-text'
                          }`}
                          title={`Open ${partner.bestComplex}${partner.bestComplexTitle ? ` — ${partner.bestComplexTitle.toLowerCase()}` : ''}${partner.bestComplexResolution ? ` (${partner.bestComplexResolution} Å)` : ''}, with the interface marked. ${partner.complexes} PDB ${partner.complexes === 1 ? 'entry holds' : 'entries hold'} both proteins.`}
                        >
                          View complex {partner.bestComplex}
                          {more > 0 && <span className="text-[10px] text-ink-dim">+{more}</span>}
                        </button>
                      ) : partner.complexes === 0 ? (
                        <span className="text-[10px] text-ink-dim">No solved complex</span>
                      ) : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {result.partners.length > INITIAL_ROWS && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-1 w-full px-2.5 py-1.5 rounded-md text-[11px] font-medium text-ink-muted hover:text-brand-text hover:bg-chip transition-colors text-left"
          >
            {expanded ? 'Show fewer' : `Show ${result.partners.length - INITIAL_ROWS} more`}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-line bg-surface flex items-center justify-between gap-3">
        <p className="text-[10px] leading-snug text-ink-dim">
          Confidence combines experiments, curated databases, co-expression and literature. Data:{' '}
          <a href={result.stringUrl} target="_blank" rel="noreferrer" className="underline decoration-line-2 hover:text-brand-text">STRING</a>
          {' '}(CC BY 4.0) · complexes from RCSB PDB.
        </p>
        {isAway && (
          <button
            onClick={onBack}
            className="flex-shrink-0 px-2 py-1 rounded-md border border-line bg-canvas text-[11px] font-medium text-ink hover:text-brand-text hover:border-brand/40 transition-colors"
          >
            Back to {/^ESM-/i.test(origin.pdbId) ? 'prediction' : origin.pdbId}
          </button>
        )}
      </div>
    </div>
  );
};

export default PartnersCard;
