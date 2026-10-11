import React from 'react';
import { CompareIcon } from './icons';
import { Explanation, Term, useExplain } from './Explain';
import type { CofoldResult, ProteinAnalysis } from '../types';
import { COMPARE_COLORS, affinityGap, foldText, formatIc50, pIc50, poseConfidence, residueLabel, siteRelation } from '../services/cofoldService';

interface CompareCardProps {
  result: CofoldResult; // A comparison: result.compare is set
  origin: ProteinAnalysis; // What was on screen when the comparison ran
  currentStructureId?: string;
  onView: () => void; // Open the combined complex again
  onBack: () => void;
}

const MAX_FINGERPRINT_ROWS = 6;

const CONFIDENCE = { high: 'High', medium: 'Medium', low: 'Low' } as const;

// Short names for the fingerprint cells
const SHORT: Record<string, string> = {
  hbond: 'H‑bond', salt_bridge: 'salt bridge', pi_stacking: 'π‑stack', pi_cation: 'cation‑π', halogen: 'halogen', metal: 'metal',
};

const Swatch = ({ color }: { color: string }) => (
  <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full flex-shrink-0 ring-1 ring-line-2" style={{ background: color }} />
);

/**
 * Two co-folded molecules side by side, laid out like a comparison table: the verdict first, then one
 * row per measure with the better value in bold (only when the gap means something), then the site
 * they share and the interactions each makes, residue by residue (an interaction fingerprint).
 */
