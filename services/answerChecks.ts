import type { ProteinAnalysis } from '../types';
import { inspectAnswer, inspectIdentity, type AnswerInspection, type IdentityInspection } from './groundingService';
import { parseAlphaFoldId } from './alphafoldService';
import { isEsmFoldId } from './esmfoldService';
import { isCofoldId } from './cofoldService';

// --- WHAT WAS CHECKED ---
// The line under an answer: what the app checked before showing it, what it fixed on the way and
// anything still off, with the details a click away. Built from the checks' own results
// (groundingService), never from the AI's words, so it can't claim a check that didn't run.

/** What happened between the AI's first answer and the one shown (ReasoningEngine fills it in). */
export interface CheckTrail {
  local?: { renumbered: number; moved: number; examples: string[] }; // Fixed in place, without asking the AI again
  retry?: {
    entry: string; // The entry the first answer used
    title: string; // ...the heading it gave
    missing: boolean; // ...that entry doesn't exist
    holds: string; // ...what that entry really is, when the answer named another protein ('' otherwise)
    problems: number; // ...and how many places (marked, or named in its text) don't match that entry
    outcome: 'kept' | 'first' | 'unverified' | 'failed'; // The second answer was kept, was no better, couldn't be checked, or never came
  };
  corrected?: boolean; // Still another protein after that: the heading became the entry's own title
}

export interface CheckRow {
  state: 'ok' | 'fixed' | 'issue' | 'skipped';
  text: string;
}

export interface AnswerChecks {
  structure: string; // The PDB entry or AlphaFold model it was checked against
  status: 'passed' | 'fixed' | 'issues' | 'unchecked';
  summary: string; // The line under the answer
  rows: CheckRow[]; // The details: the protein, the parts it marks, what was fixed or tried
  source: string; // Whose records it was checked with
}

const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** A long entry title cut at a word, so a details row stays a row. */
const shortened = (text: string, max = 90) => {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max - 1);
  return `${text.slice(0, cut > 40 ? cut : max - 1)}…`;
};

