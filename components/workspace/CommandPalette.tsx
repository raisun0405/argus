import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { searchCommands, shortcutLabel, type Command, type CommandGroup } from '../../services/commands';

// --- COMMAND PALETTE ---
// One searchable way into everything, opened with Ctrl/⌘K: type to filter, arrows to move, Enter to
// run, Escape to leave, and each row shows its own shortcut so the palette teaches the faster path.

export interface PaletteResult {
  key: string;
  title: string;
  hint?: string;
  group: CommandGroup;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: Command[];
  /** Results that depend on what was typed (a residue to jump to, a PDB entry to open). */
  dynamic?: (query: string) => PaletteResult[];
  placeholder?: string;
  onClose: () => void;
}

const GROUP_ORDER: CommandGroup[] = ['Go to', 'Selection', 'View', 'Tools', 'Workspace', 'Help'];

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, commands, dynamic, placeholder, onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const results: PaletteResult[] = useMemo(() => {
    const dyn = dynamic?.(query) ?? [];
    const matched = searchCommands(commands, query).map(({ command }) => ({
      key: command.id,
      title: command.title,
      hint: command.hint,
      group: command.group,
      shortcut: command.shortcut,
      run: command.run,
    }));
    // In the order the list shows them (by group), so the first highlighted is the one at the top
    const all = [...dyn, ...matched];
    return all.map((r, i) => ({ r, i })).sort((a, b) => GROUP_ORDER.indexOf(a.r.group) - GROUP_ORDER.indexOf(b.r.group) || a.i - b.i).map(x => x.r);
  }, [commands, dynamic, query]);

  // Grouped for display, keeping the flat order so the arrow keys and the list agree
  const groups = useMemo(() => {
    const byGroup = new Map<CommandGroup, { result: PaletteResult; index: number }[]>();
    results.forEach((result, index) => {
      const list = byGroup.get(result.group) ?? [];
      list.push({ result, index });
      byGroup.set(result.group, list);
    });
    return [...byGroup.entries()].sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  }, [results]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActive(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Escape closes it wherever focus happens to be, not only inside the dialog
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep the highlighted row in view as the arrows move
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, results.length]);

  if (!open) return null;

  const run = (result: PaletteResult) => {
    onClose();
    result.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActive(i => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActive(i => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[active];
      if (chosen) run(chosen);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Home' && !e.shiftKey) {
      setActive(0);
    } else if (e.key === 'End' && !e.shiftKey) {
      setActive(Math.max(0, results.length - 1));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] touch:pt-3 px-4 touch:px-3 bg-canvas/70 backdrop-blur-sm animate-argus-fade-in"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[560px] max-h-[62vh] touch:max-h-[min(70dvh,560px)] flex flex-col bg-surface border border-line-2 rounded-xl shadow-overlay overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {/* Query */}
        <div className="flex items-center gap-2 px-3 h-11 touch:h-12 border-b border-line flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="text-ink-dim flex-shrink-0"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder ?? 'Search commands, or jump to a residue (A:25)'}
            aria-label="Search commands"
            aria-controls="command-results"
            aria-activedescendant={results[active] ? `command-${results[active].key}` : undefined}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-ink-dim focus:outline-none"
          />
          <kbd className="flex-shrink-0 text-[10px] text-ink-dim border border-line rounded px-1 py-0.5 touch:hidden">esc</kbd>
          {/* A finger has no Escape key */}
          <button type="button" onClick={onClose} className="hidden touch:block flex-shrink-0 -mr-1 px-2 h-9 text-[14px] font-medium text-ink-muted">Cancel</button>
        </div>

        {/* Results */}
        <div ref={listRef} id="command-results" role="listbox" aria-label="Commands" className="flex-1 min-h-0 overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-ink-dim">
              Nothing matches “{query}”. Try a residue like <span className="text-ink-muted">A:25</span>, or ask in the chat.
            </p>
          )}
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">{group}</p>
              {items.map(({ result, index }) => (
                <button
                  key={result.key}
                  id={`command-${result.key}`}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  type="button"
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(result)}
                  className={`w-full flex items-center gap-2 px-3 h-8 touch:h-11 text-left transition-colors ${
                    index === active ? 'bg-chip text-ink-strong' : 'text-ink hover:bg-chip/60'
                  }`}
                >
                  <span className="text-[13px] touch:text-[15px] truncate">{result.title}</span>
                  {result.hint && <span className="text-[11px] touch:text-[12.5px] text-ink-dim truncate">{result.hint}</span>}
                  {result.shortcut && (
                    <kbd className="ml-auto flex-shrink-0 text-[10px] text-ink-dim border border-line rounded px-1 py-0.5 tracking-tight touch:hidden">
                      {shortcutLabel(result.shortcut)}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* How to drive it */}
        <div className="flex items-center gap-3 px-3 h-7 border-t border-line text-[10px] text-ink-dim flex-shrink-0 touch:hidden">
          <span><kbd className="font-sans">↑↓</kbd> move</span>
          <span><kbd className="font-sans">↵</kbd> run</span>
          <span className="ml-auto"><kbd className="font-sans">?</kbd> all shortcuts</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
