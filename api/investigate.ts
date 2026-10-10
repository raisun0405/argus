// Argus — Serverless function: Investigate mode's two AI calls, and its literature search
//
// Lives at /api/investigate on Vercel. Stage "plan": the question and the structure on screen in, a
// plan out (which of the app's tools to run, see services/investigationPlan). The browser runs those
// tools itself. Stage "search": a literature step's search words in, published sources out (Tavily,
// scientific sites only). Stage "write": the numbered results of the steps in, the conclusion out,
// written from those results alone. Stage "check": the conclusion's sentences and the same results in,
// each sentence kept, cut down to what its sources state, or dropped. Plan, write and check are NVIDIA
// Nemotron on Nebius Token Factory; the keys (NEBIUS_API_KEY, TAVILY_API_KEY) stay here, as in
// /api/analyze.

import { ASKS_LITERATURE, LITERATURE_SITES, MAX_STEPS, canonicalStructureId, normalizeCheck, normalizePlan, normalizeSources, normalizeWrite } from '../services/investigationPlan';

export const config = { runtime: 'edge' };

// --- CONFIG ---
// NVIDIA Nemotron on Nebius Token Factory (OpenAI-compatible); NEMOTRON_MODEL picks another model
const LLM_ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
// Nemotron 3 Super: in side-by-side tests on Argus's own questions it made fewer mistakes than Ultra,
// answered sooner and costs a third as much
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
// Vercel Edge functions must start responding within 25 s: leave room for the UniProt lookup
const LLM_TIMEOUT_MS = 18000;
const LONG_TIMEOUT_MS = 23000; // The write-up and the check look nothing up after the model answers
const UNIPROT_TIMEOUT_MS = 3000;
const RCSB_GRAPHQL = 'https://data.rcsb.org/graphql';
const RCSB_SEARCH = 'https://search.rcsb.org/rcsbsearch/v2/query';
const AFDB_API = 'https://alphafold.ebi.ac.uk/api/prediction';
const LOOKUP_AGENT = 'Mozilla/5.0 (compatible; Argus/1.0)'; // AlphaFold DB turns away requests that don't name a browser-like agent
const RCSB_TIMEOUT_MS = 3000;
const STRUCTURE_CHECK_MS = 6000; // All of the plan's structure check, lookups and search included
// Tavily web search; "advanced" returns the longer excerpts the write-up needs as evidence
const SEARCH_ENDPOINT = 'https://api.tavily.com/search';
const SEARCH_TIMEOUT_MS = 12000;
const SEARCH_RESULTS = 8; // More than are kept: some are page text or reference lists, not evidence (same price)
const MAX_QUESTION = 1000;
const MAX_FINDINGS = 7000;
const MAX_SETS = 40;
const MAX_CHECKED = 8; // Sentences sent to the check at once

// Same origins as /api/analyze: other websites can't spend this app's AI quota from their pages
const ALLOWED_ORIGINS = new Set<string>([
  // Any other address the app is served from goes here (the page's own address always passes)
]);

// --- PROMPTS ---

// The literature tool is offered only when this server can search (TAVILY_API_KEY is set)
const LITERATURE_TOOL = `
- literature: a search of scientific publications (PubMed, journals, preprints) for what research reports: approved drugs and trials, resistance, what a mutation does in patients, mechanisms. Returns papers with excerpts. No sets: {"tool": "literature", "query": "<4 to 12 search words: the gene or protein name, and the variant, residue, drug or effect asked about>", "why": "..."}. Use it when the question asks what is known, reported, studied or approved, or needs evidence the structure itself can't give.`;

