import { fetchOrNull, memoize } from './http';
import type { AlphaFoldModel } from './alphafoldService';

// --- CONFIDENCE MAP (AlphaFold's predicted aligned error) ---
// For every AlphaFold DB model, how sure AlphaFold is about where each residue sits relative to every
// other one: entry [a][s] is the error (Å) AlphaFold expects in residue s's position when its prediction
// is lined up with the true structure on residue a. Low across a block: those residues form a part
// whose shape can be trusted; low between two blocks: so can the way those parts are arranged. Each
// model's map is published beside it as JSON (whole numbers 0-31 in v6 files; gzipped on the wire,
// 3 KB for 140 residues, 560 KB for 1,200), CORS-open like the model itself.

export interface PaeData {
  entryId: string; // The AlphaFold model it belongs to ("AF-P04637-F1")
  n: number; // Residues
  max: number; // Top of the scale (the file's max_predicted_aligned_error)
  values: Uint8Array; // n × n, row = aligned residue, column = scored residue, in quarters of an Å
}

/** Residues lit up on the map (0-based indices, inclusive): the scored residues and the aligned ones. */
export interface PaeBox {
  scored: [number, number];
  aligned: [number, number];
}

/** A stretch AlphaFold places confidently as one piece (0-based indices, inclusive). */
export interface PaePart {
  from: number;
  to: number;
  within: number; // Mean expected error inside the part (Å)
}

// Values are kept in quarters of an Å, which holds them exactly (v6 files have whole numbers, older ones
// the centres of AlphaFold's half-Å bins) up to 63.75 Å; files round their top bin to 32, above their max
const QUARTERS = 4;
const DEFAULT_MAX = 31.75;

export const paeAt = (d: PaeData, aligned: number, scored: number) => d.values[aligned * d.n + scored] / QUARTERS;

/**
 * The map in a model's JSON file, read straight into bytes: a 2,700-residue file is 20 MB of text, and
 * parsing it the usual way would build seven million number objects first.
 */
export function parsePae(text: string, entryId: string): PaeData {
  const key = text.indexOf('"predicted_aligned_error"');
  const start = key < 0 ? -1 : text.indexOf('[[', key);
  const end = start < 0 ? -1 : text.indexOf(']]', start);
  if (end < 0) throw new Error('the file has no confidence map');
  const firstRow = text.slice(start + 2, text.indexOf(']', start + 2));
  const n = firstRow.trim() ? firstRow.split(',').length : 0;
  if (n === 0) throw new Error('the confidence map is empty');
  const values = new Uint8Array(n * n);
  let count = 0;
  let number = 0;
  let scale = 0; // 0: whole part; otherwise the place value of the next decimal digit
  let reading = false;
  for (let p = start + 2; p <= end; p++) {
    const c = text.charCodeAt(p);
    if (c >= 48 && c <= 57) {
      if (scale) {
        number += (c - 48) * scale;
        scale /= 10;
      } else number = number * 10 + (c - 48);
      reading = true;
    } else if (c === 46) {
      scale = 0.1;
      reading = true;
    } else if (reading) {
      if (count >= values.length) throw new Error('the confidence map is not square');
      values[count++] = Math.min(255, Math.round(number * QUARTERS));
      number = 0;
      scale = 0;
      reading = false;
    }
  }
  if (count !== n * n) throw new Error('the confidence map is not square');
  const maxMatch = /"max_predicted_aligned_error"\s*:\s*([\d.]+)/.exec(text);
  return { entryId, n, max: maxMatch ? Number(maxMatch[1]) : DEFAULT_MAX, values };
}

/** Where a model's map is published: beside its coordinates, same version. */
export const paeUrlFor = (model: AlphaFoldModel) =>
  model.paeUrl ?? model.pdbUrl.replace(/-model_(v\d+)\.pdb$/, '-predicted_aligned_error_$1.json');

const paeCache = new Map<string, Promise<PaeData | null>>();

