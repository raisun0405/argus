import React from 'react';
import { Explanation, Term, useExplain } from '../Explain';

// --- INSPECTOR SECTION ---
// One collapsible block in the right-hand column. The controls are a single stack of these rather
// than floating cards, so tools never cover the structure or each other, and the section header is
// the whole menu: an icon, the name, a count, and the section's own actions on the right.

interface InspectorSectionProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode; // A count or state
  actions?: React.ReactNode; // Buttons for the section itself, beside the header
  active?: boolean; // A tool that is switched on (its icon takes the accent)
  open: boolean;
  onToggle: (id: string) => void;
  onClose?: () => void; // Tools that can be switched off entirely
  closeLabel?: string;
  children: React.ReactNode;
}

const InspectorSection: React.FC<InspectorSectionProps> = ({ id, title, icon, badge, actions, active, open, onToggle, onClose, closeLabel, children }) => (
  <section className="border-b border-line" data-section={id}>
    <div className="flex items-center gap-1 pr-2">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`inspector-${id}`}
        className="group flex-1 min-w-0 flex items-center gap-2 h-9 touch:h-12 pl-3 touch:pl-4 pr-1 text-left"
      >
        {icon && (
          <span className={`flex-shrink-0 flex [&>svg]:w-[14px] [&>svg]:h-[14px] transition-colors ${active ? 'text-brand-fg' : 'text-ink-muted group-hover:text-ink-strong'}`}>{icon}</span>
        )}
        <span className="text-[12px] touch:text-[14px] font-semibold text-ink-strong tracking-tight truncate">{title}</span>
        {badge !== undefined && badge !== null && (
          <span className="flex-shrink-0 h-[18px] min-w-[18px] px-1.5 rounded-full bg-chip text-[10px] font-medium leading-[18px] text-center tabular-nums text-ink-muted">{badge}</span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`ml-auto flex-shrink-0 text-ink-dim group-hover:text-ink-muted transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
        >
          <path d="M1 1L5 5L9 1" />
        </svg>
      </button>
      {actions}
      {onClose && (
        <IconButton onClick={onClose} label={closeLabel ?? `Close ${title}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </IconButton>
      )}
    </div>
    {open && (
      <div id={`inspector-${id}`} className="px-3 touch:px-4 pb-3.5 touch:pb-4 pt-0.5">
        {children}
      </div>
    )}
  </section>
);

export default InspectorSection;

// --- Shared controls, so every row in the column measures and looks the same ---

/** A small square button for a section's own actions (close, reset). */
export const IconButton: React.FC<{ onClick: () => void; label: string; children: React.ReactNode }> = ({ onClick, label, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className="flex-shrink-0 w-6 h-6 touch:w-10 touch:h-10 flex items-center justify-center rounded-md text-ink-dim hover:text-ink-strong hover:bg-chip/70 transition-colors"
  >
    {children}
  </button>
);

const LABEL = 'text-[11px] touch:text-[12.5px] font-medium text-ink-muted';

/** A group of controls under a quiet name ("Shape", "Show in 3D"); with a hint, the name shows it when pressed. */
export const Group: React.FC<{ label: string; hint?: string; trailing?: React.ReactNode; children: React.ReactNode }> = ({ label, hint, trailing, children }) => {
  const explain = useExplain();
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        {hint ? <Term {...explain.term('hint')} className={LABEL}>{label}</Term> : <span className={LABEL}>{label}</span>}
        {trailing}
      </div>
      {hint && explain.open && <Explanation id={explain.id('hint')} className="-mt-0.5 mb-2">{hint}</Explanation>}
      {children}
    </div>
  );
};

/** A labelled row: the name in a fixed column on the left, the control filling the rest. */
export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => {
  const explain = useExplain();
  return (
    <div className="grid grid-cols-[56px_1fr] touch:grid-cols-[64px_1fr] items-center gap-2 min-h-[30px] touch:min-h-[40px]">
      {hint ? <Term {...explain.term('hint')} className={LABEL}>{label}</Term> : <span className={LABEL}>{label}</span>}
      <div className="min-w-0">{children}</div>
      {hint && explain.open && <Explanation id={explain.id('hint')} className="col-span-2 -mt-1 mb-1">{hint}</Explanation>}
    </div>
  );
};

/**
 * Segmented picker — every option visible, one click to change. With icons the options become
 * tiles, icon above name, the pressed one raised.
 */
