import React, { useMemo } from 'react';
import type { KnownVariant, VariantLensData, VariantSite } from '../types';
import {
  AM_BENIGN_MAX,
  AM_GRADIENT_CSS,
  AM_NO_DATA_COLOR,
  AM_PATHOGENIC_MIN,
  amColor,
  variantKey,
} from '../services/variantService';

export type VariantLensStatus = 'idle' | 'loading' | 'ready' | 'error';

interface VariantLensPanelProps {
  status: VariantLensStatus;
  data?: VariantLensData;
  error?: string;
  collapsed: boolean;
  focused: VariantSite | null;
  onToggleCollapsed: () => void;
  onClose: () => void;
  docked?: boolean; // Inside the inspector column, which supplies the header and the scrolling
  onRetry: () => void;
  onFocus: (site: VariantSite, label: string) => void;
}

interface Hotspot {
  key: string;
  label: string; // Chip text, e.g. "R248Q" or "HBB E7V"
  focusLabel: string; // 3D label text shown when focused
  title: string; // Hover details
  score?: number; // AlphaMissense score driving the chip dot
  extra: number; // Other substitutions reported at the same position
  site?: VariantSite;
}

const MAX_HOTSPOTS = 6;

const sameSite = (a: VariantSite | null, b?: VariantSite) =>
  !!a && !!b && a.chain === b.chain && a.resi === b.resi && a.icode === b.icode;

/** Structure numbering, e.g. "B6" — UniProt numbering can differ (HBB E7V is the textbook "E6V"). */
const siteLabel = (site?: VariantSite) => (site ? `${site.chain}${site.resi}${site.icode}` : '');

export const DnaIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m10 16 1.5 1.5" /><path d="m14 8-1.5-1.5" /><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993" />
    <path d="m16.5 10.5 1 1" /><path d="m17 6-2.891-2.891" /><path d="M2 15c6.667-6 13.333 0 20-6" />
    <path d="m20 9 .891.891" /><path d="M3.109 14.109 4 15" /><path d="m6.5 12.5 1 1" />
    <path d="m7 18 2.891 2.891" /><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993" />
  </svg>
);

/**
 * Variant Lens card: legend, per-protein summary and clickable disease-variant
 * hotspots for the AlphaMissense pathogenicity colouring.
 */
