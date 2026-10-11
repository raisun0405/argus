import type { ActionResult } from './services/chatActions';
import type { InvestigationState } from './services/investigation';
import type { AnswerChecks } from './services/answerChecks';

export interface Highlight {
  chain: string;
  resi: number[]; // Array of residue numbers
  label?: string; // Optional context label (e.g., "Heme Pocket")
  category?: 'active_site' | 'binding_site' | 'ligand' | 'substrate' | 'metal' | 'cofactor' | 'mutation' | 'other';
}

export interface AtomSpec {
  chain: string;
  resi: number;
  atom?: string; // Optional specific atom name (e.g., "CA", "FE", "SG"). If omitted, defaults to CA or Centroid.
}

export interface Measurement {
  start: AtomSpec;
  end: AtomSpec;
  label?: string; // Optional label describing the connection
}

export interface Quiz {
  question: string;
  options: string[];
  correctAnswerIndex: number; // The right option (the first of them, when several are right)
  correctAnswerIndices?: number[]; // Every right option, when there are several ("select all that apply")
  explanation: string;
  answerHighlights?: Highlight[]; // Highlights to show/zoom to when the user answers correctly
}

export interface TourStep {
  text: string; // The narration text for this step
  focus: Highlight[]; // The specific residues to look at during this step
}

export interface ProteinAnalysis {
  pdbId: string;
  title: string;
  summary: string;
  highlights: Highlight[];
  measurements?: Measurement[];
  quiz?: Quiz;
  tour?: TourStep[]; // Optional cinematic tour
  actions?: string[]; // What the answer changes in the viewer ("shape:surface", "tool:pockets"; see services/chatActions)
}

export interface Message {
  id?: number; // Set on messages updated after they appear (an answer's actions report back when they've run)
  role: 'user' | 'assistant';
  content: string;
  actionResults?: ActionResult[]; // What the chat changed in the workspace, as it actually happened
  data?: ProteinAnalysis; // Only assistant messages might have structured data
  checks?: AnswerChecks; // What the app checked in the AI's answer before showing it, and what it fixed first
  quizAfterTour?: boolean; // The answer's tour started by itself: its quiz waits until the tour has played
  shared?: boolean; // The answer came from a share link, not from the AI in this session
  welcome?: boolean; // The greeting before the first question (the welcome screen replaces it)
  notice?: 'error'; // Something went wrong: shown as a notice, not as an answer
  retry?: string; // The question to send again from that notice
  similar?: { result: SimilarSearchResult; origin: ProteinAnalysis }; // Foldseek results card
  partners?: { result: PartnerSearchResult; origin: ProteinAnalysis }; // STRING interaction partners card
  cofold?: { result: CofoldResult; origin: ProteinAnalysis }; // Boltz-2 co-folding card
  compare?: { result: CofoldResult; origin: ProteinAnalysis }; // Two molecules co-folded into the same structure (result.compare is set)
  investigation?: InvestigationState; // Investigate mode: the plan, its steps as they run, the write-up
}

// --- Co-folding (Boltz-2: how a small molecule binds, and how strongly) ---

export type CofoldSource =
  | { kind: 'pdb'; pdbId: string; chains: string[] } // Experimental entry: the chains to predict
  | { kind: 'alphafold'; accession: string }
  | { kind: 'sequence'; sequence: string }; // An ESMFold prediction's sequence

export interface CofoldPocket {
  label: string; // "Pocket 2 (37%)", "Where MK1 binds"
  residues: { chain: string; resi: number; icode: string }[]; // In the structure's own numbering
}

export interface CofoldRequest {
  source: CofoldSource;
  structureId: string; // Structure on screen, compared with and returned to: "1HSG", "AF-P69905-F1", "ESM-..."
  proteinName: string; // For titles: "HIV-1 protease"
  ligandText: string; // As typed or picked: "indinavir", "MK1", a SMILES
  entryLigands: string[]; // PDB codes of the ligands in the structure: one of these is used exactly
  cofactors: string[]; // Cofactors and metals kept from the structure (PDB codes, one per copy)
  pocket?: CofoldPocket; // Where the molecule should bind; Boltz-2 decides when absent
}

export interface ResolvedLigand {
  name: string; // "Indinavir", or "your molecule"
  code?: string; // PDB chemical component ID, when there is one ("MK1")
  smiles?: string;
  heavyAtoms?: number;
  source: 'pdb' | 'pubchem' | 'smiles';
}

export interface CofoldContact {
  chain: string;
  resi: number;
  icode: string;
  resn: string; // Three-letter residue name
  distance: number; // Closest heavy atom to the ligand, Å
}

