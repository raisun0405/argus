import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseSequenceInput } from '../../services/esmfoldService';
import { PromptLibraryPanel, type Prompt } from './PromptLibrary';

// --- THE COMPOSER'S + MENU ---
// What used to sit in the composer's row, behind one button: something to add (a sequence file), modes for the next message
// (Investigate, Co-fold; the chosen one shows as a chip beside the button, and is ticked here), and
// the prompt library one level down. As wide as the composer, and capped in height: the rest scrolls.
// A portal on document.body, like the dropdown menus: the composer's border beam clips anything inside
// it. Arrow keys move through the menu, Right opens the prompts and Escape goes back, then closes.

export type ComposerMode = 'investigate' | 'cofold';

export const MODES: Record<ComposerMode, { label: string; hint: string; about: string; placeholder: (subject?: string) => string }> = {
  investigate: {
    label: 'Investigate',
    hint: 'Step by step with tools',
    about: 'Argus plans the steps, runs its own tools, and cites each step in the answer',
    placeholder: () => 'Ask a question to investigate step by step…',
  },
  cofold: {
    label: 'Co-fold',
    hint: 'How a molecule binds',
    about: 'Boltz-2 predicts how a molecule binds the structure on screen, and how strongly',
    placeholder: () => 'Name a molecule: a drug, a PDB code or a SMILES…',
  },
};

const svg = (path: React.ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);
export const ModeIcon: React.FC<{ mode: ComposerMode; size?: number }> = ({ mode, size = 16 }) =>
  mode === 'investigate'
    ? svg(<><path d="M9 3h6M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3" /><path d="M7.5 15h9" /></>, size)
    : svg(<><path d="M9 3.5 15 7v7l-6 3.5L3 14V7z" /><path d="m15 14 3.6 2.2" /><circle cx="20.4" cy="17.6" r="2.1" /></>, size);
