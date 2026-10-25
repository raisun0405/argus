import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  arrangementWord, betweenMean, boxMean, paeAt, paeLut, paeParts, paeRgb, PART_CUTOFF, MIN_PART,
  type PaeBox, type PaeData,
} from '../services/paeService';

export type PaeState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'missing' } // AlphaFold DB has no map for this model
  | { status: 'ready'; data: PaeData };

/** The two stretches lit up from the map: the scored residues (blue) and the aligned ones (orange). */
export const PAE_COLORS = { scored: '#60a5fa', aligned: '#fb923c' };

// Two confident blocks on a map's diagonal
export const PaeIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <rect x="6" y="6" width="6.5" height="6.5" rx="0.6" fill="currentColor" stroke="none" />
    <rect x="14" y="14" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
  </svg>
);

const SCALE_TICKS = [0, 10, 20, 30];
const NICE_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const MAX_PARTS = 6;

const span = ([a, b]: [number, number], first: number) => (a === b ? `${a + first}` : `${a + first}–${b + first}`);
const sameRange = (x: [number, number], y: [number, number]) => x[0] === y[0] && x[1] === y[1];

/**
 * The map painted at `size` device pixels: each pixel the mean of the cells under it, in AlphaFold
 * DB's colours (a 2,700-residue map has seven million cells; a phone's map is a few hundred pixels).
 */
function paint(d: PaeData, size: number): ImageData {
  const lut = paeLut(d.max);
  const image = new ImageData(size, size);
  const edges = Array.from({ length: size + 1 }, (_, k) => Math.min(d.n, Math.round((k * d.n) / size)));
  for (let py = 0; py < size; py++) {
    const a0 = edges[py];
    const a1 = Math.max(a0 + 1, edges[py + 1]);
    for (let px = 0; px < size; px++) {
      const s0 = edges[px];
      const s1 = Math.max(s0 + 1, edges[px + 1]);
      let sum = 0;
      for (let a = a0; a < a1; a++) {
        const row = a * d.n;
        for (let s = s0; s < s1; s++) sum += d.values[row + s];
      }
      const v = Math.round(sum / ((a1 - a0) * (s1 - s0)));
      const at = (py * size + px) * 4;
      image.data[at] = lut[v * 3];
      image.data[at + 1] = lut[v * 3 + 1];
      image.data[at + 2] = lut[v * 3 + 2];
      image.data[at + 3] = 255;
    }
  }
  return image;
}

interface ConfidenceMapPanelProps {
  state: PaeState;
  first: number; // Residue number of the map's first row and column
  box: PaeBox | null;
  onBox: (box: PaeBox | null) => void;
  onZoom: () => void; // Bring the lit-up residues into view
  onRetry: () => void;
}

/**
 * AlphaFold's confidence map (predicted aligned error), docked in the inspector: the map in AlphaFold
 * DB's colours, drag across it to light up two stretches in 3D, the confidently placed parts it shows,
 * and how sure AlphaFold is about the way they are arranged.
 */
