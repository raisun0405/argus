import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COFOLD_MAX_RESIDUES, keptCofactors, siteForChains, type CofoldSetup } from '../services/cofoldService';
import type { CofoldPocket } from '../types';
import Dropdown from './Dropdown';
import { isTouch } from '../useMedia';

export interface CofoldChoice {
  ligandText: string;
  chains: string[];
  cofactors: string[]; // Kept cofactor copies (PDB codes)
  pocket?: CofoldPocket; // Where it should bind; absent means Boltz-2 decides
  compareWith?: string; // A second molecule, predicted under the same conditions and compared with the first
}

const ANYWHERE = 'anywhere';

interface CofoldMenuProps {
  setup: CofoldSetup;
  sourceLabel: string; // "1HSG", "the AlphaFold model", "your ESMFold prediction"
  initialSiteId?: string; // A site chosen before the form opened ("Co-fold here" in Pocket Radar)
  disabledReason?: string; // e.g. the chat is busy
  onSubmit: (choice: CofoldChoice) => void;
  inline?: boolean; // In a phone's sheet (which has its own title) rather than a menu under the toolbar
}

/** The chains a site needs added to `chains`: all of them if they fit the residue limit, else only the site's. */
const chainsWithSite = (setup: CofoldSetup, chains: string[], siteChains: string[]) => {
  const union = [...new Set([...chains, ...siteChains])].sort();
  const residues = setup.chains.filter(c => union.includes(c.chain)).reduce((n, c) => n + c.residues, 0);
  return residues <= COFOLD_MAX_RESIDUES ? union : [...new Set(siteChains)].sort();
};

const MAX_PICKS = 6;

const INPUT = 'w-full px-2.5 py-1.5 touch:py-2.5 bg-input border border-line rounded-md text-xs text-ink placeholder:text-ink-dim caret-brand-fg hover:border-line-2 focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-ink-dim transition-colors';

/**
 * Co-fold form under the toolbar: the molecule (typed, or one of the structure's ligands), the chains
 * to predict when there are several, and whether metals and cofactors stay in place. "Compare with
 * another molecule" adds a second field: both are then predicted with the same chains, site and
 * cofactors, so the comparison is like for like.
 */
