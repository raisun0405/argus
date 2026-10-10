import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { ComposerMode } from './ComposerMenu';

// The metal look's badge is WebGL: fetched only when that look is in use
const MetalBadge = lazy(() => import('metal-fx').then(m => ({ default: m.MetalBadge })));

// --- PROMPT LIBRARY ---
// Starting points, by what you want to do, one level down in the
// composer's + menu. Picking one fills the composer rather than sending it, so it can be edited; a
// prompt for a mode (Investigate, Co-fold) also switches the composer to that mode. Prompts about
// "this structure" name whatever is on screen.

export interface Prompt { title: string; text: string; isNew?: boolean; mode?: ComposerMode }
interface Category { id: string; label: string; prompts: Prompt[] }

export const promptCategories = (subject: string | undefined): Category[] => {
  const it = subject ? subject : 'this structure';
  return [
    {
      id: 'explore', label: 'Explore', prompts: [
        { title: 'Hemoglobin', text: 'Show me hemoglobin and how it carries oxygen' },
        { title: 'HIV protease and its drug', text: 'Show me HIV protease with its drug' },
        { title: 'The spike protein', text: 'Show me the SARS-CoV-2 spike protein' },
        { title: 'Green fluorescent protein', text: 'Show me green fluorescent protein and what makes it glow' },
      ],
    },
    {
      id: 'understand', label: 'Understand', prompts: [
        { title: `How ${it} works`, text: `Explain how ${it} works` },
        { title: 'The active site', text: `Where is the active site of ${it}, and which residues matter?` },
        { title: 'What holds the ligand', text: `What holds the ligand in place in ${it}?` },
        { title: 'Explain it simply', text: `Explain ${it} simply, as if I'm new to the subject` },
      ],
    },
    {
      id: 'learn', label: 'Learn', prompts: [
        { title: 'Quiz me', text: `Quiz me on ${it}` },
        { title: 'A guided tour', text: 'Generate a cinematic tour explaining the key features of this structure.' },
        { title: 'Compare with a relative', text: `How does ${it} differ from its closest relative?` },
      ],
    },
    {
      id: 'investigate', label: 'Investigate', prompts: [
        { title: 'Mutations near a drug pocket', text: 'Are the disease mutations of KRAS near a druggable pocket?', mode: 'investigate', isNew: true },
        { title: 'What holds the ligand, and what breaks it', text: `What holds the ligand in ${it}, and do disease variants touch those residues?`, mode: 'investigate', isNew: true },
        { title: 'Partners and mutation hotspots', text: 'What does p53 work with, and where do its cancer mutations sit?', mode: 'investigate', isNew: true },
        { title: 'Relatives by shape', text: `Which other proteins share the fold of ${it}?`, mode: 'investigate', isNew: true },
      ],
    },
    {
      id: 'predict', label: 'Predict', prompts: [
        { title: 'Co-fold a molecule', text: 'aspirin', mode: 'cofold' },
        { title: 'Compare two molecules', text: 'imatinib vs nilotinib', mode: 'cofold', isNew: true },
        { title: 'Fold a sequence', text: 'Paste a protein sequence (or FASTA) here to fold it with ESMFold' },
      ],
    },
  ];
};

const newBadge = <span className="px-1.5 py-px rounded-full border border-line-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">New</span>;
const MODE_LABEL: Record<ComposerMode, string> = { investigate: 'Investigate', cofold: 'Co-fold' };

interface PromptLibraryPanelProps {
  subject?: string;
  metal?: boolean; // The Metal look shows "New" as a metal badge
  onPick: (prompt: Prompt) => void;
}

/** Search, category tabs and the prompts themselves. */
export const PromptLibraryPanel: React.FC<PromptLibraryPanelProps> = ({ subject, metal = false, onPick }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('explore');
  const searchRef = useRef<HTMLInputElement>(null);
  const categories = useMemo(() => promptCategories(subject), [subject]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const q = query.trim().toLowerCase();
  const shown = q
    ? categories.flatMap(c => c.prompts).filter(p => p.title.toLowerCase().includes(q) || p.text.toLowerCase().includes(q))
    : categories.find(c => c.id === category)?.prompts ?? [];

  // The search and tabs stay put; the prompts scroll under them within the menu's height
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex-none p-2 border-b border-line">
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search prompts"
          aria-label="Search prompts"
          className="w-full h-8 px-2.5 rounded-lg bg-input border border-line text-[12px] text-ink placeholder:text-ink-dim focus:outline-none focus:border-line-2"
        />
        {!q && (
          <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Prompt categories">
            {categories.map(c => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={category === c.id}
                onClick={() => setCategory(c.id)}
                className={`px-2 h-6 touch:h-8 touch:px-3 rounded-full text-[11px] touch:text-[12.5px] font-medium whitespace-nowrap transition-colors ${category === c.id ? 'bg-chip text-ink-strong' : 'text-ink-muted hover:text-ink-strong hover:bg-chip/50'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="min-h-0 overflow-y-auto argus-menu-scroll p-1" data-menu-scroll>
        {shown.map(p => (
          <li key={`${p.mode ?? ''}${p.text}`}>
            <button
              type="button"
              data-prompt={p.title}
              onClick={() => onPick(p)}
              className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-chip/60 focus-visible:bg-chip/60 focus-visible:shadow-[inset_2px_0_0_rgb(var(--c-focus))] outline-none transition-colors group"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate text-[12px] font-medium text-ink-strong">{p.title}</span>
                {p.isNew && (metal ? <Suspense fallback={newBadge}><MetalBadge>New</MetalBadge></Suspense> : newBadge)}
              </span>
              <span className="block mt-0.5 text-[11px] leading-snug text-ink-dim group-hover:text-ink-muted truncate">
                {p.mode && <span className="text-ink-muted">{MODE_LABEL[p.mode]} · </span>}
                {p.text}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2.5 py-3 text-[11px] text-ink-dim">No prompt matches "{query}"</li>}
      </ul>
    </div>
  );
};
