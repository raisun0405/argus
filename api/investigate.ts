// Argus — Serverless function: Investigate mode's two AI calls
//
// Lives at /api/investigate on Vercel. Stage "plan": the question and the structure on screen in, a
// plan out (which of the app's tools to run, see services/investigationPlan). The browser runs those
// tools itself. Stage "write": the numbered results of the steps in, the conclusion out, written from
// those results alone. Both are NVIDIA Nemotron on Nebius Token Factory; NEBIUS_API_KEY stays here, as
// in /api/analyze.

import { MAX_STEPS, normalizePlan, normalizeWrite } from '../services/investigationPlan';

export const config = { runtime: 'edge' };

// --- CONFIG ---
// NVIDIA Nemotron on Nebius Token Factory (OpenAI-compatible); NEMOTRON_MODEL picks another model
const LLM_ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
// Nemotron 3 Super: in side-by-side tests on Argus's own questions it made fewer mistakes than Ultra,
// answered sooner and costs a third as much
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
// Vercel Edge functions must start responding within 25 s: leave room for the UniProt lookup
const LLM_TIMEOUT_MS = 18000;
const UNIPROT_TIMEOUT_MS = 3000;
const MAX_QUESTION = 1000;
const MAX_FINDINGS = 7000;
const MAX_SETS = 40;

