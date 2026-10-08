// Tailwind (v3), compiled at build time.
// Colours resolve through the theme CSS variables (themes.ts), so every utility follows the
// active theme. "<alpha-value>" keeps bg-brand/15 etc. working.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;
// Neutral shadows: full strength in dark themes, softened in light ones.
const sh = (alpha) => `rgb(var(--c-shadow) / calc(${alpha} * var(--shadow-k)))`;

/** @type {import('tailwindcss').Config} */
export default {
  // The app's page only: the landing page (index.html, landing/) has its own stylesheet
  content: ['./app.html', './index.tsx', './App.tsx', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      // The chat's sizes resolve through variables on the chat column (index.css), so its
      // "Text and spacing" choice changes them all at once
      fontSize: {
        chat:         ['var(--chat-text)', { lineHeight: 'var(--chat-leading)' }],
        'chat-title': 'var(--chat-title)',
        'chat-aside': 'var(--chat-aside)',
        'chat-meta':  'var(--chat-meta)',
      },
      spacing: {
        'chat-row':       'var(--chat-row)',
        'chat-x':         'var(--chat-x)',
        'chat-y':         'var(--chat-y)',
        'chat-option-y':  'var(--chat-option-y)',
        'chat-button':    'var(--chat-button)',
        'chat-input':     'var(--chat-input)',
        'chat-input-top': 'var(--chat-input-top)',
      },
      colors: {
        canvas:   v('--c-canvas'),
        surface:  v('--c-surface'),
        elevated: v('--c-elevated'),
        input:    v('--c-input'),
        chip:     v('--c-chip'),
        hover:    v('--c-hover'),
        line: {
          DEFAULT: v('--c-line'),
          2:       v('--c-line-2'),
        },
        ink: {
          DEFAULT: v('--c-ink'),
          strong:  v('--c-ink-strong'),
          muted:   v('--c-ink-muted'),
          dim:     v('--c-ink-dim'),
        },
        brand: {
          DEFAULT: v('--c-accent'),
          dark:    v('--c-accent-deep'),
          fg:      v('--c-accent-fg'),
          text:    v('--c-accent-text'),
          ink:     v('--c-accent-ink'),
        },
        good: v('--c-good'),
        warn: v('--c-warn'),
        bad:  v('--c-bad'),
      },
      boxShadow: {
        side:          `0 0 40px -10px ${sh(0.9)}`,
        card:          `0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 30px -12px ${sh(0.7)}`,
        quiz:          `0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px ${sh(0.7)}`,
        float:         `0 4px 12px -4px ${sh(0.6)}`,
        overlay:       `0 12px 40px -12px ${sh(0.8)}`,
        tooltip:       `0 12px 40px -12px ${sh(0.9)}`,
        menu:          `0 12px 28px -8px ${sh(0.8)}`,
        bubble:        `0 4px 18px -8px ${sh(0.7)}, 0 1px 0 0 rgba(255,255,255,0.02) inset`,
        'bubble-flat': `0 4px 18px -8px ${sh(0.7)}`,
        knob:          `0 1px 2px ${sh(0.5)}`,
        hairline:      'inset 0 0 0 1px rgba(255,255,255,0.02)',
      },
      keyframes: {
        'argus-fade-in':    { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'argus-pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgb(var(--c-accent) / 0.55)' }, '70%': { boxShadow: '0 0 0 8px rgb(var(--c-accent) / 0)' }, '100%': { boxShadow: '0 0 0 0 rgb(var(--c-accent) / 0)' } },
        'argus-dot-pulse':  { '0%,100%': { opacity: '1', boxShadow: '0 0 8px rgb(var(--c-good))' }, '50%': { opacity: '0.4', boxShadow: '0 0 2px rgb(var(--c-good))' } },
      },
      animation: {
        'argus-fade-in':    'argus-fade-in 280ms cubic-bezier(0.16,1,0.3,1) both',
        'argus-pulse-ring': 'argus-pulse-ring 2s ease-out infinite',
        'argus-dot-pulse':  'argus-dot-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    // touch: a finger rather than a mouse (useMedia.ts TOUCH_QUERY): bigger targets, no keyboard hints.
    // A variant, not a screen: a raw screen would switch off the min-[…] and max-* variants.
    ({ addVariant }) => addVariant('touch', '@media (pointer: coarse)'),
  ],
};
