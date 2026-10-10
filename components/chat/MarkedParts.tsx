import React, { useState } from 'react';
import type { Highlight } from '../../types';

// --- MARKED IN 3D ---
// The parts an answer marks in the structure, as a short list instead of a wall of pills: one row
// per named part (an interchain bond's two halves, or the same ion on two chains, share a row), the
// first few shown and the rest a click away. A row brings its part into view.

const SHOWN = 4; // Rows before "Show n more" (a fifth row is shown rather than hidden on its own)

/** Residue numbers as runs (6, 7, 8, 11 -> "6–8, 11"); a long list keeps its first two runs and a count. */
const residues = (resi: number[]) => {
  const sorted = [...new Set(resi)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    runs.push(sorted[i] === start ? `${start}` : `${start}–${sorted[i]}`);
  }
  return runs.length > 3 ? `${runs.slice(0, 2).join(', ')} +${runs.length - 2}` : runs.join(', ');
};

export interface MarkedPart {
  name: string;
  where: string; // "A 7 · B 7"
  key: string; // "A:7 B:7", one chain:residues pair per highlight
  highlights: Highlight[];
}

/** An answer's highlights grouped by name, in the order the answer gives them. */
export const groupMarkedParts = (highlights: Highlight[]): MarkedPart[] => {
  const groups = new Map<string, { name: string; highlights: Highlight[] }>();
  for (const h of highlights) {
    const name = h.label?.trim() || `Chain ${h.chain}`;
    const group = groups.get(name.toLowerCase()) ?? { name, highlights: [] };
    group.highlights.push(h);
    groups.set(name.toLowerCase(), group);
  }
  return [...groups.values()].map(({ name, highlights: hs }) => {
    const byChain = new Map<string, number[]>();
    for (const h of hs) byChain.set(h.chain, [...(byChain.get(h.chain) ?? []), ...h.resi]);
    // Beyond two chains, the first and a count: the same site on four copies of a chain must not crowd out its name
    const chains = [...byChain].map(([chain, resi]) => (resi.length ? `${chain} ${residues(resi)}` : chain));
    return {
      name,
      where: chains.length > 2 ? `${chains[0]} · +${chains.length - 1} chains` : chains.join(' · '),
      key: hs.map(h => `${h.chain}:${h.resi.join(',')}`).join(' '),
      highlights: hs,
    };
  });
};

interface MarkedPartsProps {
  highlights: Highlight[];
  live: boolean; // The answer's structure is on screen, so its rows can bring parts into view
  onFocus: (highlights: Highlight[]) => void;
}

const MarkedParts: React.FC<MarkedPartsProps> = ({ highlights, live, onFocus }) => {
  const [open, setOpen] = useState(false);
  const parts = groupMarkedParts(highlights);
  const collapsible = parts.length > SHOWN + 1;
  const shown = collapsible && !open ? parts.slice(0, SHOWN) : parts;

  return (
    <div className="mt-3" data-marked-parts>
      <p className="mb-1 text-[11px] font-medium text-ink-dim">
        Marked in 3D{parts.length > 1 && <span className="ml-1.5 tabular-nums opacity-70">{parts.length}</span>}
      </p>
      {/* -mx-2: the rows' hover fill reaches past the text, which stays in line with the answer */}
      <ul className="-mx-2">
        {shown.map(part => {
          const row = (
            <>
              <span aria-hidden="true" className={`w-1.5 h-1.5 flex-shrink-0 rounded-full ${live ? 'bg-brand-fg' : 'bg-line-2'}`} />
              {/* The name is what the row is for: it keeps at least half the row, the location gives way */}
              <span className="min-w-[48%] flex-1 truncate">{part.name}</span>
              <span className="min-w-0 max-w-[50%] truncate text-right text-[11.5px] tabular-nums text-ink-dim">{part.where}</span>
            </>
          );
          return (
            <li key={part.key}>
              {live ? (
                <button
                  type="button"
                  data-highlight-chip={part.key}
                  onClick={() => onFocus(part.highlights)}
                  title={`Zoom to ${part.name} (${part.where})`}
                  className="w-full h-chat-row flex items-center gap-2.5 px-2 rounded-md text-left text-chat-meta text-ink hover:bg-chip/60 hover:text-ink-strong transition-colors"
                >
                  {row}
                </button>
              ) : (
                <div data-highlight-chip={part.key} className="h-chat-row flex items-center gap-2.5 px-2 text-chat-meta text-ink-muted">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="mt-0.5 h-6 inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-muted hover:text-ink-strong transition-colors"
        >
          {open ? 'Show fewer' : `Show ${parts.length - SHOWN} more`}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
        </button>
      )}
    </div>
  );
};

export default MarkedParts;