const FileIcon = () => svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>);
const BookIcon = () => svg(<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />);
const Plus = () => svg(<path d="M12 5v14M5 12h14" />, 18);
const Check = () => svg(<path d="M20 6 9 17l-5-5" />, 15);
const Chevron = ({ back = false }: { back?: boolean }) => svg(<path d={back ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />, 15);

const MENU_WIDTH = 300; // Without a composer to match (the menu is as wide as the composer otherwise)
const PROMPTS_WIDTH = 352;
const MAX_HEIGHT = 320; // What doesn't fit scrolls, so the menu never covers the conversation
const MIN_HEIGHT = 160;
const EDGE = 8; // Keeps the menu off the window's edges
const GAP = 8; // Between the composer and the menu
const MAX_FILE_BYTES = 2_000_000;
const SEQUENCE_FILES = '.fasta,.fa,.faa,.fas,.fsa,.seq,.txt,text/plain';

interface ComposerMenuProps {
  anchorRef?: React.RefObject<HTMLElement | null>; // Opens above this (the composer), so the text stays in view; else above the button
  mode: ComposerMode | null;
  onModeChange: (mode: ComposerMode | null) => void;
  cofoldReady: boolean | null; // null while asking the server
  subject?: string; // What is on screen, for the prompts
  metal: boolean; // The Metal look: pill-shaped controls, metal badges
  onInsert: (text: string) => void; // Fills the composer
}

const ComposerMenu: React.FC<ComposerMenuProps> = ({ anchorRef, mode, onModeChange, cofoldReady, subject, metal, onInsert }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'prompts'>('menu');
  const [anchor, setAnchor] = useState<DOMRect | null>(null); // The composer (or the button), while the menu is open
  const [fileError, setFileError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = (refocus = false) => {
    setOpen(false);
    setView('menu');
    setFileError(null);
    if (refocus) buttonRef.current?.focus();
  };

  // Clicks outside the button and the menu close it
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // The menu follows the composer: measured on opening, and again whenever anything scrolls or resizes
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setAnchor((anchorRef?.current ?? buttonRef.current)?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      setAnchor(null);
    };
  }, [open]);

  // Opening (or coming back from the prompts) puts the keyboard on the first item
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  useEffect(() => {
    if (open && anchor && view === 'menu') items()[0]?.focus();
  }, [open, anchor !== null, view]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (view === 'prompts') setView('menu');
      else close(true);
      return;
    }
    if (e.key === 'Tab') return close();
    if (view !== 'menu') return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      const at = (i + list.length) % list.length;
      const next = list[at];
      if (!next) return;
      next.focus();
      // Focus scrolls just enough to show the item. The ends go all the way, so the label above the first
      // item and the padding below the last show too, and a section's label comes into view with its item.
      const scroller = next.closest<HTMLElement>('[data-menu-scroll]');
      const label = next.previousElementSibling;
      if (scroller && at === 0) scroller.scrollTop = 0;
      else if (scroller && at === list.length - 1) scroller.scrollTop = scroller.scrollHeight;
      else if (label instanceof HTMLParagraphElement) label.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'ArrowRight' && (document.activeElement as HTMLElement | null)?.dataset.menuPrompts !== undefined) {
      e.preventDefault();
      setView('prompts');
    }
  };

  const pickMode = (next: ComposerMode) => {
    onModeChange(mode === next ? null : next);
    close(false);
  };

  const pickPrompt = (prompt: Prompt) => {
    // A mode this server can't run stays off; the request is spelled out instead, and sending it says why
    const unavailable = prompt.mode === 'cofold' && cofoldReady === false;
    if (prompt.mode && !unavailable) onModeChange(prompt.mode);
    onInsert(unavailable ? `Co-fold ${prompt.text}` : prompt.text);
    close(false);
  };

  // A sequence file goes into the composer as text; sending it folds it (services/esmfoldService)
  const readFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) return setFileError(`${file.name} is too large for a sequence file (2 MB at most).`);
    const text = (await file.text()).trim();
    if (!parseSequenceInput(text)) return setFileError(`${file.name} doesn't look like a protein sequence: use FASTA or plain one-letter codes.`);
    onInsert(text);
    close(false);
  };

  // As wide as the composer it opens above, and short enough to keep the conversation in
  // view: MAX_HEIGHT at most, and no more than 60% of the room above the composer
  const width = Math.min(anchorRef && anchor ? anchor.width : view === 'prompts' ? PROMPTS_WIDTH : MENU_WIDTH, window.innerWidth - 2 * EDGE);
  const room = anchor ? anchor.top - GAP - EDGE : 0;
  const style: React.CSSProperties | undefined = anchor
    ? {
        position: 'fixed',
        width,
        left: Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE)),
        bottom: window.innerHeight - anchor.top + GAP,
        maxHeight: Math.min(room, Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(room * 0.6)))),
      }
    : undefined;

  const item = 'w-full h-9 px-2.5 flex items-center gap-2.5 rounded-lg text-left outline-none transition-colors hover:bg-chip/70 focus-visible:bg-chip/70 disabled:opacity-45 disabled:hover:bg-transparent disabled:cursor-not-allowed';
  const sectionLabel = 'px-2.5 pt-2 pb-1 text-[11px] font-medium text-ink-dim';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-composer-menu
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add a sequence file, pick a mode, or browse prompts"
        title="Add, modes and prompts"
        className={`flex-shrink-0 h-chat-button w-chat-button flex items-center justify-center transition-colors ${metal ? 'rounded-full border border-line bg-chip/50' : 'rounded-full'} ${
          open ? 'bg-chip text-ink-strong' : 'text-ink-muted hover:text-ink-strong hover:bg-chip/60'
        }`}
      >
        <span className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`}><Plus /></span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={SEQUENCE_FILES}
        className="hidden"
        data-sequence-file
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void readFile(file);
        }}
      />

      {open && style && createPortal(
        <div
          ref={menuRef}
          role={view === 'menu' ? 'menu' : 'dialog'}
          aria-label={view === 'menu' ? 'Add, modes and prompts' : 'Prompt library'}
          data-composer-menu-panel={view}
          style={style}
          onKeyDown={onKeyDown}
          className="flex flex-col rounded-2xl border border-line bg-surface/95 backdrop-blur-xl shadow-menu z-[60] argus-rise overflow-hidden"
        >
          {view === 'menu' ? (
            <div className="min-h-0 overflow-y-auto argus-menu-scroll p-1.5" data-menu-scroll>
              <p className={sectionLabel} aria-hidden="true">Add</p>
              <button type="button" role="menuitem" data-menu-item="sequence-file" className={item} onClick={() => { setFileError(null); fileRef.current?.click(); }}>
                <span className="flex-shrink-0 text-ink-muted"><FileIcon /></span>
                <span className="text-[13px] font-medium text-ink-strong whitespace-nowrap">Sequence file</span>
                <span className="min-w-0 truncate text-[12px] text-ink-dim">Fold a FASTA file</span>
              </button>
              {fileError && <p role="alert" className="mx-2.5 mt-1 mb-1.5 text-[11.5px] leading-snug text-bad">{fileError}</p>}

              <p className={sectionLabel} aria-hidden="true">Modes</p>
              {(Object.keys(MODES) as ComposerMode[]).map(m => {
                const unavailable = m === 'cofold' && cofoldReady === false;
                return (
                  <button
                    key={m}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={mode === m}
                    data-menu-mode={m}
                    disabled={unavailable}
                    title={unavailable ? "Co-folding isn't set up on this server (it needs an NVIDIA API key)" : MODES[m].about}
                    className={item}
                    onClick={() => pickMode(m)}
                  >
                    <span className={`flex-shrink-0 ${mode === m ? 'text-ink-strong' : 'text-ink-muted'}`}><ModeIcon mode={m} /></span>
                    <span className="text-[13px] font-medium text-ink-strong whitespace-nowrap">{MODES[m].label}</span>
                    <span className="min-w-0 truncate text-[12px] text-ink-dim">{unavailable ? 'Not set up on this server' : MODES[m].hint}</span>
                    <span className="ml-auto flex-shrink-0 text-ink-strong">{mode === m && <Check />}</span>
                  </button>
                );
              })}

              <div className="my-1.5 mx-2.5 border-t border-line" aria-hidden="true" />
              <button type="button" role="menuitem" data-menu-prompts aria-haspopup="dialog" className={item} onClick={() => setView('prompts')}>
                <span className="flex-shrink-0 text-ink-muted"><BookIcon /></span>
                <span className="text-[13px] font-medium text-ink-strong whitespace-nowrap">Prompts</span>
                <span className="min-w-0 truncate text-[12px] text-ink-dim">Ideas to start from</span>
                <span className="ml-auto flex-shrink-0 text-ink-dim"><Chevron /></span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex-none flex items-center gap-1 px-1.5 pt-1.5">
                <button
                  type="button"
                  onClick={() => setView('menu')}
                  aria-label="Back to the menu"
                  className="h-7 pl-1 pr-2 inline-flex items-center gap-0.5 rounded-md text-[12px] font-medium text-ink-muted hover:text-ink-strong hover:bg-chip/60 transition-colors"
                >
                  <Chevron back />
                  Prompts
                </button>
              </div>
              <PromptLibraryPanel subject={subject} metal={metal} onPick={pickPrompt} />
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
};

export default ComposerMenu;
