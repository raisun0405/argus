import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelChain, Selection, StructureModel } from '../../services/structureModel';
import { residueKey, residueLabel } from '../../services/structureModel';
import { TOUCH_QUERY, useMediaQuery } from '../../useMedia';

// --- SEQUENCE STRIP ---
// The chain's sequence above the canvas: one cell per residue, a ruler every ten, and the same
// selection as the 3D view.
// Click picks a residue, drag picks a run, Shift extends, Ctrl/Cmd adds. On a touch screen a swipe
// scrolls the strip and a tap picks, with wider cells for a finger. Residues an answer
// highlights carry a mark underneath, so the biology stays visible while scrolling.
// Cells are fixed-width (not a monospace font) so letters line up under the ruler.

const CELL = 11; // px per residue
const TOUCH_CELL = 15;
const RULER_EVERY = 10;

export interface SequenceMark {
  keys: Set<string>;
  color: string; // Already resolved (theme token value or a fixed colour)
  label: string;
}

interface SequenceBarProps {
  model: StructureModel;
  selection: Selection;
  marks?: SequenceMark[]; // Answer highlights, pocket residues, interaction partners…
  activeChain: string;
  onActiveChain: (chain: string) => void;
  onPick: (key: string, modifiers: { toggle?: boolean; range?: boolean }) => void;
  onPickRange: (keys: string[]) => void;
  onSelectChain: (chain: string) => void;
  onHover?: (key: string | null) => void;
}

const chainTitle = (c: ModelChain) =>
  `${c.name ? `${c.name} · ` : ''}${c.residues.length} ${c.kind === 'nucleic' ? 'nt' : 'aa'}${c.gaps.length ? ` · ${c.gaps.length} gap${c.gaps.length > 1 ? 's' : ''}` : ''}`;

