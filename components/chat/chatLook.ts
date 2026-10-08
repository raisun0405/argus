import { useSyncExternalStore } from 'react';
import type { OrbState } from 'thinking-orbs';

// --- HOW THE CHAT LOOKS ---
// The chat column's design, as a handful of independent choices (background, message layout,
// composer, loader...). The default is the mix picked from four finished directions (A-D, kept as
// presets); the tweak panel changes any choice live. Kept in this browser only (localStorage).

export type ChatBackground = 'none' | 'spotlight' | 'dots' | 'lattice' | 'aurora' | 'constellation';
export type MessageStyle = 'document' | 'cards' | 'timeline';
export type UserBubble = 'subtle' | 'outline' | 'accent';
export type ComposerStyle = 'card' | 'halo' | 'metal' | 'beam';
export type SendStyle = 'solid' | 'metal';
export type MetalPreset = 'chromatic' | 'silver' | 'gold';
export type BeamMode = 'off' | 'focus' | 'busy' | 'always';
export type BeamColor = 'mono' | 'colorful' | 'ocean' | 'ice' | 'sunset';
export type LoaderLayout = 'inline' | 'pill' | 'avatar';
export type LoaderOrb = 'thinking' | 'working' | 'planning' | 'ring';
export type PresetId = 'default' | 'studio' | 'halo' | 'metal' | 'constellation';

export interface ChatLook {
  preset: PresetId | 'custom';
  background: ChatBackground;
  backgroundStrength: number; // 0-1
  messages: MessageStyle;
  userBubble: UserBubble;
  composer: ComposerStyle;
  send: SendStyle;
  metalPreset: MetalPreset;
  beam: BeamMode;
  beamColor: BeamColor;
  loader: LoaderLayout;
  thinkingOrb: LoaderOrb; // While the AI writes an answer
  workingOrb: LoaderOrb; // While a tool runs (Co-fold, Foldseek, STRING, ESMFold)
  orbSpeed: number;
  emptyState: 'hero' | 'compact';
  density: 'comfortable' | 'compact';
}

/**
 * The four orbs in the reference screenshots, mapped to thinking-orbs states: "Thinking" (striped
 * sphere), "Working" (particles on orbits), "Agent planning" (constellation) and "Agent thinking"
 * (a morphing dotted ring).
 */
export const ORB_STATES: Record<LoaderOrb, OrbState> = {
  thinking: 'composing',
  working: 'working',
  planning: 'connecting',
  ring: 'breathing',
};

export const ORB_LABELS: Record<LoaderOrb, string> = { thinking: 'Thinking', working: 'Working', planning: 'Planning', ring: 'Ring' };

type Look = Omit<ChatLook, 'preset'>;

export const PRESETS: Record<PresetId, { name: string; tagline: string; look: Look }> = {
  default: {
    name: 'Default',
    tagline: 'The picked mix: a soft spotlight, plain answers, a rainbow beam while the AI works',
    look: {
      background: 'spotlight', backgroundStrength: 1, messages: 'document', userBubble: 'subtle',
      composer: 'beam', send: 'solid', metalPreset: 'silver', beam: 'busy', beamColor: 'colorful',
      loader: 'inline', thinkingOrb: 'ring', workingOrb: 'planning', orbSpeed: 1, emptyState: 'hero', density: 'compact',
    },
  },
  studio: {
    name: 'Studio',
    tagline: 'Quiet and document-like: answers read as text, a soft light from above',
    look: {
      background: 'spotlight', backgroundStrength: 0.7, messages: 'document', userBubble: 'subtle',
      composer: 'card', send: 'solid', metalPreset: 'chromatic', beam: 'off', beamColor: 'mono',
      loader: 'inline', thinkingOrb: 'thinking', workingOrb: 'working', orbSpeed: 1, emptyState: 'hero', density: 'comfortable',
    },
  },
  halo: {
    name: 'Halo',
    tagline: 'Frosted cards over a slow aurora; the composer glows while the AI works',
    look: {
      background: 'aurora', backgroundStrength: 0.75, messages: 'cards', userBubble: 'subtle',
      composer: 'halo', send: 'solid', metalPreset: 'chromatic', beam: 'busy', beamColor: 'colorful',
      loader: 'pill', thinkingOrb: 'thinking', workingOrb: 'working', orbSpeed: 1, emptyState: 'hero', density: 'comfortable',
    },
  },
  metal: {
    name: 'Metal',
    tagline: 'Graphite and liquid metal over a faint molecular lattice',
    look: {
      background: 'lattice', backgroundStrength: 0.55, messages: 'document', userBubble: 'outline',
      composer: 'metal', send: 'metal', metalPreset: 'chromatic', beam: 'off', beamColor: 'mono',
      loader: 'inline', thinkingOrb: 'thinking', workingOrb: 'working', orbSpeed: 1, emptyState: 'hero', density: 'comfortable',
    },
  },
  constellation: {
    name: 'Constellation',
    tagline: 'A research log: answers on a timeline, the orb working beside each step',
    look: {
      background: 'constellation', backgroundStrength: 0.7, messages: 'timeline', userBubble: 'subtle',
      composer: 'beam', send: 'solid', metalPreset: 'silver', beam: 'focus', beamColor: 'ice',
      loader: 'avatar', thinkingOrb: 'thinking', workingOrb: 'working', orbSpeed: 1, emptyState: 'hero', density: 'comfortable',
    },
  },
};

