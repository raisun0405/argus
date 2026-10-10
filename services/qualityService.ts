import { FIREWALL_REASON, memoize, stoppedByFirewall } from './http';

// --- STRUCTURE QUALITY ---
// How far to trust an experimental model, from its official wwPDB validation report (read by
// api/quality.ts): resolution, R-free, clashscore, Ramachandran and side-chain outliers, fit to the data,
// each with its percentile ranks against the archive (0-100, higher is better) and the size of the set
// it is ranked against. An AlphaFold model's counterpart is its confidence (pLDDT and the confidence map).

export type QualityMethod = 'xray' | 'em' | 'nmr' | 'other';
export type QualityMetricKey = 'clashscore' | 'rama' | 'rota' | 'rsrz' | 'rfree';

export interface QualityMetric {
  key: QualityMetricKey;
  value: number;
  absolute: number | null; // Percentile rank against the whole set (higher is better)
  absoluteOf: number | null; // ...of how many entries
  relative: number | null; // Percentile rank against the narrower set (similar resolution, or the same method)
  relativeOf: number | null;
}

export interface QualityReport {
  id: string;
  missing?: true; // No validation report for this entry
  method: QualityMethod;
  resolution: number | null;
  r: number | null; // Deposited R-work
  rFree: number | null; // Deposited R-free
  created: string | null; // When the report was made, e.g. "Mar 5, 2026"
  metrics: QualityMetric[];
}

export const METHOD_NAMES: Record<QualityMethod, string> = { xray: 'X-ray', em: 'Cryo-EM', nmr: 'NMR', other: 'Experimental' };

export const METRIC_LABELS: Record<QualityMetricKey, { name: string; unit: string; hint: string }> = {
  clashscore: { name: 'Clashscore', unit: '', hint: 'Serious overlaps between atoms, per 1,000 atoms (lower is better)' },
  rama: { name: 'Ramachandran outliers', unit: '%', hint: 'Residues whose backbone is in an unusual conformation' },
  rota: { name: 'Side-chain outliers', unit: '%', hint: 'Residues whose side chain is in an unusual conformation' },
  rsrz: { name: 'Poor fit to the density', unit: '%', hint: 'Residues that fit the electron density poorly (RSRZ outliers)' },
  rfree: { name: 'R-free, recalculated', unit: '', hint: 'How well the model predicts the diffraction data left out of refinement, recalculated by the validation' },
};

/** What each percentile is ranked against, as the wwPDB report puts it. */
export const percentileSets = (method: QualityMethod): { absolute: string; relative: string } =>
  method === 'xray' ? { absolute: 'all X-ray structures', relative: 'X-ray structures of similar resolution' }
  : method === 'em' ? { absolute: 'all structures', relative: 'all EM structures' }
  : method === 'nmr' ? { absolute: 'all structures', relative: 'all NMR structures' }
  : { absolute: 'all structures', relative: 'similar structures' };

export const formatValue = (m: QualityMetric) => `${m.key === 'rfree' ? m.value.toFixed(3) : String(m.value)}${METRIC_LABELS[m.key].unit}`;

/** "X-ray · 2.05 Å · R-free 0.246" */
export const qualityHeadline = (q: QualityReport) =>
  [METHOD_NAMES[q.method], q.resolution !== null ? `${q.resolution} Å` : '', q.rFree !== null ? `R-free ${q.rFree}` : ''].filter(Boolean).join(' · ');

const cache = new Map<string, Promise<QualityReport>>();

/** An experimental entry's validation summary (api/quality.ts reads the official report). */
export const fetchQuality = (pdbId: string): Promise<QualityReport> =>
  memoize(cache, pdbId.trim().toLowerCase(), async () => {
    const res = await fetch('/api/quality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pdbId.trim().toLowerCase() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (stoppedByFirewall(res)) throw new Error(FIREWALL_REASON);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(typeof body?.error === 'string' ? body.error.toLowerCase() : `the server answered ${res.status}`);
    return body as QualityReport;
  });

// --- For the chat ---

const known = new Map<string, QualityReport>();

/** The validation summary of an experimental entry on screen, for the facts sent with a question about it. */
export const rememberQuality = (structureId: string, report: QualityReport | null) => {
  if (report && !report.missing) known.set(structureId.trim().toUpperCase(), report);
  else known.delete(structureId.trim().toUpperCase());
};

export function qualityFactsLine(structureId: string): string | null {
  const q = known.get(structureId.trim().toUpperCase());
  if (!q) return null;
  const sets = percentileSets(q.method);
  const ranked = q.metrics.map(m => `${METRIC_LABELS[m.key].name} ${formatValue(m)}${m.absolute !== null ? ` → ${Math.round(m.absolute)}` : ''}`);
  return [
    `Structure quality (wwPDB validation report${q.created ? `, ${q.created}` : ''}): ${qualityHeadline(q)}${q.rFree !== null ? ' (deposited)' : ''}.`,
    ranked.length ? ` Percentile ranks among ${sets.absolute} (0-100, higher is better): ${ranked.join('; ')}.` : '',
  ].join('');
}
