// Single source of truth for Argus colour themes.
//
// Every colour is emitted as a CSS variable (buildThemeCss) and the Tailwind
// config (tailwind.config.js) maps its colour names onto them, so switching theme is
// one attribute change on <html> — no re-render, no reload.
//
// Palettes:
//   mono    - the default: a near-black zinc workspace, white as the accent
//   crimson - dark, crimson accent
//   noir    - dark, lime accent
//   paper   - light, black / white / zinc
//   lime    - light, lime accent
//   peach   - light, warm sand with an orange accent
//
// Mono is the default because the workspace is built around a 3D canvas: the UI stays neutral so
// the only saturated colour on screen belongs to the molecule, and its canvas matches the app
// background exactly, so the viewer reads as the page rather than as a card on it. The greys are
// Tailwind's zinc scale.

export type ThemeId = 'mono' | 'crimson' | 'noir' | 'paper' | 'lime' | 'peach';

export interface ThemeColors {
  canvas: string; // Page and panel background
  surface: string; // Cards sitting on the canvas
  elevated: string; // Chat bubbles
  input: string; // Text fields, dropdowns
  chip: string; // Small pills, hover fills
  hover: string;
  line: string; // Borders
  line2: string; // Stronger borders, dividers
  ink: string; // Body text
  inkStrong: string; // Headings
  inkMuted: string; // Labels
  inkDim: string; // Hints, placeholders: the quietest text, still 4.5:1 (WCAG AA) on every surface above
  brand: string; // Accent fills (buttons, user bubble, toggles)
  brandDark: string; // Pressed / hover fill
  brandFg: string; // Accent used as text and 3D highlights — readable on the canvas
  brandText: string; // Soft accent text for hover states and tinted chips
  brandInk: string; // Text drawn on a solid brand fill
  good: string;
  warn: string;
  bad: string;
  focus: string; // Keyboard focus ring — must read against canvas, surface and brand alike
  viewerBg: string; // Background handed to the 3Dmol WebGL canvas
  scrollThumb: string;
  scrollThumbHover: string;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  tagline: string;
  colorScheme: 'light' | 'dark';
  colors: ThemeColors;
  shadowRgb: string; // Base colour of neutral shadows ("r g b")
  shadowStrength: number; // Multiplier on neutral shadow opacity (1 = full-strength dark shadows)
}

export const THEME_STORAGE_KEY = 'argus-theme';
export const DEFAULT_THEME: ThemeId = 'mono';

