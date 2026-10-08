import React from 'react';
import type { Selection, StructureModel } from '../../services/structureModel';
import { describeSelection, neighboursOf, residueKey, residueLabel } from '../../services/structureModel';
import { isMac } from '../../services/commands';
import { AM_GRADIENT_CSS } from '../../services/variantService';
import { POCKET_COLORS } from '../../services/pocketService';
import Dropdown from '../Dropdown';
import { Field, Group, Kbd, NumberField, Range, Segmented, ToggleChip } from './InspectorSection';

// --- INSPECTOR CONTENTS ---
// The two sections that are always there: how the structure is drawn, and what is currently picked,
// because they answer the two questions a 3D view constantly raises.

const svg = (children: React.ReactNode, filled = false) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...(filled ? { fillOpacity: 0.18 } : {})}>{children}</svg>
);

// --- STYLE ---

export type VizStyle = 'cartoon' | 'stick' | 'sphere' | 'surface';

// Each shape drawn as it looks: a ribbon, bonds between atoms, packed atoms, a closed skin
const SHAPE_ICONS: Record<VizStyle, React.ReactNode> = {
  cartoon: svg(<><path d="M2.5 14.5c2.4-5 4.8-5 7.2 0s4.8 5 7.2 0c1.3-2.6 2.8-3.4 4.6-2.6" /><path d="M2.5 9.5c2.4-5 4.8-5 7.2 0" opacity="0.4" /></>),
  stick: svg(<><circle cx="5" cy="17" r="2.2" /><circle cx="12" cy="7" r="2.2" /><circle cx="19" cy="15" r="2.2" /><path d="M6.3 15.2 10.7 8.8M13.4 8.6l4.3 4.8" /></>),
  sphere: svg(<><circle cx="9" cy="10" r="5" fill="currentColor" /><circle cx="15.5" cy="13" r="5" fill="currentColor" /><circle cx="9.5" cy="17" r="3.5" fill="currentColor" /></>, true),
  surface: svg(<path d="M7.2 4.2c2.9-1.6 6.6-.8 8.6 1.2 2.4 2.4 4.6 3.5 4.2 7.3-.4 3.7-3.3 6.8-7.2 7.3-3.4.4-6.3-.6-8-3.1C3 14.4 3.2 11 4.4 8.2c.6-1.6 1.6-3.1 2.8-4z" fill="currentColor" />, true),
};

// What each colouring looks like, so the menu shows it rather than only naming it. Tools that
// colour the structure (Variant Lens, Pocket Radar, Interactions) are listed after the colourings.
const COLOURINGS: Record<string, { swatch: string; hint: string; group: string }> = {
  confidence: { swatch: 'linear-gradient(90deg, #0053D6 0 25%, #65CBF3 25% 50%, #FFDB13 50% 75%, #FF7D45 75%)', hint: "The model's own confidence", group: 'Colour by' },
  element: { swatch: 'linear-gradient(90deg, #909090 0 34%, #ff0d0d 34% 67%, #3050f8 67%)', hint: 'Carbon grey, oxygen red, nitrogen blue', group: 'Colour by' },
  rainbow: { swatch: 'linear-gradient(90deg, #3b82f6, #22d3ee, #a3e635, #facc15, #f97316, #ef4444)', hint: 'Along each chain, start to end', group: 'Colour by' },
  chain: { swatch: 'linear-gradient(90deg, #60a5fa 0 34%, #f59e0b 34% 67%, #34d399 67%)', hint: 'One colour per chain', group: 'Colour by' },
  hydrophobicity: { swatch: 'linear-gradient(90deg, #f87171 0 45%, #cbd5e1 45% 55%, #60a5fa 55%)', hint: 'Water-avoiding red, polar blue', group: 'Colour by' },
  residue: { swatch: 'linear-gradient(90deg, #e60a0a 0 20%, #145aff 20% 40%, #0f820f 40% 60%, #e6e600 60% 80%, #ebebeb 80%)', hint: 'Each amino acid its own colour', group: 'Colour by' },
  pathogenicity: { swatch: AM_GRADIENT_CSS, hint: 'Variant Lens: likely effect of mutations', group: 'From a tool' },
  pockets: { swatch: `linear-gradient(90deg, ${POCKET_COLORS.map((c, i) => `${c} ${i * 20}% ${(i + 1) * 20}%`).join(', ')})`, hint: 'Pocket Radar: predicted pockets', group: 'From a tool' },
  interactions: { swatch: 'linear-gradient(90deg, #60a5fa 0 25%, #f59e0b 25% 50%, #a78bfa 50% 75%, #a3a3a3 75%)', hint: 'What holds each ligand in place', group: 'From a tool' },
};