const planPrompt = (literature: boolean) => `You plan a short investigation for Argus, an app that shows protein structures in 3D. The app runs the steps you choose with its own tools and data, and another call then writes the answer from their results. Never answer the question yourself.

Return ONLY a JSON object:
{
  "protein": { "gene": "<official gene symbol of the protein the question is about>", "taxId": <NCBI taxonomy ID> },
  "structure": "<the structure to investigate: the current one, unless the question is about a different protein; then a real 4-character PDB entry that shows it (with the ligand or partner the question names, when there is one), or 'AF-<UniProt accession>-F1' only when no experimental structure exists>",
  "title": "<what is being investigated, at most 8 words>",
  "steps": [ { "tool": "<tool>", "why": "<what this step checks, at most 10 words>" } ]
}
Always include "protein" when the question is about a particular protein, even when it is the one on screen.

TOOLS (the app always runs "facts" first; list the other tools the question needs, most useful first):
- facts: UniProt and PDBe annotations: active-site and binding residues, domains, the ligands in the file. Makes set "sites".
- variants: AlphaMissense pathogenicity of every position, and known disease variants (human proteins only). Makes sets "harmful" (likely pathogenic positions) and "disease" (positions with disease-linked variants).
- pockets: predicted ligand-binding pockets (P2Rank; takes up to a minute). Makes sets "pocket1", "pocket2", "pocket3", best first.
- ligands: the contacts between the ligands in the file and the protein (hydrogen bonds, salt bridges, stacking, metals). Makes set "ligand".
- partners: the proteins it interacts with (STRING), and PDB entries holding both. No sets.
- similar: proteins with a similar fold (Foldseek; takes up to a minute). No sets.${literature ? LITERATURE_TOOL : ''}
- relate: which residues of one set lie near another, measured in the 3D structure: {"tool": "relate", "a": "<set>", "b": "<set>", "within": <Å: 4 for direct contact, 6 to 8 for nearby>, "why": "..."}. Only sets made by tools in this plan. Use it when the question links two things, such as mutations and a pocket, or a drug and disease variants.

RULES:
- At most ${MAX_STEPS} steps in all, at most 2 of them "relate". Only tools that help answer this question.
- If the question is not about a protein, plan only "facts".
- Output only the JSON object: no markdown, no text around it.`;

const WRITE_PROMPT = `You write the conclusion of an investigation in Argus, an app that shows protein structures in 3D. The app ran the numbered steps under RESULTS with its own tools; those results are the only evidence you may use.

Return ONLY a JSON object:
{
  "title": "<the answer in at most 8 words>",
  "answer": "<2 to 5 sentences that answer the question directly from the app's own results. After each claim, cite the steps it rests on, like [2] or [2][4]. Never restate a paper here: what papers say goes in the quotes list. Copy residue names, numbers and percentages exactly from the results. Say plainly when a step failed or found nothing.>",
  "quotes": [ { "paper": "<a paper's step number and letter, like 3a>", "quote": "<5 to 30 words copied exactly from that paper's title or excerpt>" } ],
  "marks": [ { "set": "<a name listed under SETS>", "label": "<what it is, at most 5 words>" } ],
  "caveat": "<optional: one sentence on what these results cannot show>"
}

RULES:
- Nothing from memory: no residue, number or claim that is not in the results. If the results cannot answer the question, say what they do show and what is missing.
- Answer what is asked: when the question asks which ones, name them as the results give them (up to five).
- "marks": the 1 to 3 sets that best show the answer in 3D, the most specific first (a "_near_" set when one has residues). Only names listed under SETS.
- Pockets and AlphaMissense scores are predictions, not experiments: say "predicted" or "likely".
- Published research (a step listing papers as (a), (b)...): never restate a paper in "answer"; put up to 3 quotes in "quotes" instead. Each is one stretch of 5 to 30 words copied character for character from one paper's title or excerpt (never across a "[...]" gap, never shortened inside), with that paper's step number and letter. Pick the stretches that best answer the question and that name what they are about (the drug, protein or variant), so each reads right on its own; the app adds each to the answer as: One paper reports "..." [3a]. The answer may say how many papers the search found, like [3]. If no excerpt addresses the question, leave "quotes" empty and say in "answer" that the search found nothing directly on it, citing the step.
- A ligand in the results is only the molecule its code and name say: never call it a drug the question names unless the results give that drug's name.
- Plain words a student can follow. No markdown.
- Output only the JSON object: no markdown, no text around it.`;

