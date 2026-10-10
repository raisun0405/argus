// Argus — Serverless function: protein-analysis LLM proxy
//
// Lives at /api/analyze on Vercel. Receives a user query + optional context,
// asks NVIDIA Nemotron on Nebius Token Factory server-side (NEBIUS_API_KEY from env),
// returns the parsed ProteinAnalysis JSON.
//
// Architecture: the NEBIUS_API_KEY never reaches the browser. The frontend only
// sees this function's response, not the upstream Token Factory call.

import { normalizeAnalysis, normalizeHighlights } from '../services/normalizeAnalysis';

export const config = { runtime: 'edge' };

// --- CONFIG ---
// NVIDIA Nemotron on Nebius Token Factory (an OpenAI-compatible API). NEMOTRON_MODEL picks another
// Token Factory model without a code change.
const LLM_ENDPOINT = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
// Nemotron 3 Super: in side-by-side tests on Argus's own questions it made fewer mistakes than Ultra,
// answered sooner and costs a third as much
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
// Vercel Edge functions must start responding within 25 s: leave room for the UniProt lookups
const LLM_TIMEOUT_MS = 18000;
const UNIPROT_TIMEOUT_MS = 3000;

// Origins permitted to call this function from a browser, besides the page's own address, which always
// passes (so does local development: the dev server's bridge keeps requests same-origin). This stops other
// websites' pages from spending the AI quota through their visitors' browsers. It can't stop a script:
// anything that isn't a browser can send whatever Origin it likes.
const ALLOWED_ORIGINS = new Set<string>([
  // Any other address the app is served from goes here
]);

// --- PROMPT ---

const SCHEMA_DESCRIPTION = `Return ONLY a single valid JSON object (no markdown, no prose around it) matching this exact shape:

{
  "pdbId": "<4-character PDB ID like '1TRZ', or an AlphaFold model ID of the form 'AF-<UniProt accession>-F1' (see rule 1)>",
  "title": "<short scientific title>",
  "summary": "<concise educational summary explaining structure-function and why specific residues are highlighted>",
  "highlights": [
    {
      "chain": "<chain identifier like 'A'>",
      "resi": [<array of residue numbers as integers>],
      "label": "<biological label like 'Heme Binding Pocket'>",
      "category": "<MUST be one of: active_site | binding_site | ligand | substrate | metal | cofactor | mutation | other>"
    }
  ],
  "measurements": [
    {
      "start": { "chain": "<string>", "resi": <integer>, "atom": "<optional atom name like 'CA' or 'FE'>" },
      "end":   { "chain": "<string>", "resi": <integer>, "atom": "<optional atom name>" },
      "label": "<optional short label>"
    }
  ],
  "tour": [
    {
      "text": "<narration text for this step, 1-2 sentences>",
      "focus": [
        { "chain": "<string>", "resi": [<integers>], "label": "<optional>", "category": "<category string>" }
      ]
    }
  ],
  "quiz": {
    "question": "<question text>",
    "options": ["<opt A>", "<opt B>", "<opt C>", "<opt D>"],
    "correctAnswerIndex": <integer 0-3>,
    "correctAnswerIndices": [<integers 0-3, only for a select-all-that-apply question>],
    "explanation": "<why the answer is correct>",
    "answerHighlights": [
      { "chain": "<string>", "resi": [<integers>], "label": "<string>", "category": "<category>" }
    ]
  },
  "alphafold": { "gene": "<official gene symbol, e.g. 'ZNF808'>", "taxId": <NCBI taxonomy ID, 9606 for human> },
  "actions": ["<viewer action, see VIEWER ACTIONS>"]
}

REQUIRED fields at top level: pdbId, title, summary, highlights.
OPTIONAL fields at top level: measurements, tour, quiz, alphafold, actions.
  - alphafold: include ONLY when pdbId is an AlphaFold model (used to look up the correct UniProt accession).
  - measurements: include as [] when not explicitly requested by the user.
  - tour: include only when the user asks for an explanation / mechanism / tour / "show me". Otherwise OMIT the key entirely.
  - quiz: include only when generating an educational question. Otherwise OMIT the key entirely.
  - actions: include only as VIEWER ACTIONS describes. Otherwise OMIT the key entirely.`;

