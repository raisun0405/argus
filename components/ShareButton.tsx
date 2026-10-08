import React, { useEffect, useRef, useState } from 'react';

interface ShareButtonProps {
  getLink: () => string | null; // The link for the view on screen; null when it can't be shared
  disabledReason?: string; // Set when sharing isn't possible for what's on screen
}

/**
 * Header button that copies a link reopening the current view. Touch devices get the system share
 * sheet; when the clipboard is blocked, the link is shown to copy by hand.
 */
const ShareButton: React.FC<ShareButtonProps> = ({ getLink, disabledReason }) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [manualLink, setManualLink] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== 'copied') return;
    const timer = setTimeout(() => setStatus('idle'), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  // The manual-copy box closes on an outside click or Escape
  useEffect(() => {
    if (status !== 'manual') return;
    inputRef.current?.select();
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setStatus('idle');
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setStatus('idle'); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [status]);

  const share = async () => {
    const link = getLink();
    if (!link) return;
    const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
    if (touch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Argus view', url: link });
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // The user closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setStatus('copied');
    } catch {
      setManualLink(link);
      setStatus('manual');
    }
  };

  const copied = status === 'copied';
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={share}
        disabled={Boolean(disabledReason)}
        aria-label="Share this view"
        title={disabledReason ?? 'Copy a link that opens this exact view'}
        className={`w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          copied ? 'bg-chip text-ink-strong' : 'text-ink-muted enabled:hover:bg-chip/60 enabled:hover:text-ink-strong'
        }`}
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
        )}
      </button>

      {/* Announced to screen readers; shown as a small bubble under the button */}
      <span role="status" aria-live="polite" className={copied ? 'absolute right-0 top-full mt-2 whitespace-nowrap bg-surface border border-line rounded-lg shadow-menu px-2.5 py-1.5 text-[11px] font-medium text-ink animate-argus-fade-in' : 'sr-only'}>
        {copied ? 'Link copied — it opens this exact view' : ''}
      </span>

      {status === 'manual' && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-line rounded-xl shadow-menu z-50 p-3 animate-argus-fade-in">
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1.5">Copy this link</p>
          <input
            ref={inputRef}
            readOnly
            value={manualLink}
            onFocus={e => e.currentTarget.select()}
            aria-label="Link to this view"
            className="w-full px-2 py-1.5 rounded-md border border-line bg-input text-[11px] text-ink focus:outline-none focus:border-brand/40"
          />
        </div>
      )}
    </div>
  );
};

export default ShareButton;