const CHECK_PROMPT = `You check each sentence of an answer against the RESULTS it was written from: the numbered steps an app ran, some with published papers and their excerpts. Judge only by the results, never by what you know.

A citation names what a sentence rests on: [2] is step 2's result, [3a] is paper (a) under step 3, and [3] alone is all of step 3. A sentence that cites nothing (listed under UNCITED) must still come from the results. Keep it only when it sums up other sentences of the answer and adds nothing they don't say, or says plainly what the results lack, such as a step that failed or found nothing. If it states a fact that one step or paper gives, fix it: the same sentence with that citation added. Otherwise drop it: background the results don't give fails even when it is true.

NOT IN WHAT THEY CITE lists names and numbers in a sentence that the steps and papers it cites never mention (found by matching words, so a synonym can hide one). Each is a sign of a fact borrowed from elsewhere: fix the sentence without it, or drop it, unless what it cites says the same thing in other words.

A sentence about a paper quotes the paper's own words in double quotation marks (code checks every quote against the paper afterwards). Never change the words inside a quote: to fix such a sentence, trim the words around the quote, cut the quote down at either end, or drop it. A sentence that says plainly what the results lack (a step that failed, found nothing or did not run, or a search that found nothing on the question) stays as it is.

For each sentence, return one verdict:
- "keep": what it cites states everything it says.
- "fix": that states only part of it. Rewrite it to say only what is stated, in the source's terms, as one sentence that keeps its citations.
- "drop": nothing it cites states it.

A sentence fails when it adds anything the results don't give: a residue, contact, distance or number that isn't in them, or a number tied to something else; a fact the source ties to another drug, antibody, protein or study; a ligand called a drug its code and name don't say; a certainty where the source says "may", "suggests", "predicted" or "hypothetical" (keep those words, and "in vitro", "in mice", "in one study"); a result where a paper only says something was studied, evaluated or investigated; a cause, mechanism or link that no single source states, including across a "[...]" gap in an excerpt; or a drug, trial or residue the source doesn't name.

Return ONLY a JSON object: {"verdicts": [{"id": <sentence id>, "verdict": "keep" | "fix" | "drop", "text": "<the rewritten sentence, only for fix>"}]}`;

// --- ALPHAFOLD ANSWERS (as in /api/analyze: the accession comes from the gene symbol, never from memory) ---