export const THEMES: Record<ThemeId, ThemeDef> = {
  mono: {
    id: 'mono',
    name: 'Mono',
    tagline: 'Near-black zinc',
    colorScheme: 'dark',
    colors: {
      canvas: '#09090B', // zinc-950: the workspace and the 3D canvas share it
      surface: '#121214', // Strips and the inspector, a step above the canvas
      elevated: '#18181B', // zinc-900: cards and chat bubbles
      input: '#18181B',
      chip: '#27272A', // zinc-800
      hover: '#27272A',
      line: '#27272A',
      line2: '#3F3F46', // zinc-700
      ink: '#E4E4E7', // zinc-200
      inkStrong: '#FAFAFA', // zinc-50
      inkMuted: '#A1A1AA', // zinc-400
      inkDim: '#8D8D94', // Between zinc-500 and 400: the dimmest grey that still reads on a chip (4.5:1)
      brand: '#FAFAFA', // In a monochrome UI the accent is light-on-dark
      brandDark: '#D4D4D8',
      brandFg: '#FAFAFA',
      brandText: '#FAFAFA',
      brandInk: '#09090B',
      // Status stays in colour: grey alone cannot carry meaning (WCAG 1.4.1)
      good: '#4ADE80',
      warn: '#FBBF24',
      bad: '#F87171',
      focus: '#FAFAFA',
      viewerBg: '#09090B',
      scrollThumb: '#3F3F46',
      scrollThumbHover: '#52525B',
    },
    shadowRgb: '0 0 0',
    shadowStrength: 1,
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson',
    tagline: 'Dark, crimson accent',
    colorScheme: 'dark',
    colors: {
      canvas: '#050505',
      surface: '#0A0A0A',
      elevated: '#111111',
      input: '#0C0C0C',
      chip: '#141414',
      hover: '#1A1A1A',
      line: '#222222',
      line2: '#2A2A2A',
      ink: '#E0E0E0',
      inkStrong: '#FFFFFF',
      inkMuted: '#888888',
      inkDim: '#7E7E7E', // Was #555555 (2.5:1); lifted to pass 4.5:1 on every surface, the one change to the original look
      brand: '#C43036',
      brandDark: '#A82A2F',
      brandFg: '#C43036',
      brandText: '#E87D80',
      brandInk: '#FFFFFF',
      good: '#4ADE80',
      warn: '#FBBF24',
      bad: '#E87D80',
      focus: '#F87171',
      viewerBg: '#050505',
      scrollThumb: '#222222',
      scrollThumbHover: '#C43036',
    },
    shadowRgb: '0 0 0',
    shadowStrength: 1,
  },

  noir: {
    id: 'noir',
    name: 'Noir',
    tagline: 'Dark, lime accent',
    colorScheme: 'dark',
    colors: {
      canvas: '#0C0D0B',
      surface: '#121310',
      elevated: '#1A1B18',
      input: '#131410',
      chip: '#1F211C',
      hover: '#262823',
      line: '#262823',
      line2: '#343730',
      ink: '#E8E9E3',
      inkStrong: '#FFFFFF',
      inkMuted: '#8B8E84',
      inkDim: '#858881', // Lifted until it reads on a chip (4.5:1)
      brand: '#C8F135',
      brandDark: '#A9D61C',
      brandFg: '#C8F135',
      brandText: '#D4F55C',
      brandInk: '#0C0D0B',
      good: '#4ADE80',
      warn: '#FBBF24',
      bad: '#F87171',
      focus: '#A3E635',
      viewerBg: '#0C0D0B',
      scrollThumb: '#2E312A',
      scrollThumbHover: '#C8F135',
    },
    shadowRgb: '0 0 0',
    shadowStrength: 1,
  },

  paper: {
    id: 'paper',
    name: 'Paper',
    tagline: 'Black on white',
    colorScheme: 'light',
    colors: {
      canvas: '#F4F4F5',
      surface: '#FFFFFF',
      elevated: '#FFFFFF',
      input: '#FFFFFF',
      chip: '#F4F4F5',
      hover: '#ECECEE',
      line: '#E4E4E7',
      line2: '#D4D4D8',
      ink: '#27272A',
      inkStrong: '#09090B',
      inkMuted: '#52525B', // zinc-600: labels read on the canvas too (zinc-500 fell just short there)
      inkDim: '#6F6F75', // zinc-500, nudged until it reads on every surface
      brand: '#18181B',
      brandDark: '#000000',
      brandFg: '#18181B',
      brandText: '#000000',
      brandInk: '#FFFFFF',
      good: '#15803D',
      warn: '#B45309',
      bad: '#DC2626',
      focus: '#18181B',
      viewerBg: '#F4F4F5',
      scrollThumb: '#D4D4D8',
      scrollThumbHover: '#A1A1AA',
    },
    shadowRgb: '24 24 27',
    shadowStrength: 0.22,
  },

  lime: {
    id: 'lime',
    name: 'Lime',
    tagline: 'Lime accent on white',
    colorScheme: 'light',
    colors: {
      canvas: '#F3F4F0',
      surface: '#FFFFFF',
      elevated: '#FFFFFF',
      input: '#FFFFFF',
      chip: '#E9EBE4',
      hover: '#E2E4DC',
      line: '#E2E4DC',
      line2: '#CFD2C8',
      ink: '#1F201C',
      inkStrong: '#0B0B0A',
      inkMuted: '#50524C', // Darkened until labels read on the chip (6.5:1)
      inkDim: '#686A62', // ...and hints too (4.5:1)
      brand: '#C8F135',
      brandDark: '#A9D61C',
      // Lime is near-invisible as text on white, so text and highlights use a
      // deep olive of the same hue.
      brandFg: '#4D6B00',
      brandText: '#4D6B00',
      brandInk: '#0F0F0F',
      good: '#15803D',
      warn: '#B45309',
      bad: '#DC2626',
      focus: '#3F6212',
      viewerBg: '#F3F4F0',
      scrollThumb: '#CFD2C8',
      scrollThumbHover: '#A9AD9F',
    },
    shadowRgb: '15 15 15',
    shadowStrength: 0.2,
  },

  peach: {
    id: 'peach',
    name: 'Peach',
    tagline: 'Warm sand, orange accent',
    colorScheme: 'light',
    colors: {
      canvas: '#F1E8DE',
      surface: '#FBF7F2',
      elevated: '#FFFFFF',
      input: '#FFFFFF',
      chip: '#E8DCCD',
      hover: '#E4D6C6',
      line: '#E4D6C6',
      line2: '#D9C8B5',
      ink: '#292524',
      inkStrong: '#0C0A09',
      inkMuted: '#4E4A44', // Darkened until labels read on the chip (6.5:1)
      inkDim: '#696158', // ...and hints too (4.5:1)
      brand: '#F4772F',
      brandDark: '#D95F18',
      brandFg: '#C2410C',
      brandText: '#B4470C',
      brandInk: '#1F1512',
      good: '#2F7D4F',
      warn: '#B45309',
      bad: '#C81E1E',
      focus: '#C2410C',
      viewerBg: '#F1E8DE',
      scrollThumb: '#D9C8B5',
      scrollThumbHover: '#C2AD96',
    },
    shadowRgb: '60 40 20',
    shadowStrength: 0.22,
  },
};

