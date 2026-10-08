import React, { useEffect, useState } from 'react';
import type { PocketPrediction } from '../types';
import { POCKET_COLORS, shownPockets, type PocketProgress } from '../services/pocketService';

export type PocketRadarStatus = 'idle' | 'loading' | 'computing' | 'ready' | 'error' | 'unsupported';

export interface PocketRadarState {
  status: PocketRadarStatus;
  data?: PocketPrediction;
  error?: string;
  progress?: PocketProgress;
  upgraded?: boolean; // The quick result was replaced by the conservation-aware one while open
}

interface PocketRadarPanelProps {
  state: PocketRadarState;
  collapsed: boolean;
  focusedRank: number | null;
  isSurface: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  onRetry: () => void;
  onFocus: (rank: number) => void;
  onToggleSurface: () => void;
  onCofold?: (rank: number) => void; // "Co-fold here": steer a molecule into the focused pocket (when co-folding is set up)
  docked?: boolean; // Inside the inspector column, which supplies the header and the scrolling
}

export const RadarIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="m12 12 5.5-5.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);

const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Pocket Radar card: P2Rank's predicted ligand-binding pockets, each in its own colour on the
 * structure, with probability, size and any ligand already bound there. Click a pocket to focus it.
 */
const PocketRadarPanel: React.FC<PocketRadarPanelProps> = ({
  state, collapsed: collapsedProp, focusedRank, isSurface, onToggleCollapsed, onClose, onRetry, onFocus, onToggleSurface, onCofold, docked,
}) => {
  const collapsed = docked ? false : collapsedProp;
  const { status, data, error, progress, upgraded } = state;
  const waiting = status === 'idle' || status === 'loading' || status === 'computing';

  // Elapsed time while PrankWeb computes (the status only arrives every few seconds)
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!waiting) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const pockets = data ? shownPockets(data) : [];
  const hidden = data ? data.pockets.length - pockets.length : 0;
  const multiChain = new Set(pockets.flatMap(p => p.residues.map(r => r.chain))).size > 1;

  return (
    // Docked in the inspector, or (on a phone) a card over the canvas
    <div className={docked ? 'flex flex-col min-w-0' : 'absolute bottom-4 left-4 z-20 w-[300px] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] flex flex-col bg-canvas/90 backdrop-blur-md border border-line rounded-xl shadow-overlay animate-argus-fade-in pointer-events-auto'}>
      {/* Header (the inspector supplies its own) */}
      <div className={`${docked ? 'hidden' : 'flex'} flex-shrink-0 items-center justify-between gap-2 px-3 py-2 bg-surface/60 rounded-t-xl ${collapsed ? 'rounded-b-xl' : 'border-b border-line'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <RadarIcon className="w-3.5 h-3.5 text-brand-fg flex-shrink-0" />
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Pocket Radar</span>
          <span className="text-[9px] font-medium text-ink-dim truncate">· P2Rank</span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onToggleCollapsed}
            className="p-1 rounded text-ink-dim hover:text-ink transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand Pocket Radar' : 'Collapse Pocket Radar'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${collapsed ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-dim hover:text-brand-text transition-colors"
            title="Exit Pocket Radar"
            aria-label="Exit Pocket Radar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className={docked ? 'space-y-3' : 'p-3 space-y-3 min-h-0 max-h-[42vh] overflow-y-auto'}>
          {waiting && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 py-1">
                <div className="w-4 h-4 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0"></div>
                <span className="text-xs text-ink-muted">
                  {status === 'computing'
                    ? progress?.status === 'queued' ? 'Queued at PrankWeb…' : 'P2Rank is analysing this structure…'
                    : 'Asking PrankWeb for predicted pockets…'}
                </span>
                {status === 'computing' && <span className="ml-auto text-[10px] tabular-nums text-ink-dim">{formatElapsed(elapsed)}</span>}
              </div>
              {status === 'computing' && (
                <p className="text-[10px] leading-snug text-ink-dim">
                  {progress?.quick
                    ? 'The conservation-aware model is still running, so the quick model was requested too.'
                    : 'First predictions for a structure usually take under a minute; after that they load instantly.'}
                </p>
              )}
            </div>
          )}

          {status === 'unsupported' && (
            <p className="text-xs leading-snug text-ink-muted">
              Pocket Radar works on PDB entries and AlphaFold models. Pocket predictions for folded sequences aren't available yet.
            </p>
          )}

          {status === 'error' && (
            <div className="space-y-2">
              <p className="text-xs text-bad">Couldn't get pocket predictions{error ? ` (${error})` : ''}.</p>
              <button
                onClick={onRetry}
                className="px-2.5 py-1 rounded-md border border-line bg-input text-[11px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {status === 'ready' && data && pockets.length === 0 && (
            <p className="text-xs text-ink-muted">P2Rank found no pockets in this structure.</p>
          )}

          {status === 'ready' && data && pockets.length > 0 && (
            <>
              {/* Pockets, best first; colours match the structure */}
              <div className="space-y-1">
                {pockets.map((p, i) => {
                  const isFocused = focusedRank === p.rank;
                  const percent = Math.round(p.probability * 100);
                  const chains = [...new Set(p.residues.map(r => r.chain))];
                  return (
                    <button
                      key={p.rank}
                      onClick={() => onFocus(p.rank)}
                      aria-pressed={isFocused}
                      title={`Pocket ${p.rank}: ${percent}% predicted probability of binding a ligand${p.ligands.length ? `; ${p.ligands.join(', ')} sits here in the structure on screen` : ''}. Click to ${isFocused ? 'release' : 'focus'}.`}
                      className={`w-full text-left px-2 py-1.5 rounded-md border transition-colors ${
                        isFocused ? 'border-ink/40 bg-chip' : 'border-transparent hover:border-line hover:bg-chip/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: POCKET_COLORS[i] }} />
                        <span className="text-xs font-semibold text-ink-strong tracking-tight">Pocket {p.rank}</span>
                        {p.ligands.length > 0 && (
                          <span className="min-w-0 truncate text-[10px] font-medium tabular-nums text-ink-muted border border-line-2 rounded px-1 leading-4">
                            {p.ligands.join(' · ')}
                          </span>
                        )}
                        <span className="ml-auto text-xs font-semibold tabular-nums text-ink">{percent}%</span>
                      </div>
                      <div className="mt-1 ml-[18px] hidden sm:flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-line overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(percent, 2)}%`, background: POCKET_COLORS[i] }} />
                        </div>
                        <span className="text-[10px] text-ink-dim tabular-nums whitespace-nowrap">
                          {p.residues.length} residues{multiChain ? ` · ${chains.length > 1 ? 'chains' : 'chain'} ${chains.join(', ')}` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {onCofold && focusedRank !== null && pockets.some(p => p.rank === focusedRank) && (
                <button
                  onClick={() => onCofold(focusedRank)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-brand/40 bg-brand/10 text-[11px] font-semibold text-brand-text hover:bg-brand/15 transition-colors"
                  title={`Open Co-fold with Pocket ${focusedRank} chosen: Boltz-2 is told to bind the molecule among its residues`}
                >
                  Co-fold a molecule into Pocket {focusedRank}
                </button>
              )}

              <div className="flex items-start justify-end sm:justify-between gap-3">
                <p className="hidden sm:block text-[10px] leading-snug text-ink-dim">
                  % = predicted probability of binding a ligand
                  {hidden > 0 && ` · ${hidden} weaker pocket${hidden > 1 ? 's' : ''} not shown`}. Click a pocket to focus it.
                </p>
                <button
                  onClick={onToggleSurface}
                  className="flex-shrink-0 px-2 py-0.5 touch:px-3 touch:py-2 rounded-md border border-line bg-input text-[10px] touch:text-[12.5px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
                  title={isSurface ? 'Back to the cartoon view' : 'Show the molecular surface, where pockets appear as coloured cavities'}
                >
                  {isSurface ? 'Cartoon view' : 'Surface view'}
                </button>
              </div>

              {data.model === 'quick' ? (
                <p className="text-[10px] leading-snug text-warn/80">
                  Quick model (without conservation). PrankWeb's conservation-aware prediction replaces it automatically if it finishes while this panel is open.
                </p>
              ) : upgraded ? (
                <p className="text-[10px] leading-snug text-ink-muted">Updated with the conservation-aware prediction.</p>
              ) : null}

              {/* Attribution & caveat */}
              <p className="pt-2 border-t border-line text-[9px] leading-snug text-ink-dim">
                Predicted pockets, not confirmed binding sites. P2Rank{data.p2rankVersion ? ` ${data.p2rankVersion}` : ''}
                {data.model === 'conservation' ? ' with conservation' : ''} via{' '}
                <a href={data.url} target="_blank" rel="noreferrer" className="underline decoration-line-2 hover:text-brand-text">PrankWeb</a>
                {' '}(ELIXIR CZ).
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default PocketRadarPanel;