/** The protein's UniProt accession, and whether it is a reviewed (Swiss-Prot) entry: AlphaFold DB models all of those. */
async function resolveUniProtAccession(gene: string, taxId: number): Promise<{ accession: string; reviewed: boolean } | null> {
  const base = 'https://rest.uniprot.org/uniprotkb/search?fields=accession&format=json&size=1&query=';
  for (const reviewed of [true, false]) {
    const query = `gene_exact:${gene} AND organism_id:${taxId}${reviewed ? ' AND reviewed:true' : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UNIPROT_TIMEOUT_MS);
    try {
      const res = await fetch(base + encodeURIComponent(query), { signal: controller.signal });
      if (!res.ok) continue;
      const json: any = await res.json();
      const accession = json?.results?.[0]?.primaryAccession;
      if (typeof accession === 'string') return { accession, reviewed };
    } catch {
      // Network hiccup or timeout: try the next query, then keep the model's answer
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** The reviewed UniProt entries of a gene in every species ("MB": human, sperm whale, horse... myoglobin). */
async function geneAccessions(gene: string): Promise<string[] | null> {
  const url = `https://rest.uniprot.org/uniprotkb/search?fields=accession&format=json&size=200&query=${encodeURIComponent(`gene_exact:${gene} AND reviewed:true`)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UNIPROT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json: any = await res.json();
    return (json?.results ?? []).map((r: any) => r?.primaryAccession).filter((a: unknown): a is string => typeof a === 'string');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- ANOTHER PDB ENTRY: does it hold the protein? (models recall PDB IDs poorly, and one was a DNA crystal) ---

interface EntryProteins { accessions: string[]; genes: string[]; species: number[] }

/** The UniProt accessions, gene names and species of an entry's proteins; null when it doesn't exist, undefined when RCSB can't say. */
async function entryProteins(pdbId: string): Promise<EntryProteins | null | undefined> {
  const query = `{ entry(entry_id: "${pdbId.toUpperCase()}") { polymer_entities { rcsb_polymer_entity_container_identifiers { uniprot_ids } rcsb_entity_source_organism { ncbi_taxonomy_id rcsb_gene_name { value } } } } }`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RCSB_TIMEOUT_MS);
  try {
    const res = await fetch(RCSB_GRAPHQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: controller.signal });
    if (!res.ok) return undefined;
    const json: any = await res.json();
    const entry = json?.data?.entry;
    if (entry === null) return null;
    if (!entry) return undefined;
    const entities: any[] = Array.isArray(entry.polymer_entities) ? entry.polymer_entities : [];
    return {
      accessions: entities.flatMap(e => e?.rcsb_polymer_entity_container_identifiers?.uniprot_ids ?? []).filter((a: unknown) => typeof a === 'string'),
      genes: entities.flatMap(e => (e?.rcsb_entity_source_organism ?? []).flatMap((o: any) => (o?.rcsb_gene_name ?? []).map((g: any) => String(g?.value ?? '').toUpperCase()))),
      species: entities.flatMap(e => (e?.rcsb_entity_source_organism ?? []).map((o: any) => Number(o?.ncbi_taxonomy_id))).filter(Number.isInteger),
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The PDB entry a text search for the protein finds first among that species' entries (null: none, or RCSB can't say). */
const searchEntry = (words: string, taxId: number) => firstEntry({
  type: 'group', logical_operator: 'and', nodes: [
    { type: 'terminal', service: 'full_text', parameters: { value: words } },
    { type: 'terminal', service: 'text', parameters: { attribute: 'rcsb_entity_source_organism.taxonomy_lineage.id', operator: 'exact_match', value: String(taxId) } },
  ],
});

/** The first experimental PDB entry holding a UniProt protein (null: none, or RCSB can't say). */
const entryHolding = (accession: string) => firstEntry({
  type: 'terminal', service: 'text',
  parameters: { attribute: 'rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession', operator: 'exact_match', value: accession },
});

/** Whether AlphaFold DB has a model of the protein (it leaves out the longest ones); null when it can't say. */
async function hasModel(accession: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UNIPROT_TIMEOUT_MS);
  try {
    const res = await fetch(`${AFDB_API}/${accession}`, { headers: { 'User-Agent': LOOKUP_AGENT }, signal: controller.signal });
    return res.ok ? true : res.status === 404 ? false : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The protein's AlphaFold model, or, when AlphaFold DB has none, the first PDB entry holding it, or `fallback`. */
async function modelOrEntry(accession: string, fallback: string): Promise<string> {
  if ((await hasModel(accession)) !== false) return `AF-${accession}-F1`;
  return (await entryHolding(accession)) ?? fallback;
}

/**
 * Whether an entry has a .pdb file, the only kind the app reads (the largest structures, and some
 * newer ones, come only as mmCIF); null when RCSB can't say.
 */
async function hasPdbFile(pdbId: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RCSB_TIMEOUT_MS);
  try {
    const res = await fetch(`https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`, { method: 'HEAD', signal: controller.signal });
    return res.ok ? true : res.status === 404 ? false : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The best-ranked experimental entry an RCSB search finds that the app can load (null: none, or RCSB can't say). */
async function firstEntry(query: object): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RCSB_TIMEOUT_MS);
  let ids: string[];
  try {
    const res = await fetch(RCSB_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, return_type: 'entry', request_options: { paginate: { start: 0, rows: 10 }, results_content_type: ['experimental'] } }),
      signal: controller.signal,
    });
    if (res.status !== 200) return null; // 204: nothing found
    ids = ((await res.json())?.result_set ?? []).map((r: any) => r?.identifier)
      .filter((id: unknown): id is string => typeof id === 'string' && /^[1-9][A-Za-z0-9]{3}$/.test(id)).map((id: string) => id.toUpperCase());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  // Checked all at once; the best-ranked one with a file wins
  const files = await Promise.all(ids.map(hasPdbFile));
  return ids.find((_, i) => files[i] === true) ?? null;
}

/**
 * The structure the plan names (the one on screen or another), checked against the protein the
 * question is about: an AlphaFold model gets its accession from the gene symbol, and a PDB entry that
 * doesn't hold the protein (or doesn't exist) becomes that protein's AlphaFold model. The protein in
 * any species counts (1IEP holds mouse Abl with imatinib, 1A6M sperm whale myoglobin), and so does a
 * gene named inside a longer one ("pol" in "gag-pol"). Only a reviewed UniProt entry replaces a
 * structure (an unreviewed one may have no model), and a protein AlphaFold DB has no model of (the
 * longest ones) gets the first PDB entry holding it instead; when UniProt or RCSB can't be reached, the
 * plan's choice stands. A gene with no reviewed entry in the species the plan names (a chain cut from a viral
 * polyprotein, say) leaves no model to swap in: there, a structure holding nothing from that species
 * becomes the first entry a search for the gene finds among that species' entries.
 */
async function checkedStructure(asked: string, protein: { gene?: unknown; taxId?: unknown } | undefined): Promise<string> {
  const gene = typeof protein?.gene === 'string' ? protein.gene.trim() : '';
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(gene)) return asked;
  const namedSpecies = Number.isInteger(protein?.taxId);
  const taxId = namedSpecies ? (protein!.taxId as number) : 9606;
  const isAlphaFold = /^AF-/i.test(asked);
  const isPdb = /^[1-9][A-Za-z0-9]{3}$/.test(asked);
  if (!isAlphaFold && !isPdb) return asked;
  if (isAlphaFold) {
    const found = await resolveUniProtAccession(gene, taxId);
    if (found) return modelOrEntry(found.accession, asked);
    return (namedSpecies && (await searchEntry(gene, taxId))) || asked;
  }
  const [found, entry, anySpecies] = await Promise.all([resolveUniProtAccession(gene, taxId), entryProteins(asked), geneAccessions(gene)]);
  if (entry === undefined || anySpecies === null) return asked;
  if (!found?.reviewed) {
    if (!namedSpecies) return asked;
    if (entry?.species.includes(taxId) && (await hasPdbFile(asked)) !== false) return asked;
    return (await searchEntry(gene, taxId)) ?? asked;
  }
  const symbol = gene.toUpperCase();
  const holds = entry !== null && (
    entry.accessions.some(a => a === found.accession || anySpecies.includes(a))
    || entry.genes.some(g => g === symbol || g.split(/[-\s/,;]+/).includes(symbol))
  );
  // An entry the app can't load (no .pdb file) is no better than one of another protein
  if (holds && (await hasPdbFile(asked)) !== false) return asked;
  return modelOrEntry(found.accession, asked);
}

