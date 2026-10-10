import React from 'react';
import { MoleculeIcon } from './icons';
import type { CofoldResult, ProteinAnalysis } from '../types';
import { contactLabel, formatIc50, pIc50, poseConfidence } from '../services/cofoldService';
import { LIGAND_NAMES } from '../services/alphafillService';
import { INTERACTION_LABELS, type InteractionType } from '../services/interactionService';

interface CofoldCardProps {
  result: CofoldResult;
  origin: ProteinAnalysis; // What was on screen when Co-fold ran
  currentStructureId?: string;
  onView: () => void; // Open the co-folded complex again
  onBack: () => void;
}

const MAX_CONTACTS = 6;

const CONFIDENCE = {
  high: { label: 'High', tone: 'text-good' },
  medium: { label: 'Medium', tone: 'text-warn' },
  low: { label: 'Low', tone: 'text-bad' },
} as const;

/**
 * A Boltz-2 co-folding result inside a chat message: how confident the pose is, the predicted affinity
 * and binder probability, the residues holding the molecule, and how the pose compares with the
 * crystal structure when that holds the same ligand.
 */
const CofoldCard: React.FC<CofoldCardProps> = ({ result, origin, currentStructureId, onView, onBack }) => {
  const { ligand, request, scores, affinity, reference, contacts } = result;
  const isOpen = currentStructureId?.toUpperCase() === result.id;
  const confidence = poseConfidence(scores);
  const iptm = scores.ligandIptm ?? scores.iptm;
  const multiChain = request.source.kind === 'pdb' && request.source.chains.length > 1;
  const sourceLabel = request.source.kind === 'pdb'
    ? `${request.source.pdbId} · ${request.source.chains.length > 1 ? 'chains' : 'chain'} ${request.source.chains.join(', ')}`
    : request.source.kind === 'alphafold' ? 'AlphaFold model' : 'ESMFold prediction';
  const backLabel = /^ESM-/i.test(origin.pdbId) ? 'prediction' : /^AF-/i.test(origin.pdbId) ? 'AlphaFold model' : origin.pdbId;
  // Where it was steered, and whether it stayed there
  const steer = result.pocket;
  const steering = !steer
    ? null
    : !steer.applied
      ? { tone: 'text-warn', text: `${steer.label}: the hint was refused, so the site was chosen freely` }
      : steer.touched === 0
        ? { tone: 'text-warn', text: `${steer.label}: steered there, but the pose settled elsewhere` }
        : { tone: 'text-ink-muted', text: `${steer.label} · ${steer.touched} of ${contacts.length} contacts inside it` };

  const specific = (result.interactions ?? []).filter(x => x.type !== 'hydrophobic' && x.type !== 'water_bridge');
  const hydrophobicCount = result.interactions?.find(x => x.type === 'hydrophobic')?.partners.length ?? 0;
  const kept = result.cofactors.map(c => LIGAND_NAMES[c.resn] ?? c.resn);
  const keptSummary = [...new Set(kept)].map(name => `${name}${kept.filter(k => k === name).length > 1 ? ` ×${kept.filter(k => k === name).length}` : ''}`).join(', ');

  return (
    <div className="mt-4 mb-1 bg-canvas rounded-xl border border-line shadow-quiz overflow-hidden">
      {/* Header */}
      <div className="bg-surface px-4 pt-3 pb-2.5 border-b border-line">
        {/* The same heading as the quiz card's "Quick check": the tool's icon and name, the source at the right */}
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
          <MoleculeIcon size={12} />
          Co-fold
          <span className="ml-auto text-[10px]">Boltz-2</span>
        </p>
        <p className="mt-1 text-xs text-ink">
          <span className="font-semibold text-ink-strong">{ligand.name}</span> with {request.proteinName}
          <span className="text-ink-dim"> · {sourceLabel}</span>
        </p>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        <div className="px-3 py-2.5" title="How sure Boltz-2 is about where and how the molecule sits: its confidence in the protein-ligand interface (ipTM, 0-1). Above 0.8 is usually right; below 0.6 often wrong.">
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Pose</p>
          <p className={`mt-0.5 text-sm font-semibold ${confidence ? CONFIDENCE[confidence].tone : 'text-ink'}`}>{confidence ? CONFIDENCE[confidence].label : '—'}</p>
          <p className="text-[10px] text-ink-dim tabular-nums">{iptm !== null ? `ipTM ${iptm.toFixed(2)}` : 'no score'}</p>
        </div>
        <div className="px-3 py-2.5" title="Boltz-2's estimate of the IC50, the concentration that halves the protein's activity (lower binds tighter). Useful for comparing molecules; not a measurement.">
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Affinity</p>
          <p className="mt-0.5 text-sm font-semibold text-ink-strong tabular-nums">{affinity ? `≈ ${formatIc50(affinity.log10Ic50)}` : '—'}</p>
          <p className="text-[10px] text-ink-dim tabular-nums">{affinity ? `IC50 · pIC50 ${pIc50(affinity.log10Ic50).toFixed(1)}` : 'not predicted'}</p>
        </div>
        <div className="px-3 py-2.5" title="Boltz-2's probability that this molecule is a real binder rather than an inactive look-alike, as in screening for hits.">
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">Binder</p>
          <p className="mt-0.5 text-sm font-semibold text-ink-strong tabular-nums">{affinity ? `${Math.round(affinity.binderProbability * 100)}%` : '—'}</p>
          <p className="text-[10px] text-ink-dim">probability</p>
        </div>
      </div>

      {/* Details */}
      <div className="px-4 py-2.5 space-y-1.5 text-[11px] leading-snug">
        {reference && (
          <p className="text-ink">
            <span className="font-semibold text-ink-strong">Crystal pose</span>
            <span className="text-ink-muted"> ({reference.from}, grey): </span>
            <span className="tabular-nums">{reference.centroidDistance.toFixed(1)} Å away</span>
            {reference.crystalContacts > 0 && (
              <span className="text-ink-muted tabular-nums"> · {reference.sharedContacts} of {reference.crystalContacts} contacts shared</span>
            )}
            {reference.interactionsTotal ? (
              <span
                className="text-ink-muted tabular-nums"
                title="Hydrogen bonds, salt bridges, stacking, halogen bonds and metal contacts of the crystal ligand that the prediction makes with the same residues"
              >
                {' '}· {reference.interactionsShared} of {reference.interactionsTotal} interactions reproduced
              </span>
            ) : null}
          </p>
        )}
        {steering && (
          <p className="text-ink">
            <span className="font-semibold text-ink-strong">Steered to</span>{' '}
            <span className={`${steering.tone} tabular-nums`} title={`Boltz-2 was told to bind the molecule among ${steer!.residues} residues of this site`}>
              {steering.text}
            </span>
          </p>
        )}
        {specific.length > 0 && (
          <p className="text-ink">
            <span className="font-semibold text-ink-strong">Interactions</span>{' '}
            <span className="text-ink-muted">
              {specific.map(({ type, partners }) => `${INTERACTION_LABELS[type as InteractionType]?.[partners.length > 1 ? 'many' : 'one'].toLowerCase() ?? type} ${partners.slice(0, 3).join(', ')}${partners.length > 3 ? ` +${partners.length - 3}` : ''}`).join(' · ')}
            </span>
            {hydrophobicCount > 0 && <span className="text-ink-dim"> · {hydrophobicCount} hydrophobic</span>}
          </p>
        )}
        <p className="text-ink">
          <span className="font-semibold text-ink-strong">Held by</span>{' '}
          {contacts.length > 0 ? (
            <>
              <span className="text-ink-muted">{contacts.slice(0, MAX_CONTACTS).map(c => contactLabel(c, multiChain)).join(', ')}</span>
              {contacts.length > MAX_CONTACTS && <span className="text-ink-dim"> +{contacts.length - MAX_CONTACTS}</span>}
            </>
          ) : (
            <span className="text-bad">no residue within 4 Å: the pose is unreliable</span>
          )}
        </p>
        <p className="text-[10px] text-ink-dim">
          {result.template ? `Protein shaped by ${result.template}` : 'Predicted from the sequence alone'}
          {keptSummary && ` · kept ${keptSummary}`}
          {result.proteinRmsd !== null && ` · protein ${result.proteinRmsd.toFixed(1)} Å from the structure`}
          {` · ${Math.round(result.seconds)} s`}
        </p>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-line bg-surface flex items-center justify-between gap-3">
        <p className="text-[10px] leading-snug text-ink-dim">
          <a href="https://github.com/jwohlwend/boltz" target="_blank" rel="noreferrer" className="underline decoration-line-2 hover:text-brand-text">Boltz-2</a>
          {' '}(MIT) on NVIDIA's API. Affinity is an estimate for ranking molecules, not a measurement; tenfold errors are common.
        </p>
        <button
          onClick={isOpen ? onBack : onView}
          className="flex-shrink-0 px-2 py-1 rounded-md border border-line bg-canvas text-[11px] font-medium text-ink hover:text-brand-text hover:border-brand/40 transition-colors"
        >
          {isOpen ? `Back to ${backLabel}` : 'View complex'}
        </button>
      </div>
    </div>
  );
};

export default CofoldCard;
