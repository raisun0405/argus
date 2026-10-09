import React from 'react';
import type { Selection, StructureModel } from '../../services/structureModel';
import { describeSelection, residueLabel } from '../../services/structureModel';
import { shortcutLabel } from '../../services/commands';
import { Kbd } from './InspectorSection';

const paletteKeys = shortcutLabel('mod+k');

// --- STATUS BAR ---
// The quiet line under the canvas. Left, what the pointer and keys do right now, replaced by the
// selection or the residue under the pointer when there is one; right, the size of what is loaded,
// the camera reset and the command palette, in a visible bar because a shortcut nobody sees is one
// nobody uses, and the controls of a 3D view are not guessable.

interface StatusBarProps {
  model: StructureModel | null;
  selection: Selection;
  hovered: string | null;
  busy?: string | null; // What the workspace is waiting for
  caption?: string; // What is on screen, when nothing else is said (a phone, whose header has no room for the name)
  onClearSelection: () => void;
  onOpenPalette: () => void;
  onResetView: () => void;
  onSavePicture?: () => boolean; // Saves the 3D view as a PNG; false when there is nothing to save yet
}

const Hint: React.FC<{ keys: string; children: React.ReactNode }> = ({ keys, children }) => (
  <span className="inline-flex items-center gap-1"><Kbd>{keys}</Kbd><span>{children}</span></span>
);

const StatusBar: React.FC<StatusBarProps> = ({ model, selection, hovered, busy, caption, onClearSelection, onOpenPalette, onResetView, onSavePicture }) => {
  // "Picture" says what happened for a moment: saved (a tick), or not yet possible
  const [saved, setSaved] = React.useState<boolean | null>(null);
  const savedTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(savedTimer.current), []);
  const savePicture = () => {
    setSaved(onSavePicture?.() ?? false);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(null), 1600);
  };
  const hoveredResidue = hovered && model ? model.byKey.get(hovered) : null;
  const count = selection.keys.size;
  const ligandCount = model ? model.ligands.filter(l => l.kind === 'ligand').length : 0;
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  return (
    <div className="flex items-center gap-2.5 h-7 touch:h-10 flex-shrink-0 border-t border-line bg-surface/40 pl-3 pr-1.5 text-[11px] touch:text-[12.5px] text-ink-muted whitespace-nowrap overflow-hidden">
      {/* What is picked, what the pointer is over, what is loading, or how the mouse works */}
      <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
        {count > 0 ? (
          <>
            <span className="flex-shrink-0 inline-flex items-center gap-1 h-5 touch:h-7 pl-2 touch:pl-2.5 pr-0.5 rounded-full bg-chip text-ink-strong font-medium tabular-nums">
              {count} selected
              <button
                onClick={onClearSelection}
                className="w-4 h-4 touch:w-6 touch:h-6 flex items-center justify-center rounded-full text-ink-muted hover:text-ink-strong hover:bg-line-2 transition-colors"
                title="Clear the selection (Esc)"
                aria-label="Clear the selection"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </span>
            <span className="min-w-0 truncate text-ink-dim">{describeSelection(selection, model!, 70)}</span>
          </>
        ) : hoveredResidue ? (
          <span className="min-w-0 truncate tabular-nums">
            <span className="text-ink-strong font-medium">{residueLabel(hoveredResidue)}</span>
            <span className="text-ink-dim"> · chain {hoveredResidue.chain}</span>
          </span>
        ) : busy ? (
          <span className="flex items-center gap-1.5 text-ink-dim">
            <span className="w-2.5 h-2.5 border border-brand/30 border-t-brand rounded-full animate-spin" />
            {busy}
          </span>
        ) : caption ? (
          <span className="min-w-0 truncate text-ink-muted">{caption}</span>
        ) : (
          // How a mouse works the view: wide windows with a mouse only. A hint that doesn't fit wraps
          // onto a hidden second line, so hints drop out whole instead of being cut mid-word.
          <span className="hidden [@media(min-width:768px)_and_(pointer:fine)]:flex flex-wrap items-center gap-x-3 min-w-0 h-5 overflow-hidden text-ink-dim">
            <Hint keys="Drag">rotate</Hint>
            <Hint keys="Right-drag">pan</Hint>
            <Hint keys="Scroll">zoom</Hint>
            <span className="hidden xl:inline-flex"><Hint keys="Click">select</Hint></span>
          </span>
        )}
      </div>

      {/* How big it is. Its name and whether it is predicted are in the header above. */}
      {model && (
        <span className="flex-shrink-0 hidden md:inline-flex items-center gap-2.5 text-ink-dim tabular-nums">
          <span aria-hidden="true" className="w-px h-3.5 bg-line" />
          <span>
            {plural(model.residueCount, 'residue')} · {plural(model.chains.length, 'chain')}
            {ligandCount > 0 && ` · ${plural(ligandCount, 'ligand')}`}
          </span>
        </span>
      )}
      <span aria-hidden="true" className="flex-shrink-0 w-px h-3.5 bg-line" />

      <button
        onClick={onResetView}
        className="flex-shrink-0 flex items-center gap-1.5 h-5 touch:h-8 pl-1.5 pr-1 touch:px-2.5 rounded touch:rounded-md text-ink-muted hover:text-ink-strong hover:bg-chip transition-colors"
        title="Back to the whole structure (R)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        Reset view
        <span className="touch:hidden"><Kbd>R</Kbd></span>
      </button>

      {/* The 3D view as a PNG file: words on wide screens, the camera alone elsewhere */}
      {onSavePicture && (
        <button
          onClick={savePicture}
          data-save-picture
          className="flex-shrink-0 flex items-center justify-center gap-1.5 h-5 touch:h-8 touch:w-9 pl-1.5 pr-1 touch:px-0 rounded touch:rounded-md text-ink-muted hover:text-ink-strong hover:bg-chip active:bg-chip transition-colors"
          title="Save a picture of the 3D view (P)"
          aria-label="Save a picture of the 3D view"
        >
          {saved ? (
            <svg className="w-[11px] h-[11px] touch:w-[15px] touch:h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg className="w-[11px] h-[11px] touch:w-[15px] touch:h-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
          )}
          <span className="hidden [@media(min-width:1024px)_and_(pointer:fine)]:inline" aria-live="polite">{saved === null ? 'Picture' : saved ? 'Saved' : 'Not ready'}</span>
          <span className="hidden [@media(min-width:1024px)_and_(pointer:fine)]:inline"><Kbd>P</Kbd></span>
        </button>
      )}

      {/* Everything else, in words and in this platform's keys (Ctrl+K, or ⌘K on a Mac) */}
      <button
        onClick={onOpenPalette}
        className="flex-shrink-0 flex items-center gap-1.5 h-5 pl-1.5 pr-1 rounded text-ink-muted hover:text-ink-strong hover:bg-chip transition-colors touch:hidden"
        title={`Search every command and residue (${paletteKeys})`}
      >
        Commands
        <Kbd>{paletteKeys}</Kbd>
      </button>
      {/* A finger has no Ctrl+K: the same search, as a button */}
      <button
        onClick={onOpenPalette}
        aria-label="Search commands and residues"
        className="hidden touch:flex flex-shrink-0 w-9 h-8 items-center justify-center rounded-md text-ink-muted active:bg-chip"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      </button>
    </div>
  );
};

export default StatusBar;
