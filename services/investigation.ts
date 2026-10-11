import type { Highlight, PartnerQuery, PartnerSearchResult, PocketPrediction, SimilarSearchQuery, SimilarSearchResult, VariantLensData } from '../types';
import { neighboursOf, parseStructure, residueKey, residueLabel, type StructureModel } from './structureModel';
import { fetchPdbFile } from './structureFiles';
import { fetchAlphaFoldStructure, parseAlphaFoldId } from './alphafoldService';
import { getPrediction, isEsmFoldId } from './esmfoldService';
import { getCofold, isCofoldId } from './cofoldService';
import { FIREWALL_MESSAGE, stoppedByFirewall } from './http';
import { loadStructureFacts } from './groundingService';
import { fetchSiftsMapping, loadVariantLens, type SiftsAccession } from './variantService';
import { loadPockets, pocketsSupported, shownPockets } from './pocketService';
import { INTERACTION_LABELS, analyzeInteractions, interactionSummary, partnerLabel, type LigandSite } from './interactionService';
import { findPartners } from './partnerService';
import { extractChain, pickSearchChain, proteinChains, searchSimilarStructures } from './foldseekService';
import {
  TOOL_SETS, addQuotes, applyCheck, missingTerms, normalizeCheck, normalizePlan, normalizeSources, normalizeWrite, quoteGate, relateSet, safeTitle, setCategory, setLabel,
  splitSentences, stepLabel, type InvestigationPlan, type LiteratureSource, type PlanStep, type ToolId, type WriteUp,
} from './investigationPlan';

// --- INVESTIGATE MODE: RUNNING THE STEPS ---
// The browser runs an investigation's steps with the services the workspace's tools use, then hands
// the AI their results to write up (services/investigationPlan has the plan and the write-up). Every
// residue a step reports is in the loaded file's own chain IDs and numbering, and every comparison
// between steps ("relate") is computed here from the coordinates: the AI only reads the results.

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StepResidue {
  chain: string;
  resi: number;
  icode: string;
  name: string; // "Asp25"
  note?: string; // Why it's in the set: "0.98", "G12D/G12V", "2.8 Å"
  group?: string; // The same protein position in every chain shares one ("P04637|175"), and counts once
}

export interface ResidueSet {
  name: string; // "harmful", "pocket1", "harmful_near_pocket1"
  label: string; // "likely harmful positions"
  residues: StepResidue[];
}

export interface StepResult {
  summary: string; // One line under the step
  evidence: string; // What the write-up reads: the facts behind the summary, compact
  sets: ResidueSet[];
  view?: 'pathogenicity' | 'pockets' | 'interactions'; // The workspace tool that shows this step in 3D
  partners?: PartnerSearchResult; // The lists themselves, for their "open" buttons
  similar?: SimilarSearchResult;
  sources?: LiteratureSource[]; // The papers a literature step found, for their links
}

export interface InvestigationStep {
  index: number; // 1-based, as the write-up cites it
  plan: PlanStep;
  label: string;
  status: StepStatus;
  result?: StepResult;
  note?: string; // Why it failed or was skipped
  startedAt?: number;
  finishedAt?: number;
}

export type InvestigationPhase = 'planning' | 'running' | 'writing' | 'done' | 'failed' | 'stopped';

export interface InvestigationState {
  question: string;
  phase: InvestigationPhase;
  startedAt: number;
  finishedAt?: number;
  structure?: string; // The structure investigated
  unavailable?: string; // The structure the plan named, which couldn't be opened (the one on screen was used)
  title?: string;
  planSource?: 'ai' | 'fallback'; // 'fallback': planned from the question's words (the AI was unavailable)
  steps: InvestigationStep[];
  writeUp?: WriteUp & { highlights: Highlight[]; fallback?: boolean }; // fallback: the step results, not an AI write-up
  notice?: string; // A passing note while waiting: "The AI is busy, retrying in 12 s"
  error?: string;
}

// --- THE TOOLS (injectable, so tests can run an investigation offline) ---

export interface InvestigationTools {
  structure: (id: string) => Promise<string>;
  facts: (id: string) => Promise<string | null>;
  variants: (id: string) => Promise<VariantLensData>;
  pockets: (id: string, pdb: string, signal: AbortSignal) => Promise<PocketPrediction>;
  ligands: (pdb: string) => LigandSite[];
  proteins: (id: string) => Promise<SiftsAccession[]>;
  partners: (query: PartnerQuery) => Promise<PartnerSearchResult>;
  similar: (query: SimilarSearchQuery) => Promise<SimilarSearchResult>;
  literature: (query: string) => Promise<LiteratureSource[]>;
}