const SequenceBar: React.FC<SequenceBarProps> = ({ model, selection, marks = [], activeChain, onActiveChain, onPick, onPickRange, onSelectChain, onHover }) => {
  const chain = model.chains.find(c => c.chain === activeChain) ?? model.chains[0];
  const touch = useMediaQuery(TOUCH_QUERY);
  const cell = touch ? TOUCH_CELL : CELL;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const lastPointer = useRef<string>('mouse');

  // Which residues carry a mark, and in which colour (the first mark wins)
  const markOf = useMemo(() => {
    const map = new Map<string, SequenceMark>();
    for (const mark of marks) for (const key of mark.keys) if (!map.has(key)) map.set(key, mark);
    return map;
  }, [marks]);

  // A drag selects as it moves; the pointer is tracked on the window so it survives leaving the strip
  useEffect(() => {
    if (dragFrom === null) return;
    const finish = () => {
      if (chain && dragTo !== null && dragTo !== dragFrom) {
        const [a, b] = [dragFrom, dragTo].sort((x, y) => x - y);
        onPickRange(chain.residues.slice(a, b + 1).map(residueKey));
      }
      setDragFrom(null);
      setDragTo(null);
    };
    window.addEventListener('pointerup', finish);
    return () => window.removeEventListener('pointerup', finish);
  }, [dragFrom, dragTo, chain, onPickRange]);

  // Keep the first selected residue of this chain in view when the selection comes from elsewhere
  useEffect(() => {
    if (!chain || !trackRef.current || dragFrom !== null) return;
    const first = chain.residues.find(r => selection.keys.has(residueKey(r)));
    if (!first) return;
    const track = trackRef.current;
    const x = first.index * cell;
    if (x < track.scrollLeft || x > track.scrollLeft + track.clientWidth - cell) {
      track.scrollTo({ left: Math.max(0, x - track.clientWidth / 2), behavior: 'smooth' });
    }
  }, [selection, chain, cell]);

  if (!chain) return null;

  const dragRange = dragFrom !== null && dragTo !== null ? [Math.min(dragFrom, dragTo), Math.max(dragFrom, dragTo)] : null;
  const width = chain.residues.length * cell;

  return (
    <div className="flex items-stretch gap-2 h-[46px] flex-shrink-0 border-b border-line bg-surface/40 pl-2 pr-1 select-none">
      {/* Chain picker: the chains of the structure, each selectable whole */}
      <div className="flex items-center gap-1 flex-shrink-0 py-1">
        {/* Many chains on a touch screen: the phone's own picker, so the sequence keeps its width */}
        {touch && model.chains.length > 4 ? (
          <label className="relative flex items-center h-8 pl-2.5 pr-7 rounded-md border border-brand/40 bg-brand/15 text-brand-text text-[12.5px] font-semibold">
            <span>Chain {chain.chain}</span>
            <svg width="9" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="absolute right-2.5" aria-hidden="true"><path d="M1 1L5 5L9 1" /></svg>
            <select
              value={chain.chain}
              onChange={e => onActiveChain(e.target.value)}
              aria-label="Chain shown in the sequence"
              className="absolute inset-0 opacity-0"
            >
              {model.chains.map(c => <option key={c.chain} value={c.chain}>{`Chain ${c.chain}${c.name ? ` · ${c.name}` : ''}`}</option>)}
            </select>
          </label>
        ) : model.chains.slice(0, 8).map(c => {
          const active = c.chain === chain.chain;
          return (
            <button
              key={c.chain}
              type="button"
              onClick={() => (active ? onSelectChain(c.chain) : onActiveChain(c.chain))}
              title={active ? `Select all of chain ${c.chain} — ${chainTitle(c)}` : `Show chain ${c.chain} — ${chainTitle(c)}`}
              aria-pressed={active}
              className={`h-7 min-w-[28px] touch:h-8 touch:min-w-[34px] px-1.5 rounded text-[11px] touch:text-[12.5px] font-semibold tabular-nums transition-colors ${
                active ? 'bg-brand/15 text-brand-text border border-brand/40' : 'text-ink-muted border border-transparent hover:bg-chip hover:text-ink'
              }`}
            >
              {c.chain}
            </button>
          );
        })}
        {model.chains.length > 8 && !(touch && model.chains.length > 4) && <span className="text-[10px] text-ink-dim">+{model.chains.length - 8}</span>}
      </div>

      <div className="w-px bg-line flex-shrink-0 my-2" />

      {/* The sequence itself, with its ruler */}
      <div
        ref={trackRef}
        className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden argus-thin-scroll"
        onMouseLeave={() => {
          setHovered(null);
          onHover?.(null);
        }}
      >
        <div className="relative h-full" style={{ width }}>
          {/* Ruler */}
          <div className="absolute top-[3px] left-0 h-3 pointer-events-none" style={{ width }}>
            {chain.residues.map((r, i) =>
              i === 0 || (i + 1) % RULER_EVERY === 0 ? (
                <span
                  key={r.index}
                  className="absolute text-[9px] leading-3 tabular-nums text-ink-dim"
                  style={{ left: i * cell, transform: 'translateX(-1px)' }}
                >
                  {r.resi}
                  {r.icode}
                </span>
              ) : null
            )}
          </div>

          {/* Residues */}
          <div className="absolute top-[18px] left-0 flex h-5" style={{ width }}>
            {chain.residues.map((r, i) => {
              const key = residueKey(r);
              const picked = selection.keys.has(key) || (dragRange !== null && i >= dragRange[0] && i <= dragRange[1]);
              const mark = markOf.get(key);
              const gap = chain.gaps.includes(i);
              return (
                <button
                  key={key}
                  type="button"
                  tabIndex={-1}
                  data-resi={r.resi}
                  onPointerDown={e => {
                    lastPointer.current = e.pointerType;
                    if (e.pointerType === 'touch') return; // A finger may be scrolling the strip: its tap picks (onClick)
                    e.preventDefault();
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      onPick(key, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
                      return;
                    }
                    setDragFrom(i);
                    setDragTo(i);
                    onPick(key, {});
                  }}
                  onClick={() => {
                    // A finger's tap (a mouse picked on pointerdown already; a swipe that scrolled never clicks)
                    if (lastPointer.current === 'touch') onPick(key, {});
                  }}
                  onPointerEnter={() => {
                    setHovered(i);
                    onHover?.(key);
                    if (dragFrom !== null) setDragTo(i);
                  }}
                  title={`${residueLabel(r)} · chain ${r.chain}${mark ? ` · ${mark.label}` : ''}`}
                  className={`relative flex items-start justify-center text-[11px] touch:text-[12.5px] leading-[14px] transition-colors ${
                    picked ? 'bg-brand text-brand-ink font-semibold' : hovered === i ? 'bg-chip text-ink-strong' : 'text-ink-muted'
                  } ${gap ? 'border-l border-dashed border-line-2' : ''}`}
                  style={{ width: cell, height: 20 }}
                >
                  {r.code}
                  {mark && !picked && (
                    <span className="absolute bottom-0 left-[1px] right-[1px] h-[2px] rounded-full" style={{ background: mark.color }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SequenceBar;