export const THEME_LIST: ThemeDef[] = Object.values(THEMES);

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && v in THEMES;
}

// "#F6F4EF" -> "246 244 239" (rgb triple for `rgb(var(--x) / <alpha>)`)
function triple(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const VAR_KEYS: Array<[cssVar: string, key: keyof ThemeColors]> = [
  ['--c-canvas', 'canvas'],
  ['--c-surface', 'surface'],
  ['--c-elevated', 'elevated'],
  ['--c-input', 'input'],
  ['--c-chip', 'chip'],
  ['--c-hover', 'hover'],
  ['--c-line', 'line'],
  ['--c-line-2', 'line2'],
  ['--c-ink', 'ink'],
  ['--c-ink-strong', 'inkStrong'],
  ['--c-ink-muted', 'inkMuted'],
  ['--c-ink-dim', 'inkDim'],
  ['--c-accent', 'brand'],
  ['--c-accent-deep', 'brandDark'],
  ['--c-accent-fg', 'brandFg'],
  ['--c-accent-text', 'brandText'],
  ['--c-accent-ink', 'brandInk'],
  ['--c-good', 'good'],
  ['--c-warn', 'warn'],
  ['--c-bad', 'bad'],
  ['--c-focus', 'focus'],
  ['--c-scroll-thumb', 'scrollThumb'],
  ['--c-scroll-thumb-hover', 'scrollThumbHover'],
];

function themeBlock(t: ThemeDef): string {
  const vars = VAR_KEYS.map(([v, k]) => `${v}:${triple(t.colors[k])};`).join('');
  return `${vars}--c-shadow:${t.shadowRgb};--shadow-k:${t.shadowStrength};color-scheme:${t.colorScheme};`;
}

/** One stylesheet covering the default (:root) plus every named theme. */
export function buildThemeCss(): string {
  const root = `:root{${themeBlock(THEMES[DEFAULT_THEME])}}`;
  const blocks = THEME_LIST.map((t) => `[data-theme="${t.id}"]{${themeBlock(t)}}`);
  return [root, ...blocks].join('\n');
}