const SYSTEM_PROMPT = `You are Argus, a Structural Biology Expert inside the Argus app. Given a user query about a protein or biological mechanism, you produce a JSON analysis object that drives a 3D molecular viewer.

${SCHEMA_DESCRIPTION}

CORE RULES:
1. Identify the most relevant Protein Data Bank (PDB) ID. Use real, existing 4-character PDB codes only. ONLY if no experimental structure exists for the protein, use its AlphaFold DB model "AF-<UniProt accession>-F1" instead and fill "alphafold" with the protein's official gene symbol and taxonomy ID; AlphaFold models have a single chain "A", UniProt residue numbering, and no ligands, metals or substrates.
2. Identify key active site residues, binding sites, or mutation sites relevant to the query.
3. Provide a brief educational summary in the "summary" field.
4. ONLY if the user explicitly asks for a distance / measurement / "how far" / "length", populate "measurements". Otherwise return "measurements": [].

EDUCATIONAL QUIZ MODE:
- About 50% of the time, or whenever explaining a complex mechanism, include a "quiz" object.
- The quiz must test a specific structural detail.
- Exactly one option is true; check every other option against the question and make sure it is really false. A common mistake: asking for "the" one of something the structure has several of (two bonds, three residues of one site) and listing another of them as a wrong option.
- If several options are true, make it a "select all that apply" question: word the question for several answers (the app adds the "Select all that apply" label itself) and list every true option in "correctAnswerIndices" ("correctAnswerIndex" = the first of them). Omit "correctAnswerIndices" otherwise.
- The app shows the options in a random order: don't label them ("A)", "1.") and don't refer to them by letter or position in the explanation.
- CRITICAL: provide "answerHighlights" — the specific residues/ligands corresponding to the CORRECT answer. The viewer zooms to these when the user answers correctly.

CINEMATIC TOUR MODE:
- If the user asks for "explanation", "how it works", "mechanism", "show me", or similar, include a "tour" array.
- The tour should be 2-4 steps.
- Each step has "text" (1-2 sentences) and "focus" (the residues to zoom into).
- Step 1: whole active site. Step 2: zoom into a specific residue. Step 3: substrate or next feature.

VISUALIZATION CATEGORY RULES (the "category" field):
- "metal": single-atom ions (Fe, Zn, Mg, Ca, etc.)
- "substrate": ONLY the precise molecule chemically modified in the reaction (e.g., the O2 in Hemoglobin, or a drug if the user explicitly calls it a substrate).
  CRITICAL: cofactors (Heme, FAD, NADP) and prosthetic groups are NOT substrates unless they are the actual reactant being consumed. In Hemoglobin, Heme is a COFACTOR (use "ligand"); the Oxygen (O2) is the substrate.
- "ligand": EVERYTHING ELSE bound to the protein — cofactors (Heme, FAD), prosthetic groups, inhibitors, drugs, solvents.
- "active_site": amino acid residues of the protein itself.
- "binding_site", "cofactor", "mutation", "other": use when appropriate.

EXISTENCE CHECK (CRITICAL):
- Only highlight ligands/substrates that ACTUALLY EXIST in the chosen PDB structure.
- If the structure is apo (empty), do not list substrates.
- Do not hallucinate molecules that are not in the file.

MEASUREMENTS (STRICT):
- Do NOT output measurements unless the user query specifically asks for "distance", "measure", "how far", or "length".
- Default to empty list [] for measurements.

HANDLING "ADD/DOCK/INSERT" REQUESTS:
- If the user asks to "add", "place", "dock", "insert", or "show" a molecule (ligand/substrate/drug) into a protein:
  - DO NOT say you cannot run docking simulations.
  - DO NOT keep the current PDB if it is empty (apo).
  - INTERPRET THIS AS: "Find an existing experimental PDB structure (co-crystal) where [Molecule] is ALREADY bound to [Protein]."
  - Example: "Add glucose to hexokinase" → use PDB '3O08' (glucose bound) instead of the empty structure.
  - Update the "summary" to explain that you have loaded a structure where the ligand is already bound.

VIEWER ACTIONS (the optional "actions" list):
- The display changes ONLY through "actions", and the app adds its own line listing what changed. So "summary" is about the protein, never the display: no "shown as", "displayed", "representation", "coloured by", "transparent", "sticks", "surface view". For a request only about the display, "summary" is one sentence on what stands out in the structure itself.
- One shape at a time: a surface and a cartoon can't be shown together.
- Use them only when the user asks to change the display or run a tool, or when a tool directly answers the question (e.g. "where could a drug bind?" -> "tool:pockets").
- To compare the loaded structure with another structure of the SAME protein (another PDB entry of it: open vs closed, with vs without a ligand, a mutant; or its AlphaFold model), add "overlay:<PDB ID>" or "overlay:alphafold": the app lines the two up and colours what moved. Keep the current pdbId. Never for a different protein.
- Allowed: "shape:cartoon|sticks|spheres|surface"; "color:<scheme>" where rainbow = N- to C-terminus along each chain, chain = one colour per chain, element = by atom, residue = by amino-acid type, hydrophobicity = hydrophobic vs polar, confidence = AlphaFold model confidence (AlphaFold models only); "opacity:<0-100>"; "show:<part>" or "hide:<part>" with part highlights|ligands|substrates|metals|waters; "tool:pockets|interactions|variants|similar|partners|alphafold"; "overlay:<PDB ID>|alphafold"; "reset-view"; "tour:play" (only together with a "tour").
- A request only about the display keeps the current pdbId and highlights.

OUTPUT FORMAT (CRITICAL):
- Output ONLY the JSON object.
- No markdown code fences. No prefatory text. No explanation outside the JSON.
- Ensure the JSON is syntactically valid and parseable.`;

