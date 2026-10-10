import React, { useEffect, useId, useRef, useState } from 'react';
import { THEME_LIST, type ThemeDef } from '../themes';
import { useTheme } from '../useTheme';

/** Palette preview: the theme's canvas with its accent in front (colours of the theme offered). */
const Swatch: React.FC<{ theme: ThemeDef }> = ({ theme }) => (
  <span
    className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full"
    style={{ background: theme.colors.canvas, boxShadow: `inset 0 0 0 1px ${theme.colors.line2}` }}
  >
    <span className="block h-2 w-2 rounded-full" style={{ background: theme.colors.brand }} />
  </span>
);

/**
 * Theme picker: one icon button in the header (styled like the tour button) that
 * opens a small menu of palettes. Keyboard: arrows move, Enter/Space pick, Escape closes.
 */
const ThemeSwitcher: React.FC = () => {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  // Close on a click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[focused]?.focus();
  }, [open, focused]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const pick = (id: ThemeDef['id']) => {
    setTheme(id);
    close();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocused(i => (i + 1) % THEME_LIST.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocused(i => (i - 1 + THEME_LIST.length) % THEME_LIST.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocused(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocused(THEME_LIST.length - 1);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const current = THEME_LIST.find(t => t.id === theme) ?? THEME_LIST[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          // Opens with the active theme focused
          if (!open) setFocused(Math.max(0, THEME_LIST.findIndex(t => t.id === theme)));
          setOpen(o => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Colour theme: ${current.name}`}
        title="Colour theme"
        className={`w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors ${
          open ? 'bg-chip text-ink-strong' : 'text-ink-muted hover:bg-chip/60 hover:text-ink-strong'
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Colour theme"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full mt-2 w-56 touch:w-64 bg-surface border border-line rounded-xl shadow-menu z-50 p-1 animate-argus-fade-in"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Colour theme</p>
          {THEME_LIST.map((t, idx) => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                ref={el => { itemRefs.current[idx] = el; }}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={idx === focused ? 0 : -1}
                onClick={() => pick(t.id)}
                // The mouse lights a row by hovering; only the keyboard moves focus (a hover that moved
                // focus made the arrow keys jump from wherever the pointer happened to rest)
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 touch:py-2.5 rounded-lg text-left transition-colors outline-none hover:bg-chip focus-visible:shadow-[inset_2px_0_0_rgb(var(--c-focus))] ${
                  active ? 'bg-brand/15' : idx === focused ? 'bg-chip' : ''
                }`}
              >
                <Swatch theme={t} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs touch:text-[14px] font-semibold leading-tight ${active ? 'text-brand-text' : 'text-ink-strong'}`}>{t.name}</span>
                  <span className="block text-[10px] touch:text-[12px] text-ink-dim leading-tight truncate">{t.tagline}</span>
                </span>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-brand-text">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThemeSwitcher;