const ConfidenceMapPanel: React.FC<ConfidenceMapPanelProps> = ({ state, first, box, onBox, onZoom, onRetry }) => {
  const data = state.status === 'ready' ? state.data : null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0); // CSS pixels
  const [drag, setDrag] = useState<PaeBox | null>(null);
  const [hover, setHover] = useState<{ s: number; a: number } | null>(null);
  const dragStart = useRef<{ s: number; a: number } | null>(null);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(3, window.devicePixelRatio || 1);
  const size = Math.max(1, Math.round(width * dpr));

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [Boolean(data)]);

  const image = useMemo(() => (data && width > 0 ? paint(data, size) : null), [data, size, width]);
  const parts = useMemo(() => (data ? paeParts(data) : []), [data]);

  // The map, with the lit-up (or being-dragged) block outlined
  const shown = drag ?? box;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !image || !data) return;
    canvas.width = size;
    canvas.height = size;
    ctx.putImageData(image, 0, 0);
    if (!shown) return;
    const x0 = (shown.scored[0] / data.n) * size;
    const x1 = ((shown.scored[1] + 1) / data.n) * size;
    const y0 = (shown.aligned[0] / data.n) * size;
    const y1 = ((shown.aligned[1] + 1) / data.n) * size;
    const w = Math.max(2 * dpr, x1 - x0);
    const h = Math.max(2 * dpr, y1 - y0);
    // A halo in the page's own background with a line in its text colour: both stand off the map's
    // greens in every theme (a fixed dark halo and white line vanished on the light ones)
    const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(', ');
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = `rgba(${token('--c-canvas') || '9, 9, 11'}, 0.85)`;
    ctx.strokeRect(x0, y0, w, h);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = `rgb(${token('--c-ink-strong') || '250, 250, 250'})`;
    ctx.strokeRect(x0, y0, w, h);
  }, [image, shown, size, dpr, data]);

  // Ticks along both axes at a round step, about four of them
  const ticks = useMemo(() => {
    if (!data) return [];
    const step = NICE_STEPS.find(s => data.n / s <= 4) ?? 1000;
    const list: number[] = [];
    for (let r = step; r - first < data.n; r += step) if (r - first >= 0) list.push(r);
    return list;
  }, [data, first]);

  if (state.status === 'loading') {
    return (
      <div data-pae-panel data-pae-status="loading" className="flex items-center gap-2.5 py-1">
        <div className="w-4 h-4 border-2 border-brand/25 border-t-brand rounded-full animate-spin flex-shrink-0" />
        <span className="text-xs text-ink-muted">Fetching AlphaFold's confidence map…</span>
      </div>
    );
  }
  if (state.status === 'missing') {
    return <p data-pae-panel data-pae-status="missing" className="text-xs leading-snug text-ink-muted">AlphaFold DB has no confidence map for this model.</p>;
  }
  if (state.status === 'error') {
    return (
      <div data-pae-panel data-pae-status="error" className="space-y-2.5">
        <p className="text-xs leading-snug text-bad">Couldn't fetch the confidence map: {state.error}.</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-2.5 py-1 rounded-md border border-line bg-input text-[11px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const d = state.data;
  const cellAt = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = Math.min(d.n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * d.n)));
    const a = Math.min(d.n - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * d.n)));
    return { s, a };
  };
  const boxFrom = (p: { s: number; a: number }, q: { s: number; a: number }): PaeBox => ({
    scored: [Math.min(p.s, q.s), Math.max(p.s, q.s)],
    aligned: [Math.min(p.a, q.a), Math.max(p.a, q.a)],
  });

  // What the lit-up block says
  const lit = box;
  const diagonal = lit ? sameRange(lit.scored, lit.aligned) : false;
  const litMean = lit ? (diagonal ? boxMean(d, lit.scored, lit.aligned) : betweenMean(d, lit.scored, lit.aligned)) : 0;
  const litSingle = lit && lit.scored[0] === lit.scored[1] && lit.aligned[0] === lit.aligned[1];
  const readout = hover && !drag
    ? `Residue ${hover.s + first} lined up on ${hover.a + first}: ${paeAt(d, hover.a, hover.s)} Å`
    : null;
  const shownParts = parts.slice(0, MAX_PARTS);
  const swatch = (color: string) => <span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm flex-shrink-0 ring-1 ring-line-2" style={{ background: color }} />;
  const gradient = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map(t => `rgb(${paeRgb(t * d.max, d.max).join(',')}) ${t * 100}%`).join(', ')})`;

  return (
    <div data-pae-panel data-pae-status="ready" className="space-y-3 min-w-0">
      <p className="text-[11px] touch:text-[13px] leading-snug text-ink-muted">
        How sure AlphaFold is about where each part sits relative to the others. Dark green: confident; pale: a guess. Drag across the map to light up two stretches.
      </p>

      <div className="min-w-0">
        <div className="flex gap-1.5 min-w-0">
          {/* Down the side: the residue each row is lined up on */}
          <div className="relative w-7 flex-shrink-0" aria-hidden="true">
            {ticks.map(t => (
              <span key={t} className="absolute right-0 -translate-y-1/2 text-[10px] touch:text-[11px] tabular-nums text-ink-dim" style={{ top: `${((t - first + 0.5) / d.n) * 100}%` }}>{t}</span>
            ))}
          </div>
          <div ref={wrapRef} className="relative min-w-0 flex-1">
            <canvas
              ref={canvasRef}
              data-pae-map
              role="img"
              aria-label={`Confidence map of ${d.n} residues${parts.length ? `; confident parts ${parts.map(p => span([p.from, p.to], first)).join(', ')}` : ''}`}
              className="block w-full aspect-square rounded-sm cursor-crosshair select-none"
              style={{ touchAction: 'none', height: width || undefined }}
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const cell = cellAt(e);
                dragStart.current = cell;
                setDrag(boxFrom(cell, cell));
                setHover(null);
              }}
              onPointerMove={e => {
                if (dragStart.current) setDrag(boxFrom(dragStart.current, cellAt(e)));
                else if (e.pointerType === 'mouse') setHover(cellAt(e));
              }}
              onPointerUp={e => {
                if (!dragStart.current) return;
                const picked = boxFrom(dragStart.current, cellAt(e));
                dragStart.current = null;
                setDrag(null);
                onBox(picked);
              }}
              onPointerCancel={() => {
                dragStart.current = null;
                setDrag(null);
              }}
              onPointerLeave={() => setHover(null)}
            />
          </div>
        </div>
        {/* Along the bottom: the residue whose position is scored */}
        <div className="relative h-3.5 touch:h-4 ml-[34px]" aria-hidden="true">
          {ticks.map(t => (
            <span key={t} className="absolute top-0.5 -translate-x-1/2 text-[10px] touch:text-[11px] tabular-nums text-ink-dim" style={{ left: `${((t - first + 0.5) / d.n) * 100}%` }}>{t}</span>
          ))}
        </div>
        <p className="mt-1 ml-[34px] text-[10px] touch:text-[12px] text-ink-dim">Across: residue scored · Down: residue lined up on</p>
      </div>

      <div className="ml-[34px]">
        <div className="h-2 rounded-sm" style={{ background: gradient }} />
        <div className="relative h-3.5 touch:h-4" aria-hidden="true">
          {SCALE_TICKS.filter(t => t <= d.max).map(t => (
            <span key={t} className="absolute top-0.5 -translate-x-1/2 first:translate-x-0 text-[10px] touch:text-[11px] tabular-nums text-ink-dim" style={{ left: `${(t / d.max) * 100}%` }}>{t}</span>
          ))}
        </div>
        <p className="text-[10px] touch:text-[12px] text-ink-dim">Expected position error (Å)</p>
      </div>

      <div data-pae-readout className="min-h-[18px]">
        {/* Heard: what a drag lit up. Not heard: the value under the pointer, which changes on every move */}
        <div aria-live="polite">
          {lit && (
            <div className="space-y-1.5">
              <div className="space-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  {swatch(PAE_COLORS.scored)}
                  <span className="text-xs touch:text-[14px] font-semibold text-ink-strong tabular-nums">{litSingle ? 'Residue' : 'Residues'} {span(lit.scored, first)}</span>
                  <span className="text-[10px] touch:text-[12px] text-ink-dim">scored</span>
                </div>
                {!diagonal && (
                  <div className="flex items-center gap-2 min-w-0">
                    {swatch(PAE_COLORS.aligned)}
                    <span className="text-xs touch:text-[14px] font-semibold text-ink-strong tabular-nums">{litSingle ? 'Residue' : 'Residues'} {span(lit.aligned, first)}</span>
                    <span className="text-[10px] touch:text-[12px] text-ink-dim">lined up on</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] touch:text-[13px] leading-snug text-ink">
                {litSingle
                  ? `${paeAt(d, lit.aligned[0], lit.scored[0])} Å expected error.`
                  : diagonal
                    ? `${litMean.toFixed(1)} Å expected error within, on average.`
                    : `${litMean.toFixed(1)} Å expected error between them, on average: ${arrangementWord(litMean)}.`}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-pae-zoom
                  onClick={onZoom}
                  className="px-2.5 py-1 touch:py-2 rounded-md border border-line bg-input text-[11px] touch:text-[13px] font-medium text-ink hover:border-brand/40 hover:text-brand-text transition-colors"
                >
                  Zoom to {diagonal ? 'it' : 'them'}
                </button>
                <button
                  type="button"
                  data-pae-clear
                  onClick={() => onBox(null)}
                  className="px-2.5 py-1 touch:py-2 rounded-md text-[11px] touch:text-[13px] font-medium text-ink-muted hover:text-ink-strong transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
        {!lit && <p aria-hidden={readout ? true : undefined} className="text-[11px] touch:text-[13px] text-ink-muted tabular-nums">{readout ?? 'Nothing lit up yet.'}</p>}
      </div>

      <div>
        <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-1">Confident parts</p>
        {parts.length === 0 ? (
          <p className="text-[11px] touch:text-[13px] leading-snug text-ink-muted">No stretch of {MIN_PART} or more residues is placed confidently as one piece.</p>
        ) : (
          <div className="space-y-0.5">
            {shownParts.map((p, i) => {
              const next = shownParts[i + 1];
              const between = next ? betweenMean(d, [p.from, p.to], [next.from, next.to]) : null;
              const partBox: PaeBox = { scored: [p.from, p.to], aligned: [p.from, p.to] };
              return (
                <React.Fragment key={p.from}>
                  <button
                    type="button"
                    data-pae-part={span([p.from, p.to], first)}
                    onClick={() => onBox(partBox)}
                    aria-pressed={Boolean(box && sameRange(box.scored, partBox.scored) && sameRange(box.aligned, partBox.aligned))}
                    title={`Light up ${span([p.from, p.to], first)} in the structure`}
                    className="w-full min-w-0 flex items-center gap-2 px-2 py-1.5 touch:py-2.5 rounded-md border border-transparent text-left hover:border-line hover:bg-chip/60 aria-pressed:border-line-2 aria-pressed:bg-chip/60 transition-colors"
                  >
                    <span className="min-w-0 truncate text-xs touch:text-[14px] font-semibold text-ink-strong tabular-nums">{span([p.from, p.to], first)}</span>
                    <span className="text-[10px] touch:text-[12px] text-ink-dim tabular-nums">{p.to - p.from + 1} residues</span>
                    <span className="ml-auto flex-shrink-0 text-[11px] touch:text-[13px] tabular-nums text-ink">{p.within.toFixed(1)} Å within</span>
                  </button>
                  {between !== null && next && (
                    <button
                      type="button"
                      data-pae-between={`${span([p.from, p.to], first)}|${span([next.from, next.to], first)}`}
                      onClick={() => onBox({ scored: [p.from, p.to], aligned: [next.from, next.to] })}
                      title={`Light up ${span([p.from, p.to], first)} and ${span([next.from, next.to], first)}: how sure AlphaFold is about the way they are arranged`}
                      className="w-full min-w-0 flex items-center gap-2 pl-4 pr-2 py-1 touch:py-2 rounded-md border border-transparent text-left hover:border-line hover:bg-chip/60 transition-colors"
                    >
                      <span className="min-w-0 truncate text-[11px] touch:text-[13px] text-ink-muted">Between them</span>
                      <span className={`ml-auto flex-shrink-0 text-[11px] touch:text-[13px] tabular-nums ${between <= PART_CUTOFF ? 'text-ink' : 'text-ink-muted'}`}>{between.toFixed(1)} Å</span>
                    </button>
                  )}
                </React.Fragment>
              );
            })}
            {parts.length > MAX_PARTS && (
              <p className="px-2 text-[10px] text-ink-dim">and {parts.length - MAX_PARTS} more</p>
            )}
          </div>
        )}
      </div>

      <p className="pt-2 border-t border-line text-[10px] touch:text-[12px] leading-snug text-ink-dim">
        From the model's predicted aligned error file in AlphaFold DB. Parts: stretches whose residues AlphaFold expects to be within {PART_CUTOFF} Å of each other's true positions on average.
      </p>
    </div>
  );
};

export default ConfidenceMapPanel;
