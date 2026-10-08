<div align="center">

# Argus

**Your AI Molecular Co-Scientist**

Talk to any protein in plain English. Argus finds the right structure, shows it in 3D,
highlights what matters, and lets you dig into variants, binding pockets and partners,
or predict how a drug binds.

Answers and investigations run on **NVIDIA Nemotron** through **Nebius Token Factory**.

<sub>Named after Argus, the giant of Greek myth with a hundred eyes who saw everything.</sub>

![Argus showing HIV-1 protease bound to the inhibitor XK263: the chat on the left with the answer and a quick check, the structure coloured by Pocket Radar's predicted pockets with the catalytic Asp25 selected, the sequence above it and the inspector listing everything within 5 Å](docs/screenshot.jpg)

</div>

---

## Nemotron on Nebius Token Factory

Every AI call in Argus goes to **NVIDIA Nemotron 3 Super** (`nvidia/nemotron-3-super-120b-a12b`) on
[Nebius Token Factory](https://tokenfactory.nebius.com), through its OpenAI-compatible API, from two
server-side Edge Functions (the key never reaches the browser):

| Where | What Nemotron does |
|---|---|
| [`api/analyze.ts`](api/analyze.ts) | Answers a question about a protein: picks the PDB entry or AlphaFold model, writes the explanation, marks the residues it talks about, adds quizzes and guided tours, and asks the viewer for actions (shapes, colours, tools). Grounded in facts the app looks up first (UniProt, PDBe, predicted pockets), and checked against the structure file afterwards. |
| [`api/investigate.ts`](api/investigate.ts) | **Investigate mode**, the agentic part: Nemotron plans which of the app's tools to run (annotations, AlphaMissense variants, P2Rank pockets, ligand contacts, STRING partners, Foldseek, distance relations between them), the browser runs those tools, and Nemotron writes the conclusion from their numbered results alone, citing each step. |

Both ask for JSON (`response_format`), with `reasoning_effort: "low"`: Nemotron reasons first, apart
from the answer, and briefly, so answers arrive in a few seconds. `NEMOTRON_MODEL` switches to another
Token Factory model without a code change. Nemotron 3 Super was chosen over Nemotron 3 Ultra in a side-by-side
test on Argus's own questions, scored by the app's answer checker: fewer wrong residues and ligands
(3 against 12 over eight questions), quicker answers, and a third of the price.

## What it does

You ask a question (*"Show me HIV protease"*, *"Where does the sickle-cell mutation sit?"*,
*"What are the catalytic residues of trypsin?"*). An LLM answers with a structured analysis:
the PDB entry, the key residues and what they do, an optional guided tour and an optional quiz.
That answer drives a live 3D viewer, and a set of tools built on free public science databases
takes you further.

### Ask and learn
- **Conversational analysis** with highlighted residues by role: active site, binding site, ligand, substrate, metal, cofactor, mutation. A structure opens whole, with the rest faded just enough for the highlights to stand out; click a highlight in the answer to zoom to it.
- **Grounded answers.** Curated UniProt features and PDBe ligand data, converted to the loaded file's own chain IDs and residue numbers, go with every question. Each answer is then checked against the structure: residues that don't exist, wrong chains or mislabelled ligands are corrected locally or sent back to the AI once for repair.
- **Investigate mode.** For a question that needs several tools at once, such as *"are the disease mutations of KRAS near a druggable pocket?"*, pick Investigate from the message box's + menu (or start the message with `investigate:`). The AI plans the steps from Argus's own tools: UniProt and PDBe annotations, Variant Lens, Pocket Radar, ligand contacts, partners and similar folds, plus a step that measures in 3D how two results relate (which disease variants line which pocket). The app runs the steps in the browser while a checklist shows each one's progress and result. The AI then writes the answer from those results alone, citing the step behind each claim, and every residue it marks comes from a step, not from its memory. Click a citation or a step to see it in 3D.
- **Cinematic tours** that zoom from site to site with subtitles, and **quizzes** whose correct answers fly the camera to the residues.
- **Ask the chat to do it.** Anything the controls do can be typed: *"surface, coloured by chain"*, *"hide waters"*, *"opacity 40"*, *"open pockets"*, *"select A:25"*, *"paper theme"*, *"play the tour"*. Plain requests like these run at once without the AI; an answer can also change the view or open a tool when the question calls for it (*"show me hemoglobin as a surface"*). Under each request the chat lists what actually changed, and why anything couldn't be done.
- **Voice input** in the browser.

### Explore structures
- **Any of the 200,000+ PDB entries**, as cartoon, wireframe, spacefill or surface, coloured by element, chain, rainbow, hydrophobicity or residue type.
- **AlphaFold models.** Switch an experimental entry to its full-length AlphaFold DB prediction, coloured by confidence (pLDDT), with highlights carried across.
- **AlphaFill ligands.** AlphaFold models have no ligands, so Argus adds the cofactors, metals and other ligands AlphaFill transplants from related PDB entries. Only confident transplants that the model actually holds are shown, and each is fitted onto its own binding site.
- **Fold any sequence.** Paste a protein sequence or FASTA (up to 400 residues), or add a FASTA file from the + menu, and ESMFold predicts its structure in seconds.

### Investigate
- **Variant Lens.** Colours residues by AlphaMissense pathogenicity and lists known disease variants from UniProt (human proteins).
- **Pocket Radar.** P2Rank's predicted ligand-binding pockets, each in its own colour, with probabilities and any ligand already sitting there.
- **Interactions.** What holds each ligand in place: hydrogen bonds, salt bridges, π-stacking, cation-π, halogen bonds, metal coordination, water bridges and hydrophobic contacts, drawn as coloured dashed lines and listed by residue. Computed in the browser from the coordinates with criteria from PLIP, for crystal ligands, AlphaFill transplants and co-folded poses alike. Checked against PDBe's Arpeggio on ten ligands from classic structures, it finds 97% of Arpeggio's hydrogen-bonded residues and every metal contact. Questions about binding get these interactions as facts.
- **Overlay.** Lay another structure of the same protein over the one on screen to see what moved: another PDB entry (an open and a closed form, with and without a ligand, a mutant) or its AlphaFold model. The toolbar's Overlay menu suggests the protein's other entries, best resolved first, or takes any PDB ID. The two are lined up with residues paired by sequence, one chain fitted onto the other by least squares, then refitted on the pairs that end up within 2 Å, so the parts that moved don't drag the fit. The structure on screen is coloured by how far each residue sits from its partner (blue, white at 2 Å, red), with the other drawn as a thin line, or the two are shown in blue and orange. The panel gives the fit over the core and over all pairs, lists where they differ most and any residues that differ, and lets you pick which chain lies on which. The second structure is a passive layer: selections, tools and the chat never act on it. Only the same protein (at least 90% identical where the chains align) is accepted. Checked against RCSB's pairwise alignment on adenylate kinase open (4AKE) and closed (1AKE): a whole-chain fit gives the same RMSD as FATCAT (7.13 against 7.14 Å), and the core residues sit on average 0.4 Å from where TM-align places them. Also from the chat: `overlay 1AKE`, `overlay alphafold`, or ask how two forms differ.
- **Partners.** Interaction partners from STRING, with the evidence behind them. Partners that have been solved together with the protein open as a complex with the interface marked.
- **Co-fold.** Name a molecule (a drug name, a PDB ligand code or a SMILES string) and Boltz-2 predicts how it binds the protein on screen and how strongly: the pose, its confidence, an estimated IC50 and the probability that it is a binder. The protein keeps its experimental shape (the structure is used as a template), metals and cofactors can stay in place, and when the crystal structure holds the same ligand its pose is shown beside the prediction, with how many of its interactions the prediction reproduces. Also from the chat: pick Co-fold in the + menu and name the molecule, or type `cofold imatinib`.
- **Pick the site.** By default Boltz-2 chooses where the molecule binds. You can instead point it at a site: where one of the structure's own ligands sits, or any pocket from Pocket Radar (which offers "Co-fold a molecule into Pocket *n*" for the pocket you're looking at). The card then says how many of the pose's contacts landed inside. Steering matters: caffeine left free drifted to the surface of HIV-1 protease, but aimed at a predicted pocket every contact landed inside it, and aspirin on trypsin went from a loose pose (ipTM 0.74) to a deep one (0.96).
- **Compare two molecules.** Add a second molecule in the Co-fold form (or type `cofold imatinib vs nilotinib`) and both are predicted under the same conditions: same chains, site and cofactors. One card sets them side by side: which is predicted to bind more tightly and by how much, pose confidence, binder probability, how much of the site they share, and the interactions each makes residue by residue. Boltz-2's affinities are often off by tenfold, so a smaller gap is called similar rather than a win. In 3D the two sit together, one with blue carbons and one with orange, and either can be hidden from the inspector.
- **Find similar.** Foldseek searches the PDB and AlphaFold DB for proteins with the same 3D shape, grouping orthologs so distant relatives stand out.

### The workspace
The screen is a working surface, not a page: the chat on the left, the structure edge to edge in
the middle with its sequence above it and a status bar below, and one inspector on the right.
Both side panels resize by dragging their edge and fold away when you want the structure to itself;
their widths are remembered. Below 1024px the inspector steps aside, and on a phone the chat and the
structure become two tabs that keep their state as you switch.

- **The sequence.** Every residue of every chain as a row of cells, coloured by what the answer marked and by what you have selected. Click a residue to select it, drag across a stretch, shift-click to extend, ⌘/Ctrl-click to add. Selecting in the sequence selects in 3D, and clicking a residue in 3D selects it in the sequence.
- **The inspector** holds the controls that used to sit in menus: how the structure looks, what is on screen (chains, ligands, waters) and a focus panel that lists what sits within 5 Å of the selection, so you can walk a binding site residue by residue.
- **A command palette** (<kbd>Ctrl</kbd>+<kbd>K</kbd>, or <kbd>⌘K</kbd> on a Mac) runs everything by name — tools, colourings, visual modes, themes — and doubles as a residue search: type `A:25`, `Asp25` or `25-40` to jump to and select residues.
- **Keyboard shortcuts** for the things you do constantly: <kbd>1</kbd>–<kbd>4</kbd> for the visual modes, <kbd>I</kbd> for the inspector, <kbd>B</kbd> for the chat, <kbd>R</kbd> to reset the view, <kbd>Esc</kbd> to clear a selection, <kbd>?</kbd> for the full list.

### Share
- **Share links** reopen the exact view on any device: the answer, colouring, visual mode, opacity and camera angle. Everything travels in the link's `#fragment`, which never reaches a server.
- **Six colour themes**, monochrome dark by default.

## How the pieces fit

The app is a static React site. The science databases are called directly from the browser
(all of them are free, keyless and CORS-enabled), so their data doesn't pass through an Argus
server; only Co-fold reads RCSB on the server, to build its input. The server code is three Vercel
Edge Functions, the only places keys live:
[`api/analyze.ts`](api/analyze.ts) talks to the LLM, [`api/investigate.ts`](api/investigate.ts) makes
Investigate mode's two LLM calls (the plan, then the write-up; the browser runs the steps in between),
and [`api/cofold.ts`](api/cofold.ts) runs Boltz-2 on NVIDIA's API. Co-fold builds its input on the server: each chain's sequence from RCSB,
cut to the residues the entry has coordinates for, with that chain as a structural template, since
NVIDIA's service predicts without a sequence alignment. The answer comes back numbered like the
entry and streams while Boltz-2 runs (usually 10–60 s).

| Source | Used for | Licence / credit |
|---|---|---|
| NVIDIA Nemotron 3 Super on [Nebius Token Factory](https://tokenfactory.nebius.com) | Answers and Investigate mode | NVIDIA open model, via Token Factory's API |
| [RCSB PDB](https://www.rcsb.org) | Structure files, complex search, entry titles | CC0 |
| [PDBe](https://www.ebi.ac.uk/pdbe/) | SIFTS residue mapping, residue listings, ligands | EMBL-EBI terms of use |
| [UniProt](https://www.uniprot.org) | Curated features, sequences, disease variants | CC BY 4.0 |
| [AlphaFold DB](https://alphafold.ebi.ac.uk) | Predicted models and AlphaMissense scores | CC BY 4.0 |
| [AlphaFill](https://alphafill.eu) | Ligands for AlphaFold models | Hekkelman et al., *Nat Methods* 2023 |
| [ESM Atlas](https://esmatlas.com) | ESMFold predictions | Lin et al., *Science* 2023 |
| [Foldseek](https://search.foldseek.com) | Structural similarity search | van Kempen et al., *Nat Biotechnol* 2024 |
| [PrankWeb](https://prankweb.cz) | P2Rank pocket predictions | Krivák & Hoksza, *J Cheminform* 2018; ELIXIR CZ |
| [STRING](https://string-db.org) | Interaction partners | CC BY 4.0 · Szklarczyk et al., *NAR* 2023 |
| [Boltz-2](https://github.com/jwohlwend/boltz) via [NVIDIA](https://build.nvidia.com/mit/boltz2) | Co-folding: pose, confidence and affinity | MIT · Passaro, Corso, Wohlwend et al., *bioRxiv* 2025 |
| [PubChem](https://pubchem.ncbi.nlm.nih.gov) | Molecule names and SMILES for Co-fold | NCBI · Kim et al., *NAR* 2023 |
| [PLIP](https://plip-tool.biotec.tu-dresden.de) (criteria) | Interaction types and distance and angle thresholds | Salentin et al., *NAR* 2015; Adasme et al., *NAR* 2021 |
| [3Dmol.js](https://3dmol.csb.pitt.edu) | WebGL molecular viewer | BSD-3 · Rego & Koes, *Bioinformatics* 2015 |

AlphaMissense scores are from Cheng et al., *Science* 2023. Predictions shown in Argus (pathogenicity,
pockets, folds, transplanted ligands, co-folded poses and affinities) are research aids, not experimental
results or clinical advice. Predicted affinities in particular are for comparing molecules; tenfold errors are common.

## Tech stack

- **React 19**, **TypeScript** (strict), **Vite 6**
- **Tailwind CSS 3**, compiled at build time; colour themes as CSS variables ([`themes.ts`](themes.ts))
- **3Dmol.js** for the 3D viewer
- **three.js** for the landing page's 3D stage
- **thinking-orbs**, **border-beam** and **metal-fx** (MIT) for the chat's loaders, composer beam and liquid-metal finish
- **Vercel** hosting, three Edge Functions and Web Analytics

## Run locally

**Prerequisites:** Node.js 18 or newer, and a Nebius Token Factory API key ([tokenfactory.nebius.com](https://tokenfactory.nebius.com) → API keys).

```bash
npm install
cp .env.example .env.local   # then paste your NEBIUS_API_KEY into .env.local
npm run dev                  # http://localhost:3000 (the landing page); the app is at /app
```

`npm run dev` also serves `/api/analyze`, `/api/investigate` and `/api/cofold`: a small Vite plugin in [`vite.config.ts`](vite.config.ts)
runs the Edge Functions in-process (streaming included), so local development matches production without the
Vercel CLI. Co-fold appears only when `NVIDIA_NIM_KEY` is set (a free key from [build.nvidia.com](https://build.nvidia.com/mit/boltz2)).
If something else already uses port 3000, run `npm run dev -- --port 3100`.

Other scripts: `npm run typecheck` (TypeScript, strict) and `npm run build` (production build into `dist/`).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEBIUS_API_KEY` | Yes | Nebius Token Factory API key, read only by `api/analyze.ts` and `api/investigate.ts`. On Vercel, set it under Project Settings → Environment Variables. |
| `NEMOTRON_MODEL` | No | Another Token Factory model ID (default `nvidia/nemotron-3-super-120b-a12b`). |
| `NVIDIA_NIM_KEY` | For Co-fold | NVIDIA API key for hosted Boltz-2, read only by `api/cofold.ts`. Without it the Co-fold tool stays hidden. |
| `COFOLD_DAILY_LIMIT` | No | Predictions per day per server instance (default 60). |

The keys are never bundled into the browser: Vite only exposes `VITE_`-prefixed variables to client code.

## Project structure

```
.
├── index.html                      # The landing page, served at / (its scripts and styles in landing/)
├── landing/                        # The landing page: 3D stage (three.js), toolkit previews, answer check
├── public/landing/                 # The landing page's data (structures, KRAS results) and screenshot
├── app.html, index.tsx, index.css  # The app, served at /app
├── App.tsx                         # Workspace layout, resizable panes, shortcuts, share-link loading
├── themes.ts, useTheme.ts          # Colour themes (CSS variables)
├── types.ts                        # Shared types
├── vite.config.ts                  # Vite, the two pages, theme CSS, dev bridge for the Edge Functions
├── vercel.json                     # /app serves app.html
├── tailwind.config.js, postcss.config.js  # Tailwind build
├── docs/screenshot.jpg             # The image above
├── api/
│   ├── analyze.ts                  # Edge Function: Nemotron (Token Factory) call, prompt, validation, limits
│   ├── investigate.ts              # Edge Function: Investigate mode's plan and write-up
│   └── cofold.ts                   # Edge Function: Boltz-2 input from RCSB, NVIDIA call, streaming, limits
├── components/
│   ├── ReasoningEngine.tsx         # Chat, grounding and answer checks, tours, voice
│   ├── chat/
│   │   ├── chatLook.ts             # The chat's look: the default and the four options it was picked from
│   │   ├── Composer.tsx            # Message box: the mode chip, model, mic, send button, border beam
│   │   ├── ComposerMenu.tsx        # The + menu: a sequence file, modes (Investigate, Co-fold), prompts
│   │   ├── ChatLoader.tsx          # Loaders while the AI answers or a tool runs
│   │   ├── MarkedParts.tsx         # "Marked in 3D": an answer's parts, one row each
│   │   ├── ActionReceipt.tsx       # What a request changed in the workspace
│   │   ├── InvestigationCard.tsx   # Investigate mode: the live checklist, then the cited answer
│   │   ├── EmptyState.tsx, PromptLibrary.tsx, ChatBackground.tsx
│   │   └── TweakPanel.tsx          # Live design tweaks (local development, or ?tweaks)
│   ├── ProteinViewer.tsx           # 3Dmol viewer, picking, toolbar, inspector, legends
│   ├── workspace/
│   │   ├── SequenceBar.tsx         # The sequence strip and selecting in it
│   │   ├── StatusBar.tsx           # Identity, selection, hover readout
│   │   ├── InspectorSection.tsx    # Inspector sections and controls
│   │   ├── InspectorPanels.tsx     # Style, focus (within 5 Å) and layers
│   │   ├── CommandPalette.tsx      # Ctrl+K: commands and residue search
│   │   ├── ShortcutSheet.tsx       # The ? reference
│   │   └── ResizeHandle.tsx        # Pane splitters, remembered widths
│   ├── VariantLensPanel.tsx        # AlphaMissense heatmap panel
│   ├── PocketRadarPanel.tsx        # P2Rank pockets panel
│   ├── InteractionsPanel.tsx       # Ligand interactions panel
│   ├── OverlayPanel.tsx            # Overlay: the picker, the panel and its legend
│   ├── SimilarStructuresCard.tsx   # Foldseek results in the chat
│   ├── PartnersCard.tsx            # STRING partners in the chat
│   ├── CofoldMenu.tsx, CofoldCard.tsx  # Co-fold form (toolbar) and result (chat)
│   ├── CompareCard.tsx             # Two co-folded molecules side by side (chat)
│   ├── QuizCard.tsx, ShareButton.tsx, ThemeSwitcher.tsx, Dropdown.tsx
└── services/
    ├── analysisService.ts          # Client for /api/analyze, answer cache, 429 retry
    ├── groundingService.ts         # UniProt/PDBe facts, answer checking and correction
    ├── normalizeAnalysis.ts        # Validates every answer (server and browser)
    ├── variantService.ts           # SIFTS mapping, AlphaMissense, UniProt variants
    ├── alphafoldService.ts         # AlphaFold DB models
    ├── alphafillService.ts         # AlphaFill transplants fitted onto the model on screen
    ├── esmfoldService.ts           # Sequence detection and ESMFold
    ├── foldseekService.ts          # Foldseek search and result grouping
    ├── pocketService.ts            # PrankWeb pockets
    ├── interactionService.ts       # Ligand interactions from coordinates (PLIP criteria)
    ├── overlayService.ts           # Overlay: sequence alignment, the pruned fit, the protein's other entries
    ├── partnerService.ts           # STRING partners, RCSB complexes, interfaces
    ├── cofoldService.ts            # Molecule lookup, Co-fold requests, placing the prediction
    ├── structureModel.ts           # Chains, residues and ligands from a PDB file; the selection
    ├── commands.ts                 # Palette matching, residue queries, shortcut chords
    ├── chatActions.ts              # What the chat can do in the workspace: plain requests, an answer's actions
    ├── quiz.ts                     # Quiz option order (shuffled), right answers, marking
    ├── investigationPlan.ts        # Investigate mode: the tools, and checking the AI's plan and write-up
    ├── investigation.ts            # Investigate mode: running the steps, relating them in 3D
    ├── shareService.ts             # Share-link encoding and validation
    └── http.ts, mmcif.ts, structureFiles.ts, superpose.ts
```

## Security and privacy

The Edge Functions are the only places the keys live. They enforce:

- **Origin check:** only the deployed domains, local development and same-origin requests are served.
- **Rate limits:** 12 questions a minute per visitor; 6 investigations a minute (two LLM calls each); 4 co-folds per 10 minutes and 15 a day per visitor, plus a daily ceiling (`COFOLD_DAILY_LIMIT`). All of these count per server instance, and repeated co-folds are served from a cache. For hard global limits, add a Vercel Firewall rule or [`@upstash/ratelimit`](https://upstash.com/docs/redis/sdks/ratelimit-ts/overview).
- **Input limits:** questions up to 2,000 characters (1,000 for an investigation, whose step results are capped at 7,000); the context and facts the browser sends are capped and sanitised. Co-fold takes up to 1,200 residues, 8 chains and a 60-residue pocket, PDB codes and SMILES only, and builds its own requests from them.
- **Timeouts and clean errors:** an 18-second limit on the LLM call and 4 minutes on a prediction; upstream error details are logged, never returned.
- **Validated output:** every answer is checked against the expected shape before it reaches the page.

Argus has no accounts and stores nothing on a server. Answers are cached in your browser's
`localStorage` to save repeat calls, and share links keep their content in the URL fragment.
Co-fold sends the protein's sequence and the molecule to NVIDIA's API; its predictions stay in
the browser tab that made them. Never commit `.env.local`; it is git-ignored.

## Roadmap

| | |
|---|---|
| **Done** | Grounded and checked answers · Investigate mode · Variant Lens · AlphaFold models and AlphaFill ligands · ESMFold · Foldseek · Pocket Radar · Interactions · Overlay · Partners · Boltz-2 co-folding into a chosen site · Comparing two molecules · The workspace: sequence, selection, inspector, command palette · Share links · Colour themes |
| **Next** | Ranking a small set of molecules against one site |
| **Later** | Mutation stability estimates · classroom features such as saved tours and quiz sets |

## Credits

- Visual language adapted from the developer's portfolio at [raisun.dev](https://raisun.dev): near-black canvas, Inter type and monochrome restraint. The crimson `#c43036` brand lives on as a theme.
- The science comes from the databases and tools listed above. Please cite them if Argus helps your work.

## License

Argus is released under the [MIT License](LICENSE). The data and tools it uses have their own licences
(see the table above); check them before any commercial use.
