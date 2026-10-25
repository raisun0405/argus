import React, { useEffect, useId, useState } from 'react';
import Dropdown from './Dropdown';
import { Explanation, Term, useExplain } from './Explain';
import { Field, Group, Segmented, Switch } from './workspace/InspectorSection';
import { DISTANCE_GRADIENT, PAIR_COLORS, distanceColor, sameProteinEntries, type OverlayResult, type SameProteinEntry } from '../services/overlayService';
import { readableName } from '../services/structureModel';

export type OverlayColour = 'distance' | 'pair';

export type OverlayState =
  | { status: 'idle' }
  | { status: 'loading'; name: string }
  | { status: 'error'; name: string; error: string }
  | { status: 'ready'; name: string; result: OverlayResult };

/** A ready-made pick above the list: the AlphaFold model, or the experimental entry a model came from. */
export interface OverlayChoice { id: string; label: string; detail: string }

// A trace with a dashed copy of it laid a little off: a structure and the one over it. Not two
// circles (Find similar) and not stacked sheets (Layers).
export const OverlayIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 16c2.5-4.5 5.5-4.5 8 0s5.5 4.5 8 0" />
    <path d="M6 9.5c2.5-4.5 5.5-4.5 8 0s5.5 4.5 8 0" strokeDasharray="2.6 2.4" />
  </svg>
);

const PDB_ID = /^[1-9][A-Z0-9]{3}$/;
const MAX_SUGGESTIONS = 25; // All the search returns; the list scrolls
const MAX_REGIONS = 5;
const MAX_CHANGES = 12;

const METHOD_SHORT: Record<string, string> = { 'X-RAY DIFFRACTION': 'X-ray', 'ELECTRON MICROSCOPY': 'EM', 'SOLUTION NMR': 'NMR', 'SOLID-STATE NMR': 'NMR' };

const PickRow = ({ id, label, detail, note, onPick }: { id: string; label: string; detail: string; note?: string; onPick: (id: string) => void }) => (
  <button
    type="button"
    onClick={() => onPick(id)}
    data-overlay-pick={id}
    title={detail}
    className="w-full min-w-0 flex items-baseline gap-2 px-2 py-1.5 touch:py-3 rounded-md text-left hover:bg-chip active:bg-chip transition-colors"
  >
    <span className="flex-shrink-0 text-xs touch:text-[14px] font-semibold text-ink-strong tabular-nums">{label}</span>
    <span className="min-w-0 flex-1 truncate text-[11px] touch:text-[13px] text-ink-muted">{detail}</span>
    {note && <span className="flex-shrink-0 text-[10px] text-ink-dim tabular-nums">{note}</span>}
  </button>
);

interface OverlayPickerProps {
  accession: string | null; // The protein's UniProt accession: its other PDB entries are offered
  choices: OverlayChoice[];
  exclude: string[]; // Never offered: the structure on screen
  onPick: (id: string) => void;
}