/** The structure's file, wherever it lives: in memory (ESMFold, Co-fold), AlphaFold DB, or the PDB. */
export const loadStructureText = async (structureId: string): Promise<string> => {
  if (isEsmFoldId(structureId)) {
    const folded = getPrediction(structureId);
    if (!folded) throw new Error('this prediction is no longer in memory');
    return folded.pdb;
  }
  if (isCofoldId(structureId)) {
    const complex = getCofold(structureId);
    if (!complex) throw new Error('this co-folded complex is no longer in memory');
    return complex.pdb;
  }
  const accession = parseAlphaFoldId(structureId);
  if (accession) {
    const result = await fetchAlphaFoldStructure(accession);
    if (!result) throw new Error(`no AlphaFold model is available for ${accession}`);
    return result.pdb;
  }
  return fetchPdbFile(structureId);
};

export const browserTools: InvestigationTools = {
  structure: loadStructureText,
  facts: loadStructureFacts,
  variants: loadVariantLens,
  pockets: (id, pdb, signal) => loadPockets(id, pdb, signal),
  ligands: pdb => analyzeInteractions(pdb),
  proteins: fetchSiftsMapping,
  partners: query => findPartners(query),
  similar: query => searchSimilarStructures(query),
  literature: query => searchLiterature(query),
};

// Outside servers compute pockets (PrankWeb) and fold searches (Foldseek): they get a minute or two.
// A literature search allows for one wait when the server is rate-limited.
const STEP_TIMEOUT_MS: Record<ToolId, number> = {
  facts: 30_000, variants: 45_000, pockets: 100_000, ligands: 15_000, partners: 60_000, similar: 120_000, literature: 45_000, relate: 10_000,
};

const MAX_SET = 5000; // Residues in a set: a large complex's every copy, with room to spare

/** A step that doesn't apply to this structure: skipped with a reason, not failed. */
class SkipStep extends Error {}

const stopped = () => Object.assign(new Error('stopped'), { name: 'AbortError' });

/** The work, unless it takes longer than `ms` or the investigation is stopped first. */
const within = <T,>(work: Promise<T>, ms: number, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(stopped());
    const timer = setTimeout(() => reject(new Error(`no answer after ${Math.round(ms / 1000)} s`)), ms);
    const onAbort = () => reject(stopped());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    });
  });

// --- HELPERS ---

const unique = <T,>(items: T[]) => [...new Set(items)];

const residueIn = (model: StructureModel, chain: string, resi: number, icode = '', note?: string): StepResidue => {
  const r = model.byKey.get(residueKey({ chain, resi, icode }));
  return { chain, resi, icode, name: r ? residueLabel(r) : `${resi}${icode}`, ...(note ? { note } : {}) };
};

const named = (r: StepResidue) => `${r.chain}:${r.name}`;

/** Residues counted as positions: copies of one position in several chains count once. */
const countOf = (residues: StepResidue[]) => new Set(residues.map(r => r.group ?? residueKey(r))).size;