// --- ALPHAFOLD ANSWERS ---
// Never trust a recalled UniProt accession: the model knows gene symbols far
// better (it once answered "ZNF808" with ATP12A's accession), so the accession
// is looked up from the gene symbol instead.

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
// Best effort: each Edge instance counts recent requests per visitor IP. Instances are many and
// short-lived, so this is no substitute for a Vercel Firewall rule, but it stops one script
// hammering an instance from draining the Token Factory credit that every visitor
// shares. A person asks far less than this, even with the app's one automatic correction.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 12;
const recentRequests = new Map<string, number[]>();

/** Seconds until the visitor may ask again, or 0 when the request is allowed (and counted). */
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

// --- HANDLER ---

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // Method check
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Origin check (stops other websites from calling this endpoint from their visitors' browsers).
  // The page's own origin is always fine: Vercel preview deployments, the dev server on a LAN IP.
  // Scripts can fake an Origin header, so real abuse protection needs a rate limit (Vercel Firewall).
  const origin = req.headers.get('origin') || '';
  const sameOrigin = origin !== '' && origin === new URL(req.url).origin;
  if (!ALLOWED_ORIGINS.has(origin) && !sameOrigin) {
    return jsonResponse({ error: 'Forbidden origin' }, 403);
  }

  const visitor = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const wait = rateLimitWait(visitor);
  if (wait > 0) {
    return new Response(JSON.stringify({ error: 'Too many questions in a minute; please wait a moment' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(wait) },
    });
  }

  // Parse body
  let body: { query?: unknown; currentContext?: unknown; structureFacts?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return jsonResponse({ error: 'Missing "query" field' }, 400);
  }
  if (query.length > 2000) {
    return jsonResponse({ error: 'Query too long (max 2000 chars)' }, 400);
  }

  // Optional context (the answer on screen), cut down to what the prompt uses and capped in
  // size: every token is paid for from credit that every visitor shares
  const rawCtx = body.currentContext && typeof body.currentContext === 'object' ? (body.currentContext as any) : null;
  const ctx = rawCtx
    ? {
        pdbId: typeof rawCtx.pdbId === 'string' ? rawCtx.pdbId.slice(0, 40) : undefined,
        title: typeof rawCtx.title === 'string' ? rawCtx.title.slice(0, 200) : undefined,
        highlights: normalizeHighlights(rawCtx.highlights).slice(0, 20),
      }
    : undefined;

  // Optional grounding facts for the loaded structure, built in the browser by
  // services/groundingService.ts from UniProt + PDBe (already in the file's
  // chain IDs and residue numbering), plus AlphaFill's ligands on AlphaFold models,
  // Pocket Radar's pockets and STRING partners when the user has opened those, the
  // ligand interactions computed from the file for questions about binding, the
  // structure laid over this one (Overlay) when there is one, and the Boltz-2
  // prediction when a co-folded complex is on screen.
  // Most important lines come first; anything past 2800 characters is cut, and
  // control characters dropped.
  const facts =
    ctx && typeof body.structureFacts === 'string'
      ? body.structureFacts.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim().slice(0, 2800)
      : '';

  const factsPrompt = facts
    ? `- STRUCTURE FACTS (curated UniProt and PDBe data, already in THIS FILE's chain IDs and residue numbers. Lines: "Predicted ligand-binding pockets" = P2Rank predictions, present as predicted; "AlphaFill ligands" = ligands copied into the AlphaFold model from related structures; "Interaction partners" = STRING data, its PDB IDs are real complexes of both proteins; "Co-folded complex" = the Boltz-2 prediction on screen: present pose and affinity as predicted, keep the loaded ID as pdbId; "Ligand interactions" = contacts computed from this file's coordinates, use them to explain how a ligand is held):
${facts}
`
    : '';

  const groundingRule = facts
    ? `6. Grounding: STRUCTURE FACTS are verified data about the currently loaded structure and override the current highlights where they disagree. When they cover what the user asks about, copy their chain IDs and residue numbers exactly into highlights, tour focus, quiz answerHighlights and measurements, and only highlight ligands or metals listed under "Ligands in the file". The facts list only curated key residues, not every residue of a site: for a pocket, cleft, groove or interface, also include the other residues you know line it, numbered as in this file. If the user names a residue by its UniProt or literature number (for example a mutation), use the conversion under "Residues named in the question" when present, otherwise convert it with the "file numbering" offset. The current highlights come from an earlier answer and may use the wrong numbering (often UniProt's): never copy a residue number from them; take it from the facts. If you switch to a different PDB ID, these facts do not apply.
`
    : '';

  const contextPrompt = ctx
    ? `CURRENT CONTEXT (what the user is looking at):
- Currently Loaded PDB: ${ctx.pdbId ?? '(unknown)'}
- Title: ${ctx.title ?? '(unknown)'}
- Current Highlights: ${JSON.stringify(ctx.highlights).slice(0, 2500)}
${factsPrompt}
INSTRUCTIONS FOR FOLLOW-UP:
1. Focus/Zoom Mode: If the user asks about a specific site (e.g., "Where is the active site?", "Show me the heme group"), provide the specific residues in "highlights". The viewer will AUTOMATICALLY ZOOM IN and dim the rest of the protein.
2. Labels: ALWAYS provide a "label" for highlights.
3. Categories: CRITICAL — categorize highlights correctly per the category rules above.
4. Maintain Context: If the user asks about the *current* protein, keep the same PDB ID.
5. Measurements: ONLY output if the user EXPLICITLY asks for distance/length. Otherwise return [].
${groundingRule}
`
    : '';

  const userPrompt = `${contextPrompt}Query: "${query}"

Output the JSON analysis object now.`;

  // API key from server env (Vercel injects at runtime)
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { error: 'NEBIUS_API_KEY not configured on the server' },
      500
    );
  }

  // Call Nemotron (with a deadline: an Edge function that hasn't answered in 25 s gets a non-JSON 504)
  let llmResponse: Response;
  let completion: any;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    llmResponse = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.NEMOTRON_MODEL || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 4096,
        // Nemotron reasons before it answers (apart, in reasoning_content): briefly, for a quick answer
        reasoning_effort: 'low',
      }),
      signal: controller.signal,
    });

    if (!llmResponse.ok) {
      // Details stay in the server log; error bodies can name the account and its limits
      const errText = await llmResponse.text().catch(() => '<no body>');
      console.error(`[analyze] Token Factory ${llmResponse.status}: ${errText.slice(0, 300)}`);
      if (llmResponse.status === 429) {
        const retryAfter = llmResponse.headers.get('retry-after');
        return new Response(JSON.stringify({ error: 'The AI is busy right now (rate limit)' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) },
        });
      }
      return jsonResponse({ error: `Upstream error ${llmResponse.status}` }, 502);
    }

    try {
      completion = await llmResponse.json();
    } catch {
      return jsonResponse({ error: 'Upstream returned invalid JSON' }, 502);
    }
  } catch (e) {
    return controller.signal.aborted
      ? jsonResponse({ error: 'The AI took too long to answer' }, 504)
      : jsonResponse({ error: 'Failed to reach upstream LLM provider' }, 502);
  } finally {
    clearTimeout(timer);
  }

  const text: string | undefined = completion?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    return jsonResponse({ error: 'Empty response from upstream' }, 502);
  }

  // Strip accidental code fences
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
  }

  let data: any;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    return jsonResponse(
      {
        error: 'Model returned invalid JSON',
        raw: cleaned.slice(0, 500),
      },
      502
    );
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return jsonResponse({ error: 'Model returned an unexpected answer' }, 502);
  }

  // Canonical structure IDs: "1trz" -> "1TRZ", "af-p04637-f1-model_v6" -> "AF-P04637-F1"
  if (typeof data.pdbId === 'string') {
    const id = data.pdbId.trim();
    const af = id.match(/^AF-([A-Z0-9]{6,10})(?:-F\d+)?/i);
    data.pdbId = af ? `AF-${af[1].toUpperCase()}-F1` : id.toUpperCase();

    if (af) {
      const gene = typeof data.alphafold?.gene === 'string' ? data.alphafold.gene.trim() : '';
      const taxId = Number.isInteger(data.alphafold?.taxId) ? data.alphafold.taxId : 9606;
      if (/^[A-Za-z0-9._-]{1,20}$/.test(gene)) {
        const accession = await resolveUniProtAccession(gene, taxId);
        if (accession) data.pdbId = `AF-${accession}-F1`;
      }
    }
  }

  // Only well-formed fields go back (drops "alphafold" and anything else unexpected)
  const analysis = normalizeAnalysis(data);
  if (!analysis) {
    return jsonResponse({ error: 'Model answer had no usable structure ID' }, 502);
  }
  return jsonResponse(analysis, 200);
}