// Same origins as /api/analyze: other websites can't spend this app's AI quota from their pages
const ALLOWED_ORIGINS = new Set<string>([
  // The deployed address goes here too (requests from the page's own address always pass)
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

// --- PROMPTS ---

const PLAN_PROMPT = `You plan a short investigation for Argus, an app that shows protein structures in 3D. The app runs the steps you choose with its own tools and data, and another call then writes the answer from their results. Never answer the question yourself.

Return ONLY a JSON object:
{
  "structure": "<the structure to investigate: the current one, unless the question is about a different protein; then a real 4-character PDB entry that shows it (with the ligand or partner the question names, when there is one), or 'AF-<UniProt accession>-F1' only when no experimental structure exists>",
  "alphafold": { "gene": "<official gene symbol>", "taxId": <NCBI taxonomy ID> },
  "title": "<what is being investigated, at most 8 words>",
  "steps": [ { "tool": "<tool>", "why": "<what this step checks, at most 10 words>" } ]
}
Include "alphafold" only with an AlphaFold ID.

TOOLS (the app always runs "facts" first; list the other tools the question needs, most useful first):
- facts: UniProt and PDBe annotations: active-site and binding residues, domains, the ligands in the file. Makes set "sites".
- variants: AlphaMissense pathogenicity of every position, and known disease variants (human proteins only). Makes sets "harmful" (likely pathogenic positions) and "disease" (positions with disease-linked variants).
- pockets: predicted ligand-binding pockets (P2Rank; takes up to a minute). Makes sets "pocket1", "pocket2", "pocket3", best first.
- ligands: the contacts between the ligands in the file and the protein (hydrogen bonds, salt bridges, stacking, metals). Makes set "ligand".
- partners: the proteins it interacts with (STRING), and PDB entries holding both. No sets.
- similar: proteins with a similar fold (Foldseek; takes up to a minute). No sets.
- relate: which residues of one set lie near another, measured in the 3D structure: {"tool": "relate", "a": "<set>", "b": "<set>", "within": <Å: 4 for direct contact, 6 to 8 for nearby>, "why": "..."}. Only sets made by tools in this plan. Use it when the question links two things, such as mutations and a pocket, or a drug and disease variants.

RULES:
- At most ${MAX_STEPS} steps in all, at most 2 of them "relate". Only tools that help answer this question.
- If the question is not about a protein, plan only "facts".
- Output only the JSON object: no markdown, no text around it.`;

const WRITE_PROMPT = `You write the conclusion of an investigation in Argus, an app that shows protein structures in 3D. The app ran the numbered steps under RESULTS with its own tools; those results are the only evidence you may use.

Return ONLY a JSON object:
{
  "title": "<the answer in at most 8 words>",
  "answer": "<2 to 5 sentences that answer the question directly. After each claim, cite the steps it rests on, like [2] or [2][4]. Copy residue names, numbers and percentages exactly from the results. Say plainly when a step failed or found nothing.>",
  "marks": [ { "set": "<a name listed under SETS>", "label": "<what it is, at most 5 words>" } ],
  "caveat": "<optional: one sentence on what these results cannot show>"
}

RULES:
- Nothing from memory: no residue, number or claim that is not in the results. If the results cannot answer the question, say what they do show and what is missing.
- "marks": the 1 to 3 sets that best show the answer in 3D, the most specific first (a "_near_" set when one has residues). Only names listed under SETS.
- Pockets and AlphaMissense scores are predictions, not experiments: say "predicted" or "likely".
- Plain words a student can follow. No markdown.
- Output only the JSON object: no markdown, no text around it.`;

// --- ALPHAFOLD ANSWERS (as in /api/analyze: the accession comes from the gene symbol, never from memory) ---

async function resolveUniProtAccession(gene: string, taxId: number): Promise<string | null> {
  const base = 'https://rest.uniprot.org/uniprotkb/search?fields=accession&format=json&size=1&query=';
  for (const reviewedOnly of [true, false]) {
    const query = `gene_exact:${gene} AND organism_id:${taxId}${reviewedOnly ? ' AND reviewed:true' : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UNIPROT_TIMEOUT_MS);
    try {
      const res = await fetch(base + encodeURIComponent(query), { signal: controller.signal });
      if (!res.ok) continue;
      const json: any = await res.json();
      const accession = json?.results?.[0]?.primaryAccession;
      if (typeof accession === 'string') return accession;
    } catch {
      // Network hiccup or timeout: try the next query, then keep the model's answer
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// --- RATE LIMIT ---
// Best effort, per Edge instance (see /api/analyze). An investigation makes two calls, so this allows
// six investigations a minute per visitor: far more than a person asks.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 12;
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
async function askModel(system: string, user: string, options: { maxTokens: number; reasoningEffort: 'low' | 'medium' }): Promise<{ data: any } | { error: Response }> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) return { error: jsonResponse({ error: 'NEBIUS_API_KEY not configured on the server' }, 500) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
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
    const result = await askModel(
      PLAN_PROMPT,
      `CURRENT STRUCTURE: ${pdbId}${title ? ` (${title})` : ''}\nQUESTION: "${question}"\n\nOutput the JSON plan now.`,
      { maxTokens: 2048, reasoningEffort: 'low' },
    );
    if ('error' in result) return result.error;

    // An AlphaFold model: its accession comes from the gene symbol (the model recalls those far better)
    const data = result.data;
    const af = typeof data.structure === 'string' ? data.structure.trim().match(/^AF-([A-Z0-9]{6,10})/i) : null;
    if (af) {
      const gene = typeof data.alphafold?.gene === 'string' ? data.alphafold.gene.trim() : '';
      const taxId = Number.isInteger(data.alphafold?.taxId) ? data.alphafold.taxId : 9606;
      if (/^[A-Za-z0-9._-]{1,20}$/.test(gene)) {
        const accession = await resolveUniProtAccession(gene, taxId);
        if (accession) data.structure = `AF-${accession}-F1`;
      }
    }
    const plan = normalizePlan(data, pdbId);
    return plan ? jsonResponse(plan, 200) : jsonResponse({ error: 'Model returned an unusable plan' }, 502);
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
      { maxTokens: 3072, reasoningEffort: 'medium' },
    );
    if ('error' in result) return result.error;
    const writeUp = normalizeWrite(result.data, sets.map((s: { name: string }) => s.name), steps);
    return writeUp ? jsonResponse(writeUp, 200) : jsonResponse({ error: 'Model returned an unusable write-up' }, 502);
  }

  return jsonResponse({ error: 'Unknown "stage" (expected "plan" or "write")' }, 400);
}
