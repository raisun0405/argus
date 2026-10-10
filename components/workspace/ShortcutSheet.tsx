import React, { useEffect } from 'react';
import { shortcutLabel } from '../../services/commands';

// --- SHORTCUT SHEET ---
// Pressing ? shows every shortcut: it keeps them discoverable without putting a single extra control
// on screen.

const GROUPS: { title: string; items: [keys: string, description: string][] }[] = [
  {
    title: 'Everywhere',
    items: [
      ['mod+k', 'Search commands, tools and residues'],
      ['shift+?', 'This list'],
      ['escape', 'Clear the selection, or close what is open'],
    ],
  },
  {
    title: 'Workspace',
    items: [
      ['b', 'Show or hide the chat'],
      ['i', 'Show or hide the inspector'],
      ['r', 'Reset the view'],
      ['p', 'Save a picture of the 3D view'],
    ],
  },
  {
    title: 'Shape',
    items: [
      ['1', 'Cartoon'],
      ['2', 'Wireframe'],
      ['3', 'Spacefill'],
      ['4', 'Surface'],
    ],
  },
  {
    title: 'Selecting',
    items: [
      ['click', 'Pick a residue, in the structure or the sequence'],
      ['shift+click', 'Extend the selection along the chain'],
      ['mod+click', 'Add or remove one residue'],
      ['drag', 'Pick a run of residues on the sequence strip'],
    ],
  },
  {
    title: 'The 3D view',
    items: [
      ['drag', 'Rotate'],
      ['right-drag', 'Pan'],
      ['scroll', 'Zoom'],
    ],
  },
];

const Keys: React.FC<{ keys: string }> = ({ keys }) => {
  // Mouse actions are words, not keys
  const literal = ['click', 'drag', 'scroll', 'right-drag', 'shift+click', 'mod+click'].includes(keys);
  const text = literal
    ? keys.replace('mod+', shortcutLabel('mod+x').replace(/x$/i, '').replace('+', '') + '+').replace('shift+', '⇧+')
    : shortcutLabel(keys);
  return <kbd className="flex-shrink-0 px-1.5 py-0.5 rounded border border-line bg-input text-[10px] text-ink-muted tracking-tight">{text}</kbd>;
};

const ShortcutSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-canvas/70 backdrop-blur-sm animate-argus-fade-in"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="w-full max-w-[560px] max-h-[80vh] overflow-y-auto bg-surface border border-line-2 rounded-xl shadow-overlay">
        <div className="flex items-center justify-between h-10 px-4 border-b border-line sticky top-0 bg-surface">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">Keyboard shortcuts</h2>
          <button onClick={onClose} aria-label="Close" className="w-6 h-6 flex items-center justify-center rounded text-ink-dim hover:text-brand-text transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {GROUPS.map(group => (
            <section key={group.title}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-dim mb-1.5">{group.title}</p>
              <div className="space-y-1">
                {group.items.map(([keys, description]) => (
                  <div key={keys + description} className="flex items-center gap-3">
                    <span className="text-[12px] text-ink flex-1 min-w-0">{description}</span>
                    <Keys keys={keys} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ShortcutSheet;
