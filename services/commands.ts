// --- COMMANDS AND SHORTCUTS ---
// One list of everything the workspace can do, so the palette, the shortcut sheet and the keyboard
// all read from the same place: Ctrl/⌘K opens the palette, ? opens the shortcut sheet, Escape backs out.

export type CommandGroup = 'Go to' | 'View' | 'Tools' | 'Selection' | 'Workspace' | 'Help';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  hint?: string; // Shown dim beside the title: the current value, or what it does
  shortcut?: string; // Display form, e.g. "⌘K" or "G then R"
  keywords?: string; // Extra words that should find this command
  disabled?: boolean;
  run: () => void;
}

/**
 * Subsequence match with a score: every letter of the query must appear in order. Runs of adjacent
 * letters and matches at word starts score higher, so "pok" finds "Pockets" before "Copy link".
 * Returns null when the query doesn't match at all.
 */
export const fuzzyScore = (text: string, query: string): number | null => {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let score = 0;
  let at = 0;
  let run = 0;
  for (const ch of needle) {
    if (ch === ' ') continue;
    const found = haystack.indexOf(ch, at);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s\-:·(]/.test(haystack[found - 1]);
    run = found === at ? run + 1 : 0;
    score += 10 + run * 6 + (wordStart ? 8 : 0) - Math.min(found - at, 10);
    at = found + 1;
  }
  return score - haystack.length * 0.08; // Shorter titles win ties
};

export interface ScoredCommand {
  command: Command;
  score: number;
}

/** The commands matching a query, best first; an empty query keeps the given order. */
export const searchCommands = (commands: Command[], query: string, limit = 40): ScoredCommand[] => {
  if (!query.trim()) return commands.filter(c => !c.disabled).slice(0, limit).map(command => ({ command, score: 0 }));
  const scored: ScoredCommand[] = [];
  for (const command of commands) {
    if (command.disabled) continue;
    const best = Math.max(
      fuzzyScore(command.title, query) ?? -Infinity,
      (fuzzyScore(`${command.group} ${command.title}`, query) ?? -Infinity) - 6,
      command.keywords ? (fuzzyScore(command.keywords, query) ?? -Infinity) - 10 : -Infinity,
    );
    if (Number.isFinite(best)) scored.push({ command, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
};

// --- RESIDUE QUERIES ---
// Typing "A:25", "Asp25" or "25-40" in the palette should go there. The palette offers these as
// results above the commands, because jumping to a residue is the thing one does most often.

export interface ResidueQuery {
  chain?: string;
  from: number;
  to: number;
  name?: string; // Three-letter name when the query named one ("Asp25")
}

const THREE_LETTER = /^(ala|arg|asn|asp|cys|gln|glu|gly|his|ile|leu|lys|met|phe|pro|ser|thr|trp|tyr|val|mse)$/i;

/** "A:25", "A 25-40", "Asp25", "25", "B:184A" -> a residue query; null when it isn't one. */
export const parseResidueQuery = (text: string): ResidueQuery | null => {
  const q = text.trim();
  if (!q) return null;
  // Optional "chain:" or "chain " prefix
  const chained = /^([A-Za-z0-9]{1,4})\s*[:.\s]\s*(.+)$/.exec(q);
  const rest = chained ? chained[2].trim() : q;
  const chain = chained ? chained[1] : undefined;
  // "Asp25" or "ASP 25"
  const named = /^([A-Za-z]{3})\s*(\d{1,5})$/.exec(rest);
  if (named && THREE_LETTER.test(named[1])) {
    const at = Number(named[2]);
    return { ...(chain ? { chain } : {}), from: at, to: at, name: named[1].toUpperCase() };
  }
  const range = /^(\d{1,5})\s*[-–]\s*(\d{1,5})$/.exec(rest);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
    return { ...(chain ? { chain } : {}), from: a, to: b };
  }
  const single = /^(\d{1,5})$/.exec(rest);
  if (single) {
    const at = Number(single[1]);
    return { ...(chain ? { chain } : {}), from: at, to: at };
  }
  return null;
};

// --- KEYBOARD ---

export interface Shortcut {
  keys: string; // "mod+k", "shift+?", "g r", "1"
  description: string;
  group: CommandGroup;
  run: (event: KeyboardEvent) => void;
  /** Allow it while typing in a field (only for things like Escape). */
  whileTyping?: boolean;
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "mod+k" shown the way this platform writes it. */
export const shortcutLabel = (keys: string): string => {
  const mod = isMac() ? '⌘' : 'Ctrl';
  return keys
    .split(' ')
    .map(part =>
      part
        .split('+')
        .map(k => (k === 'mod' ? mod : k === 'shift' ? '⇧' : k === 'alt' ? (isMac() ? '⌥' : 'Alt') : k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1)))
        .join(isMac() ? '' : '+')
    )
    .join(' then ');
};

/** Does this event match a single chord like "mod+k" or "shift+/"? */
export const matchesChord = (event: KeyboardEvent, chord: string): boolean => {
  const parts = chord.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const hasMod = event.metaKey || event.ctrlKey;
  if (wantMod !== hasMod) return false;
  if (wantAlt !== event.altKey) return false;
  const pressed = event.key.toLowerCase();
  // Shift is implied by the character for punctuation ("?"), checked for letters
  if (key.length === 1 && /[a-z0-9]/.test(key) && wantShift !== event.shiftKey) return false;
  return pressed === key || (key === 'escape' && pressed === 'esc');
};

/** True while focus is in a text field, where single-letter shortcuts must not fire. */
export const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
};