export const Segmented = <T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { value: T; label: string; title?: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) => {
  const tiles = options.some(o => o.icon);
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-stretch gap-0.5 p-0.5 rounded-lg bg-input border border-line">
      {options.map(o => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            title={o.title ?? o.label}
            className={`flex-1 min-w-0 rounded-md font-medium transition-all ${
              tiles ? 'h-[46px] touch:h-[54px] flex flex-col items-center justify-center gap-1 text-[10.5px] touch:text-[12px]' : 'h-[24px] touch:h-9 px-1 text-[11px] touch:text-[13px] truncate'
            } ${on ? 'bg-elevated text-ink-strong shadow-float ring-1 ring-line-2' : 'text-ink-muted hover:text-ink-strong hover:bg-chip/60'}`}
          >
            {o.icon && <span className={`flex [&>svg]:w-[17px] [&>svg]:h-[17px] ${on ? 'text-brand-fg' : ''}`}>{o.icon}</span>}
            <span className="truncate max-w-full px-0.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/** An on/off chip with an icon: filled with a bright icon when on, an empty outline when off. */
export const ToggleChip: React.FC<{ label: string; icon: React.ReactNode; on: boolean; onChange: (on: boolean) => void; hint?: string }> = ({ label, icon, on, onChange, hint }) => (
  <button
    type="button"
    onClick={() => onChange(!on)}
    aria-pressed={on}
    title={hint ? `${hint} (${on ? 'shown' : 'hidden'})` : undefined}
    className={`h-8 touch:h-10 min-w-0 flex items-center gap-1.5 px-1.5 touch:px-2.5 rounded-md border text-[11px] touch:text-[13px] font-medium transition-colors ${
      on ? 'bg-chip/80 border-line-2 text-ink-strong shadow-float' : 'border-dashed border-line-2 text-ink-dim hover:text-ink-muted'
    }`}
  >
    <span className={`flex-shrink-0 flex [&>svg]:w-[13px] [&>svg]:h-[13px] ${on ? 'text-brand-fg' : ''}`}>{icon}</span>
    <span className="truncate">{label}</span>
  </button>
);

/** A number typed in a small box: applied on Enter or when the box loses focus; arrows step it. */
export const NumberField: React.FC<{ value: number; min: number; max: number; unit?: string; label: string; onChange: (v: number) => void }> = ({ value, min, max, unit, label, onChange }) => {
  const [draft, setDraft] = React.useState<string | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const commit = (raw: string) => {
    if (raw.trim() !== '' && Number.isFinite(Number(raw))) onChange(clamp(Number(raw)));
    setDraft(null);
  };
  return (
    <label className="flex-shrink-0 flex items-center gap-0.5 h-6 w-[50px] touch:h-9 touch:w-[66px] px-1.5 rounded-md bg-input border border-line focus-within:border-ink-dim hover:border-line-2 transition-colors">
      <input
        value={draft ?? String(value)}
        inputMode="numeric"
        aria-label={label}
        onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, String(max).length))}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value + (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)));
            setDraft(null);
          }
        }}
        className="w-full min-w-0 bg-transparent text-right text-[11px] font-medium tabular-nums text-ink focus:outline-none"
      />
      {unit && <span className="text-[10px] text-ink-dim">{unit}</span>}
    </label>
  );
};

/** A switch whose knob always contrasts with its track (the accent is near-white on dark themes). */
export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex flex-shrink-0 h-[18px] w-[30px] touch:h-6 touch:w-10 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-brand' : 'bg-line-2'}`}
  >
    {/* A finger-sized track and knob on touch screens, like the inspector's other controls */}
    <span className={`inline-block h-3.5 w-3.5 touch:h-5 touch:w-5 rounded-full shadow-knob transition-transform ${checked ? 'translate-x-[14px] touch:translate-x-[18px] bg-brand-ink' : 'translate-x-[2px] bg-ink-muted'}`} />
  </button>
);

/** A key as it appears on the keyboard, for hints. */
export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center h-[17px] px-1 rounded border border-line-2 bg-chip/50 font-sans text-[10px] font-medium leading-none text-ink-muted">{children}</kbd>
);

/** A slider, its track filled up to the value (styles: .argus-range in index.css). */
export const Range: React.FC<{ value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; label: string }> = ({ value, min = 0, max = 100, step = 1, onChange, label }) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={e => onChange(Number(e.target.value))}
    aria-label={label}
    className="argus-range"
    style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
  />
);