/** One residue per position (the first chain's), for lists people read. */
const onePerPosition = (residues: StepResidue[]) => {
  const seen = new Set<string>();
  return residues.filter(r => {
    const key = r.group ?? residueKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** "A:Gly12, A:Gly13, B:Lys16 +9 more" */
const listOf = (residues: StepResidue[], max: number, withNotes = false) => {
  const shown = residues.slice(0, max).map(r => (withNotes && r.note ? `${named(r)} (${r.note})` : named(r)));
  return residues.length > max ? `${shown.join(', ')} +${residues.length - max} more` : shown.join(', ');
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// --- THE STEPS ---

interface StepContext {
  structureId: string;
  pdb: string;
  model: StructureModel;
  tools: InvestigationTools;
  signal: AbortSignal;
  sets: Map<string, ResidueSet>; // Every set made so far, for "relate"
}

// "- active site: A:His57 (Charge relay system), A:Asp102" and "- binds Zn(2+): A:Cys96, A:His99"
const FACT_RESIDUE = /\b([A-Za-z0-9]{1,4}):([A-Z][a-z]{2})(-?\d+)\b/g;

const runFacts = async ({ structureId, model, tools }: StepContext): Promise<StepResult> => {
  const facts = await tools.facts(structureId);
  if (!facts) {
    return { summary: 'No curated annotations for this structure', evidence: 'No UniProt or PDBe annotations were available for this structure.', sets: [] };
  }
  const sites = new Map<string, StepResidue>();
  let active = 0;
  let binding = 0;
  for (const line of facts.split('\n')) {
    const isActive = /^\s*- active site:/.test(line);
    const isBinding = /^\s*- binds /.test(line);
    if (!isActive && !isBinding) continue;
    for (const m of line.matchAll(FACT_RESIDUE)) {
      const residue = residueIn(model, m[1], Number(m[3]));
      if (!model.byKey.has(residueKey(residue))) continue;
      if (isActive) active++;
      else binding++;
      sites.set(residueKey(residue), residue);
    }
  }
  const proteins = unique([...facts.matchAll(/^([^\n[]+?) \[[^\]\n]*UniProt [A-Z0-9]+\]/gm)].map(m => m[1].trim())).slice(0, 2);
  const ligands = /^Ligands in the file: (.+)$/m.exec(facts)?.[1];
  const ligandCodes = ligands && ligands !== 'none' ? unique([...ligands.matchAll(/(?:^|; )([A-Z0-9]{1,5})\b/g)].map(m => m[1])).slice(0, 4) : [];
  const counted = [active && plural(active, 'active-site residue'), binding && plural(binding, 'binding residue')].filter(Boolean).join(' and ');
  return {
    summary: `${proteins.join(', ') || 'This structure'}: ${counted ? `${counted} annotated` : 'no active or binding sites annotated'}${ligandCodes.length ? `; ligands ${ligandCodes.join(', ')}` : ''}`,
    evidence: facts.length > 1100 ? `${facts.slice(0, 1100)}…` : facts,
    sets: sites.size ? [{ name: 'sites', label: setLabel('sites'), residues: [...sites.values()] }] : [],
  };
};

const runVariants = async ({ structureId, model, tools }: StepContext): Promise<StepResult> => {
  const data = await tools.variants(structureId);
  const available = data.proteins.filter(p => p.available);
  if (available.length === 0) {
    throw new SkipStep(data.skipped.length > 0 || data.proteins.length === 0
      ? 'AlphaMissense covers human proteins only'
      : 'no AlphaMissense scores for this protein');
  }
  // One entry per UniProt position, holding its residue in every chain that has it (1TUP has p53 three times)
  const positions = new Map<string, { v: VariantLensData['residues'][string]; residues: StepResidue[] }>();
  for (const [key, v] of Object.entries(data.residues)) {
    const [chain, rest = ''] = key.split('|');
    const [number, icode = ''] = rest.split('^');
    const resi = Number(number);
    if (!Number.isInteger(resi)) continue;
    const group = `${v.accession}|${v.position}`;
    const entry = positions.get(group) ?? { v, residues: [] };
    entry.residues.push({ ...residueIn(model, chain, resi, icode), group });
    positions.set(group, entry);
  }
  const all = [...positions.values()];
  const harmful = all.filter(p => p.v.amClass === 'likely_pathogenic').sort((a, b) => b.v.mean - a.v.mean);
  const disease = all
    .map(p => {
      const linked = p.v.known.filter(k => k.diseaseLinked);
      return { ...p, names: unique(linked.map(k => `${k.wt}${p.v.position}${k.alt}`)), diseases: unique(linked.flatMap(k => (k.diseaseNames.length ? k.diseaseNames : k.tags))) };
    })
    .filter(p => p.names.length > 0)
    .sort((a, b) => b.names.length - a.names.length);
  const harmfulResidues = harmful.flatMap(p => p.residues.map(r => ({ ...r, note: p.v.mean.toFixed(2) })));
  const diseaseResidues = disease.flatMap(p => p.residues.map(r => ({ ...r, note: p.names.slice(0, 3).join('/') })));
  const mapped = available.reduce((n, p) => n + p.mappedResidues, 0);
  const proteins = available.map(p => p.gene ?? p.identifier).join(', ');
  const diseaseList = disease.slice(0, 8).map(d => `${named(d.residues[0])} (${d.names.slice(0, 3).join('/')}${d.diseases.length ? `; ${d.diseases.slice(0, 2).join(', ')}` : ''})`).join('; ');
  return {
    summary: `${harmful.length} of ${mapped} positions likely harmful when mutated; ${plural(disease.length, 'position')} with known disease variants`,
    evidence: [
      `${proteins}: ${harmful.length} of ${mapped} positions in this structure are likely pathogenic when mutated (mean AlphaMissense score at least 0.564).`,
      harmful.length ? `Highest scores: ${listOf(onePerPosition(harmfulResidues), 10, true)}.` : '',
      disease.length ? `Positions with disease-linked UniProt variants: ${diseaseList}.` : 'No disease-linked UniProt variants at the positions in this structure.',
    ].filter(Boolean).join(' '),
    sets: [
      // Whole sets, every chain's copy (comparisons count positions); only the marks shown in 3D are capped
      ...(harmfulResidues.length ? [{ name: 'harmful', label: setLabel('harmful'), residues: harmfulResidues.slice(0, MAX_SET) }] : []),
      ...(diseaseResidues.length ? [{ name: 'disease', label: setLabel('disease'), residues: diseaseResidues.slice(0, MAX_SET) }] : []),
    ],
    view: 'pathogenicity',
  };
};

const runPockets = async ({ structureId, pdb, model, tools, signal }: StepContext): Promise<StepResult> => {
  if (!pocketsSupported(structureId)) throw new SkipStep('pocket prediction works on PDB entries and AlphaFold models');
  const prediction = await tools.pockets(structureId, pdb, signal);
  const pockets = shownPockets(prediction).slice(0, 3);
  if (pockets.length === 0) return { summary: 'No pockets found', evidence: 'P2Rank found no ligand-binding pockets.', sets: [], view: 'pockets' };
  const sets = pockets.map((p, i) => ({
    name: `pocket${i + 1}`,
    label: setLabel(`pocket${i + 1}`),
    residues: p.residues.map(r => residueIn(model, r.chain, r.resi, r.icode)),
  }));
  const percent = (p: { probability: number }) => `${Math.round(p.probability * 100)}%`;
  const best = pockets[0];
  return {
    summary: `${plural(pockets.length, 'pocket')} found; pocket 1 is ${percent(best)} likely to bind a ligand${best.ligands.length ? ` and holds ${best.ligands.join(', ')}` : ''}`,
    evidence: pockets.map((p, i) =>
      `pocket${i + 1}: ${percent(p)} probability of binding a ligand${p.ligands.length ? `, already holds ${p.ligands.join('/')} in this file` : ''}; ${plural(p.residues.length, 'residue')}: ${listOf(sets[i].residues, 16)}`
    ).join('. ') + `. (P2Rank ${prediction.model === 'quick' ? 'quick' : 'conservation-aware'} model.)`,
    sets,
    view: 'pockets',
  };
};

const runLigands = async ({ pdb, model, tools }: StepContext): Promise<StepResult> => {
  const sites = tools.ligands(pdb).filter(s => s.interactions.length > 0);
  if (sites.length === 0) throw new SkipStep('there are no ligands touching the protein in this file');
  const organic = sites.filter(s => s.kind === 'organic');
  const shown = (organic.length ? organic : sites).slice(0, 3);
  const contacts = new Map<string, StepResidue>();
  for (const site of organic.length ? organic : sites) {
    for (const i of site.interactions) {
      const r = model.byKey.get(residueKey(i.partner));
      if (!r || r.het || contacts.has(residueKey(i.partner))) continue;
      contacts.set(residueKey(i.partner), residueIn(model, i.partner.chain, i.partner.resi, i.partner.icode));
    }
  }
  const describe = (site: LigandSite, max: number) =>
    interactionSummary(site).map(({ type, partners }) =>
      `${INTERACTION_LABELS[type][partners.length === 1 ? 'one' : 'many'].toLowerCase()} with ${partners.slice(0, max).map(p => partnerLabel(p, true)).join(', ')}${partners.length > max ? ` +${partners.length - max} more` : ''}`
    ).join('; ');
  const main = shown[0];
  const counts = interactionSummary(main).slice(0, 3).map(({ type, partners }) => `${INTERACTION_LABELS[type].many.toLowerCase()} with ${plural(partners.length, 'residue')}`).join(', ');
  return {
    summary: `${main.name === main.code ? main.code : `${main.name} (${main.code})`}: ${counts}${sites.length > 1 ? `; ${plural(sites.length - 1, 'more ligand')}` : ''}`,
    evidence: shown.map(site => `${site.name === site.code ? site.code : `${site.name} (${site.code})`} at ${site.chain}:${site.resi}: ${describe(site, 6)}`).join('. ') + '.',
    sets: contacts.size ? [{ name: 'ligand', label: setLabel('ligand'), residues: [...contacts.values()] }] : [],
    view: 'interactions',
  };
};

/** The UniProt proteins of the structure, the largest first (the AlphaFold model's own, for a model). */
const proteinsOf = async ({ structureId, tools }: StepContext): Promise<{ accession: string; label: string; chains: string[] }[]> => {
  const af = parseAlphaFoldId(structureId);
  if (af) return [{ accession: af, label: af, chains: ['A'] }];
  if (isEsmFoldId(structureId) || isCofoldId(structureId)) return [];
  const proteins = await tools.proteins(structureId);
  const size = (p: SiftsAccession) => p.segments.reduce((n, s) => n + s.resEnd - s.resStart + 1, 0);
  return [...proteins].sort((a, b) => size(b) - size(a)).map(p => ({ accession: p.accession, label: p.identifier, chains: unique(p.segments.map(s => s.chain)) }));
};

const runPartners = async (ctx: StepContext): Promise<StepResult> => {
  const proteins = await proteinsOf(ctx);
  if (proteins.length === 0) throw new SkipStep('no UniProt protein is mapped to this structure');
  const [protein] = proteins;
  const result = await ctx.tools.partners({
    accession: protein.accession,
    label: protein.label,
    structureKeys: [ctx.structureId],
    chainsHere: Object.fromEntries(proteins.map(p => [p.accession, p.chains])),
  });
  const solved = result.partners.filter(p => p.bestComplex);
  return {
    summary: result.partners.length
      ? `${plural(result.partners.length, 'partner')} in STRING; ${solved.length} solved together with ${result.name} in the PDB`
      : `STRING lists no partners of ${result.name} at medium confidence or higher`,
    evidence: result.partners.length
      ? `${result.name} interacts with: ${result.partners.slice(0, 8).map(p => `${p.name} (confidence ${p.score.toFixed(2)}${p.bestComplex ? `; solved together in ${p.bestComplex}` : ''})`).join(', ')}.`
      : `STRING lists no interaction partners of ${result.name} at medium confidence or higher.`,
    sets: [],
    partners: result,
  };
};

const runSimilar = async (ctx: StepContext): Promise<StepResult> => {
  const chain = pickSearchChain(proteinChains(ctx.pdb));
  if (!chain) throw new SkipStep('there is no protein chain to search with');
  const af = parseAlphaFoldId(ctx.structureId);
  const predicted = Boolean(af) || isEsmFoldId(ctx.structureId) || isCofoldId(ctx.structureId);
  const proteins = predicted ? [] : await proteinsOf(ctx).catch(() => []);
  const result = await ctx.tools.similar({
    label: af ? `${af} (AlphaFold model)` : isEsmFoldId(ctx.structureId) ? 'the ESMFold prediction' : `${ctx.structureId} chain ${chain}`,
    structureId: ctx.structureId,
    pdb: extractChain(ctx.pdb, chain),
    excludePdbIds: predicted ? [] : [ctx.structureId.toUpperCase()],
    excludeAccessions: af ? [af] : proteins.filter(p => p.chains.includes(chain)).map(p => p.accession),
  });
  // Other proteins first: the query's own protein in other species says little about the fold
  const others = result.proteins.filter(h => !h.sameProtein);
  const same = result.proteins.filter(h => h.sameProtein);
  const hits = [...others, ...result.experimental, ...same];
  const describe = (h: (typeof hits)[number]) =>
    `${h.name}${h.organism ? ` (${h.organism})` : ''}: probability ${h.probability.toFixed(2)}, ${Math.round(h.identity)}% identity`;
  return {
    summary: hits.length
      ? `${plural(result.proteins.length, 'protein family', 'protein families')} and ${plural(result.experimental.length, 'other structure')} share the fold; closest other protein: ${(others[0] ?? hits[0]).name}`
      : 'No clearly similar structures',
    evidence: hits.length
      ? [
          others.length ? `Other proteins with this fold (AlphaFold DB): ${others.slice(0, 10).map(describe).join('; ')}.` : '',
          result.experimental.length ? `Experimental structures of other proteins: ${result.experimental.slice(0, 4).map(h => `${h.label} ${describe(h)}`).join('; ')}.` : '',
          same.length ? `The same protein in other species: ${plural(same.length, 'family', 'families')}.` : '',
          result.sameProteinStructures ? `${plural(result.sameProteinStructures, 'more PDB structure')} of the same protein left out.` : '',
        ].filter(Boolean).join(' ')
      : 'Foldseek found no clearly similar structures.',
    sets: [],
    similar: result,
  };
};

const runLiterature = async ({ tools }: StepContext, step: PlanStep): Promise<StepResult> => {
  const query = step.query ?? '';
  if (!query) throw new SkipStep('the plan gave no search words');
  let sources: LiteratureSource[];
  try {
    sources = await tools.literature(query);
  } catch (e) {
    // Not set up on this server, or its search allowance is used up
    if ((e as { status?: number }).status === 503) throw new SkipStep('the literature search is unavailable here');
    throw e;
  }
  if (sources.length === 0) {
    return { summary: `No papers found for “${query}”`, evidence: `A search of scientific publications for "${query}" found no relevant papers.`, sets: [] };
  }
  return {
    summary: `${plural(sources.length, 'paper')} found for “${query}”`,
    evidence: [
      `A search of scientific publications for "${query}" found these papers (each with an excerpt from it):`,
      ...sources.map((s, i) => `(${String.fromCharCode(97 + i)}) "${s.title}" (${s.site}): ${s.excerpt}`),
    ].join('\n'),
    sets: [],
    sources,
  };
};

const runRelate = async ({ model, sets }: StepContext, step: PlanStep): Promise<StepResult> => {
  const a = sets.get(step.a ?? '');
  const b = sets.get(step.b ?? '');
  if (!a?.residues.length || !b?.residues.length) {
    throw new SkipStep(`nothing to compare without ${setLabel((!a?.residues.length ? step.a : step.b) ?? '')}`);
  }
  const radius = step.within ?? 5;
  const targets = new Set(b.residues.map(residueKey));
  const near: StepResidue[] = [];
  for (const r of a.residues) {
    const key = residueKey(r);
    if (targets.has(key)) {
      near.push({ ...r, note: `in ${b.label}` });
      continue;
    }
    // Through space only: the residues bonded before and after it are always within 1.5 Å
    const closest = neighboursOf(model, key, radius, true).find(n => targets.has(residueKey(n.residue)));
    if (closest) near.push({ ...r, note: `${closest.distance.toFixed(1)} Å` });
  }
  near.sort((x, y) => (parseFloat(x.note ?? '0') || 0) - (parseFloat(y.note ?? '0') || 0));
  const name = relateSet(a.name, b.name);
  // Counted as positions: a mutation in three copies of a chain is one position
  const total = countOf(a.residues);
  const head = `${countOf(near)} of ${total} ${a.label} lie within ${radius} Å of ${b.label}`;
  return {
    summary: near.length ? `${head}: ${listOf(onePerPosition(near), 5)}` : sentence(`none of the ${total} ${a.label} lie within ${radius} Å of ${b.label}`),
    evidence: near.length ? `${head}: ${listOf(onePerPosition(near), 24, true)}.` : `None of the ${total} ${a.label} lie within ${radius} Å of ${b.label}.`,
    sets: near.length ? [{ name, label: setLabel(name), residues: near }] : [],
  };
};

const runTool = (step: PlanStep, ctx: StepContext): Promise<StepResult> => {
  switch (step.tool) {
    case 'facts': return runFacts(ctx);
    case 'variants': return runVariants(ctx);
    case 'pockets': return runPockets(ctx);
    case 'ligands': return runLigands(ctx);
    case 'partners': return runPartners(ctx);
    case 'similar': return runSimilar(ctx);
    case 'literature': return runLiterature(ctx, step);
    case 'relate': return runRelate(ctx, step);
  }
};

/** The earlier steps whose sets a comparison reads. */
const sourcesOf = (step: PlanStep, steps: InvestigationStep[]) =>
  steps.filter(s => s.index < steps.find(x => x.plan === step)!.index && [step.a, step.b].some(set =>
    s.plan.tool === 'relate' ? relateSet(s.plan.a ?? '', s.plan.b ?? '') === set : TOOL_SETS[s.plan.tool].includes(set ?? '')
  ));

const readable = (e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^Error:\s*/, '').slice(0, 160) || 'something went wrong';
};

/**
 * Run an investigation's steps on a structure. Data steps run side by side; a comparison waits for
 * the steps making its sets. Every change to a step is reported through onStep (a fresh copy), and the
 * finished steps are returned. Stopping marks the steps not done as skipped.
 */
export const runInvestigationSteps = async (
  structureId: string,
  pdb: string,
  plan: InvestigationPlan,
  onStep: (step: InvestigationStep) => void,
  signal: AbortSignal,
  tools: InvestigationTools = browserTools,
): Promise<InvestigationStep[]> => {
  const ctx: StepContext = { structureId, pdb, model: parseStructure(pdb), tools, signal, sets: new Map() };
  const steps: InvestigationStep[] = plan.steps.map((p, i) => ({ index: i + 1, plan: p, label: stepLabel(p), status: 'pending' }));
  const update = (step: InvestigationStep, patch: Partial<InvestigationStep>) => {
    Object.assign(step, patch);
    onStep({ ...step });
  };
  const running = new Map<number, Promise<void>>();
  const run = async (step: InvestigationStep) => {
    if (step.plan.tool === 'relate') await Promise.all(sourcesOf(step.plan, steps).map(s => running.get(s.index)));
    if (signal.aborted) return update(step, { status: 'skipped', note: 'stopped', finishedAt: Date.now() });
    update(step, { status: 'running', startedAt: Date.now() });
    try {
      const result = await within(runTool(step.plan, ctx), STEP_TIMEOUT_MS[step.plan.tool], signal);
      for (const set of result.sets) ctx.sets.set(set.name, set);
      update(step, { status: 'done', result, finishedAt: Date.now() });
    } catch (e) {
      if (signal.aborted) update(step, { status: 'skipped', note: 'stopped', finishedAt: Date.now() });
      else if (e instanceof SkipStep) update(step, { status: 'skipped', note: e.message, finishedAt: Date.now() });
      else update(step, { status: 'failed', note: readable(e), finishedAt: Date.now() });
    }
  };
  for (const step of steps) running.set(step.index, run(step));
  await Promise.all(running.values());
  return steps;
};

// --- WHAT THE WRITE-UP READS, AND WHAT IT MARKS ---

const MAX_FINDINGS = 6000; // The server takes up to 7000 characters
const MAX_MARKED = 40; // Residues per marked set

/** The sets the write-up may mark: made by finished steps, with residues. */
export const markableSets = (steps: InvestigationStep[]) =>
  steps.flatMap(s => (s.status === 'done' ? s.result?.sets ?? [] : []))
    .filter(set => set.residues.length > 0)
    .map(set => ({ name: set.name, label: set.label, count: set.residues.length }));

/** Every step's result (or why it has none), numbered as the write-up cites them. */
export const findingsText = (steps: InvestigationStep[]): string => {
  const lines = steps.map(s => {
    const head = `[${s.index}] ${s.label}`;
    if (s.status === 'done' && s.result) return `${head}: ${s.result.evidence}`;
    return `${head}: ${s.status === 'failed' ? 'FAILED' : 'NOT RUN'}${s.note ? ` (${s.note})` : ''}`;
  });
  // Over budget: the longest results are cut first, so every step keeps its say
  let total = lines.reduce((n, l) => n + l.length + 1, 0);
  while (total > MAX_FINDINGS) {
    const longest = lines.reduce((best, l, i) => (l.length > lines[best].length ? i : best), 0);
    const cut = Math.max(200, lines[longest].length - (total - MAX_FINDINGS) - 1);
    total -= lines[longest].length - cut - 1;
    lines[longest] = `${lines[longest].slice(0, cut)}…`;
  }
  return lines.join('\n');
};

/** A set's residues as highlights (one per chain), labelled and coloured by what the set holds. */
const setHighlights = (set: ResidueSet, label = sentence(set.label)): Highlight[] => {
  const byChain = new Map<string, number[]>();
  for (const r of set.residues.slice(0, MAX_MARKED)) byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r.resi]);
  return [...byChain].map(([chain, resi]) => ({ chain, resi, label, category: setCategory(set.name) }));
};

/** What the write-up marks, as highlights for the viewer. */
export const highlightsFor = (marks: WriteUp['marks'], steps: InvestigationStep[]): Highlight[] => {
  const sets = new Map(steps.flatMap(s => s.result?.sets ?? []).map(set => [set.name, set]));
  return marks.flatMap(mark => {
    const set = sets.get(mark.set);
    return set && set.residues.length ? setHighlights(set, mark.label) : [];
  });
};

/** A step's sets as highlights: what selecting the step shows. */
export const stepHighlights = (step: InvestigationStep): Highlight[] => (step.result?.sets ?? []).flatMap(set => setHighlights(set));

/**
 * The write-up when the AI couldn't write one: each finished step's result, cited, and the most
 * specific set marked (a comparison with residues, else the best pocket, harmful positions, sites).
 */
export const fallbackWriteUp = (steps: InvestigationStep[], title: string): WriteUp => {
  const done = steps.filter(s => s.status === 'done' && s.result);
  const sets = markableSets(steps).map(s => s.name);
  const pick = [...sets].reverse().find(n => n.includes('_near_')) ?? ['pocket1', 'harmful', 'disease', 'ligand', 'sites'].find(n => sets.includes(n));
  return {
    title,
    answer: done.length ? done.map(s => `${s.result!.summary}. [${s.index}]`).join('\n') : 'None of the steps returned results.',
    marks: pick ? [{ set: pick, label: sentence(setLabel(pick)) }] : [],
  };
};

// --- THE TWO AI CALLS ---

const MAX_RATE_LIMIT_WAIT_S = 20;

/** Waits `ms`, or rejects at once when the investigation is stopped. */
const waitUnlessStopped = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const stop = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  if (signal?.aborted) return stop();
  signal?.addEventListener('abort', stop, { once: true });
});

