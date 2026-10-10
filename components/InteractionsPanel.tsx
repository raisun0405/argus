import React from 'react';
import { INTERACTION_LABELS, INTERACTION_ORDER, partnerLabel, type InteractionType, type LigandSite } from '../services/interactionService';

// One colour per interaction type, for the dashed lines on the structure and the key in the panel
export const INTERACTION_COLORS: Record<InteractionType, string> = {
  hbond: '#60a5fa',
  salt_bridge: '#f59e0b',
  pi_stacking: '#a78bfa',
  pi_cation: '#f472b6',
  halogen: '#22d3ee',
  metal: '#2dd4bf',
  water_bridge: '#7dd3fc',
  hydrophobic: '#a3a3a3',
};

// Many contacts of these kinds: listed compactly, as residue chips
const COMPACT = new Set<InteractionType>(['hydrophobic', 'water_bridge']);
const MAX_LIGAND_CHIPS = 6;

interface InteractionsPanelProps {
  sites: LigandSite[];
  selected: LigandSite | null;
  focused: number | null; // Index into selected.interactions
  collapsed: boolean;
  names?: Record<string, string>; // Display names by site key (a co-folded ligand's name)
  onSelect: (key: string) => void;
  onFocus: (index: number) => void;
  onToggleCollapsed: () => void;
  onClose: () => void;
  docked?: boolean; // Inside the inspector column, which supplies the header and the scrolling
}

// Two atoms joined by a dashed line: a contact, drawn the way the overlay draws it. Not three linked
// nodes (the universal share icon) and no ring (Co-fold's molecule icon has one).
export const InteractionsIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4" cy="12" r="2.6" fill="currentColor" stroke="none" />
    <path d="M7.2 12h9.6" strokeDasharray="2.2 1.5" strokeLinecap="butt" />
    <circle cx="20" cy="12" r="2.6" fill="currentColor" stroke="none" />
  </svg>
);

const siteLabel = (site: LigandSite, names?: Record<string, string>) => names?.[site.key] ?? (site.name !== site.code ? site.name : site.code);

/**
 * Interactions card: what holds the chosen ligand (hydrogen bonds, salt bridges, stacking, metal
 * coordination, water bridges, hydrophobic contacts), in the colours of the dashed lines on the
 * structure. Click an interaction to focus it.
 */