// What the answer marks in 3D, by kind
const PART_ICONS = {
  highlights: svg(<><circle cx="12" cy="12" r="3.2" fill="currentColor" /><circle cx="12" cy="12" r="8" /></>),
  ligands: svg(<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />),
  substrates: svg(<path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />),
  metals: svg(<><circle cx="12" cy="12" r="8" /><path d="M12 9v6M9 12h6" /></>),
};

interface StyleSectionProps {
  vizStyle: VizStyle;
  colorScheme: string;
  colorOptions: { value: string; label: string }[];
  opacity: number;
  toggles: { part: keyof typeof PART_ICONS; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }[];
  onVizStyle: (v: VizStyle) => void;
  onColorScheme: (v: string) => void;
  onOpacity: (v: number) => void;
}

export const StyleSection: React.FC<StyleSectionProps> = ({
  vizStyle, colorScheme, colorOptions, opacity, toggles, onVizStyle, onColorScheme, onOpacity,
}) => (
  <div className="space-y-3.5">
    <Group label="Shape" hint="How the protein itself is drawn (keys 1–4)">
      <Segmented
        ariaLabel="Visual mode"
        value={vizStyle}
        onChange={onVizStyle}
        options={[
          { value: 'cartoon', label: 'Cartoon', title: 'Ribbons following the backbone (1)', icon: SHAPE_ICONS.cartoon },
          { value: 'stick', label: 'Wire', title: 'Every bond as a stick (2)', icon: SHAPE_ICONS.stick },
          { value: 'sphere', label: 'Space', title: 'Atoms at their real size (3)', icon: SHAPE_ICONS.sphere },
          { value: 'surface', label: 'Surface', title: 'The solvent-accessible surface (4)', icon: SHAPE_ICONS.surface },
        ]}
      />
    </Group>

    <div className="space-y-0.5">
      <Field label="Colour">
        <Dropdown
          size="sm"
          align="end"
          menuWidth={150}
          ariaLabel="Colouring"
          value={colorScheme}
          onChange={onColorScheme}
          options={[...colorOptions]
            .sort((a, b) => Number(COLOURINGS[a.value]?.group === 'From a tool') - Number(COLOURINGS[b.value]?.group === 'From a tool'))
            .map(o => ({ ...o, ...(COLOURINGS[o.value] ? { swatch: COLOURINGS[o.value].swatch, group: COLOURINGS[o.value].group } : {}) }))}
        />
      </Field>
      {/* What the chosen colours mean, under the choice rather than in the menu */}
      {COLOURINGS[colorScheme] && (
        <p data-colouring-hint className="pl-16 -mt-0.5 pb-1 text-[10.5px] leading-snug text-ink-dim">{COLOURINGS[colorScheme].hint}</p>
      )}
      <Field label="Opacity" hint="Fade the protein so highlights and ligands stand out">
        <div className="flex items-center gap-2.5">
          <Range value={opacity} onChange={onOpacity} label="Structure opacity" />
          <NumberField value={opacity} min={0} max={100} unit="%" label="Opacity, percent" onChange={onOpacity} />
        </div>
      </Field>
    </div>

    <Group label="Show in 3D" hint="Which of the answer's marked parts are drawn">
      <div className="grid grid-cols-2 gap-1.5">
        {toggles.map(t => (
          <ToggleChip key={t.label} label={t.label} icon={PART_ICONS[t.part]} on={t.checked} onChange={t.onChange} hint={t.hint} />
        ))}
      </div>
    </Group>
  </div>
);

// --- FOCUS ---
// What is picked, and what sits around it. Clicking a structure should always answer "what is this":
// the residue plus its surroundings within 5 Å, the same question the chat gets asked in words.

const NEIGHBOUR_RADIUS = 5;
const MAX_NEIGHBOURS = 8;

