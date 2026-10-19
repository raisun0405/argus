// --- ESMFOLD: FOLD A PASTED SEQUENCE ---
// Meta's ESM Metagenomic Atlas endpoint predicts a structure from a single
// sequence (no alignment) in a few seconds. Free, keyless, CORS-enabled, but an
// unmaintained legacy service with a hard 400-residue limit. Predictions are
// kept in memory and addressed by an "ESM-<hash>" ID so the viewer can load
// them like any other structure.

import { BoundedMap } from './http';

const ESMFOLD_URL = 'https://api.esmatlas.com/foldSequence/v1/pdb/';
export const ESMFOLD_MAX_LENGTH = 400;
const MIN_LENGTH = 20;
const STANDARD = 'ACDEFGHIKLMNPQRSTVWY';

export interface SequenceInput {
  sequence: string; // Upper-case, letters only
  name?: string; // From a FASTA header
  invalid: string[]; // Non-standard letters found (ESMFold needs the 20 standard amino acids)
  skippedRecords?: number; // Multi-FASTA: further sequences left out (ESMFold folds one chain)
}

export interface EsmPrediction {
  id: string; // "ESM-XXXXXXX"
  sequence: string;
  name?: string;
  pdb: string;
  length: number;
  meanPlddt: number; // 0-100
  fractionVeryLow: number; // Share of residues with pLDDT < 50
}

/** FASTA name: ">sp|P69905|HBA_HUMAN Hemoglobin subunit alpha" -> "HBA_HUMAN". */
const fastaName = (header: string) => {
  const text = header.replace(/^>\s*/, '').trim();
  const parts = text.split('|');
  const name = parts.length >= 3 ? parts[2].split(/\s/)[0] : text.split(/\s/)[0];
  return name.slice(0, 40) || undefined;
};

/**
 * Recognises a pasted protein sequence: raw letters (line breaks, spaces and
 * position numbers allowed), FASTA, or "fold <sequence>". Returns null for
 * ordinary questions, which always contain words that aren't sequences.
 */
export const parseSequenceInput = (text: string): SequenceInput | null => {
  let body = text.trim();
  let name: string | undefined;
  let explicit = false; // FASTA header or "fold ..." prefix: clearly meant as a sequence
  let skippedRecords = 0;

  if (body.startsWith('>')) {
    const newline = body.indexOf('\n');
    if (newline < 0) return null;
    name = fastaName(body.slice(0, newline));
    body = body.slice(newline + 1);
    // Multi-FASTA: fold the first record, and say how many were left out
    const next = body.search(/^\s*>/m);
    if (next >= 0) {
      skippedRecords = (body.slice(next).match(/^\s*>/gm) ?? []).length;
      body = body.slice(0, next);
    }
    explicit = true;
  } else {
    const stripped = body.replace(
      /^(?:please\s+)?(?:fold|predict(?:\s+the)?(?:\s+structure)?(?:\s+of)?)(?:\s+(?:this|the|my))?(?:\s+(?:protein\s+)?sequence)?\s*:?\s*/i,
      ''
    );
    explicit = stripped !== body;
    body = stripped;
  }

  // Pasted sequences come as one block or in long runs (FASTA lines, 10-letter
  // GenBank groups); sentences are short words. "PLEASE DESCRIBE THE SITE" is
  // nearly all amino-acid letters, so word length is what tells them apart.
  const words = body.split(/\s+/).filter(t => t && !/^\d+$/.test(t)).map(t => t.replace(/[\d*]/g, '').length);
  if (words.length > 1) {
    const median = [...words].sort((a, b) => a - b)[Math.floor(words.length / 2)];
    // Equal-length blocks of 5+ letters ("MVLSP ADKTN VKAAW") are a formatted sequence too
    const blocks = words.length >= 3 && words[0] >= 5 &&
      words.slice(0, -1).every(w => w === words[0]) && words[words.length - 1] <= words[0];
    if (median < 8 && !blocks) return null;
  }

  const compact = body.replace(/[\s\d*]/g, '').toUpperCase();
  if (compact.length < MIN_LENGTH || !/^[A-Z]+$/.test(compact)) return null;

  // Bare text in word-sized pieces may be a protein's name ("Streptavidin tetramer",
  // "acetylcholinesterase"). Unless a piece is too long to be a word, it only counts as
  // a sequence with none of the letters proteins never use and, if split up, 30+ letters.
  if (!explicit && Math.max(...words) < 30) {
    if (/[BJOUZ]/.test(compact) || (words.length > 1 && compact.length < 30)) return null;
  }
  const nonStandard = [...compact].filter(c => !STANDARD.includes(c));
  if (nonStandard.length > compact.length * 0.05) return null; // Mostly not amino-acid letters: a sentence
  return { sequence: compact, name, invalid: [...new Set(nonStandard)], ...(skippedRecords ? { skippedRecords } : {}) };
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
};

const ESM_ID = /^ESM-[0-9A-Z]{6,8}$/i;
export const isEsmFoldId = (id: string | null | undefined) => ESM_ID.test((id ?? '').trim());

const predictions = new BoundedMap<string, EsmPrediction>(30);
const pending = new BoundedMap<string, Promise<EsmPrediction>>(30);

/** A prediction made earlier in this session (they live in memory only). */
export const getPrediction = (id: string) => predictions.get(id.trim().toUpperCase());

/** Fold a validated sequence (<= 400 standard residues). Same sequence -> same prediction. */
export const foldSequence = (sequence: string, name?: string): Promise<EsmPrediction> => {
  const id = `ESM-${hash(sequence)}`;
  const done = predictions.get(id);
  if (done) return Promise.resolve(done);
  let job = pending.get(id);
  if (!job) {
    job = (async () => {
      let response: Response;
      try {
        response = await fetch(ESMFOLD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: sequence,
          signal: AbortSignal.timeout(90000),
        });
      } catch {
        throw new Error('the ESMFold server could not be reached');
      }
      if (response.status === 413) throw new Error(`ESMFold folds up to ${ESMFOLD_MAX_LENGTH} residues`);
      if (!response.ok) throw new Error(`the ESMFold server responded ${response.status}`);
      const pdb = await response.text();

      const scores = pdb
        .split('\n')
        .filter(l => l.startsWith('ATOM') && l.slice(12, 16).trim() === 'CA')
        .map(l => parseFloat(l.slice(60, 66)))
        .filter(Number.isFinite);
      // The scale is the file's, not each value's: 0-1 when every score is (plddtIsFraction)
      const fraction = scores.length > 0 && Math.max(...scores) <= 1;
      const plddt = scores.map(b => (fraction ? b * 100 : b));
      if (plddt.length === 0) throw new Error('ESMFold returned no structure');

      const prediction: EsmPrediction = {
        id,
        sequence,
        name,
        pdb,
        length: plddt.length,
        meanPlddt: plddt.reduce((a, b) => a + b, 0) / plddt.length,
        fractionVeryLow: plddt.filter(v => v < 50).length / plddt.length,
      };
      predictions.set(id, prediction);
      return prediction;
    })();
    pending.set(id, job);
    job.catch(() => {}).finally(() => pending.delete(id));
  }
  return job;
};
