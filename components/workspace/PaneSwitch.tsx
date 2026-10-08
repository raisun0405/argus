import React from 'react';

// --- PANE SWITCH ---
// A phone shows the conversation or the structure, one at a time. The switch between them sits at
// the left of whichever header is showing, in the same place on both, so there is no extra bar.

export type Pane = 'chat' | 'structure';

const PANES: { id: Pane; label: string; name: string }[] = [
  { id: 'chat', label: 'Chat', name: 'Chat' },
  { id: 'structure', label: '3D', name: '3D structure' },
];

const PaneSwitch: React.FC<{ pane: Pane; onChange: (pane: Pane) => void; news?: Pane }> = ({ pane, onChange, news }) => (
  <div role="tablist" aria-label="Workspace" className="flex-shrink-0 inline-flex items-center gap-0.5 p-[3px] rounded-[10px] bg-chip/60 border border-line">
    {PANES.map(p => {
      const on = pane === p.id;
      const dot = news === p.id && !on; // Something changed there since it was last on screen
      return (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={on}
          aria-label={dot ? `${p.name}, updated` : p.name}
          data-pane={p.id}
          onClick={() => onChange(p.id)}
          className={`relative h-8 min-w-[44px] px-3 rounded-[7px] text-[13px] font-semibold tracking-tight transition-colors ${
            on ? 'bg-elevated text-ink-strong shadow-float ring-1 ring-line-2' : 'text-ink-muted'
          }`}
        >
          {p.label}
          {dot && <span aria-hidden="true" className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-ink-strong" />}
        </button>
      );
    })}
  </div>
);

export default PaneSwitch;