const ActionButton: React.FC<{ onClick: () => void; icon: React.ReactNode; label: string; title?: string; iconOnly?: boolean }> = ({ onClick, icon, label, title, iconOnly }) => (
  <button
    type="button"
    onClick={onClick}
    title={title ?? label}
    aria-label={iconOnly ? label : undefined}
    className={`h-7 touch:h-10 min-w-0 flex items-center justify-center gap-1.5 rounded-md text-[11px] touch:text-[13px] font-medium transition-colors ${
      iconOnly ? 'w-7 touch:w-10 flex-shrink-0 text-ink-dim hover:text-ink-strong hover:bg-chip/60' : 'flex-1 px-2 bg-surface border border-line text-ink hover:border-line-2 hover:text-ink-strong'
    }`}
  >
    <span className="flex-shrink-0 flex [&>svg]:w-[13px] [&>svg]:h-[13px]">{icon}</span>
    {!iconOnly && <span className="truncate">{label}</span>}
  </button>
);

// A part of the structure to select in one click, while nothing is selected
const QuickPick: React.FC<{ onClick: () => void; title: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ onClick, title, icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="h-6 touch:h-9 inline-flex items-center gap-1 px-2 touch:px-3 rounded-md border border-line bg-surface text-[11px] touch:text-[13px] font-medium text-ink hover:border-line-2 hover:text-ink-strong transition-colors"
  >
    {icon && <span className="flex text-ink-dim [&>svg]:w-[11px] [&>svg]:h-[11px]">{icon}</span>}
    {children}
  </button>
);

const ChainTag: React.FC<{ chain: string }> = ({ chain }) => (
  <span className="flex-shrink-0 inline-flex items-center justify-center h-[17px] min-w-[17px] px-1 rounded bg-chip text-[10px] font-semibold text-ink-muted">{chain}</span>
);

interface FocusSectionProps {
  model: StructureModel | null;
  selection: Selection;
  onPick: (key: string, modifiers?: { toggle?: boolean; range?: boolean }) => void;
  onZoom: () => void;
  onClear: () => void;
  onAsk?: (question: string) => void; // Hand the selection to the chat
  onCofold?: () => void; // Co-fold into the selected site
  onSelectMarked?: () => void; // Select what the answer marks in 3D
  onSelectChain?: (chain: string) => void; // Select a whole chain (the quick picks)
  onHover?: (key: string | null) => void; // A nearby residue under the pointer
}

const MAX_QUICK_CHAINS = 6;
const MAX_QUICK_LIGANDS = 4;

