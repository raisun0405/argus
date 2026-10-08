import React, { useLayoutEffect, useState } from 'react';
import {
  DEFAULT_PRESET, OPTIONS, ORB_LABELS, PRESETS, applyPreset, setChatDemo, setChatLook, useChatDemo, useChatLook,
  type ChatLook, type LoaderOrb, type PresetId,
} from './chatLook';
import { Orb } from './ChatLoader';
import { IconButton, Range, Segmented } from '../workspace/InspectorSection';

// --- TWEAK PANEL ---
// Every choice behind the chat's look, live: the default, the four options it was picked from, and
// any single part. Preview buttons show the loader, an error and the tour without making a request.
// Shown in local development (or with ?tweaks in the address). Built from the inspector's controls,
// so the two panels look and behave alike.

type Look = Omit<ChatLook, 'preset'>;

const icon = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS = {
  design: icon(<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>),
  background: icon(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m3 15 5-5 4 4 3-3 6 6" /></>),
  messages: icon(<path d="M21 14a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  composer: icon(<><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M7 12h6" /><circle cx="17" cy="12" r="1.3" fill="currentColor" /></>),
  loader: icon(<><circle cx="12" cy="12" r="8" strokeDasharray="3 3.2" /><circle cx="12" cy="12" r="2.4" fill="currentColor" /></>),
  preview: icon(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
};

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon: sectionIcon, children }) => (
  <section className="px-3 pt-3 pb-3.5 border-t border-line first:border-t-0">
    <p className="flex items-center gap-2 mb-2.5 text-[12px] font-semibold tracking-tight text-ink-strong">
      <span className="flex text-ink-muted [&>svg]:w-[14px] [&>svg]:h-[14px]">{sectionIcon}</span>
      {title}
    </p>
    <div className="space-y-3">{children}</div>
  </section>
);

const Label: React.FC<{ children: React.ReactNode; trailing?: React.ReactNode }> = ({ children, trailing }) => (
  <p className="flex items-center justify-between mb-1.5 text-[11px] font-medium text-ink-muted">{children}{trailing}</p>
);