const VariantLensPanel: React.FC<VariantLensPanelProps> = ({
  status, data, error, collapsed: collapsedProp, focused, onToggleCollapsed, onClose, onRetry, onFocus, docked,
}) => {
  const collapsed = docked ? false : collapsedProp;
  const available = data?.proteins.filter(p => p.available) ?? [];
  const multiProtein = available.length > 1;

  const hotspots = useMemo<Hotspot[]>(() => {
    if (!data) return [];
    const groups: (Hotspot & { rank: number[] })[] = [];

    for (const protein of data.proteins) {
      if (!protein.available) continue;
      const name = protein.gene ?? protein.identifier.replace(/_HUMAN$/, '');
      const prefix = multiProtein ? `${name} ` : '';

      // One chip per position: positions with many reported disease variants are the hotspots
      const byPosition = new Map<number, KnownVariant[]>();
      for (const k of protein.knownVariants) {
        const list = byPosition.get(k.position) ?? [];
        list.push(k);
        byPosition.set(k.position, list);
      }
      for (const [position, variants] of byPosition) {
        const lead = variants[0]; // Already sorted by relevance in the service
        const diseases = [...new Set(variants.flatMap(v => v.diseaseNames))];
        const tags = [...new Set(variants.flatMap(v => v.tags))].slice(0, 3);
        const site = data.sites[`${protein.accession}|${position}`]?.[0];
        const score = lead.amScore;
        groups.push({
          key: `${protein.accession}|${position}`,
          label: `${prefix}${lead.wt}${position}${lead.alt}`,
          focusLabel: `${name} ${lead.wt}${position}${lead.alt}${score !== undefined ? ` · AM ${score.toFixed(2)}` : ''}${site ? ` · ${siteLabel(site)}` : ''}`,
          title: [
            `${name} ${lead.wt}${position}${lead.alt} (UniProt numbering${site ? `; residue ${siteLabel(site)} in this structure` : ''})`,
            score !== undefined ? `AlphaMissense ${score.toFixed(3)}` : 'No AlphaMissense score',
            diseases.length ? diseases.join('; ') : tags.join(', '),
            variants.length > 1 ? `Also reported: ${variants.slice(1, 6).map(v => `${v.wt}${v.position}${v.alt}`).join(', ')}` : '',
          ].filter(Boolean).join('\n'),
          score,
          extra: variants.length - 1,
          site,
          rank: [
            diseases.length > 0 ? 1 : 0,
            variants.filter(v => v.diseaseLinked).length,
            Math.max(...variants.map(v => v.amScore ?? 0)),
          ],
        });
      }
    }

    groups.sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1] || b.rank[2] - a.rank[2]);
    return groups.slice(0, MAX_HOTSPOTS);
  }, [data, multiProtein]);

  // Fallback when UniProt lists no variants: the most mutation-sensitive positions
  const sensitive = useMemo<Hotspot[]>(() => {
    if (!data || hotspots.length > 0) return [];
    const seen = new Set<string>();
    const out: Hotspot[] = [];
    for (const [key, sites] of Object.entries(data.sites)) {
      const site = sites[0];
      const rv = data.residues[variantKey(site.chain, site.resi, site.icode)];
      if (!rv || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        label: `${multiProtein ? `${rv.protein} ` : ''}${rv.wt}${rv.position}`,
        focusLabel: `${rv.protein} ${rv.wt}${rv.position} · mean AM ${rv.mean.toFixed(2)} · ${siteLabel(site)}`,
        title: `${rv.protein} ${rv.wt}${rv.position} (residue ${siteLabel(site)} in this structure)\nMean AlphaMissense ${rv.mean.toFixed(3)}\nWorst: ${rv.wt}${rv.position}${rv.worstAlt} (${rv.worstScore.toFixed(3)})`,
        score: rv.mean,
        extra: 0,
        site,
      });
    }
    return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, MAX_HOTSPOTS);
  }, [data, hotspots.length, multiProtein]);

  const mismatchCount = data ? Object.keys(data.mismatches).length : 0;
  const chips = hotspots.length > 0 ? hotspots : sensitive;

  return (
    // Capped to the viewer's height so the header (collapse / exit) stays reachable on short screens
    <div className={docked ? 'flex flex-col min-w-0' : 'absolute bottom-4 left-4 z-20 w-[300px] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] flex flex-col bg-canvas/90 backdrop-blur-md border border-line rounded-xl shadow-overlay animate-argus-fade-in pointer-events-auto'}>
      {/* Header */}
      <div className={`${docked ? 'hidden' : 'flex'} flex-shrink-0 items-center justify-between gap-2 px-3 py-2 bg-surface/60 rounded-t-xl ${collapsed ? 'rounded-b-xl' : 'border-b border-line'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <DnaIcon className="w-3.5 h-3.5 text-brand-fg flex-shrink-0" />
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Variant Lens</span>
          <span className="text-[10px] font-medium text-ink-dim truncate">· AlphaMissense</span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onToggleCollapsed}
            className="p-1 rounded text-ink-dim hover:text-ink transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand Variant Lens' : 'Collapse Variant Lens'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${collapsed ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-dim hover:text-brand-text transition-colors"
            title="Exit Variant Lens"
            aria-label="Exit Variant Lens"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className={docked ? 'space-y-3' : 'p-3 space-y-3 min-h-0 max-h-[42vh] overflow-y-auto'}>
          {(status === 'loading' || status === 'idle') && (
            <div className="flex items-center gap-2.5 py-1">
              <div className="w-4 h-4 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0"></div>
              <span className="text-xs text-ink-muted">Mapping residues to UniProt and loading AlphaMissense…</span>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-2">
              <p className="text-xs text-bad">Couldn't load variant data{error ? ` (${error})` : ''}.</p>
              <button
                onClick={onRetry}
                className="px-2.5 py-1 rounded-md border border-line bg-input text-[11px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'ready' && data && data.proteins.length === 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-ink">
                {data.skipped.length > 0 ? 'No human proteins in this entry.' : 'No UniProt mapping found for this entry.'}
              </p>
              <p className="text-[11px] leading-snug text-ink-muted">
                AlphaMissense covers the human proteome only
                {data.skipped.length > 0 && ` — this structure contains ${data.skipped.slice(0, 3).map(s => s.identifier).join(', ')}`}.
              </p>
            </div>
          )}

          {status === 'ready' && data && data.proteins.length > 0 && (
            <>
              {/* Proteins */}
              <div className="space-y-2">
                {data.proteins.map(p => (
                  <div key={p.accession} className="flex items-start justify-between gap-3" title={p.proteinName}>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-ink-strong tracking-tight">{p.gene ?? p.identifier}</span>
                        {p.proteinName && <span className="sr-only">{p.proteinName}</span>}
                        <a
                          href={`https://alphafold.ebi.ac.uk/entry/${p.accession}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] font-medium tabular-nums text-ink-dim hover:text-brand-text transition-colors"
                        >
                          {p.accession}
                        </a>
                      </div>
                      <p className="text-[10px] text-ink-muted truncate">
                        Chain{p.chains.length > 1 ? 's' : ''} {p.chains.join(', ')}
                        {p.available && ` · ${p.mappedResidues} residues`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {p.available && p.mappedResidues > 0 ? (
                        <>
                          <div className="text-xs font-semibold tabular-nums text-ink">
                            {Math.round((100 * p.pathogenicResidues) / p.mappedResidues)}%
                          </div>
                          <div className="text-[10px] text-ink-dim">Likely harmful</div>
                        </>
                      ) : (
                        <span className="text-[10px] text-ink-dim">{p.available ? 'Not observed' : 'No AM data'}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Legend */}
              <div>
                <div className="relative h-2 rounded-full" style={{ background: AM_GRADIENT_CSS }}>
                  <span className="absolute -top-0.5 -bottom-0.5 w-px bg-canvas/80" style={{ left: `${AM_BENIGN_MAX * 100}%` }} />
                  <span className="absolute -top-0.5 -bottom-0.5 w-px bg-canvas/80" style={{ left: `${AM_PATHOGENIC_MIN * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px] font-medium text-ink-muted">
                  <span>Benign</span>
                  <span>Ambiguous</span>
                  <span>Pathogenic</span>
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-ink-dim flex items-start gap-1.5">
                  <span className="inline-block w-2 h-2 mt-0.5 rounded-sm flex-shrink-0" style={{ background: AM_NO_DATA_COLOR }} />
                  <span>Mean predicted pathogenicity of all 19 substitutions per residue; grey = no prediction.</span>
                </p>
              </div>

              {/* Hotspots */}
              {chips.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-ink-muted mb-1.5">
                    {hotspots.length > 0 ? 'Known disease variants' : 'Most sensitive positions'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map(h => {
                      const isFocused = sameSite(focused, h.site);
                      return (
                        <button
                          key={h.key}
                          onClick={() => h.site && onFocus(h.site, h.focusLabel)}
                          disabled={!h.site}
                          title={h.title}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 touch:px-2.5 touch:py-1.5 rounded-md border text-[11px] touch:text-[12.5px] font-medium tabular-nums transition-colors disabled:opacity-50 disabled:cursor-default ${
                            isFocused
                              ? 'border-ink/50 bg-chip text-ink-strong'
                              : 'border-line bg-input text-ink hover:border-brand/40 hover:text-brand-text'
                          }`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: h.score !== undefined ? amColor(h.score) : AM_NO_DATA_COLOR }}
                          />
                          {h.label}
                          {h.extra > 0 && <span className="text-[10px] text-ink-dim">+{h.extra}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-ink-dim">
                    {hotspots.length > 0
                      ? 'From UniProt. Dot = AlphaMissense score of that substitution.'
                      : 'Highest mean AlphaMissense scores in this structure.'}
                    {' '}<span className="touch:hidden">Click</span><span className="hidden touch:inline">Tap</span> one to focus it.
                  </p>
                </div>
              )}

              {mismatchCount > 0 && (
                <p className="text-[10px] leading-snug text-warn">
                  {mismatchCount} residue{mismatchCount > 1 ? 's' : ''} in this structure differ{mismatchCount > 1 ? '' : 's'} from the UniProt
                  sequence (engineered or disease mutant) — <span className="touch:hidden">hover over</span><span className="hidden touch:inline">tap</span> a residue in 3D to see which.
                </p>
              )}

              {/* Attribution & caveat */}
              <p className="pt-2 border-t border-line text-[10px] leading-snug text-ink-dim">
                Predictions, not diagnoses — not for clinical use. AlphaMissense (Cheng et al., Science 2023) via{' '}
                <a href="https://alphafold.ebi.ac.uk/" target="_blank" rel="noreferrer" className="underline decoration-line-2 hover:text-brand-text">AlphaFold DB</a>
                {' '}· CC BY 4.0 · variants from UniProt · mapping by PDBe SIFTS.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default VariantLensPanel;