export const FocusSection: React.FC<FocusSectionProps> = ({ model, selection, onPick, onZoom, onClear, onAsk, onCofold, onSelectMarked, onSelectChain, onHover }) => {
  const focused = model && selection.focus ? model.byKey.get(selection.focus) ?? null : null;
  const count = selection.keys.size;
  const neighbours = React.useMemo(
    () => (model && focused ? neighboursOf(model, residueKey(focused), NEIGHBOUR_RADIUS, true).slice(0, MAX_NEIGHBOURS) : []),
    [model, focused]
  );

  // Nothing picked yet: what can be picked, one click away, and how picking works
  if (!model || count === 0) {
    const chains = model ? model.chains.slice(0, MAX_QUICK_CHAINS) : [];
    const allLigands = model ? model.ligands.filter(l => l.kind === 'ligand') : [];
    const ligands = allLigands.slice(0, MAX_QUICK_LIGANDS);
    // Four hemes read "HEM A", "HEM B"...; a single one just "HEM"
    const repeated = (resn: string) => allLigands.filter(l => l.resn === resn).length > 1;
    return (
      <div className="space-y-2.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-px w-7 h-7 flex-shrink-0 rounded-lg bg-chip flex items-center justify-center text-ink-muted [&>svg]:w-[14px] [&>svg]:h-[14px]">
            {svg(<><path d="m9 9 5 12 1.8-5.2L21 14Z" /><path d="M7.2 2.2 8 5.1M5.1 8l-2.9-.8M14 4.1 12 6M6 12l-1.9 2" /></>)}
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] touch:text-[14px] font-medium text-ink-strong">Nothing selected</span>
            <span className="block text-[10.5px] touch:text-[12.5px] leading-snug text-ink-dim"><span className="touch:hidden">Click</span><span className="hidden touch:inline">Tap</span> a residue in 3D or in the sequence, or pick a part</span>
          </span>
        </div>
        {(chains.length > 0 || ligands.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {chains.map(c => (
              <QuickPick key={c.chain} onClick={() => onSelectChain?.(c.chain)} title={`Select chain ${c.chain}${c.name ? `: ${c.name}` : ''}`}>
                Chain {c.chain}
              </QuickPick>
            ))}
            {ligands.map(l => (
              <QuickPick key={l.key} onClick={() => onPick(l.key)} title={`Select ${l.resn} (${l.chain}:${l.resi}) and see what holds it`} icon={PART_ICONS.ligands}>
                {l.resn}{repeated(l.resn) && <span className="text-ink-dim"> {l.chain}</span>}
              </QuickPick>
            ))}
          </div>
        )}
        {onSelectMarked && (
          <button
            type="button"
            onClick={onSelectMarked}
            className="w-full h-7 touch:h-10 flex items-center justify-center gap-1.5 rounded-md bg-chip/60 text-[11px] touch:text-[13px] font-medium text-ink hover:bg-chip hover:text-ink-strong transition-colors"
          >
            <span className="flex text-brand-fg [&>svg]:w-[12px] [&>svg]:h-[12px]">{PART_ICONS.highlights}</span>
            Select the marked residues
          </button>
        )}
        {/* Keys for a keyboard: a finger has none */}
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10.5px] text-ink-dim touch:hidden">
          <span className="inline-flex items-center gap-1"><Kbd>{isMac() ? '⇧' : 'Shift'}</Kbd> range</span>
          <span className="inline-flex items-center gap-1"><Kbd>{isMac() ? '⌘' : 'Ctrl'}</Kbd> add</span>
          <span className="inline-flex items-center gap-1"><Kbd>Esc</Kbd> clear</span>
        </div>
      </div>
    );
  }

  const multi = count > 1;
  return (
    <div className="space-y-3">
      {/* What is picked, and what can be done with it */}
      <div className="rounded-lg bg-chip/30 border border-line p-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="min-w-0 truncate text-[14px] font-semibold tracking-tight text-ink-strong">
            {multi ? `${count} residues` : focused ? residueLabel(focused) : ''}
          </span>
          {!multi && focused && <ChainTag chain={focused.chain} />}
        </div>
        <p className="mt-0.5 text-[10.5px] text-ink-dim tabular-nums truncate">
          {multi ? describeSelection(selection, model, 46) : focused ? `${focused.atoms} atoms · B-factor ${focused.bfactor.toFixed(1)}` : ''}
        </p>
        <div className="mt-2.5 flex gap-1">
          <ActionButton onClick={onZoom} label="Zoom" title="Zoom to the selection" icon={svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6M11 8v6M8 11h6" /></>)} />
          {onAsk && focused && (
            <ActionButton
              onClick={() => onAsk(multi ? `What do these residues do: ${describeSelection(selection, model, 60)}?` : `What does ${residueLabel(focused)} of chain ${focused.chain} do?`)}
              label="Ask"
              title="Ask the chat about this"
              icon={svg(<path d="M21 14a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />)}
            />
          )}
          {onCofold && (
            <ActionButton onClick={onCofold} label="Co-fold" title="Co-fold a molecule into this site" icon={svg(<><path d="M9 3.5 15 7v7l-6 3.5L3 14V7z" /><path d="m15 14 3.6 2.2" /><circle cx="20.4" cy="17.6" r="2.1" /></>)} />
          )}
          <ActionButton onClick={onClear} label="Clear" title="Clear the selection (Esc)" iconOnly icon={svg(<path d="M18 6 6 18M6 6l12 12" />)} />
        </div>
      </div>

      {/* What sits around it, closest first: the bar grows as the distance shrinks */}
      {focused && neighbours.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-ink-muted">Within {NEIGHBOUR_RADIUS} Å</span>
            <span className="text-[10px] tabular-nums text-ink-dim">{neighbours.length} closest</span>
          </div>
          <div className="space-y-px">
            {neighbours.map(n => (
              <button
                key={residueKey(n.residue)}
                type="button"
                onClick={() => onPick(residueKey(n.residue))}
                onMouseEnter={() => onHover?.(residueKey(n.residue))}
                onMouseLeave={() => onHover?.(null)}
                className="group w-full flex items-center gap-2 h-7 touch:h-10 px-1.5 -mx-1.5 rounded-md text-left hover:bg-chip/60 transition-colors"
                title={`Select ${residueLabel(n.residue)} of chain ${n.residue.chain}`}
              >
                <span className="min-w-0 flex-1 flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[11.5px] touch:text-[13px] font-medium text-ink group-hover:text-ink-strong">{residueLabel(n.residue)}</span>
                  <ChainTag chain={n.residue.chain} />
                </span>
                <span aria-hidden="true" className="flex-shrink-0 w-12 h-1 rounded-full bg-line overflow-hidden">
                  <span className="block h-full rounded-full bg-brand-fg/70" style={{ width: `${Math.max(8, (1 - n.distance / NEIGHBOUR_RADIUS) * 100)}%` }} />
                </span>
                <span className="flex-shrink-0 w-[38px] text-right text-[11px] tabular-nums text-ink-muted whitespace-nowrap">{n.distance.toFixed(1)} Å</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- LAYERS ---
// What the structure is made of, with a switch per part: the fastest way to answer
// "where did the waters go" or "hide that chain".

export interface Layer {
  id: string;
  name: string;
  kind: 'chain' | 'ligands' | 'waters';
  badge?: string; // A chain's letter
  detail?: string;
  visible: boolean;
  onToggle: () => void;
  onFocus?: () => void;
}

const LAYER_ICONS = {
  ligands: svg(<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />),
  waters: svg(<path d="M12 3.5s6 6.4 6 10.7a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5z" />),
};

export const LayersSection: React.FC<{ layers: Layer[] }> = ({ layers }) => (
  <div className="space-y-px">
    {layers.length === 0 && <p className="text-[11px] text-ink-dim py-1">Nothing loaded yet.</p>}
    {layers.map(layer => {
      const name = `${layer.badge ? `${layer.badge} · ` : ''}${layer.name}`;
      return (
        <div key={layer.id} className="group flex items-center gap-2 h-7 touch:h-10 px-1.5 -mx-1.5 rounded-md hover:bg-chip/50 transition-colors">
          {layer.kind === 'chain' ? (
            <span className={`flex-shrink-0 w-[18px] h-[18px] rounded flex items-center justify-center text-[10px] font-semibold ${layer.visible ? 'bg-chip text-ink-strong' : 'bg-chip/40 text-ink-dim'}`}>{layer.badge}</span>
          ) : (
            <span className={`flex-shrink-0 w-[18px] h-[18px] flex items-center justify-center [&>svg]:w-[13px] [&>svg]:h-[13px] ${layer.visible ? 'text-ink-muted' : 'text-ink-dim/60'}`}>{LAYER_ICONS[layer.kind]}</span>
          )}
          <button
            type="button"
            onClick={layer.onFocus}
            disabled={!layer.onFocus}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-left disabled:cursor-default"
            title={layer.onFocus ? `Zoom to ${name}` : name}
          >
            <span className={`truncate text-[11.5px] touch:text-[13px] ${layer.visible ? 'text-ink' : 'text-ink-dim line-through decoration-ink-dim/40'}`}>{layer.name}</span>
          </button>
          {layer.detail && <span className="flex-shrink-0 text-[10.5px] text-ink-dim tabular-nums">{layer.detail}</span>}
          <button
            type="button"
            onClick={layer.onToggle}
            aria-pressed={layer.visible}
            title={layer.visible ? `Hide ${name}` : `Show ${name}`}
            aria-label={layer.visible ? `Hide ${name}` : `Show ${name}`}
            // Shown on hover while the layer is visible; a hidden layer always shows its closed eye
            className={`flex-shrink-0 w-6 h-6 touch:w-10 touch:h-10 flex items-center justify-center rounded-md transition-all ${
              layer.visible
                ? 'text-ink-muted opacity-0 touch:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 hover:!text-ink-strong hover:bg-chip'
                : 'text-ink-dim hover:text-ink-strong hover:bg-chip'
            }`}
          >
            {layer.visible ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.2A10 10 0 0 1 12 4c6.4 0 10 7 10 7a15 15 0 0 1-3 3.6M6 6.3A15 15 0 0 0 2 11s3.6 7 10 7a10 10 0 0 0 4-.8" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
            )}
          </button>
        </div>
      );
    })}
  </div>
);
