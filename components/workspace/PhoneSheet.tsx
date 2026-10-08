import React, { useRef, useState } from 'react';

// --- PHONE SHEET ---
// A phone has no room beside the canvas for the inspector or the tools, so they rise from the bottom
// over it, the way maps and photo apps show their panels: half the height at first, with the
// structure still in view above (the canvas shrinks to the space left, so the molecule stays whole),
// dragged up for more room, or down to put it away. A tap on the handle switches between the two.

export type SheetSize = 'half' | 'full';
export const SHEET_HEIGHT: Record<SheetSize, number> = { half: 56, full: 92 }; // % of the space under the sequence

interface PhoneSheetProps {
  title: string;
  label?: string; // For screen readers, when the title alone is vague
  size: SheetSize;
  onSize: (size: SheetSize) => void;
  onClose: () => void;
  onBack?: () => void; // One step back inside the sheet (a tool's menu back to the list of tools)
  sheetRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

const PhoneSheet: React.FC<PhoneSheetProps> = ({ title, label, size, onSize, onClose, onBack, sheetRef, children }) => {
  const [dragged, setDragged] = useState<number | null>(null); // Height (%) while a finger moves it
  const drag = useRef<{ y: number; from: number; moved: boolean; space: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return; // Its buttons stay buttons
    const space = rootRef.current?.parentElement?.getBoundingClientRect().height ?? 0;
    if (!space) return;
    drag.current = { y: e.clientY, from: SHEET_HEIGHT[size], moved: false, space };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return; // Still a tap
    d.moved = true;
    setDragged(Math.max(10, Math.min(96, d.from - (dy / d.space) * 100)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      onSize(size === 'half' ? 'full' : 'half');
      return;
    }
    const at = dragged ?? d.from;
    setDragged(null);
    if (at < 32) onClose();
    else onSize(at < (SHEET_HEIGHT.half + SHEET_HEIGHT.full) / 2 ? 'half' : 'full');
  };

  return (
    <div
      ref={node => {
        rootRef.current = node;
        if (typeof sheetRef === 'function') sheetRef(node);
        else if (sheetRef) (sheetRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      role="dialog"
      aria-label={label ?? title}
      data-phone-sheet={size}
      className="absolute inset-x-0 bottom-0 z-40 flex flex-col bg-surface border-t border-line-2 rounded-t-2xl shadow-overlay animate-argus-fade-in"
      style={{ height: `${dragged ?? SHEET_HEIGHT[size]}%`, transition: dragged === null ? 'height 240ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none' }}
    >
      {/* The handle and the title bar are one grip */}
      <div
        className="flex-shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setDragged(null); }}
      >
        <div className="flex justify-center pt-2 pb-0.5" aria-hidden="true">
          <span className="w-9 h-1 rounded-full bg-line-2" />
        </div>
        <div className="flex items-center gap-1 h-11 px-1.5 border-b border-line">
          {onBack ? (
            <button type="button" onClick={onBack} aria-label="Back" className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg text-ink-muted active:bg-chip">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          ) : (
            <span className="w-2 flex-shrink-0" />
          )}
          <p className="flex-1 min-w-0 truncate text-[15px] font-semibold tracking-tight text-ink-strong">{title}</p>
          <button
            type="button"
            onClick={() => onSize(size === 'half' ? 'full' : 'half')}
            aria-label={size === 'half' ? 'Expand' : 'Shrink'}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg text-ink-muted active:bg-chip"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${size === 'full' ? 'rotate-180' : ''}`}><path d="m18 15-6-6-6 6" /></svg>
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg text-ink-muted active:bg-chip">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-phone-sheet-body>
        {children}
      </div>
    </div>
  );
};

export default PhoneSheet;