const CompareCard: React.FC<CompareCardProps> = ({ result, origin, currentStructureId, onView, onBack }) => {
  const c = result.compare!;
  const a = result;
  const b = c.other;
  const isOpen = currentStructureId?.toUpperCase() === result.id;
  const multiChain = a.request.source.kind === 'pdb' && a.request.source.chains.length > 1;
  const sourceLabel = a.request.source.kind === 'pdb'
    ? `${a.request.source.pdbId} · ${a.request.source.chains.length > 1 ? 'chains' : 'chain'} ${a.request.source.chains.join(', ')}`
    : a.request.source.kind === 'alphafold' ? 'AlphaFold model' : 'ESMFold prediction';
  const backLabel = /^ESM-/i.test(origin.pdbId) ? 'prediction' : /^AF-/i.test(origin.pdbId) ? 'AlphaFold model' : origin.pdbId;

  const iptmA = a.scores.ligandIptm ?? a.scores.iptm;
  const iptmB = b.scores.ligandIptm ?? b.scores.iptm;
  const gap = affinityGap(a, b);
  const site = siteRelation(c);
  const all = c.shared.length + c.onlyA.length + c.onlyB.length;

  // Which side is better on a row, if the difference is worth stating
  const better = (x: number | null | undefined, y: number | null | undefined, margin: number, higherIsBetter = true): 'a' | 'b' | null => {
    if (x === null || x === undefined || y === null || y === undefined || Math.abs(x - y) < margin) return null;
    return (x > y) === higherIsBetter ? 'a' : 'b';
  };
  const poseBetter = better(iptmA, iptmB, 0.05);
  const affinityBetter = gap?.tighter ?? null;
  const binderBetter = better(a.affinity?.binderProbability, b.affinity?.binderProbability, 0.1);
  const tone = (side: 'a' | 'b', winner: 'a' | 'b' | null) => (winner === side ? 'text-ink-strong font-semibold' : 'text-ink');

  // The headline: who is predicted to bind more tightly, and whether that comparison is fair
  const winner = affinityBetter === 'a' ? a : affinityBetter === 'b' ? b : null;
  const verdict = site === 'different'
    ? { text: `Different sites, ${c.centroidDistance.toFixed(0)} Å apart: not a like-for-like comparison`, tone: 'text-warn' }
    : !gap
      ? { text: site === 'same' ? 'Same site · no affinity predicted' : 'Partly the same site · no affinity predicted', tone: 'text-ink' }
      : winner
        ? { text: `${winner.ligand.name} predicted ~${foldText(gap.fold)} tighter${site === 'partly' ? ' · sites overlap partly' : ''}${poseConfidence(winner.scores) === 'low' ? ' · but its pose is low-confidence' : ''}`, tone: 'text-ink-strong' }
        : { text: `Similar predicted affinity${site === 'partly' ? ' · sites overlap partly' : ' · same site'}`, tone: 'text-ink-strong' };

  const rows: { label: string; title: string; a: React.ReactNode; b: React.ReactNode; winner: 'a' | 'b' | null }[] = [
    {
      label: 'Pose',
      title: "Boltz-2's confidence in where and how each molecule sits (ligand ipTM, 0-1). Above 0.8 is usually right; below 0.6 often wrong.",
      a: <>{poseConfidence(a.scores) ? CONFIDENCE[poseConfidence(a.scores)!] : '—'} <span className="text-ink-dim font-normal tabular-nums">{iptmA !== null ? iptmA.toFixed(2) : ''}</span></>,
      b: <>{poseConfidence(b.scores) ? CONFIDENCE[poseConfidence(b.scores)!] : '—'} <span className="text-ink-dim font-normal tabular-nums">{iptmB !== null ? iptmB.toFixed(2) : ''}</span></>,
      winner: poseBetter,
    },
    {
      label: 'Affinity',
      title: "Boltz-2's estimated IC50 (lower binds tighter). Gaps under tenfold are within its usual error, so neither is marked better.",
      a: a.affinity ? <span className="tabular-nums">≈ {formatIc50(a.affinity.log10Ic50)}<span className="block text-[10px] text-ink-dim font-normal">pIC50 {pIc50(a.affinity.log10Ic50).toFixed(1)}</span></span> : '—',
      b: b.affinity ? <span className="tabular-nums">≈ {formatIc50(b.affinity.log10Ic50)}<span className="block text-[10px] text-ink-dim font-normal">pIC50 {pIc50(b.affinity.log10Ic50).toFixed(1)}</span></span> : '—',
      winner: affinityBetter,
    },
    {
      label: 'Binder',
      title: "Boltz-2's probability that each is a real binder rather than an inactive look-alike.",
      a: a.affinity ? <span className="tabular-nums">{Math.round(a.affinity.binderProbability * 100)}%</span> : '—',
      b: b.affinity ? <span className="tabular-nums">{Math.round(b.affinity.binderProbability * 100)}%</span> : '—',
      winner: binderBetter,
    },
    {
      label: 'Contacts',
      title: 'Residues within 4 Å of each molecule',
      a: <span className="tabular-nums">{a.contacts.length}</span>,
      b: <span className="tabular-nums">{b.contacts.length}</span>,
      winner: null,
    },
  ];
  if (a.reference || b.reference) {
    // Each molecule's own crystal comparison, from its own prediction
    const crystal = (r: CofoldResult) => {
      const ref = r === a ? (c.reference === 'a' ? a.reference : undefined) : b.reference;
      return ref ? <span className="tabular-nums">{ref.centroidDistance.toFixed(1)} Å{ref.crystalContacts > 0 ? <span className="text-ink-dim font-normal"> · {ref.sharedContacts}/{ref.crystalContacts}</span> : null}</span> : '—';
    };
    rows.push({
      label: 'Crystal',
      title: 'How far the predicted pose sits from the same molecule in the crystal structure, and how many of its contacts it shares',
      a: crystal(a),
      b: crystal(b),
      winner: null,
    });
  }

  const fingerprint = c.fingerprint.slice(0, MAX_FINGERPRINT_ROWS);
  const explain = useExplain(); // What each row means, a press on its name away
  const cell = (mine: string[], theirs: string[]) =>
    mine.length === 0
      ? <span className="text-ink-dim">—</span>
      : mine.map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 ? ', ' : ''}
            <span className={`whitespace-nowrap ${theirs.includes(t) ? 'text-ink' : 'text-ink-strong font-semibold'}`}>{SHORT[t] ?? t}</span>
          </React.Fragment>
        ));

  return (
    <div className="mt-4 mb-1 bg-canvas rounded-xl border border-line shadow-quiz overflow-hidden">
      {/* Header */}
      <div className="bg-surface px-4 pt-3 pb-2.5 border-b border-line">
        {/* The same heading as the quiz card's "Quick check": the tool's icon and name, the source at the right */}
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-dim">
          <CompareIcon size={12} />
          Compare
          <span className="ml-auto text-[10px]">Boltz-2</span>
        </p>
        <p className="mt-1 text-xs text-ink">
          <span className="font-semibold text-ink-strong">{a.ligand.name}</span> vs <span className="font-semibold text-ink-strong">{b.ligand.name}</span> with {a.request.proteinName}
          <span className="text-ink-dim"> · {sourceLabel}</span>
        </p>
        <p className={`mt-1.5 text-[12px] leading-snug ${verdict.tone}`} data-compare-verdict>{verdict.text}</p>
      </div>

      {/* Side by side */}
      <table className="w-full table-fixed text-[11px] border-b border-line">
        <colgroup>
          <col className="w-[31%]" />
          <col className="w-[34.5%]" />
          <col className="w-[34.5%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th />
            {[{ r: a, color: COMPARE_COLORS.a.swatch }, { r: b, color: COMPARE_COLORS.b.swatch }].map(({ r, color }) => (
              <th key={r.id} scope="col" className="px-2 py-1.5 text-left font-semibold text-ink-strong overflow-hidden">
                <span className="flex items-center gap-1.5 min-w-0"><Swatch color={color} /><span className="truncate" title={r.ligand.name}>{r.ligand.name}</span></span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(row => (
            <React.Fragment key={row.label}>
              <tr>
                <th scope="row" className="pl-4 pr-1 py-1.5 text-left text-[10px] font-semibold text-ink-muted uppercase tracking-[0.1em]">
                  <Term {...explain.term(row.label)}>{row.label}</Term>
                </th>
                <td className={`px-2 py-1.5 break-words ${tone('a', row.winner)}`}>{row.a}</td>
                <td className={`px-2 py-1.5 break-words ${tone('b', row.winner)}`}>{row.b}</td>
              </tr>
              {explain.open === row.label && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 bg-surface/40">
                    <Explanation id={explain.id(row.label)}>{row.title}</Explanation>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {/* Where, and how */}
      <div className="px-4 py-2.5 space-y-2 text-[11px] leading-snug">
        <p className="text-ink">
          <span className="font-semibold text-ink-strong">Site</span>{' '}
          <span className="text-ink-muted tabular-nums">
            {site === 'same' ? 'Same' : site === 'partly' ? 'Partly shared' : 'Different'} · {c.shared.length} of {all} residues shared · {c.centroidDistance.toFixed(1)} Å apart
          </span>
        </p>
        {fingerprint.length > 0 && (
          <div>
            <p className="font-semibold text-ink-strong mb-1">
              <Term {...explain.term('interactions')}>Interactions</Term>
            </p>
            {explain.open === 'interactions' && (
              <Explanation id={explain.id('interactions')} className="mb-1.5">
                The hydrogen bonds, salt bridges, stacking, halogen bonds and metal contacts each molecule makes, by residue. Bold: made by one molecule only.
              </Explanation>
            )}
            <table className="w-full text-[10.5px]">
              <tbody>
                {fingerprint.map(f => (
                  <tr key={`${f.chain}|${f.resi}|${f.icode}`} className="align-top">
                    <th scope="row" className="pr-2 py-0.5 text-left font-medium text-ink-muted whitespace-nowrap">{residueLabel(f, multiChain)}</th>
                    <td className="pr-2 py-0.5 w-[42%]">{cell(f.a, f.b)}</td>
                    <td className="py-0.5 w-[42%]">{cell(f.b, f.a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c.fingerprint.length > MAX_FINGERPRINT_ROWS && (
              <p className="mt-0.5 text-[10px] text-ink-dim">+{c.fingerprint.length - MAX_FINGERPRINT_ROWS} more residues</p>
            )}
          </div>
        )}
        <p className="text-[10px] text-ink-dim">
          Same chains, site and cofactors for both · the protein shown is from the {a.ligand.name} prediction
        </p>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-line bg-surface flex items-center justify-between gap-3">
        <p className="text-[10px] leading-snug text-ink-dim">
          <a href="https://github.com/jwohlwend/boltz" target="_blank" rel="noreferrer" className="underline decoration-line-2 hover:text-brand-text">Boltz-2</a>
          {' '}(MIT) on NVIDIA's API. Affinities are estimates for ranking; tenfold errors are common.
        </p>
        <button
          onClick={isOpen ? onBack : onView}
          className="flex-shrink-0 px-2 py-1 rounded-md border border-line bg-canvas text-[11px] font-medium text-ink hover:text-brand-text hover:border-brand/40 transition-colors"
        >
          {isOpen ? `Back to ${backLabel}` : 'View both'}
        </button>
      </div>
    </div>
  );
};

export default CompareCard;