/** A model's confidence map; null when AlphaFold DB has none for it. */
export const fetchPae = (model: AlphaFoldModel): Promise<PaeData | null> =>
  memoize(paeCache, model.entryId, async () => {
    const response = await fetchOrNull(paeUrlFor(model));
    return response ? parsePae(await response.text(), model.entryId) : null;
  });

// --- COLOURS: AlphaFold DB's own, dark green (0 Å) to near-white (the top of the scale) ---

const GREENS = ['#00441b', '#006d2c', '#238b45', '#41ab5d', '#74c476', '#a1d99b', '#c7e9c0', '#e5f5e0', '#f7fcf5'];
const GREEN_RGB = GREENS.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));

/** The colour AlphaFold DB gives an expected error of `value` Å on a scale up to `max`. */
export function paeRgb(value: number, max = DEFAULT_MAX): [number, number, number] {
  const t = Math.min(1, Math.max(0, value / max)) * (GREENS.length - 1);
  const i = Math.min(GREENS.length - 2, Math.floor(t));
  const f = t - i;
  const [a, b] = [GREEN_RGB[i], GREEN_RGB[i + 1]];
  return [0, 1, 2].map(k => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
}

export const paeHex = (value: number, max = DEFAULT_MAX) => `#${paeRgb(value, max).map(c => c.toString(16).padStart(2, '0')).join('')}`;

/** Every stored value's colour (indexed in quarters of an Å), for painting the map quickly. */
export function paeLut(max = DEFAULT_MAX): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) lut.set(paeRgb(v / QUARTERS, max), v * 3);
  return lut;
}

// --- WHAT THE MAP SAYS ---

/** Mean expected error over a block of the map: rows (aligned) a0..a1, columns (scored) s0..s1. */
export function boxMean(d: PaeData, [s0, s1]: [number, number], [a0, a1]: [number, number]): number {
  let sum = 0;
  for (let a = a0; a <= a1; a++) {
    const row = a * d.n;
    for (let s = s0; s <= s1; s++) sum += d.values[row + s];
  }
  return sum / ((a1 - a0 + 1) * (s1 - s0 + 1)) / QUARTERS;
}

/** Mean expected error between two stretches, both ways round (each lined up on the other). */
export const betweenMean = (d: PaeData, x: [number, number], y: [number, number]) => (boxMean(d, x, y) + boxMean(d, y, x)) / 2;

export const PART_CUTOFF = 5; // Å: within a part, AlphaFold expects positions to be this good
export const MIN_PART = 30; // residues: shorter confident stretches aren't reported as parts
const MIN_PIECE = 5; // residues: shorter pieces are loose loops, never what a part is made of
const LOOP_GAP = 30; // residues: the longest loose loop a part is joined across

/**
 * The stretches AlphaFold places confidently as one piece, read off the map's diagonal. Pieces first:
 * a piece grows while the next residue's mean expected error against it (both ways round) stays within
 * the cutoff, so a loose loop ends it. Then parts: a piece joins the part before it when it is at most
 * a loop away and confidently placed relative to that part's pieces (a short piece that doesn't join is
 * passed over, as a loop). Only parts of MIN_PART residues or more are kept; the rest of the chain is
 * placed without that confidence.
 */