/** The checks an answer passed, in words (no network: collectChecks gathers what it needs). */
export function buildChecks(structure: string, inspection: AnswerInspection | null, identity: IdentityInspection, trail: CheckTrail): AnswerChecks {
  const model = Boolean(parseAlphaFoldId(structure));
  const source = model ? 'Source: UniProt' : 'Sources: RCSB, PDBe and UniProt';
  if (isEsmFoldId(structure) || isCofoldId(structure)) {
    return { structure, status: 'unchecked', summary: 'Not checked: predictions made here have no records to check against', rows: [], source: '' };
  }
  const protein = trail.corrected ? 'corrected' : identity.status;
  if (!inspection && (protein === 'unavailable' || protein === 'unjudged')) {
    return { structure, status: 'unchecked', summary: `Not checked: ${structure}'s records didn't load in time`, rows: [], source };
  }
  const exists = inspection?.exists !== false;
  const name = identity.name ? shortened(identity.name) : '';
  const rows: CheckRow[] = [];

  // The protein it names
  if (protein === 'match') rows.push({ state: 'ok', text: `Protein name matches ${structure}${name ? `: ${name}` : ''}` });
  else if (protein === 'corrected') rows.push({ state: 'issue', text: `The answer describes a different protein from the one in ${structure}${name ? ` (${name})` : ''}, so its heading is now ${structure}'s own title` });
  else if (protein === 'mismatch') rows.push({ state: 'issue', text: `Protein name doesn't match ${structure}${name ? `: ${name}` : ''}` });
  else if (protein === 'unjudged') rows.push({ state: 'skipped', text: 'Protein name not checked: the heading names no particular protein' });
  else if (exists) rows.push({ state: 'skipped', text: `Protein name not checked: ${structure}'s records didn't load in time` });

  // The parts it marks in 3D
  const where = model ? 'the model' : structure;
  if (!inspection) rows.push({ state: 'skipped', text: `Marked parts not checked: ${structure}'s residue list didn't load in time` });
  else {
    const { residues, ligands, missing, wrong, unchecked, named, misnamed, problems } = inspection;
    if (residues) rows.push({ state: 'ok', text: `${count(residues, 'marked residue')} ${residues === 1 ? 'is' : 'are'} in ${where}` });
    if (ligands) rows.push({ state: 'ok', text: `${count(ligands, 'marked ligand')} ${ligands === 1 ? 'is' : 'are'} in ${where}` });
    if (named) rows.push({ state: 'ok', text: `${count(named, 'amino acid')} named in the answer ${named === 1 ? 'is' : 'are'} that amino acid in ${where}` });
    if (unchecked) rows.push({ state: 'skipped', text: `${count(unchecked, 'marked part')} not checked: ${structure}'s ligand list didn't load` });
    problems.forEach(p => rows.push({ state: 'issue', text: capitalised(p) }));
    const unlisted = missing + wrong + misnamed - problems.length;
    if (unlisted > 0) rows.push({ state: 'issue', text: `...and ${unlisted} more like ${unlisted === 1 ? 'that' : 'these'}` });
  }

  // What was fixed on the way, or tried
  const replaced = trail.retry?.outcome === 'kept'; // The second answer replaced the first, fixes and all
  if (trail.local && !replaced) {
    const { renumbered, moved, examples } = trail.local;
    if (renumbered) rows.push({ state: 'fixed', text: `${count(renumbered, 'residue number')} in UniProt numbering changed to ${structure}'s own${examples.length ? ` (${examples.slice(0, 2).join('; ')})` : ''}` });
    if (moved) rows.push({ state: 'fixed', text: `${count(moved, 'ligand mark')} moved onto the ligand ${structure} holds` });
  }
  if (trail.retry) {
    const r = trail.retry;
    const why = [
      r.missing ? `used ${r.entry}, which isn't an existing PDB entry` : '',
      r.holds ? `called ${r.entry} "${r.title}", but ${r.entry} is ${shortened(r.holds)}` : '',
      r.problems ? `didn't match ${r.entry} in ${count(r.problems, 'place')}` : '',
    ].filter(Boolean).join(' and ') || `didn't fit ${r.entry}`;
    const instead = r.outcome === 'first' ? 'the second answer was no better' : r.outcome === 'unverified' ? "the second answer couldn't be checked" : 'that request failed';
    rows.push(r.outcome === 'kept'
      // A fix only counts as one when the answer that replaced the first could itself be checked
      ? { state: inspection ? 'fixed' : 'skipped', text: `The first answer ${why}, so it went back to the AI once${structure === r.entry ? ` with ${r.entry}'s records` : `, which chose ${structure} instead`}` }
      : { state: 'skipped', text: `The first answer ${why}. It went back to the AI once, but ${instead}, so this is the first answer` });
  }

  const status = rows.some(r => r.state === 'issue') ? 'issues' : rows.some(r => r.state === 'fixed') ? 'fixed' : 'passed';
  const head = `${status === 'fixed' ? 'Fixed, then checked' : 'Checked'} against ${structure}`;
  const off = inspection ? inspection.missing + inspection.wrong : 0;
  const misnamed = inspection?.misnamed ?? 0;
  let summary: string;
  if (!exists) summary = `${head}: ${inspection?.problems[0]?.includes('not a valid PDB ID') ? "it isn't a valid PDB ID" : "it isn't an existing PDB entry"}`;
  else if (protein === 'corrected' || protein === 'mismatch') summary = `${head}: the answer describes another protein`;
  else if (inspection && (off > 0 || misnamed > 0)) {
    const parts = off + inspection.residues + inspection.ligands + inspection.unchecked;
    const clauses = [
      off > 0 ? `${off} of ${count(parts, 'marked part')}` : '',
      misnamed > 0 ? `${misnamed} of ${count(misnamed + inspection.named, 'amino acid')} it names` : '',
    ].filter(Boolean);
    summary = `${head}: ${clauses.join(' and ')} ${off + misnamed === 1 ? "doesn't" : "don't"} match the ${model ? 'model' : 'entry'}`;
  } else {
    const parts = [
      protein === 'match' ? 'protein name' : '',
      inspection?.residues ? count(inspection.residues, 'residue') : '',
      inspection?.ligands ? count(inspection.ligands, 'ligand') : '',
      inspection?.named ? count(inspection.named, 'amino acid') : '',
    ].filter(Boolean);
    summary = parts.length ? `${head}: ${parts.join(', ')}` : `${head}: the ${model ? 'model' : 'entry'} exists`;
  }
  return { structure, status, summary, rows, source };
}

const UNKNOWN: IdentityInspection = { status: 'unavailable', problem: null, name: '', proteins: [] };

/**
 * The checks the shown answer passed, run once more on it as it stands. Its records are cached by
 * now, so this is quick, and it gives up after maxWaitMs rather than hold the answer back. null
 * when the answer names no structure.
 */
export const collectChecks = async (analysis: ProteinAnalysis, trail: CheckTrail, maxWaitMs = 1500): Promise<AnswerChecks | null> => {
  if (!analysis.pdbId) return null;
  const [inspection, identity] = await Promise.all([
    inspectAnswer(analysis, maxWaitMs).catch(() => null),
    inspectIdentity(analysis, maxWaitMs).catch(() => UNKNOWN),
  ]);
  return buildChecks(analysis.pdbId, inspection, identity, trail);
};
