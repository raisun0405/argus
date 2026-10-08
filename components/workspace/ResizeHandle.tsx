import React, { useCallback, useEffect, useRef } from 'react';

// --- RESIZE HANDLE ---
// The divider between the chat and the workspace. Built to the WAI-ARIA window-splitter pattern, so
// it is not a mouse-only control: it takes focus, arrow keys move it, Home/End jump to the limits and
// Enter collapses or restores. Sizes are remembered, which every guide on split panes insists on
// because people expect a layout to survive a reload.

interface ResizeHandleProps {
  value: number; // Current size of the pane before the handle, px
  min: number;
  max: number;
  onChange: (value: number) => void;
  onToggleCollapse?: () => void;
  label: string;
  collapsed?: boolean;
  invert?: boolean; // The handle sits on the pane's left edge (an inspector), so drag direction flips
}

const STEP = 16;

const ResizeHandle: React.FC<ResizeHandleProps> = ({ value, min, max, onChange, onToggleCollapse, label, collapsed, invert }) => {
  const dragging = useRef<{ startX: number; startValue: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = { startX: e.clientX, startValue: value };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const stop = useCallback(() => {
    dragging.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag) return;
    const delta = (e.clientX - drag.startX) * (invert ? -1 : 1);
    onChange(Math.min(max, Math.max(min, drag.startValue + delta)));
  };

  useEffect(() => () => stop(), [stop]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const back = invert ? 'ArrowRight' : 'ArrowLeft';
    const forward = invert ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === back) {
      e.preventDefault();
      onChange(Math.max(min, value - step));
    } else if (e.key === forward) {
      e.preventDefault();
      onChange(Math.min(max, value + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    } else if ((e.key === 'Enter' || e.key === ' ') && onToggleCollapse) {
      e.preventDefault();
      onToggleCollapse();
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={collapsed ? 0 : Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onToggleCollapse}
      onKeyDown={onKeyDown}
      title={`${label} — drag, or arrow keys${onToggleCollapse ? '; double-click to collapse' : ''}`}
      // A 1px line with a comfortable grab area around it
      className="group relative w-px flex-shrink-0 bg-line cursor-col-resize hover:bg-brand/50 focus-visible:bg-brand transition-colors"
    >
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 z-10" />
    </div>
  );
};

export default ResizeHandle;

/**
 * Remembered pane sizes: the layout survives a reload, as people expect of a split view. Only a size
 * someone dragged to is kept; the default isn't, so a later default reaches everyone who never chose.
 * `retired` lists earlier defaults, which older versions saved for every visitor: read as unset.
 */
export const usePaneSize = (key: string, fallback: number, retired: number[] = []) => {
  const [size, setSize] = React.useState<number>(() => {
    if (typeof window === 'undefined') return fallback;
    const saved = Number(window.localStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 && !retired.includes(saved) ? saved : fallback;
  });
  useEffect(() => {
    try {
      if (Math.round(size) === fallback) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, String(Math.round(size)));
    } catch {
      // Private window, or storage is full: the size just won't be remembered
    }
  }, [key, size]);
  return [size, setSize] as const;
};