export function paeParts(d: PaeData, cutoff = PART_CUTOFF, minLength = MIN_PART): PaePart[] {
  const pieces: [number, number][] = [];
  let from = 0;
  while (from < d.n) {
    let to = from;
    while (to + 1 < d.n) {
      const next = to + 1;
      let sum = 0;
      for (let k = from; k <= to; k++) sum += d.values[next * d.n + k] + d.values[k * d.n + next];
      if (sum / (2 * (to - from + 1)) / QUARTERS > cutoff) break;
      to = next;
    }
    pieces.push([from, to]);
    from = to + 1;
  }
  const length = ([a, b]: [number, number]) => b - a + 1;
  // Mean expected error between a piece and a part's pieces, weighted by their lengths
  const toPart = (part: [number, number][], piece: [number, number]) =>
    part.reduce((sum, p) => sum + betweenMean(d, p, piece) * length(p), 0) / part.reduce((sum, p) => sum + length(p), 0);
  type Part = { span: [number, number]; pieces: [number, number][] };
  const parts: Part[] = [];
  let current: Part | null = null;
  let passed: [number, number][] = []; // Short pieces passed over since the part last grew
  for (const piece of pieces) {
    if (length(piece) < MIN_PIECE) continue;
    const gap = current ? piece[0] - current.span[1] - 1 : Infinity;
    if (current && gap <= LOOP_GAP && toPart(current.pieces, piece) <= cutoff) {
      current.span[1] = piece[1];
      current.pieces.push(piece);
      passed = [];
      continue;
    }
    // A short piece near a part already its full size: a loop in it, or the start of the next part
    if (current && length(current.span) >= minLength && length(piece) < minLength && gap <= LOOP_GAP) {
      passed.push(piece);
      continue;
    }
    // A new part, with the short pieces just before it that belong with it
    const next: Part = { span: [piece[0], piece[1]], pieces: [piece] };
    for (let k = passed.length - 1; k >= 0; k--) {
      const p = passed[k];
      if (next.span[0] - p[1] - 1 > LOOP_GAP || toPart(next.pieces, p) > cutoff) break;
      next.span[0] = p[0];
      next.pieces.unshift(p);
    }
    passed = [];
    current = next;
    parts.push(current);
  }
  return parts
    .filter(p => length(p.span) >= minLength)
    .map(({ span: [a, b] }) => ({ from: a, to: b, within: boxMean(d, [a, b], [a, b]) }));
}

/** How a mean expected error between two parts reads in words. */
export const arrangementWord = (error: number) =>
  error <= PART_CUTOFF ? 'confidently placed relative to each other' : error <= 12 ? 'placed with some uncertainty relative to each other' : 'not reliably placed relative to each other';

// --- For the chat ---

const onScreen = new Map<string, { data: PaeData; first: number }>(); // Structure ID -> its map, and its first residue number

/** The confidence map of an AlphaFold model on screen, for the facts sent with a question about it. */
export const rememberPae = (structureId: string, data: PaeData | null, firstResidue = 1) => {
  if (data) onScreen.set(structureId.trim().toUpperCase(), { data, first: firstResidue });
  else onScreen.delete(structureId.trim().toUpperCase());
};

const range = (p: { from: number; to: number }, first: number) => `${p.from + first}–${p.to + first}`;

export function paeFactsLine(structureId: string): string | null {
  const known = onScreen.get(structureId.trim().toUpperCase());
  if (!known) return null;
  const { data, first } = known;
  const parts = paeParts(data).sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 4).sort((a, b) => a.from - b.from);
  const head = 'AlphaFold confidence map (expected position error between residues, from the model\'s PAE file):';
  if (parts.length === 0) return `${head} no stretch of ${MIN_PART}+ residues is placed confidently (≤ ${PART_CUTOFF} Å) as one piece; the model's 3D arrangement is not reliable anywhere.`;
  const within = parts.map(p => `${range(p, first)} (${p.within.toFixed(1)} Å within)`).join(', ');
  const pairs: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const e = betweenMean(data, [parts[i].from, parts[i].to], [parts[j].from, parts[j].to]);
      pairs.push(`${range(parts[i], first)} and ${range(parts[j], first)}: ${e.toFixed(1)} Å, ${arrangementWord(e)}`);
    }
  }
  const covered = parts.reduce((sum, p) => sum + p.to - p.from + 1, 0);
  return [
    `${head} confidently predicted part${parts.length > 1 ? 's' : ''} ${within}.`,
    pairs.length ? ` Between parts: ${pairs.join('; ')}.` : '',
    covered < data.n ? ` The other ${data.n - covered} of ${data.n} residues are not placed confidently relative to the rest.` : '',
  ].join('');
}