// --- RATE LIMIT ---
// Best effort, per Edge instance (see /api/analyze). An investigation makes two to four calls, so this
// allows four investigations a minute per visitor: far more than a person asks.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 16;
const recentRequests = new Map<string, number[]>();

function rateLimitWait(visitor: string): number {
  const now = Date.now();
  const recent = (recentRequests.get(visitor) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REQUESTS) {
    recentRequests.set(visitor, recent);
    return Math.max(1, Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  recentRequests.set(visitor, recent);
  if (recentRequests.size > 5000) {
    for (const [key, times] of recentRequests) if (times.every(t => now - t >= RATE_WINDOW_MS)) recentRequests.delete(key);
  }
  return 0;
}

// --- NEMOTRON ---

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** The model's JSON object, or the error response to send instead. */
async function askModel(system: string, user: string, options: { maxTokens: number; reasoningEffort: 'low' | 'medium'; timeoutMs?: number }): Promise<{ data: any } | { error: Response }> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) return { error: jsonResponse({ error: 'NEBIUS_API_KEY not configured on the server' }, 500) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LLM_TIMEOUT_MS);
  let completion: any;
  try {
    const response = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.NEMOTRON_MODEL || DEFAULT_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: options.maxTokens,
        reasoning_effort: options.reasoningEffort,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Details stay in the server log; error bodies can name the account and its limits
      const errText = await response.text().catch(() => '<no body>');
      console.error(`[investigate] Token Factory ${response.status}: ${errText.slice(0, 300)}`);
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return { error: jsonResponse({ error: 'The AI is busy right now (rate limit)' }, 429, retryAfter ? { 'Retry-After': retryAfter } : {}) };
      }
      return { error: jsonResponse({ error: `Upstream error ${response.status}` }, 502) };
    }
    completion = await response.json().catch(() => null);
  } catch {
    return {
      error: controller.signal.aborted
        ? jsonResponse({ error: 'The AI took too long to answer' }, 504)
        : jsonResponse({ error: 'Failed to reach upstream LLM provider' }, 502),
    };
  } finally {
    clearTimeout(timer);
  }

  const text: unknown = completion?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) return { error: jsonResponse({ error: 'Empty response from upstream' }, 502) };
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const data = JSON.parse(cleaned);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: jsonResponse({ error: 'Model returned an unexpected answer' }, 502) };
    return { data };
  } catch {
    return { error: jsonResponse({ error: 'Model returned invalid JSON' }, 502) };
  }
}