export interface CofoldScores {
  confidence: number | null; // Boltz-2's ranking score: 0.8 complex pLDDT + 0.2 ipTM
  ptm: number | null;
  iptm: number | null;
  ligandIptm: number | null; // Confidence in the protein-ligand interface, 0-1
  proteinIptm: number | null;
  plddt: number | null; // Whole complex, 0-1
  iplddt: number | null;
  pde: number | null; // Å
  ipde: number | null;
}

export interface CofoldResult {
  id: string; // "COFOLD-XXXXXXX": what the viewer loads
  request: CofoldRequest;
  ligand: ResolvedLigand;
  pdb: string; // In the frame, chain IDs and residue numbers of the structure on screen
  ligandChain: string; // Predicted ligand: residue 1 of this chain
  ligandResn: string; // Its residue name: the PDB code, or LIG for a SMILES
  cofactors: { chain: string; resn: string }[]; // Kept cofactors in the prediction
  reference?: {
    chain: string; resn: string; from: string; centroidDistance: number; sharedContacts: number; crystalContacts: number;
    interactionsShared?: number; interactionsTotal?: number; // Crystal ligand's specific interactions (H-bonds, salt bridges, stacking, metals) the prediction reproduces
  }; // The same ligand in the experimental structure, added for comparison
  interactions?: { type: string; partners: string[] }[]; // The predicted pose's interactions by type ("hbond": ["Asp189", ...])
  scores: CofoldScores;
  affinity: { log10Ic50: number; binderProbability: number } | null; // log10(IC50 in µM); probability of being a binder
  contacts: CofoldContact[]; // Residues within 4 Å of the predicted ligand, closest first
  proteinRmsd: number | null; // Predicted protein vs the structure on screen (Cα, Å)
  meanPlddt: number; // Protein, 0-100
  template: string | null; // Structure that shaped the protein ("1HSG"), null when predicted from sequence alone
  compare?: CofoldComparison; // Set on a comparison: this result's molecule is the first, `other` the second
  pocket?: { label: string; residues: number; touched: number; applied: boolean }; // The pocket asked for: residues sent, how many the pose touches, whether Boltz-2 took the hint
  seconds: number;
}

/** Two molecules co-folded into the same structure, compared residue by residue. */
export interface CofoldComparison {
  other: CofoldResult; // The second molecule's prediction, as made on its own
  chain: string; // The second molecule in the combined complex: residue 1 of this chain
  reference: 'a' | 'b' | null; // Whose crystal pose the complex shows (grey), if either matches one
  centroidDistance: number; // Å between the two predicted molecules
  shared: CofoldContact[]; // Residues within 4 Å of both (distances from the first)
  onlyA: CofoldContact[];
  onlyB: CofoldContact[];
  overlap: number; // Shared over all residues either touches (Jaccard), 0-1
  // Residues making a specific interaction (H-bond, salt bridge, stacking, halogen, metal) with either
  fingerprint: { chain: string; resi: number; icode: string; resn: string; a: string[]; b: string[] }[];
}

// --- Interaction partners (STRING) and solved complexes (RCSB PDB) ---

export interface PartnerQuery {
  accession: string; // UniProt accession of the protein on screen
  label: string; // How the protein is named before STRING answers, e.g. "P53_HUMAN"
  structureKeys: string[]; // Structures the result belongs to (chat facts): ["1TUP"] or ["AF-P04637-F1", "1TUP"]
  chainsHere: Record<string, string[]>; // UniProt accession -> author chains in the structure on screen
}

export interface InteractionPartner {
  name: string; // STRING's name, usually the gene symbol ("MDM2"); "HBA1/HBA2" when two genes share a protein
  accession?: string; // UniProt accession, when it could be resolved
  description?: string; // UniProt protein name
  score: number; // STRING combined confidence, 0-1
  evidence: string[]; // Strongest evidence channels: "Experiments", "Databases", "Literature", "Co-expression", "Gene context"
  complexes?: number; // PDB entries holding both proteins (displayable in the viewer); undefined when not checked
  bestComplex?: string; // The best-resolved of them
  bestComplexTitle?: string;
  bestComplexResolution?: number; // Å
}

export interface PartnerSearchResult {
  query: PartnerQuery;
  name: string; // STRING's name for the query protein, e.g. "TP53"
  taxId: number;
  partners: InteractionPartner[]; // Best first
  stringUrl: string; // The protein's network on string-db.org
}

// --- Similar structures (Foldseek) ---

export interface SimilarSearchQuery {
  label: string; // e.g. "1TUP chain A" or "AF-P04637-F1"
  structureId: string; // Structure being searched
  pdb: string; // Single-chain PDB text sent to Foldseek
  excludePdbIds: string[]; // The query entry itself
  excludeAccessions: string[]; // UniProt accessions of the query protein
}