// Stop on the investigation's card aborts the call itself, and the wait before its retry
const post = async (body: object, onRateLimitWait?: (seconds: number) => void, signal?: AbortSignal): Promise<unknown> => {
  const send = () => fetch('/api/investigate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  let response = await send();
  // The AI answered something unusable (malformed JSON, say), couldn't be reached or took too long: one more try
  if (response.status === 502 || response.status === 504) response = await send();
  // The AI is rate-limited: wait as long as it suggests, within reason, and try once more
  if (response.status === 429 && !stoppedByFirewall(response)) {
    const suggested = Number(response.headers.get('retry-after'));
    const wait = Math.min(MAX_RATE_LIMIT_WAIT_S, Number.isFinite(suggested) && suggested > 0 ? Math.ceil(suggested) : 10);
    onRateLimitWait?.(wait);
    await waitUnlessStopped(wait * 1000, signal);
    response = await send();
  }
  if (stoppedByFirewall(response)) throw Object.assign(new Error(FIREWALL_MESSAGE), { status: response.status, firewall: true });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'unknown' }));
    throw Object.assign(new Error(`Investigate API error ${response.status}: ${err?.error || 'unknown'}`), { status: response.status });
  }
  return response.json();
};

/** The AI's plan for a question about the structure on screen (null when it's unusable). */
export const requestPlan = async (question: string, current: { pdbId: string; title: string }, onRateLimitWait?: (seconds: number) => void, signal?: AbortSignal) =>
  normalizePlan(await post({ stage: 'plan', question, current }, onRateLimitWait, signal), current.pdbId, question);