const field = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, max) : '');

// --- TAVILY (the literature step) ---

const MAX_QUERY = 160;

/** Papers for a literature step's search words, or the error response to send instead. */
async function searchLiterature(query: string): Promise<Response> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'Literature search is not set up on this server' }, 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: 'advanced',
        max_results: SEARCH_RESULTS,
        include_domains: Object.keys(LITERATURE_SITES),
        include_answer: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '<no body>');
      console.error(`[investigate] Tavily ${response.status}: ${errText.slice(0, 300)}`);
      // 432/433: the plan's or the pay-as-you-go limit is used up
      if (response.status === 429) return jsonResponse({ error: 'The literature search is busy right now (rate limit)' }, 429);
      if (response.status === 432 || response.status === 433) return jsonResponse({ error: 'The literature search is unavailable right now' }, 503);
      return jsonResponse({ error: `Literature search error ${response.status}` }, 502);
    }
    const json: any = await response.json().catch(() => null);
    return jsonResponse({ sources: normalizeSources(json?.results) }, 200);
  } catch {
    return controller.signal.aborted
      ? jsonResponse({ error: 'The literature search took too long' }, 504)
      : jsonResponse({ error: 'Failed to reach the literature search' }, 502);
  } finally {
    clearTimeout(timer);
  }
}