export interface SimilarStructureHit {
  structureId: string; // What the viewer loads: "1LYZ" or "AF-P61626-F1"
  label: string; // Display ID: "1LYZ · A" or "P61626"
  name: string; // Protein name (AlphaFold DB) or entry title (PDB)
  organism?: string;
  probability: number; // Foldseek homology probability, 0-1
  evalue: number;
  identity: number; // Sequence identity to the query, %
  coverage: number; // Fraction of the query aligned, 0-1
  members: number; // Hits collapsed into this row (orthologs / near-duplicates)
  identityRange: [number, number]; // Min-max identity across those members
  sameProtein?: boolean; // The query's own protein family (other species)
}

export interface SimilarSearchResult {
  queryLabel: string;
  queryStructureId: string;
  proteins: SimilarStructureHit[]; // AlphaFold DB (Swiss-Prot), one row per protein family name
  experimental: SimilarStructureHit[]; // PDB entries of other proteins
  sameProteinStructures: number; // PDB hits of the query protein or close orthologs (≥80% identity), not listed
  totalHits: number;
}

// --- Variant Lens (AlphaMissense pathogenicity mapped onto the structure) ---

export type AmClass = 'likely_benign' | 'ambiguous' | 'likely_pathogenic';

export interface KnownVariant {
  position: number; // UniProt residue number
  wt: string; // Wild-type residue (one-letter)
  alt: string; // Substituted residue (one-letter)
  tags: string[]; // Disease acronyms / variant names from UniProt, e.g. ["LFS"], ["SKCA"], ["Hb C"]
  diseaseNames: string[]; // Full disease names resolved from UniProt disease comments
  diseaseLinked: boolean;
  amScore?: number; // AlphaMissense score for this exact substitution
}

export interface ResidueVariant {
  accession: string; // UniProt accession, e.g. "P04637"
  protein: string; // Display name: gene symbol if known, else UniProt identifier
  position: number; // UniProt residue number
  wt: string; // UniProt wild-type residue (one-letter)
  mean: number; // Mean AlphaMissense pathogenicity over all 19 substitutions (0-1)
  amClass: AmClass; // Class of the mean, using the AlphaMissense thresholds
  worstAlt: string; // Most damaging substitution at this position
  worstScore: number;
  known: KnownVariant[]; // UniProt natural variants at this position
}

export interface VariantSite {
  chain: string; // Author chain ID (matches 3Dmol atom.chain)
  resi: number; // Author residue number (matches 3Dmol atom.resi)
  icode: string; // Insertion code, '' when none
}

export interface VariantProtein {
  accession: string;
  identifier: string; // UniProt entry name, e.g. "P53_HUMAN"
  gene?: string;
  proteinName?: string;
  chains: string[]; // Author chains of this entry mapped to the protein
  available: boolean; // AlphaMissense predictions found for this protein
  mappedResidues: number; // Observed residues mapped to a UniProt position with predictions
  pathogenicResidues: number; // ...of which the mean score is likely pathogenic
  knownVariants: KnownVariant[]; // UniProt natural variants at observed positions, most relevant first
}

export interface VariantLensData {
  structureId: string; // Lower-case PDB ID, or AlphaFold model ID ("AF-P04637-F1"), the data was built for
  proteins: VariantProtein[]; // Human proteins in the entry
  residues: Record<string, ResidueVariant>; // Keyed by `${chain}|${rescode}` (see variantKey)
  mismatches: Record<string, string>; // Same key -> residue in the structure when it differs from UniProt
  sites: Record<string, VariantSite[]>; // `${accession}|${position}` -> observed residues in the structure
  skipped: { accession: string; identifier: string }[]; // Non-human proteins (no AlphaMissense data)
}

// --- Pocket Radar (ligand-binding pockets predicted by P2Rank, via PrankWeb) ---

export type PocketModel = 'conservation' | 'quick'; // PrankWeb's default conservation-aware model, or the faster one without

export interface PocketResidue {
  chain: string; // Author chain ID (matches 3Dmol atom.chain)
  resi: number; // Author residue number (matches 3Dmol atom.resi)
  icode: string; // Insertion code, '' when none
  aa?: string; // One-letter residue type, when PrankWeb reports it
}

export interface Pocket {
  rank: number; // 1 = most likely binding site
  probability: number; // P2Rank's calibrated probability that this is a ligand-binding site, 0-1
  residues: PocketResidue[]; // Residues lining the pocket, sorted by chain and number
  center: [number, number, number] | null;
  ligands: string[]; // Ligands bound in this pocket in the loaded file, e.g. ["MK1"]; [] for predicted models
}

export interface PocketPrediction {
  structureId: string; // Viewer structure the prediction belongs to: "1HSG" or "AF-P68871-F1"
  model: PocketModel;
  p2rankVersion?: string;
  pockets: Pocket[]; // Every pocket P2Rank found, best first
  url: string; // The same prediction on prankweb.cz
}

// Global declaration for 3Dmol.js loaded via CDN and SpeechRecognition
declare global {
  interface Window {
    $3Dmol: any;
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}