/** Published papers for a literature step's search words (the server holds the search key). */
const searchLiterature = async (query: string): Promise<LiteratureSource[]> =>
  normalizeSources(((await post({ stage: 'search', question: query, query })) as { sources?: unknown })?.sources);

const MAX_CHECKED = 8; // Sentences the server checks at once

/** What a sentence's citations point at: each cited step's result, or one paper of it ([3a]). */
const citedText = (sentence: string, steps: InvestigationStep[]) =>
  [...sentence.matchAll(/\[(\d+)([a-d]?)\]/g)].map(([, n, paper]) => {
    const step = steps.find(s => s.index === Number(n));
    const source = paper ? step?.result?.sources?.[paper.charCodeAt(0) - 97] : undefined;
    return source ? `${source.title} ${source.excerpt}` : step?.result ? `${step.label} ${step.result.evidence}` : '';
  }).join(' ');

/**
 * The write-up with each sentence checked against the results it cites (the same results it was
 * written from, papers and their excerpts included): kept, cut down to what they state, or dropped.
 * Sentences past the first MAX_CHECKED are left as written.
 */
export const checkWriteUp = async (
  question: string,
  writeUp: WriteUp,
  steps: InvestigationStep[],
  onRateLimitWait?: (seconds: number) => void,
  signal?: AbortSignal,
): Promise<WriteUp> => {
  const parts = splitSentences(writeUp.answer);
  const sentences = parts.map((p, id) => ({ id, text: p.text.trim() })).filter(s => s.text.length > 0).slice(0, MAX_CHECKED)
    .map(s => ({ ...s, missing: missingTerms(s.text, question, citedText(s.text, steps)) }));
  if (sentences.length === 0) return writeUp;
  const raw = (await post({ stage: 'check', question, results: findingsText(steps), sentences }, onRateLimitWait, signal)) as { verdicts?: unknown };
  const { answer, fixed, dropped } = applyCheck(writeUp.answer, normalizeCheck(raw, sentences), steps.length);
  const checked = { sentences: sentences.length, fixed, dropped };
  // Nothing left standing: say so plainly rather than show an empty answer
  return { ...writeUp, answer: answer || 'The results of these steps don\'t answer this directly.', checked };
};

