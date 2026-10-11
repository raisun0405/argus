import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BorderBeam } from 'border-beam';
import { THEMES } from '../../themes';
import { useTheme } from '../../useTheme';
import type { ChatLook } from './chatLook';
import ComposerMenu, { MODES, ModeIcon, type ComposerMode } from './ComposerMenu';

// Liquid metal is WebGL and only the metal looks use it: fetched the first time one is picked
const MetalFx = lazy(() => import('metal-fx').then(m => ({ default: m.MetalFx })));

// --- COMPOSER ---
// The composer: the text on top, a row underneath with
// the + menu (a sequence file, modes, prompts) and the chosen mode's chip at its start, the model,
// the mic and a round send button at its end. Four finishes: a plain card, a frosted halo
// rim, a liquid-metal send ring (metal-fx) with pill chips, and a border beam along the edge.

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean; // Sending waits until the current answer or tool run is done
  working?: boolean; // Drives the busy beam and glow: busy, or a tweak-panel preview of busy (defaults to busy)
  listening: boolean;
  micAvailable: boolean;
  onToggleMic: () => void;
  subject?: string; // What is on screen, for the prompt library
  modelLabel: string;
  look: ChatLook;
  focusSignal?: number; // Changes when something else wants the composer focused (a picked prompt)
  mode?: ComposerMode | null; // The mode the next message is sent in (Investigate, Co-fold)
  onModeChange?: (mode: ComposerMode | null) => void;
  cofoldReady?: boolean | null; // Whether this server can co-fold (null while asking)
}

const ArrowUp = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
const MicIcon = ({ on }: { on: boolean }) => on
  ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></svg>;

const Composer: React.FC<ComposerProps> = ({ value, onChange, onSubmit, busy, working = busy, listening, micAvailable, onToggleMic, subject, modelLabel, look, focusSignal, mode = null, onModeChange, cofoldReady = null }) => {
  const [themeId] = useTheme();
  const dark = THEMES[themeId].colorScheme !== 'light';
  const [focused, setFocused] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null); // The + menu opens above it, so what's typed stays in view

  // Grows with its text up to about six lines
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);
  useEffect(() => { if (focusSignal) textRef.current?.focus(); }, [focusSignal]);

  const canSend = value.trim() !== '' && !busy;
  const metalChips = look.composer === 'metal';
  const beamActive = look.beam === 'always' || (look.beam === 'focus' && focused) || (look.beam === 'busy' && working);

  const sendButton = (metal: boolean) => (
    <button
      type="submit"
      data-chat-send
      disabled={!canSend}
      aria-label="Send"
      title="Send (Enter)"
      className={`w-chat-button h-chat-button rounded-full flex items-center justify-center disabled:cursor-not-allowed ${
        metal ? 'bg-canvas text-ink-strong disabled:text-ink-dim' : 'bg-brand text-brand-ink transition-all hover:opacity-90 disabled:bg-chip disabled:text-ink-dim'
      }`}
    >
      <ArrowUp />
    </button>
  );

  const box = (
    <div
      // The border follows the browser's own focus (focus-within), which never misses an event, in the
      // dim text colour: 3:1 or more against the page in every theme
      className={`relative flex flex-col transition-colors border border-line focus-within:border-ink-dim ${
        look.composer === 'halo'
          ? 'rounded-2xl bg-surface/55 backdrop-blur-xl'
          : look.composer === 'metal'
            ? 'rounded-2xl bg-elevated shadow-float'
            : 'rounded-2xl bg-input/90 backdrop-blur [&:hover:not(:focus-within)]:border-line-2 shadow-float'
      }`}
    >
      {/* The halo: a warm-to-violet glow along the bottom rim, stronger while focused */}
      {look.composer === 'halo' && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden">
          <div className="absolute -bottom-6 left-[8%] right-[8%] h-12 rounded-full transition-opacity duration-300" style={{ opacity: focused || working ? 0.9 : 0.55, background: 'linear-gradient(90deg, rgb(255 138 61 / 0.55), rgb(236 72 153 / 0.45), rgb(139 92 246 / 0.5), rgb(59 130 246 / 0.4))', filter: 'blur(18px)' }} />
        </div>
      )}
      <textarea
        ref={textRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        rows={1}
        placeholder={listening ? 'Listening…' : mode ? MODES[mode].placeholder(subject) : 'Ask Argus about a protein, or paste a sequence…'}
        aria-label="Message Argus"
        className="relative w-full resize-none bg-transparent px-4 pt-chat-input-top pb-1 text-chat leading-6 text-ink placeholder:text-ink-dim caret-brand-fg focus:outline-none min-h-chat-input"
      />
      <div className="relative flex items-center gap-1 px-2 pb-2 pt-1">
        {onModeChange && (
          <ComposerMenu
            anchorRef={formRef}
            mode={mode}
            onModeChange={next => { onModeChange(next); textRef.current?.focus(); }}
            cofoldReady={cofoldReady}
            subject={subject}
            metal={metalChips}
            onInsert={text => { onChange(text); textRef.current?.focus(); }}
          />
        )}
        {/* The chosen mode, as a chip: good for the next message, gone with × */}
        {mode && onModeChange && (
          <span
            data-mode-chip={mode}
            className={`min-w-0 h-chat-button inline-flex items-center gap-1.5 pl-2.5 pr-1 rounded-full text-[12px] font-medium text-ink-strong ${metalChips ? 'border border-line-2 bg-chip/70' : 'bg-chip'}`}
          >
            <span className="flex-shrink-0"><ModeIcon mode={mode} size={14} /></span>
            <span className="truncate">{MODES[mode].label}</span>
            <button
              type="button"
              onClick={() => { onModeChange(null); textRef.current?.focus(); }}
              aria-label={`Turn off ${MODES[mode].label}`}
              title={`Turn off ${MODES[mode].label}`}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-ink-muted hover:text-ink-strong hover:bg-line transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </span>
        )}
        <span className="ml-auto mr-1 text-[10px] text-ink-dim whitespace-nowrap hidden min-[360px]:inline" title="The model answering">{modelLabel}</span>
        {micAvailable && (
          <button
            type="button"
            onClick={onToggleMic}
            title={listening ? 'Stop listening' : 'Speak your question'}
            aria-label={listening ? 'Stop listening' : 'Speak your question'}
            aria-pressed={listening}
            className={`h-chat-button w-chat-button flex items-center justify-center transition-colors ${metalChips ? 'rounded-full border border-line bg-chip/50' : 'rounded-lg'} ${
              listening ? 'text-ink-strong bg-chip animate-pulse' : 'text-ink-muted hover:text-ink-strong hover:bg-chip/60'
            }`}
          >
            <MicIcon on={listening} />
          </button>
        )}
        {look.send === 'metal' ? (
          <Suspense fallback={sendButton(true)}>
            <MetalFx preset={look.metalPreset} variant="circle" innerShadow theme={dark ? 'dark' : 'light'} strength={canSend ? 1 : 0.55}>
              {sendButton(true)}
            </MetalFx>
          </Suspense>
        ) : sendButton(false)}
      </div>
    </div>
  );

  return (
    <form
      ref={formRef}
      data-chat-composer
      onSubmit={e => { e.preventDefault(); if (canSend) onSubmit(); }}
      className="relative"
    >
      {look.beam !== 'off' ? (
        <BorderBeam size="md" colorVariant={look.beamColor} theme={dark ? 'dark' : 'light'} active={beamActive} borderRadius={16} strength={0.85} className="w-full">
          {box}
        </BorderBeam>
      ) : box}
    </form>
  );
};

export default Composer;