const CofoldMenu: React.FC<CofoldMenuProps> = ({ setup, sourceLabel, initialSiteId, disabledReason, onSubmit, inline = false }) => {
  const preset = setup.sites.find(s => s.id === initialSiteId);
  const siteChains = (id: string) => [...new Set(setup.sites.find(s => s.id === id)?.residues.map(r => r.chain) ?? [])];
  const [ligandText, setLigandText] = useState('');
  const [comparing, setComparing] = useState(false);
  const [secondText, setSecondText] = useState('');
  const [activeField, setActiveField] = useState<'first' | 'second'>('first'); // Where a picked ligand goes
  const [chains, setChains] = useState<string[]>(() => (preset ? chainsWithSite(setup, setup.defaultChains, siteChains(preset.id)) : setup.defaultChains));
  const [keepCofactors, setKeepCofactors] = useState(true);
  const [siteId, setSiteId] = useState(preset ? preset.id : ANYWHERE);
  // Choosing a site also ticks the chains that line it
  const chooseSite = (id: string) => {
    setSiteId(id);
    const needed = siteChains(id);
    if (needed.some(c => !chains.includes(c))) setChains(current => chainsWithSite(setup, current, needed));
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const secondRef = useRef<HTMLInputElement>(null);
  // Ready to type, except on a touch screen, where focus would throw the keyboard over the form
  useEffect(() => { if (!isTouch()) inputRef.current?.focus(); }, []);

  // The site must lie in the chains being predicted; one that doesn't falls back to "anywhere"
  const site = setup.sites.find(s => s.id === siteId);
  const pocket = useMemo(() => (site ? siteForChains(site, chains) : null), [site, chains]);
  const siteDropped = Boolean(site) && !pocket;

  const residues = setup.chains.filter(c => chains.includes(c.chain)).reduce((n, c) => n + c.residues, 0);
  const picked = setup.ligands.find(l => l.code === ligandText.trim().toUpperCase());
  const second = comparing ? secondText.trim() : '';
  const pickedSecond = second ? setup.ligands.find(l => l.code === second.toUpperCase()) : undefined;
  // Neither molecule is also kept as a cofactor
  const cofactors = useMemo(
    () => keptCofactors(setup, chains, picked?.code).filter(code => code !== pickedSecond?.code),
    [setup, chains, picked?.code, pickedSecond?.code]
  );
  const cofactorSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const code of cofactors) counts.set(code, (counts.get(code) ?? 0) + 1);
    return [...counts].map(([code, n]) => `${setup.cofactors.find(c => c.code === code)?.name ?? code}${n > 1 ? ` ×${n}` : ''}`).join(', ');
  }, [cofactors, setup]);

  const tooBig = residues > COFOLD_MAX_RESIDUES;
  const sameTwice = second !== '' && second.toLowerCase() === ligandText.trim().toLowerCase();
  const problem = disabledReason
    ?? (chains.length === 0 ? 'Pick at least one chain'
      : tooBig ? `${residues.toLocaleString()} residues: untick chains to stay within ${COFOLD_MAX_RESIDUES.toLocaleString()}`
      : sameTwice ? 'Pick two different molecules to compare'
      : null);
  const canSubmit = ligandText.trim() !== '' && (!comparing || second !== '') && !problem;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      ligandText: ligandText.trim(),
      chains,
      cofactors: keepCofactors ? cofactors : [],
      ...(pocket ? { pocket } : {}),
      ...(second ? { compareWith: second } : {}),
    });
  };

  // Picking one of the structure's ligands also picks the chains around it (a drug between two chains needs both)
  const pick = (code: string, around: string[]) => {
    if (comparing && activeField === 'second') {
      setSecondText(code);
      secondRef.current?.focus();
      return; // The chains stay as the first molecule set them: both are predicted alike
    }
    setLigandText(code);
    const near = around.filter(c => setup.chains.some(s => s.chain === c));
    if (near.length > 0 && setup.chains.length > 1) setChains(near);
    inputRef.current?.focus();
  };

  const toggleChain = (chain: string) =>
    setChains(current => (current.includes(chain) ? current.filter(c => c !== chain) : [...current, chain].sort()));

  return (
    // No overflow clipping: the "Where it binds" list opens past the form's lower edge. Anchored to
    // the right because the toolbar sits at the right end of the header.
    <div className={inline ? '' : 'absolute top-full right-0 mt-3 w-[300px] max-w-[calc(100vw-2rem)] bg-surface border border-line rounded-lg shadow-menu z-50 animate-argus-fade-in'}>
      <div className={inline ? 'px-4 pt-3' : 'px-3 pt-2.5 pb-2 border-b border-line'}>
        <div className={inline ? 'hidden' : 'flex items-center justify-between gap-2'}>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">{comparing ? 'Compare two molecules' : 'Co-fold a molecule'}</p>
          <span className="text-[10px] font-medium text-ink-dim">Boltz-2</span>
        </div>
        <p className={inline ? 'text-[13px] leading-snug text-ink-muted' : 'mt-0.5 text-[11px] leading-snug text-ink-muted'}>
          {comparing ? `Predicts how each binds ${sourceLabel}, under the same conditions, and sets them side by side.` : `Predicts how it binds ${sourceLabel}, and how strongly.`}
        </p>
      </div>

      <form
        className={inline ? 'p-4 space-y-3.5' : 'p-3 space-y-2.5'}
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          value={ligandText}
          onChange={e => setLigandText(e.target.value)}
          onFocus={() => setActiveField('first')}
          placeholder={comparing ? 'First molecule: name, PDB code or SMILES' : 'Drug name, PDB ligand code or SMILES'}
          aria-label="Molecule to co-fold: a name, a PDB ligand code or a SMILES string"
          spellCheck={false}
          autoComplete="off"
          maxLength={500}
          className={INPUT}
        />

        {comparing ? (
          <div className="flex items-center gap-1.5">
            <input
              ref={secondRef}
              value={secondText}
              onChange={e => setSecondText(e.target.value)}
              onFocus={() => setActiveField('second')}
              placeholder="Second molecule"
              aria-label="Second molecule to compare: a name, a PDB ligand code or a SMILES string"
              spellCheck={false}
              autoComplete="off"
              maxLength={500}
              className={INPUT}
            />
            <button
              type="button"
              onClick={() => { setComparing(false); setSecondText(''); setActiveField('first'); inputRef.current?.focus(); }}
              title="Back to one molecule"
              aria-label="Remove the second molecule"
              className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-ink-muted hover:bg-chip/60 hover:text-ink-strong transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setComparing(true); setActiveField('second'); setTimeout(() => secondRef.current?.focus(), 0); }}
            className="text-[11px] touch:text-[13px] touch:py-1 font-medium text-ink-muted hover:text-ink-strong transition-colors"
          >
            + Compare with another molecule
          </button>
        )}

        {setup.ligands.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">In this structure</p>
            <div className="flex flex-wrap gap-1">
              {setup.ligands.slice(0, MAX_PICKS).map(l => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => pick(l.code, l.chains)}
                  title={l.fullName ? `${l.code}: ${l.fullName.toLowerCase()}` : l.code}
                  aria-pressed={picked?.code === l.code || pickedSecond?.code === l.code}
                  className={`px-1.5 py-0.5 touch:px-2.5 touch:py-1.5 touch:text-[13px] rounded border text-[11px] font-medium transition-colors ${
                    picked?.code === l.code || pickedSecond?.code === l.code ? 'border-brand/50 bg-brand/10 text-brand-text' : 'border-line bg-input text-ink hover:border-brand/40 hover:text-brand-text'
                  }`}
                >
                  {l.code}{l.name !== l.code && <span className="text-ink-dim font-normal"> · {l.name}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {setup.sites.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">Where it binds</p>
            <Dropdown
              ariaLabel="Where the molecule should bind"
              value={siteId}
              options={[
                { value: ANYWHERE, label: 'Boltz-2 decides' },
                ...setup.sites.map(s => ({ value: s.id, label: s.label })),
              ]}
              onChange={chooseSite}
            />
            <p className={`mt-1 text-[10px] leading-snug ${siteDropped ? 'text-warn' : 'text-ink-dim'}`}>
              {siteDropped
                ? 'That site is not in the chosen chains: tick the chains that line it, or the molecule will be placed freely.'
                : site
                  ? `${site.detail} · Boltz-2 is told to bind among these residues`
                  : 'Boltz-2 picks the site itself, anywhere on the protein.'}
            </p>
          </div>
        )}

        {setup.chains.length > 1 && (
          <div>
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">Chains</p>
            <div className="max-h-28 overflow-y-auto space-y-0.5 pr-1" data-cofold-chains>
              {setup.chains.map(c => (
                <label key={c.chain} className="flex items-center gap-2 touch:gap-3 px-1 py-0.5 touch:py-2 rounded hover:bg-chip cursor-pointer text-[11px] touch:text-[13px] text-ink select-none">
                  <input type="checkbox" checked={chains.includes(c.chain)} onChange={() => toggleChain(c.chain)} className="accent-brand touch:w-4 touch:h-4" />
                  <span className="font-semibold">{c.chain}</span>
                  <span className="truncate text-ink-muted">{c.name ?? ''}</span>
                  <span className="ml-auto text-[10px] text-ink-dim tabular-nums">{c.residues}</span>
                </label>
              ))}
            </div>
            <p className={`mt-1 text-[10px] tabular-nums ${tooBig ? 'text-bad' : 'text-ink-dim'}`}>
              {residues.toLocaleString()} residues selected · up to {COFOLD_MAX_RESIDUES.toLocaleString()}
            </p>
          </div>
        )}

        {cofactors.length > 0 && (
          <label className="flex items-start gap-2 touch:gap-3 text-[11px] touch:text-[13px] text-ink cursor-pointer select-none">
            <input type="checkbox" checked={keepCofactors} onChange={e => setKeepCofactors(e.target.checked)} className="accent-brand mt-0.5 touch:w-4 touch:h-4" />
            <span>
              Keep {cofactorSummary}
              <span className="block text-[10px] text-ink-dim leading-snug">Metals and cofactors often shape the site the molecule binds</span>
            </span>
          </label>
        )}

        {problem && ligandText.trim() !== '' && <p className="text-[10px] text-bad leading-snug">{problem}</p>}

        <div className="flex items-center gap-2.5 pt-0.5">
          <button
            type="submit"
            disabled={!canSubmit}
            title={problem ?? (!ligandText.trim() ? 'Name a molecule first' : comparing && !second ? 'Name the second molecule' : undefined)}
            className="flex-shrink-0 whitespace-nowrap px-3 py-1.5 touch:px-5 touch:py-2.5 touch:text-[14px] rounded-md bg-brand text-brand-ink text-xs font-semibold hover:bg-brand-dark hover:shadow-[0_4px_18px_-4px_rgb(var(--c-accent)/0.65)] disabled:bg-chip disabled:text-ink-dim disabled:border disabled:border-line disabled:shadow-none disabled:cursor-not-allowed transition-all"
          >
            {comparing ? 'Compare' : 'Co-fold'}
          </button>
          <span className="text-[10px] leading-snug text-ink-dim">{comparing ? 'Two predictions, side by side; usually about a minute' : "Usually under a minute, on NVIDIA's servers"}</span>
        </div>
      </form>
    </div>
  );
};

export default CofoldMenu;
