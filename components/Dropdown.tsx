import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption {
  value: string;
  label: string;
  swatch?: string; // A CSS background previewing the option (a colouring's colours)
  group?: string; // Options sharing a group sit under its name
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md'; // sm: an inspector row
  align?: 'stretch' | 'end'; // end: the menu lines up with the button's right edge...
  menuWidth?: number; // ...and is at least this wide (otherwise exactly the button's width)
}

const GAP = 4; // Between the button and its menu
const EDGE = 8; // Kept clear of the window's edges

const Swatch: React.FC<{ background: string }> = ({ background }) => (
  <span aria-hidden="true" className="flex-shrink-0 w-[18px] h-[11px] rounded-[3px] ring-1 ring-inset ring-black/25" style={{ background }} />
);

/**
 * Argus custom dropdown — replaces native <select> so the options panel
 * matches the theme exactly (no OS-rendered white dropdowns).
 *
 * Features:
 * - The menu is drawn over the page (a portal), placed against the button, so a scrolling panel
 *   never clips it; it opens upwards when there is no room below, and scrolls when it is long
 * - Options can carry a swatch (shown in the button too) and a group heading
 * - Keyboard: ArrowDown / ArrowUp navigate, Enter selects, Escape closes
 * - Click-outside closes (menus that host a dropdown ignore clicks inside [data-dropdown-menu])
 */
const Dropdown: React.FC<DropdownProps> = ({ value, options, onChange, ariaLabel, size = 'md', align = 'stretch', menuWidth }) => {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [anchor, setAnchor] = useState<DOMRect | null>(null); // The button, while the menu is open
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId(); // Screen readers follow the arrow-key focus through aria-activedescendant

  const currentIndex = options.findIndex(o => o.value === value);
  const current = options[currentIndex];
  const small = size === 'sm';

  // Click outside (the button or the menu) closes
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // The menu follows its button: measured on opening, and again whenever anything scrolls or resizes
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setAnchor(buttonRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      setAnchor(null); // Measured afresh next time, never shown where the button used to be
    };
  }, [open]);

  // Reset focused index when opened
  useEffect(() => {
    if (open) {
      setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [open, currentIndex]);

  // Arrow keys keep the focused option in sight in a scrolling menu
  useEffect(() => {
    if (open && focusedIndex >= 0) document.getElementById(`${listId}-${focusedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, focusedIndex, listId]);

  const selectAndClose = (val: string) => {
    onChange(val);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < options.length) {
        selectAndClose(options[focusedIndex].value);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  // Where the menu goes: under the button (over it when the room is below), inside the window
  let menuStyle: React.CSSProperties | undefined;
  if (anchor) {
    const width = align === 'end' ? Math.max(anchor.width, menuWidth ?? 0) : anchor.width;
    const left = Math.max(EDGE, Math.min(align === 'end' ? anchor.right - width : anchor.left, window.innerWidth - width - EDGE));
    const below = window.innerHeight - anchor.bottom - GAP - EDGE;
    const above = anchor.top - GAP - EDGE;
    const upwards = below < 240 && above > below;
    menuStyle = upwards
      ? { position: 'fixed', left, width, bottom: window.innerHeight - anchor.top + GAP, maxHeight: above }
      : { position: 'fixed', left, width, top: anchor.bottom + GAP, maxHeight: below };
  }

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && focusedIndex >= 0 ? `${listId}-${focusedIndex}` : undefined}
        aria-label={ariaLabel}
        data-value={value}
        onClick={() => setOpen(o => !o)}
        className={`w-full bg-input border text-ink cursor-pointer transition-colors text-left flex items-center gap-2 ${
          small ? 'h-[28px] touch:h-10 pl-3 pr-6 rounded-md text-[11.5px] touch:text-[13.5px] font-medium' : 'pl-2 pr-6 py-1.5 touch:py-2.5 rounded-lg text-xs touch:text-[13.5px] font-semibold'
        } ${open ? 'border-line-2 bg-chip/40' : 'border-line hover:border-line-2'}`}
      >
        {current?.swatch && <Swatch background={current.swatch} />}
        <span className="truncate">{current?.label ?? value}</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-ink-dim">
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          >
            <path d="M1 1L5 5L9 1" />
          </svg>
        </span>
      </button>

      {open && menuStyle && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          data-dropdown-menu
          style={menuStyle}
          className="z-[90] overflow-y-auto overscroll-contain p-1 rounded-lg border border-line bg-elevated shadow-menu animate-argus-fade-in"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === focusedIndex;
            const heading = opt.group && opt.group !== options[idx - 1]?.group ? opt.group : null;
            return (
              <React.Fragment key={opt.value}>
                {heading && (
                  <p role="presentation" className={`px-2 pb-1 text-[10.5px] font-medium text-ink-dim ${idx > 0 ? 'pt-2.5 mt-1 border-t border-line' : 'pt-1.5'}`}>{heading}</p>
                )}
                <button
                  id={`${listId}-${idx}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  onClick={() => selectAndClose(opt.value)}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  className={`w-full text-left px-2 py-1.5 touch:px-3 touch:py-3 rounded-md transition-colors flex items-center gap-2 ${
                    // The list's cursor: a lit row with a bar at its edge, since the fill alone is faint
                    isFocused ? 'bg-chip text-ink-strong shadow-[inset_2px_0_0_rgb(var(--c-focus))]' : isSelected ? 'bg-chip/50 text-ink-strong' : 'text-ink'
                  }`}
                >
                  {opt.swatch && <Swatch background={opt.swatch} />}
                  <span className="block min-w-0 flex-1 truncate text-xs touch:text-[14px] font-medium">{opt.label}</span>
                  {isSelected && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="flex-shrink-0 text-ink-strong"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default Dropdown;