// Up to four options: a segmented control. More: chips that wrap.
function Choice<K extends keyof Look>({ label, field, options }: { label?: string; field: K; options: { value: Look[K]; label: string }[] }) {
  const look = useChatLook();
  const ariaLabel = label ?? String(field);
  return (
    <div>
      {label && <Label>{label}</Label>}
      {options.length <= 4 ? (
        <Segmented
          ariaLabel={ariaLabel}
          value={String(look[field])}
          onChange={v => setChatLook({ [field]: options.find(o => String(o.value) === v)!.value } as Partial<Look>)}
          options={options.map(o => ({ value: String(o.value), label: o.label }))}
        />
      ) : (
        <div className="flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
          {options.map(o => {
            const on = look[field] === o.value;
            return (
              <button
                key={String(o.value)}
                type="button"
                aria-pressed={on}
                onClick={() => setChatLook({ [field]: o.value } as Partial<Look>)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
                  on ? 'bg-elevated border-line-2 text-ink-strong shadow-float' : 'border-line text-ink-muted hover:text-ink-strong hover:border-line-2'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Slider<K extends 'backgroundStrength' | 'orbSpeed'>({ label, field, min, max, step }: { label: string; field: K; min: number; max: number; step: number }) {
  const look = useChatLook();
  return (
    <div>
      <Label trailing={<span className="text-[11px] font-medium tabular-nums text-ink">{look[field].toFixed(field === 'orbSpeed' ? 1 : 2)}</span>}>{label}</Label>
      <Range value={look[field]} min={min} max={max} step={step} label={label} onChange={v => setChatLook({ [field]: v } as Partial<Look>)} />
    </div>
  );
}

const OrbPicker: React.FC<{ label: string; field: 'thinkingOrb' | 'workingOrb' }> = ({ label, field }) => {
  const look = useChatLook();
  return (
    <div>
      <Label>{label}</Label>
      <div className="grid grid-cols-4 gap-0.5 p-0.5 rounded-lg bg-input border border-line" role="group" aria-label={label}>
        {(Object.keys(ORB_LABELS) as LoaderOrb[]).map(kind => {
          const on = look[field] === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => setChatLook({ [field]: kind })}
              className={`flex flex-col items-center gap-1 py-2 rounded-md transition-all ${on ? 'bg-elevated ring-1 ring-line-2 shadow-float' : 'hover:bg-chip/60'}`}
            >
              <Orb kind={kind} size={20} speed={look.orbSpeed} />
              <span className={`text-[10.5px] font-medium ${on ? 'text-ink-strong' : 'text-ink-muted'}`}>{ORB_LABELS[kind]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// A preset as a choice card: its name, one line on what it is, and a radio mark
const PresetCard: React.FC<{ id: PresetId; name: string; wide?: boolean }> = ({ id, name, wide }) => {
  const look = useChatLook();
  const on = look.preset === id;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => applyPreset(id)}
      title={PRESETS[id].tagline}
      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${wide ? '' : 'min-h-[70px]'} ${
        on ? 'bg-chip/60 border-line-2 shadow-float' : 'border-line hover:border-line-2 hover:bg-chip/30'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11.5px] font-semibold leading-tight text-ink-strong">{name}</span>
        <span aria-hidden="true" className={`flex-shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center ${on ? 'border-ink-strong' : 'border-line-2'}`}>
          {on && <span className="w-1.5 h-1.5 rounded-full bg-ink-strong" />}
        </span>
      </span>
      <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-dim line-clamp-2">{PRESETS[id].tagline}</span>
    </button>
  );
};

const TweakPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const look = useChatLook();
  const demo = useChatDemo();
  const [copied, setCopied] = useState(false);
  // Docked just right of the chat, over the 3D view, so it never covers what it changes
  const [left, setLeft] = useState(12);
  useLayoutEffect(() => {
    const column = document.querySelector('[data-chat-column]');
    const place = () => {
      const rect = column?.getBoundingClientRect();
      setLeft(rect && rect.width > 0 && rect.right + 312 < window.innerWidth ? rect.right + 12 : 12);
    };
    place();
    const observer = new ResizeObserver(place);
    if (column) observer.observe(column);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(look, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard refused: nothing to show */ }
  };

  return (
    <div
      role="dialog"
      aria-label="Chat design tweaks"
      style={{ left }}
      className="fixed bottom-3 z-[70] w-[300px] max-w-[calc(100vw-1.5rem)] max-h-[min(84vh,720px)] flex flex-col rounded-xl border border-line bg-surface/95 backdrop-blur-xl shadow-overlay argus-rise"
    >
      <div className="flex items-center gap-2 pl-3 pr-2 h-11 border-b border-line flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted" aria-hidden="true"><path d="m15 4-1 1 5 5 1-1a3.5 3.5 0 0 0-5-5Z" /><path d="M14 5 3.5 15.5a2.1 2.1 0 0 0 3 3L17 8" /></svg>
        <span className="text-[13px] font-semibold tracking-tight text-ink-strong">Tweaks</span>
        <span className="h-[18px] px-1.5 rounded-full bg-chip text-[10px] font-medium leading-[18px] text-ink-muted">{look.preset === 'custom' ? 'Custom' : PRESETS[look.preset].name}</span>
        <span className="ml-auto" />
        <IconButton onClick={onClose} label="Close tweaks">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </IconButton>
      </div>

      <div className="overflow-y-auto">
        <Section title="Design" icon={ICONS.design}>
          <PresetCard id={DEFAULT_PRESET} name={PRESETS[DEFAULT_PRESET].name} wide />
          <div>
            <Label>The options it was picked from</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {OPTIONS.map((id, i) => <PresetCard key={id} id={id} name={`${String.fromCharCode(65 + i)} · ${PRESETS[id].name}`} />)}
            </div>
          </div>
        </Section>

        <Section title="Background" icon={ICONS.background}>
          <Choice field="background" options={[
            { value: 'none', label: 'None' }, { value: 'spotlight', label: 'Spotlight' }, { value: 'dots', label: 'Dots' },
            { value: 'lattice', label: 'Lattice' }, { value: 'aurora', label: 'Aurora' }, { value: 'constellation', label: 'Constellation' },
          ]} />
          <Slider label="Strength" field="backgroundStrength" min={0} max={1} step={0.05} />
        </Section>

        <Section title="Messages" icon={ICONS.messages}>
          <Choice label="Answers" field="messages" options={[{ value: 'document', label: 'Document' }, { value: 'cards', label: 'Cards' }, { value: 'timeline', label: 'Timeline' }]} />
          <Choice label="Your messages" field="userBubble" options={[{ value: 'subtle', label: 'Subtle' }, { value: 'outline', label: 'Outline' }, { value: 'accent', label: 'Accent' }]} />
          <Choice label="Text and spacing" field="density" options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
          <Choice label="Before the first question" field="emptyState" options={[{ value: 'hero', label: 'Welcome screen' }, { value: 'compact', label: 'One message' }]} />
        </Section>

        <Section title="Chatbox" icon={ICONS.composer}>
          <Choice label="Style" field="composer" options={[{ value: 'card', label: 'Card' }, { value: 'halo', label: 'Halo' }, { value: 'metal', label: 'Metal' }, { value: 'beam', label: 'Beam' }]} />
          <Choice label="Send button" field="send" options={[{ value: 'solid', label: 'Solid' }, { value: 'metal', label: 'Liquid metal' }]} />
          {look.send === 'metal' && (
            <Choice label="Metal" field="metalPreset" options={[{ value: 'chromatic', label: 'Chromatic' }, { value: 'silver', label: 'Silver' }, { value: 'gold', label: 'Gold' }]} />
          )}
          <Choice label="Border beam" field="beam" options={[{ value: 'off', label: 'Off' }, { value: 'focus', label: 'On focus' }, { value: 'busy', label: 'While busy' }, { value: 'always', label: 'Always' }]} />
          {look.beam !== 'off' && (
            <Choice label="Beam colour" field="beamColor" options={[{ value: 'mono', label: 'Mono' }, { value: 'colorful', label: 'Rainbow' }, { value: 'ocean', label: 'Ocean' }, { value: 'ice', label: 'Ice' }, { value: 'sunset', label: 'Sunset' }]} />
          )}
        </Section>

        <Section title="Loader" icon={ICONS.loader}>
          <Choice label="Layout" field="loader" options={[{ value: 'inline', label: 'Inline' }, { value: 'pill', label: 'Pill' }, { value: 'avatar', label: 'Avatar' }]} />
          <OrbPicker label="While the AI answers" field="thinkingOrb" />
          <OrbPicker label="While a tool runs" field="workingOrb" />
          <Slider label="Orb speed" field="orbSpeed" min={0.5} max={2} step={0.1} />
        </Section>

        <Section title="Preview without asking" icon={ICONS.preview}>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              ['think', 'Thinking', demo.loader === 'think', () => setChatDemo({ loader: demo.loader === 'think' ? null : 'think' })],
              ['work', 'Tool running', demo.loader === 'work', () => setChatDemo({ loader: demo.loader === 'work' ? null : 'work' })],
              ['error', 'Error', demo.error, () => setChatDemo({ error: !demo.error })],
              ['tour', 'Tour', demo.tour, () => setChatDemo({ tour: !demo.tour })],
            ] as [string, string, boolean, () => void][]).map(([id, label, on, toggle]) => (
              <button
                key={id}
                type="button"
                data-preview={id}
                aria-pressed={on}
                onClick={toggle}
                className={`h-8 flex items-center gap-2 px-2.5 rounded-md border text-[11px] font-medium transition-colors ${
                  on ? 'bg-chip/80 border-line-2 text-ink-strong shadow-float' : 'border-dashed border-line-2 text-ink-muted hover:text-ink-strong'
                }`}
              >
                <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-good' : 'bg-line-2'}`} />
                {label}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-line flex-shrink-0">
        <button type="button" onClick={copy} className="h-7 px-2.5 rounded-md bg-chip/70 border border-line-2 text-[11px] font-medium text-ink-strong hover:bg-chip transition-colors">
          {copied ? 'Copied' : 'Copy settings'}
        </button>
        <button
          type="button"
          onClick={() => applyPreset(look.preset === 'custom' ? DEFAULT_PRESET : look.preset)}
          className="h-7 px-2.5 rounded-md text-[11px] font-medium text-ink-muted hover:text-ink-strong hover:bg-chip/60 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
};

export default TweakPanel;