/** The literature steps' papers, by step number, as the write-up cites them. */
const papersOf = (steps: InvestigationStep[]) =>
  Object.fromEntries(steps.filter(s => s.result?.sources?.length).map(s => [s.index, s.result!.sources!]));

/** The AI's first draft of the write-up of the finished steps (null when it's unusable). */
export const requestDraft = async (
  question: string,
  structure: { id: string; title: string },
  steps: InvestigationStep[],
  onRateLimitWait?: (seconds: number) => void,
  signal?: AbortSignal,
) => {
  const sets = markableSets(steps);
  const raw = await post({ stage: 'write', question, structure, findings: findingsText(steps), sets, steps: steps.length }, onRateLimitWait, signal);
  return normalizeWrite(raw, sets.map(s => s.name), steps.length);
};

/**
 * A draft made ready to show, papers counting only through their own words: a sentence of the answer
 * about a paper goes unless it quotes one word for word (quoteGate); the rest is checked against the
 * results (a check that can't run leaves it unmarked); then the quotes the model picked are verified and
 * added (addQuotes).
 */
export const finishWriteUp = async (question: string, draft: WriteUp, steps: InvestigationStep[], onRateLimitWait?: (seconds: number) => void, signal?: AbortSignal): Promise<WriteUp> => {
  const papers = papersOf(steps);
  const gated = { ...draft, answer: quoteGate(draft.answer, papers, steps.length).answer };
  const checked = gated.answer ? await checkWriteUp(question, gated, steps, onRateLimitWait, signal).catch(() => gated) : gated;
  // A fix can't bring a paraphrase back
  const regated = quoteGate(checked.answer, papers, steps.length);
  const quoted = addQuotes(regated.answer, draft.quotes ?? [], papers);
  const counts = checked.checked && { ...checked.checked, dropped: checked.checked.dropped + regated.dropped };
  const marked = quoted.added ? { ...(counts ?? { sentences: 0, fixed: 0, dropped: 0 }), quotes: quoted.added } : counts;
  const answer = quoted.answer || 'The results of these steps don\'t answer this directly.';
  return { ...checked, title: safeTitle(checked.title, question, answer), answer, ...(marked ? { checked: marked } : {}) };
};

/** The AI's write-up of the finished steps, checked and its quotes verified (null when it's unusable). */
export const requestWriteUp = async (
  question: string,
  structure: { id: string; title: string },
  steps: InvestigationStep[],
  onRateLimitWait?: (seconds: number) => void,
  signal?: AbortSignal, // Stop on the card: the draft and its check are both called off
) => {
  const draft = await requestDraft(question, structure, steps, onRateLimitWait, signal);
  return draft ? finishWriteUp(question, draft, steps, onRateLimitWait, signal) : null;
};