/** The four directions the default was picked from, lettered A-D in the tweak panel. */
export const OPTIONS: PresetId[] = ['studio', 'halo', 'metal', 'constellation'];

export const DEFAULT_PRESET: PresetId = 'default';
const KEY = 'argus-chat-look';
const fromPreset = (id: PresetId): ChatLook => ({ preset: id, ...PRESETS[id].look });

/** The preset a look matches choice for choice, or "custom". */
const presetOf = (look: Look): PresetId | 'custom' =>
  (Object.keys(PRESETS) as PresetId[]).find(id =>
    (Object.keys(PRESETS[id].look) as (keyof Look)[]).every(k => PRESETS[id].look[k] === look[k]),
  ) ?? 'custom';

const read = (): ChatLook => {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (stored && typeof stored === 'object') {
      // A named option always loads as currently defined; only a custom look keeps its own choices
      if (Object.keys(PRESETS).includes(stored.preset)) return fromPreset(stored.preset);
      const look = { ...PRESETS[DEFAULT_PRESET].look, ...stored };
      return { ...look, preset: presetOf(look) };
    }
  } catch {
    // Unreadable or blocked storage: the default look
  }
  return fromPreset(DEFAULT_PRESET);
};

let current: ChatLook = typeof window === 'undefined' ? fromPreset(DEFAULT_PRESET) : read();
const listeners = new Set<() => void>();
const publish = () => {
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* the change still applies for this visit */ }
  listeners.forEach(l => l());
};

export const useChatLook = () => useSyncExternalStore(
  (l) => { listeners.add(l); return () => listeners.delete(l); },
  () => current,
  () => current,
);

/** Change one or more choices; the look is named after the preset it now matches, if any. */
export const setChatLook = (patch: Partial<Look>) => {
  const next = { ...current, ...patch };
  current = { ...next, preset: presetOf(next) };
  publish();
};

export const applyPreset = (id: PresetId) => {
  current = fromPreset(id);
  publish();
};

// --- PREVIEW STATES (tweak panel only): show the loader, an error or the tour without real requests ---

export interface ChatDemo { loader: 'think' | 'work' | null; error: boolean; tour: boolean }
let demo: ChatDemo = { loader: null, error: false, tour: false };
const demoListeners = new Set<() => void>();
export const useChatDemo = () => useSyncExternalStore(
  (l) => { demoListeners.add(l); return () => demoListeners.delete(l); },
  () => demo,
  () => demo,
);
export const setChatDemo = (patch: Partial<ChatDemo>) => {
  demo = { ...demo, ...patch };
  demoListeners.forEach(l => l());
};

/** The tweak panel shows in local development, or anywhere with ?tweaks in the address. */
export const tweaksEnabled = () => {
  if (typeof window === 'undefined') return false;
  const { hostname, search } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || new URLSearchParams(search).has('tweaks');
};