/** What to lay over: a ready-made choice, another PDB entry of the same protein (best resolved first), or a typed PDB ID. */
export const OverlayPicker: React.FC<OverlayPickerProps> = ({ accession, choices, exclude, onPick }) => {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<{ accession: string; entries: SameProteinEntry[] | null; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!accession) return;
    let live = true;
    setFound({ accession, entries: null });
    sameProteinEntries(accession)
      .then(entries => { if (live) setFound({ accession, entries }); })
      .catch(() => { if (live) setFound({ accession, entries: [], failed: true }); });
    return () => { live = false; };
  }, [accession]);

  const onScreen = new Set(exclude.map(id => id.toUpperCase()));
  const skip = new Set([...onScreen, ...choices.map(c => c.id.toUpperCase())]);
  const current = found?.accession === accession ? found : null;
  const entries = current?.entries ? current.entries.filter(e => !skip.has(e.id)).slice(0, MAX_SUGGESTIONS) : null;
  const id = typed.trim().toUpperCase();
  const problem = !id ? null : !PDB_ID.test(id) ? 'A PDB ID is four characters, like 1AKE' : onScreen.has(id) ? "That's the structure on screen" : null;
  const problemId = useId();

  return (
    <div className="space-y-2.5">
      {choices.length > 0 && (
        <div className="space-y-0.5">
          {choices.map(c => <PickRow key={c.id} id={c.id} label={c.label} detail={c.detail} onPick={onPick} />)}
        </div>
      )}

      {accession && (
        <div>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">Other entries of this protein</p>
          {entries === null ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-ink-muted">
              <span className="w-3 h-3 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0" />
              Looking them up…
            </div>
          ) : entries.length === 0 ? (
            <p className="px-2 py-1 text-[11px] leading-snug text-ink-dim">
              {current?.failed ? "Couldn't reach the PDB's search; type an ID below." : 'No other entries of it in the PDB.'}
            </p>
          ) : (
            <div className="max-h-44 overflow-y-auto space-y-0.5" data-overlay-suggestions>
              {entries.map(e => (
                <PickRow
                  key={e.id}
                  id={e.id}
                  label={e.id}
                  detail={readableName(e.title)}
                  note={e.resolution !== null ? `${e.resolution.toFixed(1)} Å` : METHOD_SHORT[e.method] ?? undefined}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <form
        className="flex items-center gap-1.5"
        onSubmit={e => {
          e.preventDefault();
          if (id && !problem) onPick(id);
        }}
      >
        <input
          value={typed}
          onChange={e => setTyped(e.target.value.replace(/\s/g, '').slice(0, 4))}
          placeholder={entries?.[0] ? `PDB ID, like ${entries[0].id}` : 'PDB ID'}
          aria-label="PDB ID of the structure to lay over"
          aria-describedby={problem ? problemId : undefined}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 px-2.5 py-1.5 touch:py-2 bg-input border border-line rounded-md text-xs text-ink uppercase placeholder:normal-case placeholder:text-ink-dim caret-brand-fg hover:border-line-2 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-ink-dim transition-colors"
        />
        <button
          type="submit"
          disabled={!id || Boolean(problem)}
          aria-describedby={problem ? problemId : undefined}
          className="flex-shrink-0 whitespace-nowrap px-3 py-1.5 touch:py-2.5 touch:px-4 touch:text-[14px] rounded-md bg-brand text-brand-ink text-xs font-semibold hover:bg-brand-dark disabled:bg-chip disabled:text-ink-dim disabled:border disabled:border-line disabled:cursor-not-allowed transition-colors"
        >
          Lay over
        </button>
      </form>
      {/* Polite, not an alert: it appears from the first character typed, and must not cut the typing
          short. Always present, since a live region is only heard when its text changes */}
      <p id={problemId} role="status" className={problem ? 'text-[11.5px] touch:text-[13px] text-bad leading-snug' : 'sr-only'}>{problem}</p>
    </div>
  );
};

/**
 * The picker as a menu under the toolbar's Overlay button. Anchored right, like the toolbar's other
 * menus; inline, it fills a phone's sheet, which has its own title.
 */
export const OverlayMenu: React.FC<OverlayPickerProps & { sourceLabel: string; inline?: boolean }> = ({ sourceLabel, inline = false, ...picker }) => (
  <div data-overlay-menu className={inline ? 'p-4 space-y-3' : 'absolute top-full right-0 mt-3 w-[300px] max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-lg shadow-menu z-50 animate-argus-fade-in'}>
    <div className={inline ? '' : 'px-3 pt-2.5 pb-2 border-b border-line'}>
      {!inline && <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Overlay</p>}
      <p className={inline ? 'text-[13px] leading-snug text-ink-muted' : 'mt-0.5 text-[11px] leading-snug text-ink-muted'}>
        Lay another structure of the same protein over {sourceLabel} to see what moved: an open and a closed form, with and without a ligand, or its predicted model.
      </p>
    </div>
    <div className={inline ? '' : 'p-3'}>
      <OverlayPicker {...picker} />
    </div>
  </div>
);

// A figure with its name, whose meaning shows when the name is pressed
const Stat = ({ label, value, detail, hint }: { label: string; value: string; detail: string; hint: string }) => {
  const explain = useExplain();
  return (
    <div className="grid grid-cols-[56px_1fr] items-baseline gap-2">
      <Term {...explain.term('hint')} className="text-[11px] font-medium text-ink-muted">{label}</Term>
      <span className="min-w-0 truncate text-[11px] text-ink-muted">
        <span className="text-xs font-semibold tabular-nums text-ink-strong">{value}</span> {detail}
      </span>
      {explain.open && <Explanation id={explain.id('hint')} className="col-span-2 mb-1">{hint}</Explanation>}
    </div>
  );
};

interface OverlayPanelProps {
  state: OverlayState;
  sourceLabel: string; // The structure on screen ("4AKE", "the AlphaFold model")
  colour: OverlayColour;
  shown: boolean;
  choosing: boolean; // The picker is open in the panel
  picker: React.ReactNode;
  onChoosing: (open: boolean) => void;
  onColour: (colour: OverlayColour) => void;
  onShown: (shown: boolean) => void;
  onChains: (main: string, other: string) => void;
  onFocus: (keys: string[]) => void; // Select residues of the structure on screen and bring them into view
  onRetry: () => void;
}

/**
 * Overlay, docked in the inspector: how closely the two line up, which chain lies on which, the
 * colouring, and where they differ most. How the two are lined up: services/overlayService.
 */
const OverlayPanel: React.FC<OverlayPanelProps> = ({ state, sourceLabel, colour, shown, choosing, picker, onChoosing, onColour, onShown, onChains, onFocus, onRetry }) => {
  if (state.status === 'idle') return null;
  const r = state.status === 'ready' ? state.result : null;
  // Which chain lies on which: the same chain IDs first
  const pairs = r ? [...r.choices].sort((x, y) => Number(y.main === y.other) - Number(x.main === x.other) || x.main.localeCompare(y.main) || x.other.localeCompare(y.other)) : [];
  const retryable = state.status === 'error' && !/same protein|no protein chain/.test(state.error);

  return (
    <div data-overlay-panel className="space-y-3 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="flex-shrink-0 text-xs font-semibold text-ink-strong">{state.name}</span>
        {r && <span className="min-w-0 truncate text-[11px] text-ink-muted">chain {r.otherChain} on chain {r.mainChain}</span>}
        {state.status !== 'error' && (
          <button
            type="button"
            onClick={() => onChoosing(!choosing)}
            aria-expanded={choosing}
            className="ml-auto flex-shrink-0 text-[11px] font-medium text-ink-muted hover:text-ink-strong transition-colors"
          >
            {choosing ? 'Cancel' : 'Change'}
          </button>
        )}
      </div>

      {choosing && state.status !== 'error' && picker}

      {!choosing && state.status === 'loading' && (
        <div className="flex items-center gap-2.5 py-1">
          <div className="w-4 h-4 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0" />
          <span className="text-xs text-ink-muted">Fetching {state.name} and lining it up…</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="space-y-2.5">
          <p className="text-xs leading-snug text-bad" data-overlay-error>Couldn't lay {state.name} over {sourceLabel}: {state.error}.</p>
          {retryable && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2.5 py-1 rounded-md border border-line bg-input text-[11px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
            >
              Try again
            </button>
          )}
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Lay another over it</p>
          {picker}
        </div>
      )}

      {!choosing && r && (
        <>
          <div className="space-y-1">
            <Stat
              label="Fit"
              value={`${r.coreRmsd.toFixed(1)} Å`}
              detail={`over ${r.core} of ${r.pairs} pairs`}
              hint="RMSD over the residue pairs that end up within 2 Å of each other: the fit leaves out the parts that moved"
            />
            <Stat label="All pairs" value={`${r.allRmsd.toFixed(1)} Å`} detail={`over all ${r.pairs}`} hint="RMSD over every aligned residue pair, moved parts included" />
            <Stat label="Identity" value={`${Math.round(r.identity * 100)}%`} detail="where they align" hint="Share of aligned residues that are the same amino acid" />
          </div>

          {pairs.length > 1 && (
            <Field label="Chains" hint={`Which chain of ${state.name} lies on which chain of ${sourceLabel}`}>
              <Dropdown
                size="sm"
                ariaLabel="Which chain lies on which"
                value={`${r.mainChain}|${r.otherChain}`}
                options={pairs.map(p => ({ value: `${p.main}|${p.other}`, label: `${state.name} ${p.other} on ${p.main}` }))}
                onChange={value => {
                  const [main, other] = value.split('|');
                  onChains(main, other);
                }}
              />
            </Field>
          )}

          <Group label="Colour">
            <Segmented<OverlayColour>
              ariaLabel="Overlay colouring"
              value={colour}
              options={[
                { value: 'distance', label: 'Distance', title: `${sourceLabel} by how far each residue sits from its partner (blue where they agree, white at 2 Å, red at 4 Å or more), ${state.name} as a thin line` },
                { value: 'pair', label: 'Two colours', title: `${sourceLabel} in blue, ${state.name} in orange` },
              ]}
              onChange={onColour}
            />
          </Group>

          <div className="flex items-center justify-between gap-2 min-h-[30px]">
            <span className="text-[11px] font-medium text-ink-muted truncate">Show {state.name}</span>
            <Switch checked={shown} onChange={onShown} label={`Show ${state.name}`} />
          </div>

          <div>
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">Differs most</p>
            {r.regions.length === 0 ? (
              <p className="text-[11px] leading-snug text-ink-muted">No part sits more than 2 Å from its partner.</p>
            ) : (
              <div className="space-y-0.5">
                {r.regions.slice(0, MAX_REGIONS).map(g => (
                  <button
                    key={g.label}
                    type="button"
                    data-overlay-region={g.label}
                    onClick={() => onFocus(g.keys)}
                    title={`Select ${g.label} and bring it into view`}
                    className="w-full min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md border border-transparent text-left hover:border-line hover:bg-chip/60 transition-colors"
                  >
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-line-2" style={{ background: distanceColor(g.max) }} />
                    <span className="min-w-0 truncate text-xs font-semibold text-ink-strong tabular-nums">{g.label}</span>
                    <span className="ml-auto flex-shrink-0 text-[11px] tabular-nums text-ink">up to {g.max.toFixed(1)} Å</span>
                  </button>
                ))}
                {r.regions.length > MAX_REGIONS && (
                  <p className="px-2 text-[10px] text-ink-dim">and {r.regions.length - MAX_REGIONS} smaller {r.regions.length - MAX_REGIONS === 1 ? 'one' : 'ones'}</p>
                )}
              </div>
            )}
          </div>

          {r.changed.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">Different residues</p>
              <p className="text-[11px] leading-relaxed text-ink tabular-nums">
                {r.changed.slice(0, MAX_CHANGES).map((c, i) => (
                  <React.Fragment key={c.key}>
                    {i > 0 && ', '}
                    <button
                      type="button"
                      data-overlay-change={c.label}
                      onClick={() => onFocus([c.key])}
                      title={`${c.label}: ${c.from} here, ${c.to} in ${state.name}`}
                      className="-mx-0.5 px-1 py-0.5 touch:px-1.5 touch:py-1.5 rounded underline decoration-line-2 underline-offset-2 hover:bg-chip/60 hover:text-brand-text hover:decoration-brand/50 transition-colors"
                    >
                      {c.label} {c.from}→{c.to}
                    </button>
                  </React.Fragment>
                ))}
                {r.changed.length > MAX_CHANGES && <span className="text-ink-dim"> and {r.changed.length - MAX_CHANGES} more</span>}
              </p>
            </div>
          )}

          <p className="pt-2 border-t border-line text-[10px] leading-snug text-ink-dim">
            Residues paired by sequence, then fitted on the pairs that end up within 2 Å, so the parts that moved don't pull the fit.
          </p>
        </>
      )}
    </div>
  );
};

export default OverlayPanel;

/** The canvas legend: the distance scale, or which colour is which. */
export const OverlayLegend: React.FC<{ result: OverlayResult; colour: OverlayColour; sourceLabel: string; shown: boolean; noPartner: string; line: string; className: string }> = ({
  result, colour, sourceLabel, shown, noPartner, line, className,
}) => (
  <div className={className} data-overlay-legend>
    <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-2">Overlay · {result.id}</p>
    {colour === 'distance' ? (
      <>
        <div className="h-2 rounded-full" style={{ background: DISTANCE_GRADIENT }} />
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-dim">
          <span>0 Å</span>
          <span>2</span>
          <span>4+ Å</span>
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-ink-dim">{sourceLabel} chain {result.mainChain}: how far each residue sits from its partner</p>
        <div className="mt-1.5 space-y-1">
          <div className={`flex items-center gap-2 ${shown ? '' : 'opacity-40'}`}>
            <div className="w-3 h-0.5 rounded-full flex-shrink-0" style={{ background: line }} />
            <span className="text-[11px] text-ink">{result.id} chain {result.otherChain}{shown ? '' : ' (hidden)'}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: noPartner }} />
            <span className="text-[11px] text-ink">No partner</span>
          </div>
        </div>
      </>
    ) : (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-1.5 rounded-full flex-shrink-0" style={{ background: PAIR_COLORS.main }} />
          <span className="text-xs font-semibold text-ink leading-tight">{sourceLabel} chain {result.mainChain}</span>
        </div>
        <div className={`flex items-center gap-2 ${shown ? '' : 'opacity-40'}`}>
          <div className="w-3 h-1.5 rounded-full flex-shrink-0" style={{ background: PAIR_COLORS.other }} />
          <span className="text-xs font-semibold text-ink leading-tight">{result.id} chain {result.otherChain}{shown ? '' : ' (hidden)'}</span>
        </div>
      </div>
    )}
    <p className="mt-2 text-[10px] leading-snug text-ink-dim">Lined up on {result.core} residues to {result.coreRmsd.toFixed(1)} Å.</p>
  </div>
);