// --- HANDLER ---

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  // Origin check, as in /api/analyze (the page's own origin is always fine)
  const origin = req.headers.get('origin') || '';
  const sameOrigin = origin !== '' && origin === new URL(req.url).origin;
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin) return jsonResponse({ error: 'Forbidden origin' }, 403);

  const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const wait = rateLimitWait(visitor);
  if (wait > 0) return jsonResponse({ error: 'Too many requests in a minute; please wait a moment' }, 429, { 'Retry-After': String(wait) });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') return jsonResponse({ error: 'Invalid JSON body' }, 400);

  const question = field(body.question, MAX_QUESTION + 1);
  if (!question) return jsonResponse({ error: 'Missing "question" field' }, 400);
  if (question.length > MAX_QUESTION) return jsonResponse({ error: `Question too long (max ${MAX_QUESTION} chars)` }, 400);

  if (body.stage === 'plan') {
    const pdbId = field(body.current?.pdbId, 40);
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(pdbId)) return jsonResponse({ error: 'Missing or invalid "current.pdbId"' }, 400);
    const title = field(body.current?.title, 200);
    const literature = Boolean(process.env.TAVILY_API_KEY);
    const result = await askModel(
      planPrompt(literature),
      `CURRENT STRUCTURE: ${pdbId}${title ? ` (${title})` : ''}\nQUESTION: "${question}"\n\nOutput the JSON plan now.`,
      { maxTokens: 2048, reasoningEffort: 'low' },
    );
    if ('error' in result) return result.error;

    // Another structure than the one on screen: checked against the protein's gene symbol (the model
    // recalls those far better than accessions or PDB IDs). No usable ID means the one on screen,
    // which is checked the same way.
    const data = result.data;
    const asked = canonicalStructureId(data.structure) ?? pdbId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<string>(resolve => { timer = setTimeout(() => resolve(asked), STRUCTURE_CHECK_MS); });
    data.structure = await Promise.race([checkedStructure(asked, data.protein ?? data.alphafold), outOfTime]);
    clearTimeout(timer);
    // A question about published research always searches it, even when the model's plan leaves that out
    if (literature && ASKS_LITERATURE.test(question)) {
      if (!Array.isArray(data.steps)) data.steps = [];
      if (!data.steps.some((s: any) => s?.tool === 'literature')) data.steps.push({ tool: 'literature', why: 'What published research reports' });
    }
    const plan = normalizePlan(data, pdbId, question);
    if (plan && !literature) plan.steps = plan.steps.filter(s => s.tool !== 'literature');
    return plan ? jsonResponse(plan, 200) : jsonResponse({ error: 'Model returned an unusable plan' }, 502);
  }

  if (body.stage === 'search') {
    const query = field(body.query, MAX_QUERY + 1).replace(/\s+/g, ' ');
    if (query.length < 3) return jsonResponse({ error: 'Missing "query"' }, 400);
    if (query.length > MAX_QUERY) return jsonResponse({ error: `Query too long (max ${MAX_QUERY} chars)` }, 400);
    return searchLiterature(query);
  }

  if (body.stage === 'write') {
    const steps = Number(body.steps);
    if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) return jsonResponse({ error: 'Invalid "steps"' }, 400);
    const findings = field(body.findings, MAX_FINDINGS + 1).replace(/ {2,}/g, ' '); // Keeps its line breaks
    if (!findings) return jsonResponse({ error: 'Missing "findings"' }, 400);
    if (findings.length > MAX_FINDINGS) return jsonResponse({ error: `Findings too long (max ${MAX_FINDINGS} chars)` }, 400);
    const sets = (Array.isArray(body.sets) ? body.sets : [])
      .slice(0, MAX_SETS)
      .map((s: any) => ({ name: field(s?.name, 80), label: field(s?.label, 80), count: Number(s?.count) }))
      .filter((s: { name: string; count: number }) => /^[a-z0-9_]+$/.test(s.name) && Number.isInteger(s.count) && s.count > 0);
    const structureId = field(body.structure?.id, 40);
    const structureTitle = field(body.structure?.title, 200);

    const result = await askModel(
      WRITE_PROMPT,
      `QUESTION: "${question}"\nSTRUCTURE: ${structureId}${structureTitle ? ` (${structureTitle})` : ''}\n\nRESULTS:\n${findings}\n\nSETS (name: what it holds, residue count):\n${
        sets.length ? sets.map((s: { name: string; label: string; count: number }) => `- ${s.name}: ${s.label} (${s.count})`).join('\n') : '(none)'
      }\n\nOutput the JSON now.`,
      { maxTokens: 3072, reasoningEffort: 'medium', timeoutMs: LONG_TIMEOUT_MS },
    );
    if ('error' in result) return result.error;
    const writeUp = normalizeWrite(result.data, sets.map((s: { name: string }) => s.name), steps);
    return writeUp ? jsonResponse(writeUp, 200) : jsonResponse({ error: 'Model returned an unusable write-up' }, 502);
  }

  if (body.stage === 'check') {
    const results = field(body.results, MAX_FINDINGS + 1).replace(/ {2,}/g, ' '); // Keeps its line breaks
    if (results.length > MAX_FINDINGS) return jsonResponse({ error: `Results too long (max ${MAX_FINDINGS} chars)` }, 400);
    type Sentence = { id: number; text: string; missing: string[] };
    const sentences: Sentence[] = (Array.isArray(body.sentences) ? body.sentences : [])
      .slice(0, MAX_CHECKED)
      .map((s: any) => ({
        id: Number(s?.id),
        text: field(s?.text, 600),
        missing: (Array.isArray(s?.missing) ? s.missing : []).slice(0, 6).map((m: unknown) => field(m, 30).replace(/[^\w.%+-]/g, '')).filter(Boolean),
      }))
      .filter((s: Sentence) => Number.isInteger(s.id) && s.text);
    if (!results || !sentences.length) return jsonResponse({ error: 'Missing "results" or "sentences"' }, 400);
    const uncited = sentences.filter(s => !/\[\d+[a-d]?\]/.test(s.text)).map(s => s.id);
    const missing = sentences.filter(s => s.missing.length).map(s => `${s.id}: ${s.missing.join(', ')}`);
    const result = await askModel(
      CHECK_PROMPT,
      `QUESTION: "${question}"\n\nRESULTS:\n${results}\n\nSENTENCES:\n${
        sentences.map(s => `${s.id}. ${s.text}`).join('\n')
      }\n\nUNCITED: ${uncited.length ? uncited.join(', ') : 'none'}\n\nNOT IN WHAT THEY CITE:${missing.length ? `\n${missing.join('\n')}` : ' none'}\n\nOutput the JSON now.`,
      { maxTokens: 3072, reasoningEffort: 'medium', timeoutMs: LONG_TIMEOUT_MS },
    );
    if ('error' in result) return result.error;
    return jsonResponse({ verdicts: normalizeCheck(result.data, sentences) }, 200);
  }

  return jsonResponse({ error: 'Unknown "stage" (expected "plan", "search", "write" or "check")' }, 400);
}