const InteractionsPanel: React.FC<InteractionsPanelProps> = ({ sites, selected, focused, collapsed: collapsedProp, names, onSelect, onFocus, onToggleCollapsed, onClose, docked }) => {
  const collapsed = docked ? false : collapsedProp;
  const multiChain = selected ? new Set(selected.interactions.map(i => i.partner.chain)).size > 1 : false;
  const groups = selected
    ? INTERACTION_ORDER.map(type => ({ type, items: selected.interactions.map((interaction, index) => ({ interaction, index })).filter(x => x.interaction.type === type) }))
        .filter(g => g.items.length > 0)
    : [];
  const residues = selected ? new Set(selected.interactions.map(i => `${i.partner.chain}|${i.partner.resi}|${i.partner.icode}`)).size : 0;

  return (
    // Same slot and card as Pocket Radar; capped to the viewer's height so the header stays reachable
    <div className={docked ? 'flex flex-col min-w-0' : 'absolute bottom-4 left-4 z-20 w-[300px] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] flex flex-col bg-canvas/90 backdrop-blur-md border border-line rounded-xl shadow-overlay animate-argus-fade-in pointer-events-auto'}>
      {/* Header */}
      <div className={`${docked ? 'hidden' : 'flex'} flex-shrink-0 items-center justify-between gap-2 px-3 py-2 bg-surface/60 rounded-t-xl ${collapsed ? 'rounded-b-xl' : 'border-b border-line'}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <InteractionsIcon className="w-3.5 h-3.5 text-brand-fg flex-shrink-0" />
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Interactions</span>
          {selected && <span className="text-[10px] font-medium text-ink-dim truncate">· {siteLabel(selected, names)}</span>}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={onToggleCollapsed}
            className="p-1 rounded text-ink-dim hover:text-ink transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand Interactions' : 'Collapse Interactions'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${collapsed ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-ink-dim hover:text-brand-text transition-colors"
            title="Exit Interactions"
            aria-label="Exit Interactions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className={docked ? 'space-y-3' : 'p-3 space-y-3 min-h-0 max-h-[42vh] overflow-y-auto'}>
          {sites.length === 0 && <p className="text-xs text-ink-muted">This structure holds no ligand to analyse.</p>}

          {/* Ligand picker */}
          {sites.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {sites.slice(0, MAX_LIGAND_CHIPS).map(site => {
                const active = selected?.key === site.key;
                return (
                  <button
                    key={site.key}
                    onClick={() => onSelect(site.key)}
                    aria-pressed={active}
                    title={`${site.code} ${site.chain}:${site.resi}${site.icode} · ${site.interactions.length} interaction${site.interactions.length === 1 ? '' : 's'}`}
                    className={`px-1.5 py-0.5 touch:px-2.5 touch:py-1.5 rounded border text-[11px] touch:text-[12.5px] font-medium transition-colors ${
                      active ? 'border-brand/50 bg-brand/10 text-brand-text' : 'border-line bg-input text-ink hover:border-brand/40 hover:text-brand-text'
                    }`}
                  >
                    {siteLabel(site, names)}
                    <span className="text-ink-dim font-normal tabular-nums"> {site.chain}{site.resi}</span>
                  </button>
                );
              })}
              {sites.length > MAX_LIGAND_CHIPS && <span className="px-1 text-[10px] text-ink-dim self-center">+{sites.length - MAX_LIGAND_CHIPS}</span>}
            </div>
          )}

          {selected && selected.interactions.length === 0 && (
            <p className="text-xs text-ink-muted">No interactions within PLIP's distances for {siteLabel(selected, names)}.</p>
          )}

          {selected && selected.interactions.length > 0 && (
            <>
              <p className="text-[11px] text-ink-muted">
                {residues} residue{residues === 1 ? '' : 's'} hold {siteLabel(selected, names)}
                <span className="text-ink-dim"> ({selected.code} {selected.chain}:{selected.resi}{selected.icode})</span>
              </p>
              <div className="space-y-2.5">
                {groups.map(({ type, items }) => (
                  <div key={type}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-3 h-0 border-t-2 border-dashed flex-shrink-0" style={{ borderColor: INTERACTION_COLORS[type] }} />
                      <span className="text-[11px] font-medium text-ink-muted">
                        {items.length === 1 ? INTERACTION_LABELS[type].one : INTERACTION_LABELS[type].many}
                      </span>
                      <span className="text-[10px] text-ink-dim tabular-nums">{items.length}</span>
                    </div>
                    {COMPACT.has(type) ? (
                      <div className="flex flex-wrap gap-1 ml-[18px]">
                        {items.map(({ interaction, index }) => (
                          <button
                            key={index}
                            onClick={() => onFocus(index)}
                            aria-pressed={focused === index}
                            title={`${partnerLabel(interaction.partner, true)} · ${interaction.distance.toFixed(1)} Å${interaction.via ? ` · via water ${interaction.via.chain}:${interaction.via.resi}` : ''}`}
                            className={`px-1.5 py-px rounded border text-[10px] tabular-nums transition-colors ${
                              focused === index ? 'border-ink/40 bg-chip text-ink-strong' : 'border-line text-ink hover:border-line-2 hover:bg-chip/60'
                            }`}
                          >
                            {partnerLabel(interaction.partner, multiChain)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {items.map(({ interaction, index }) => (
                          <button
                            key={index}
                            onClick={() => onFocus(index)}
                            aria-pressed={focused === index}
                            className={`w-full min-w-0 text-left px-2 py-1.5 rounded-md border transition-colors ${
                              focused === index ? 'border-line-2 bg-chip' : 'border-transparent hover:border-line hover:bg-chip/60'
                            }`}
                          >
                            {/* Residue and distance on one line that never wraps; the atoms beneath, cut to fit */}
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="min-w-0 truncate whitespace-nowrap text-[12px] font-semibold text-ink-strong">{partnerLabel(interaction.partner, multiChain)}</span>
                              <span className="ml-auto flex-shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-ink">{interaction.distance.toFixed(1)} Å</span>
                            </span>
                            <span className="block mt-0.5 truncate text-[10.5px] text-ink-dim">
                              {[interaction.partner.atom && interaction.partner.atom !== 'ring' ? interaction.partner.atom : null,
                                interaction.ligandAtom ? `↔ ${interaction.ligandAtom}` : null,
                                interaction.detail].filter(Boolean).join(' ')}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Method & caveat */}
          <p className="pt-2 border-t border-line text-[10px] leading-snug text-ink-dim">
            Computed from the coordinates with criteria from{' '}
            <a href="https://plip-tool.biotec.tu-dresden.de" target="_blank" rel="noreferrer" className="underline decoration-line-2 hover:text-brand-text">PLIP</a>
            {' '}(Salentin et al. 2015). Files rarely include hydrogens, so hydrogen bonds and charges are inferred from geometry.
          </p>
        </div>
      )}
    </div>
  );
};

export default InteractionsPanel;
