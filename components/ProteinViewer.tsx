
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Highlight, Measurement, AtomSpec, VariantLensData, VariantSite, SimilarSearchQuery, PocketPrediction, PartnerQuery, CofoldRequest, CofoldResult } from '../types';
import { extractChain, pickSearchChain, proteinChains } from '../services/foldseekService';
import Dropdown from './Dropdown';
import VariantLensPanel, { DnaIcon, VariantLensStatus } from './VariantLensPanel';
import { THEMES } from '../themes';
import { useTheme } from '../useTheme';
import {
  AM_CLASS_LABEL,
  AM_NO_DATA_COLOR,
  amColor,
  fetchSiftsMapping,
  loadUniProtResidueMap,
  loadVariantLens,
  normalizeStructureId,
  variantKey,
  type SiftsAccession,
} from '../services/variantService';
import {
  PLDDT_BANDS,
  alphaFoldId,
  fetchAlphaFoldStructure,
  parseAlphaFoldId,
  plddtBand,
  plddtColor,
  plddtValue,
  type AlphaFoldModel,
} from '../services/alphafoldService';
import { getPrediction, isEsmFoldId, type EsmPrediction } from '../services/esmfoldService';
import PocketRadarPanel, { RadarIcon, type PocketRadarState } from './PocketRadarPanel';
import { POCKET_COLORS, loadPockets, pocketKey, pocketsSupported, shownPockets, withPocketLigands } from '../services/pocketService';
import { fetchPdbFile } from '../services/structureFiles';
import { FIRST_TRANSPLANT_RESIDUE, LIGAND_NAMES, loadAlphaFill, type AlphaFillResult } from '../services/alphafillService';
import type { SharedViewState } from '../services/shareService';
import { COMPARE_COLORS, cofoldAvailable, cofoldProteinName, cofoldSetup, cofoldSourceKind, formatIc50, getCofold, isCofoldId } from '../services/cofoldService';
import CofoldMenu, { type CofoldChoice } from './CofoldMenu';
import { INTERACTION_LABELS, analyzeInteractions, hasLigands, partnerLabel, type LigandSite } from '../services/interactionService';
import InteractionsPanel, { INTERACTION_COLORS, InteractionsIcon } from './InteractionsPanel';
import OverlayPanel, { OverlayIcon, OverlayLegend, OverlayMenu, OverlayPicker, type OverlayChoice, type OverlayColour, type OverlayState } from './OverlayPanel';
import { CUTOFF as OVERLAY_CUTOFF, PAIR_COLORS, computeOverlay, distanceColor, overlayName, rememberOverlay } from '../services/overlayService';
import { loadStructureText } from '../services/investigation';
import {
  applyPick,
  centerOf,
  emptySelection,
  parseStructure,
  residueKey,
  residueLabel,
  selectChain,
  toAtomSpec,
  type Selection as ResidueSelection,
  type StructureModel,
} from '../services/structureModel';
import SequenceBar, { type SequenceMark } from './workspace/SequenceBar';
import StatusBar from './workspace/StatusBar';
import InspectorSection, { Switch } from './workspace/InspectorSection';
import { FocusSection, LayersSection, StyleSection, type Layer } from './workspace/InspectorPanels';
import ResizeHandle, { usePaneSize } from './workspace/ResizeHandle';
import PhoneSheet, { SHEET_HEIGHT, type SheetSize } from './workspace/PhoneSheet';
import { actionDone, actionFailed, type ActionResult, type ChatAction } from '../services/chatActions';

/** Actions the chat asked for: run once the structure they belong to (target, when set) is on screen. */
export interface ActionRequest { id: number; target?: string; actions: ChatAction[] }

interface ProteinViewerProps {
  pdbId: string;
  title: string;
  highlights: Highlight[];
  measurements?: Measurement[];
  tourHighlights?: Highlight[]; // Optional override for cinematic tours
  onFindSimilar?: (query: SimilarSearchQuery) => void; // Foldseek search, run as a chat turn
  onFindPartners?: (query: PartnerQuery) => void; // STRING interaction partners, run as a chat turn
  onCofold?: (request: CofoldRequest, compareWith?: string) => void; // Boltz-2 co-folding, run as a chat turn; with a second molecule, a comparison
  isChatBusy?: boolean; // The chat is answering, folding or searching; "Find similar", "Partners" and "Co-fold" wait
  initialView?: SharedViewState; // From a share link: how the first structure is shown
  viewStateRef?: React.MutableRefObject<(() => SharedViewState) | null>; // Read by "Share"
  onOpenPalette?: () => void; // The status bar's search button and ⌘K
  onAsk?: (question: string) => void; // Send a question about the selection to the chat
  commandsRef?: React.MutableRefObject<WorkspaceCommands | null>; // What the palette and shortcuts can drive
  onShowChat?: () => void; // Set while the chat is folded away: the header offers to bring it back
  subtitle?: string | null; // The tour's narration, shown over the bottom of the canvas
  actionRequest?: ActionRequest | null; // Asked for in the chat ("surface", "open pockets", or an answer's actions)
  onActionsDone?: (id: number, results: ActionResult[]) => void; // ...and what each of them actually did
  phone?: boolean; // One pane at a time: the tools and the inspector rise from the bottom instead of sitting beside the canvas
  headerStart?: React.ReactNode; // At the header's left (a phone's switch between chat and structure)
  tourControls?: { paused: boolean; onPause: () => void; onStop: () => void }; // A phone's tour buttons, beside the narration
}

/** What the command palette and the keyboard can do to the workspace. */
export interface WorkspaceCommands {
  setVizStyle: (style: VizStyle) => void;
  setColorScheme: (scheme: string) => void;
  resetView: () => void;
  toggleInspector: () => void;
  clearSelection: () => void;
  selectResidues: (query: { chain?: string; from: number; to: number }) => boolean;
  /** Select an answer's highlights and bring them into view (false if none are in this structure). */
  focusHighlights: (highlights: Highlight[]) => boolean;
  openTool: (tool: 'pockets' | 'interactions' | 'pathogenicity' | 'overlay' | 'cofold' | 'partners' | 'similar' | 'alphafold') => void;
  available: (tool: string) => boolean;
  structureId: string;
  chains: string[];
}

type VizStyle = 'cartoon' | 'stick' | 'sphere' | 'surface';
type ColorScheme = 'element' | 'rainbow' | 'hydrophobicity' | 'chain' | 'residue' | 'pathogenicity' | 'confidence' | 'pockets' | 'interactions' | 'overlay';
type OverlayScheme = 'pathogenicity' | 'pockets' | 'interactions' | 'overlay';

// Colourings that come with their own panel (Variant Lens, Pocket Radar, Interactions, Overlay); closing one returns to the colouring before it
const isOverlayScheme = (scheme: ColorScheme): scheme is OverlayScheme => scheme === 'pathogenicity' || scheme === 'pockets' || scheme === 'interactions' || scheme === 'overlay';

const AMINO_ACID_MAP: { [key: string]: string } = {
  ALA: 'Alanine', ARG: 'Arginine', ASN: 'Asparagine', ASP: 'Aspartic Acid',
  CYS: 'Cysteine', GLN: 'Glutamine', GLU: 'Glutamic Acid', GLY: 'Glycine',
  HIS: 'Histidine', ILE: 'Isoleucine', LEU: 'Leucine', LYS: 'Lysine',
  MET: 'Methionine', PHE: 'Phenylalanine', PRO: 'Proline', SER: 'Serine',
  THR: 'Threonine', TRP: 'Tryptophan', TYR: 'Tyrosine', VAL: 'Valine',
  HEM: 'Heme', HOH: 'Water', SO4: 'Sulfate', PO4: 'Phosphate', ADP: 'ADP', ATP: 'ATP'
};


// How far the rest of the structure fades behind an answer's highlights. 30% left a grey ghost with
// the highlights floating in it; at 100% highlights inside the structure vanish behind its ribbons.
// 65% keeps the shape readable and the highlights visible through it.
const HIGHLIGHT_FADE = 65;

// Highlights with more residues than this are drawn as sticks without the ball overlay
const MAX_BALL_RESIDUES = 8;

// Overlay: the line drawn for the structure laid over, brighter than the "no partner" grey on dark
// themes and darker than it on light ones
const OVERLAY_LINE = { dark: '#f4f4f5', light: '#3f3f46' };

// Colour legends share the Variant Lens panel's bottom-left slot and card style; only one shows at a time
// Phones: a smaller card in the corner, and none while the sheet is up (the colour is explained there)
const LEGEND_CARD = 'argus-legend absolute bottom-4 left-4 max-md:bottom-2.5 max-md:left-2.5 z-20 w-56 max-md:w-48 max-w-[calc(100%-2rem)] bg-canvas/90 backdrop-blur-md border border-line rounded-xl shadow-overlay p-3 max-md:p-2.5 animate-argus-fade-in pointer-events-none';

const ProteinViewer: React.FC<ProteinViewerProps> = ({ pdbId, title, highlights, measurements = [], tourHighlights, onFindSimilar, onFindPartners, onCofold, isChatBusy = false, initialView, viewStateRef, onOpenPalette, onAsk, commandsRef, onShowChat, subtitle, actionRequest, onActionsDone, phone = false, headerStart, tourControls }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [viewerInstance, setViewerInstance] = useState<any>(null);
  const [pdbContent, setPdbContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0); // "Try again" after a failed download
  const [tooltip, setTooltip] = useState<{ text: string, subtext?: string, x: number, y: number } | null>(null);

  // Colour theme: 3Dmol draws with real colours, so it needs the palette values
  const [themeId] = useTheme();
  const theme = THEMES[themeId];
  
  // UI State (a share link sets how its structure is first shown)
  const [vizStyle, setVizStyle] = useState<VizStyle>(() => (initialView?.vizStyle as VizStyle | undefined) ?? 'cartoon');
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => (initialView?.colorScheme as ColorScheme | undefined) ?? 'element');
  const [structureOpacity, setStructureOpacity] = useState<number>(100);

  // Visibility States
  const [showActiveSiteBalls, setShowActiveSiteBalls] = useState(true); 
  const [showLigands, setShowLigands] = useState(true);
  const [showSubstrates, setShowSubstrates] = useState(true);
  const [showMetals, setShowMetals] = useState(true);

  const [stylingTrigger, setStylingTrigger] = useState(0);

  // Variant Lens (AlphaMissense pathogenicity heatmap)
  const [variantLens, setVariantLens] = useState<{ status: VariantLensStatus; data?: VariantLensData; error?: string }>({ status: 'idle' });
  // UniProt proteins in the PDB entry (SIFTS); tagged with the entry so they never outlive it
  const [entryProteinList, setEntryProteinList] = useState<{ pdbId: string; proteins: SiftsAccession[] }>({ pdbId: '', proteins: [] });
  const entryProteins = entryProteinList.pdbId === pdbId.toUpperCase() ? entryProteinList.proteins : [];
  const [focusSite, setFocusSite] = useState<(VariantSite & { label: string }) | null>(null);
  // Panels opened from the toolbar fold on phones (openOverlay); one restored from a share link does too
  const [isLensCollapsed, setIsLensCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  const [lensRetry, setLensRetry] = useState(0);
  const schemeBeforeOverlay = useRef<ColorScheme>('element');
  const lensAutoKey = useRef<string | null>(null);

  // Pocket Radar (P2Rank ligand-binding pockets via PrankWeb)
  const [pockets, setPockets] = useState<PocketRadarState>({ status: 'idle' });
  const [focusPocket, setFocusPocket] = useState<number | null>(null); // Rank of the pocket picked in the panel
  const [isPocketsCollapsed, setIsPocketsCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  const [pocketRetry, setPocketRetry] = useState(0);

  // The workspace: what the file contains, what is picked, and how the columns are arranged
  const [selection, setSelection] = useState<ResidueSelection>(emptySelection);
  const [activeChain, setActiveChain] = useState<string>('');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [inspectorWidth, setInspectorWidth] = usePaneSize('argus-inspector-width', 248);
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 1023px)').matches);
  const [openSections, setOpenSections] = useState<string[]>(['focus', 'style']);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [foldedTools, setFoldedTools] = useState<string[]>([]); // Docked tools folded to their header
  const toggleTool = (id: string) => setFoldedTools(folded => (folded.includes(id) ? folded.filter(f => f !== id) : [...folded, id]));
  const toggleSection = (id: string) => setOpenSections(open => (open.includes(id) ? open.filter(s => s !== id) : [...open, id]));
  const openSection = (id: string) => setOpenSections(open => (open.includes(id) ? open : [...open, id]));

  // Interactions (PLIP-style contacts of a ligand, computed here from the coordinates)
  const [interactionKey, setInteractionKey] = useState<string | null>(null); // Ligand picked in the panel
  const [focusInteraction, setFocusInteraction] = useState<number | null>(null); // Index into its interactions
  const [isInteractionsCollapsed, setIsInteractionsCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);

  // Overlay: another structure of the same protein laid over this one, one chain onto one chain. It is
  // its own 3Dmol model, added after the hover and click handlers and under a chain ID this structure
  // doesn't use, so selections, tools and the chat's actions never reach it.
  const [overlayWith, setOverlayWith] = useState<{ id: string; on: string } | null>(null); // What is laid over, on which structure
  const [overlayFile, setOverlayFile] = useState<{ id: string; pdb?: string; error?: string } | null>(null);
  const [overlayChains, setOverlayChains] = useState<{ main?: string; other?: string }>({}); // Picked in the panel
  const [overlayColour, setOverlayColour] = useState<OverlayColour>('distance');
  const [overlayShown, setOverlayShown] = useState(true);
  const [overlayChoosing, setOverlayChoosing] = useState(false); // The panel's picker is open
  const [overlayRetry, setOverlayRetry] = useState(0);
  const overlayModelRef = useRef<{ model: any; pdb: string } | null>(null); // The model in the viewer, and the file it holds

  // AlphaFold model view
  const [afToggle, setAfView] = useState<{ accession: string; fromPdb: string } | null>( // Opened from an experimental entry
    () => (initialView?.alphaFold ? { accession: initialView.alphaFold, fromPdb: pdbId.toUpperCase() } : null)
  );
  const afView = afToggle && afToggle.fromPdb === pdbId.toUpperCase() ? afToggle : null; // Never outlives its entry
  const [afModel, setAfModel] = useState<AlphaFoldModel | null>(null);
  const [afResidueMap, setAfResidueMap] = useState<Record<string, number> | null>(null); // Entry residue -> UniProt position
  const [afNotice, setAfNotice] = useState<string | null>(null);
  const [toolMenu, setToolMenu] = useState<'alphafold' | 'partners' | 'cofold' | 'overlay' | null>(null); // Toolbar menu that is open
  const toolsRef = useRef<HTMLDivElement>(null); // Toolbar plus its menus (outside clicks close the menu)
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const titleIdRef = useRef<HTMLSpanElement>(null);
  const [compactTools, setCompactTools] = useState(false); // Icons only: the labels don't fit
  const contentIdRef = useRef<string | null>(null); // Which structure pdbContent currently holds

  // A phone's sheet (PhoneSheet): the list of tools, a tool's menu (toolMenu), or the inspector
  const [phoneSheet, setPhoneSheet] = useState<'tools' | 'inspector' | null>(null);
  const [sheetSize, setSheetSize] = useState<SheetSize>('half');
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetForToolRef = useRef(false); // Opened by a tool's panel, so it goes when the tool does
  const sheetOpen = phone && (phoneSheet !== null || toolMenu !== null);
  const closeSheet = () => {
    setPhoneSheet(null);
    setToolMenu(null);
    sheetForToolRef.current = false;
  };
  useEffect(() => {
    if (!phone) closeSheet();
  }, [phone]);
  // The inspector: a column beside the canvas, or on a phone the sheet
  const showInspector = (open: boolean) => {
    if (!phone) return setInspectorOpen(open);
    setToolMenu(null);
    setPhoneSheet(open ? 'inspector' : null);
    if (open) setSheetSize('half');
    sheetForToolRef.current = false;
  };

  // A share link's view applies to the structure it names, once: its AlphaFold switch survives the
  // first "new answer" reset, its colouring isn't replaced by the automatic confidence colouring,
  // and its camera replaces the automatic zoom
  const initialAccession = initialView?.alphaFold ?? parseAlphaFoldId(pdbId);
  const sharedStructureRef = useRef<string | null>( // The structure ID the link's view belongs to
    initialView ? (initialAccession ? alphaFoldId(initialAccession) : pdbId.toUpperCase()) : null
  );
  // The entry whose AlphaFold switch came from the link (a value, not a one-shot flag: React's
  // development mode runs mount effects twice)
  const sharedAfEntryRef = useRef<string | null>(initialView?.alphaFold ? pdbId.toUpperCase() : null);
  const keepSharedSchemeRef = useRef(Boolean(initialView?.colorScheme));
  const pendingCameraRef = useRef<number[] | null>(initialView?.camera ?? null);
  const sharedHighlightsRef = useRef(initialView ? highlights : null); // The link's answer, while it is on screen

  // AlphaFill: ligands copied into the AlphaFold model on screen from related PDB structures
  const [alphaFill, setAlphaFill] = useState<AlphaFillResult | null>(null);
  const afBasePdbRef = useRef<string | null>(null); // The AlphaFold DB file before the ligands are added
  const skipZoomRef = useRef(false); // Adding the ligands rebuilds the model; the camera stays where it is
  const framedStructureRef = useRef<string | null>(null); // The structure the camera has already given its whole view
  const framedContentRef = useRef<string | null>(null); // ...and the file it was showing then

  const [esmModel, setEsmModel] = useState<EsmPrediction | null>(null); // ESMFold prediction on screen
  const isEsm = isEsmFoldId(pdbId); // A sequence the user pasted, folded with ESMFold
  const [cofoldModel, setCofoldModel] = useState<CofoldResult | null>(null); // Boltz-2 co-folded complex on screen
  const isCofold = isCofoldId(pdbId);
  const [cofoldReady, setCofoldReady] = useState(false); // The server can co-fold (it has a key)

  const propAccession = parseAlphaFoldId(pdbId); // The answer itself chose an AlphaFold model
  const afAccession = afView?.accession ?? propAccession; // AlphaFold model on screen, if any
  const structureId = afAccession ? alphaFoldId(afAccession) : pdbId.toUpperCase();
  const isPredicted = Boolean(afAccession) || isEsm || isCofold;
  const predictedModelId = afModel?.entryId ?? esmModel?.id ?? cofoldModel?.id; // Drives the automatic confidence colouring
  const prediction = afModel
    ? { source: 'AlphaFold', meanPlddt: afModel.meanPlddt, fractionVeryLow: afModel.fractionVeryLow }
    : esmModel
      ? { source: 'ESMFold', meanPlddt: esmModel.meanPlddt, fractionVeryLow: esmModel.fractionVeryLow }
      : cofoldModel
        ? { source: 'Boltz-2', meanPlddt: cofoldModel.meanPlddt, fractionVeryLow: undefined }
        : null;
  const lensAvailable = isPredicted ? afModel?.taxId === 9606 : entryProteins.some(p => p.isHuman);

  // Optimization Refs
  const surfaceIdRef = useRef<number | null>(null);
  const prevVizStyle = useRef<VizStyle>(vizStyle);
  const prevColorScheme = useRef<ColorScheme>(colorScheme);
  const prevPdbContent = useRef<string | null>(null);
  const prevVariantData = useRef<VariantLensData | null>(null);
  const prevPocketData = useRef<PocketPrediction | null>(null);
  const prevOverlay = useRef<{ result: unknown; colour: OverlayColour }>({ result: null, colour: 'distance' });
  const prevThemeId = useRef<string | null>(null);

  // Pockets drawn on the structure, and which of them each residue lines (the better-ranked one if two overlap).
  // On an AlphaFold model the ligands (AlphaFill) arrive after the pockets, so they are named again then.
  const pocketBase = pockets.status === 'ready' && pockets.data?.structureId === pocketKey(structureId) ? pockets.data : null;
  const pocketData = useMemo(
    () => (pocketBase && pdbContent && alphaFill?.transplants.length ? withPocketLigands(pocketBase, pdbContent) : pocketBase),
    [pocketBase, pdbContent, alphaFill]
  );
  const pocketView = useMemo(() => {
    const shown = pocketData ? shownPockets(pocketData) : [];
    const byResidue = new Map<string, number>(); // variantKey -> index into shown (and POCKET_COLORS)
    shown.forEach((pocket, i) => pocket.residues.forEach(r => {
      const key = variantKey(r.chain, r.resi, r.icode);
      if (!byResidue.has(key)) byResidue.set(key, i);
    }));
    return { shown, byResidue };
  }, [pocketData]);

  // The structure as data: the sequence strip, selection, layers and focus panel all read this one parse
  const model: StructureModel | null = useMemo(() => (pdbContent ? parseStructure(pdbContent) : null), [pdbContent]);

  // The sequence strip shows one chain; follow the answer's chain when a new structure arrives
  useEffect(() => {
    if (!model || model.chains.length === 0) return;
    setActiveChain(current => {
      if (model.chains.some(c => c.chain === current)) return current;
      const highlighted = activeHighlights.find(h => model.chains.some(c => c.chain === h.chain));
      return highlighted?.chain ?? model.chains[0].chain;
    });
  }, [model]);

  // The click handler is registered once per model build, so it reads the latest picker through a ref
  const pickResidueRef = useRef<(key: string, modifiers?: { toggle?: boolean; range?: boolean }) => void>(() => {});

  // Picking a residue, from the 3D view or the sequence strip
  const pickResidue = (key: string, modifiers: { toggle?: boolean; range?: boolean } = {}) => {
    if (!model) return;
    setSelection(current => applyPick(current, model, key, modifiers));
    openSection('focus');
  };
  const pickRange = (keys: string[]) => {
    setSelection(current => ({ keys: new Set([...current.keys, ...keys]), focus: keys[keys.length - 1] ?? current.focus }));
    openSection('focus');
  };
  const pickChain = (chain: string) => {
    if (!model) return;
    setSelection(selectChain(model, chain));
    openSection('focus');
  };
  pickResidueRef.current = pickResidue;
  const clearSelection = () => setSelection(emptySelection());
  const zoomToSelection = () => {
    if (!viewerInstance || selection.keys.size === 0) return;
    try {
      viewerInstance.zoomTo(toAtomSpec(selection.keys), 800, true);
    } catch (e) {}
  };

  // Interactions: every ligand's contacts, computed only while the panel is open (a co-folded complex's
  // added crystal pose is not part of it). The ligand shown: the one picked, else a co-folded ligand,
  // a ligand the answer highlights, or the largest.
  const interactionSkip = cofoldModel?.reference?.chain ?? '';
  const ligandsPresent = useMemo(() => (pdbContent ? hasLigands(pdbContent, interactionSkip ? [interactionSkip] : []) : false), [pdbContent, interactionSkip]);
  const interactionSites = useMemo(
    () => (colorScheme === 'interactions' && pdbContent ? analyzeInteractions(pdbContent, interactionSkip ? [interactionSkip] : []) : []),
    [colorScheme, pdbContent, interactionSkip]
  );
  const interactionNames = useMemo(
    () => (cofoldModel
      ? {
          [`${cofoldModel.ligandChain}|1|`]: cofoldModel.ligand.name,
          ...(cofoldModel.compare ? { [`${cofoldModel.compare.chain}|1|`]: cofoldModel.compare.other.ligand.name } : {}),
        }
      : undefined),
    [cofoldModel]
  );
  // A comparison shows both molecules; either can be hidden (never both), as in docking viewers
  const [compareHidden, setCompareHidden] = useState<{ a: boolean; b: boolean }>({ a: false, b: false });
  useEffect(() => {
    setCompareHidden({ a: false, b: false });
    if (cofoldModel?.compare) openSection('compare');
  }, [cofoldModel?.id]);
  const selectedSite: LigandSite | null = useMemo(() => {
    if (interactionSites.length === 0) return null;
    const picked = interactionSites.find(s => s.key === interactionKey);
    if (picked) return picked;
    if (cofoldModel) {
      const ligand = interactionSites.find(s => s.chain === cofoldModel.ligandChain);
      if (ligand) return ligand;
    }
    const highlighted = interactionSites.find(s => highlights.some(h => (h.category === 'ligand' || h.category === 'substrate' || h.category === 'cofactor') && h.chain === s.chain && h.resi.includes(s.resi)));
    return highlighted ?? interactionSites[0];
  }, [interactionSites, interactionKey, cofoldModel, highlights]);

  // Overlay: what is laid over this structure (never outliving it), its file, and the two lined up.
  // Lining up takes a fraction of a second even for a spike trimer, so it is simply redone when a
  // chain is picked or this structure's file changes (AlphaFill adding its ligands).
  const overlayTarget = colorScheme === 'overlay' && overlayWith?.on === structureId ? overlayWith.id : null;
  const overlayState: OverlayState = useMemo(() => {
    if (!overlayTarget) return { status: 'idle' };
    const name = overlayName(overlayTarget);
    if (!pdbContent || overlayFile?.id !== overlayTarget || (!overlayFile.pdb && !overlayFile.error)) return { status: 'loading', name };
    if (overlayFile.error || !overlayFile.pdb) return { status: 'error', name, error: overlayFile.error ?? 'its file is empty' };
    try {
      // The chain on show in the sequence strip, unless one was picked in the panel
      return { status: 'ready', name, result: computeOverlay(pdbContent, overlayFile.pdb, name, { mainChain: overlayChains.main ?? activeChain, otherChain: overlayChains.other }) };
    } catch (e: any) {
      return { status: 'error', name, error: e?.message || "they couldn't be lined up" };
    }
  }, [overlayTarget, overlayFile, pdbContent, overlayChains, activeChain]);
  const overlayResult = overlayState.status === 'ready' ? overlayState.result : null;

  // Latest values for the 3Dmol hover callback (registered once per model build)
  const colorSchemeRef = useRef<ColorScheme>(colorScheme);
  colorSchemeRef.current = colorScheme;
  const variantDataRef = useRef<VariantLensData | null>(null);
  variantDataRef.current = variantLens.status === 'ready' ? variantLens.data ?? null : null;
  const pocketViewRef = useRef(pocketView);
  pocketViewRef.current = pocketView;
  const alphaFillRef = useRef(alphaFill);
  alphaFillRef.current = alphaFill;
  const cofoldRef = useRef(cofoldModel);
  cofoldRef.current = cofoldModel;
  const selectedSiteRef = useRef(selectedSite);
  selectedSiteRef.current = selectedSite;
  const isPredictedRef = useRef(isPredicted);
  isPredictedRef.current = isPredicted;
  const overlayResultRef = useRef(overlayResult);
  overlayResultRef.current = overlayResult;

  // Answers describe the experimental entry. On its AlphaFold model (chain A,
  // UniProt numbering) highlights are carried over through SIFTS; anything that
  // doesn't map (other proteins, ligands, ions) is dropped.
  const toModelHighlights = (hls?: Highlight[]) => {
    if (!hls || !afView) return hls;
    if (!afResidueMap) return [];
    return hls.flatMap(h => {
      const resi = [...new Set(h.resi.map(r => afResidueMap[variantKey(h.chain, r)]).filter((p): p is number => p !== undefined))];
      return resi.length > 0 ? [{ ...h, chain: 'A', resi }] : [];
    });
  };
  const toModelAtom = (a: AtomSpec): AtomSpec | null => {
    if (!afView) return a;
    const resi = afResidueMap?.[variantKey(a.chain, a.resi)];
    return resi === undefined ? null : { ...a, chain: 'A', resi };
  };
  const viewHighlights = useMemo(() => toModelHighlights(highlights) ?? [], [highlights, afView, afResidueMap]);
  const viewTourHighlights = useMemo(() => toModelHighlights(tourHighlights), [tourHighlights, afView, afResidueMap]);
  const viewMeasurements = useMemo(
    () => measurements.flatMap(m => {
      const start = toModelAtom(m.start);
      const end = toModelAtom(m.end);
      return start && end ? [{ ...m, start, end }] : [];
    }),
    [JSON.stringify(measurements), afView, afResidueMap]
  );

  // Determine effective highlights (Tour overrides global)
  const activeHighlights = (viewTourHighlights && viewTourHighlights.length > 0) ? viewTourHighlights : viewHighlights;

  const openAlphaFold = (accession: string) => {
    setAfView({ accession, fromPdb: pdbId.toUpperCase() });
    setToolMenu(null);
    setAfNotice(null);
  };

  // Foldseek searches one protein chain: the one the answer highlights (unless it's a short peptide)
  const searchableChains = useMemo(() => (pdbContent ? proteinChains(pdbContent) : []), [pdbContent]);
  const findSimilar = () => {
    if (!pdbContent || !onFindSimilar || isChatBusy) return;
    const chain = pickSearchChain(searchableChains, activeHighlights[0]?.chain);
    if (!chain) return;
    onFindSimilar({
      label: isEsm
        ? 'your ESMFold prediction'
        : isCofold ? `the co-folded complex (chain ${chain})`
        : afAccession ? `${afAccession} (AlphaFold model)` : `${pdbId.toUpperCase()} chain ${chain}`,
      structureId,
      pdb: extractChain(pdbContent, chain),
      excludePdbIds: isPredicted ? [] : [pdbId.toUpperCase()],
      excludeAccessions: afAccession
        ? [afAccession]
        : isEsm ? [] : entryProteins.filter(p => p.segments.some(s => s.chain === chain)).map(p => p.accession),
    });
  };

  // "Partners" asks STRING about one UniProt protein: the AlphaFold model's, or one of the entry's (SIFTS)
  const partnerTargets = isEsm
    ? []
    : afAccession
      ? [{ accession: afAccession, label: afModel?.uniprotId ?? afAccession }]
      : entryProteins.map(p => ({ accession: p.accession, label: p.identifier }));
  const findPartners = (accession: string, label: string) => {
    setToolMenu(null);
    if (!onFindPartners || isChatBusy) return;
    const chainsHere: Record<string, string[]> = {};
    if (afAccession) chainsHere[afAccession] = ['A'];
    else for (const p of entryProteins) chainsHere[p.accession] = [...new Set(p.segments.map(s => s.chain))];
    onFindPartners({
      accession,
      label,
      structureKeys: [structureId, ...(afView ? [afView.fromPdb] : [])], // Partners belong to the protein, so to both views
      chainsHere,
    });
  };

  // "Co-fold" predicts a molecule bound to the structure on screen (Boltz-2): an experimental entry and
  // the chains picked, an AlphaFold model, or an ESMFold prediction; never a co-folded complex itself
  const cofoldKind = cofoldSourceKind(structureId);
  // Pockets Pocket Radar found join the form's sites (also when they arrive while it is open)
  const cofoldOptions = useMemo(
    () => (toolMenu === 'cofold' && pdbContent ? cofoldSetup(pdbContent, activeHighlights.map(h => h.chain), structureId) : null),
    [toolMenu, pdbContent, structureId, pocketBase]
  );
  // "Co-fold here" in Pocket Radar opens the form with that pocket chosen
  const [cofoldPreset, setCofoldPreset] = useState<string | null>(null);
  const cofoldIntoPocket = (rank: number) => {
    setCofoldPreset(`pocket:${rank}`);
    setToolMenu('cofold');
  };
  useEffect(() => {
    if (toolMenu !== 'cofold') setCofoldPreset(null);
  }, [toolMenu]);
  const startCofold = (choice: CofoldChoice) => {
    setToolMenu(null);
    if (!onCofold || isChatBusy || !cofoldOptions) return;
    const source: CofoldRequest['source'] | null =
      cofoldKind === 'pdb' ? { kind: 'pdb', pdbId: pdbId.toUpperCase(), chains: choice.chains }
      : cofoldKind === 'alphafold' && afAccession ? { kind: 'alphafold', accession: afAccession }
      : cofoldKind === 'sequence' && esmModel ? { kind: 'sequence', sequence: esmModel.sequence }
      : null;
    if (!source) return;
    const proteinName =
      source.kind === 'alphafold' ? afModel?.description ?? afAccession ?? 'the AlphaFold model'
      : source.kind === 'sequence' ? esmModel?.name ?? 'your protein'
      : cofoldProteinName(cofoldOptions, choice.chains) ?? title;
    onCofold({
      source,
      structureId,
      proteinName,
      ligandText: choice.ligandText,
      entryLigands: [...new Set([...cofoldOptions.ligands.map(l => l.code), ...cofoldOptions.cofactors.map(c => c.code)])],
      cofactors: choice.cofactors,
      ...(choice.pocket ? { pocket: choice.pocket } : {}),
    }, choice.compareWith);
  };

  // Variant Lens and Pocket Radar: a data colouring plus its panel
  const openOverlay = (scheme: OverlayScheme) => {
    const section = scheme === 'pathogenicity' ? 'lens' : scheme;
    setFoldedTools(folded => folded.filter(f => f !== section)); // An opened tool shows its panel
    if (!isOverlayScheme(colorScheme)) schemeBeforeOverlay.current = colorScheme;
    setColorScheme(scheme);
    // The colouring is the point; don't leave it faded behind highlights. Interactions are the
    // exception: the residue sticks and dashed lines sit inside the protein, so it is faded instead.
    setStructureOpacity(scheme === 'interactions' ? 45 : 100);
    setFocusSite(null);
    setFocusPocket(null);
    setFocusInteraction(null);
    // Phones open the panel folded to its header (like Settings), so the colouring stays in view
    const fold = window.matchMedia('(max-width: 639px)').matches;
    if (scheme === 'pathogenicity') setIsLensCollapsed(fold);
    else if (scheme === 'pockets') setIsPocketsCollapsed(fold);
    else if (scheme === 'interactions') setIsInteractionsCollapsed(fold);
    // A phone shows the tool's panel in the sheet, half height, over the freshly coloured structure
    if (phone) {
      if (phoneSheet !== 'inspector') sheetForToolRef.current = true;
      setToolMenu(null);
      setPhoneSheet('inspector');
      setSheetSize('half');
      requestAnimationFrame(() => sheetRef.current?.querySelector('[data-phone-sheet-body]')?.scrollTo({ top: 0 }));
    }
  };
  const enableLens = () => openOverlay('pathogenicity');

  const selectColorScheme = (scheme: ColorScheme) => {
    if (isOverlayScheme(scheme)) return openOverlay(scheme);
    setColorScheme(scheme);
    setFocusSite(null);
    setFocusPocket(null);
    setFocusInteraction(null);
  };

  // Back to the colouring before the panel opened, unless that was model confidence and this is an experimental entry
  const closeOverlay = () => {
    const previous = schemeBeforeOverlay.current;
    selectColorScheme(isOverlayScheme(previous) || (previous === 'confidence' && !isPredicted) ? 'element' : previous);
    if (phone && sheetForToolRef.current) closeSheet(); // The sheet came up for that tool alone
  };

  /** Lays another structure ("1AKE", "AF-P69441-F1") over the one on screen. */
  const startOverlay = (id: string) => {
    setToolMenu(null);
    setOverlayChoosing(false);
    setOverlayChains({});
    setOverlayWith({ id: id.trim().toUpperCase(), on: structureId });
    if (colorScheme === 'overlay') setFoldedTools(folded => folded.filter(f => f !== 'overlay'));
    else openOverlay('overlay');
  };

  // A part of the structure on screen that differs from its partner: selected, and brought into view
  // together with that partner (a closed lid can sit 20 Å from the open one)
  const focusOverlayKeys = (keys: string[]) => {
    if (!model || !overlayResult) return;
    const own = keys.filter(k => model.byKey.has(k));
    if (own.length === 0) return;
    setSelection({ keys: new Set(own), focus: own[0] });
    const chain = model.byKey.get(own[0])?.chain;
    if (chain) setActiveChain(chain);
    const partners = own.map(k => overlayResult.partnerOf.get(k)).filter((k): k is string => Boolean(k));
    try { viewerInstance?.zoomTo(toAtomSpec(new Set([...own, ...(overlayShown ? partners : [])])), 800, true); } catch (e) {}
  };

  const focusOnSite = (site: VariantSite, label: string) => {
    const isSame = focusSite && focusSite.chain === site.chain && focusSite.resi === site.resi && focusSite.icode === site.icode;
    setFocusSite(isSame ? null : { ...site, label });
    if (!isSame && viewerInstance) {
      try { viewerInstance.zoomTo({ chain: site.chain, resi: site.resi }, 800, true); } catch (e) {}
    }
  };

  // Polymer atoms of a shown pocket's residues (exact, insertion codes included)
  const pocketSelection = (rank: number) => {
    const pocket = pocketView.shown.find(p => p.rank === rank);
    if (!pocket) return null;
    const keys = new Set(pocket.residues.map(r => variantKey(r.chain, r.resi, r.icode)));
    return { hetflag: false, predicate: (atom: any) => keys.has(variantKey(atom.chain, atom.resi, atom.icode)) };
  };

  const focusOnPocket = (rank: number) => {
    const isSame = focusPocket === rank;
    setFocusPocket(isSame ? null : rank);
    const selection = isSame ? null : pocketSelection(rank);
    if (selection && viewerInstance) {
      try { viewerInstance.zoomTo(selection, 800, true); } catch (e) {}
    }
  };

  // Interactions: pick a ligand (the view moves to it) or focus one interaction (ligand and partner)
  const selectInteractionLigand = (key: string) => {
    setInteractionKey(key);
    setFocusInteraction(null);
  };
  const focusOnInteraction = (index: number) => {
    const isSame = focusInteraction === index;
    setFocusInteraction(isSame ? null : index);
    const interaction = isSame ? null : selectedSite?.interactions[index];
    if (!interaction || !selectedSite || !viewerInstance) return;
    try {
      viewerInstance.zoomTo({ or: [
        { chain: selectedSite.chain, resi: selectedSite.resi, resn: selectedSite.code },
        { chain: interaction.partner.chain, resi: interaction.partner.resi },
      ] }, 800, true);
    } catch (e) {}
  };

  // Helper: Split PDB into Context (Background) and Focus (Highlights + Ligands)
  const splitPdbContent = (pdb: string, hls: Highlight[]) => {
    const lines = pdb.split('\n');
    const bgLines: string[] = [];
    const fgLines: string[] = [];

    // Quick lookup set for highlights
    const highlightSet = new Set<string>();
    hls.forEach(h => {
      h.resi.forEach(r => highlightSet.add(`${h.chain}_${r}`));
    });

    for (const line of lines) {
      // First model only, as in single-model mode (NMR entries hold ~20 models; without
      // ENDMDL, which the END filter below drops, 3Dmol would merge them all into one)
      if (line.startsWith('ENDMDL')) break;
      if (line.startsWith('ATOM') || line.startsWith('HETATM')) {
        const isHet = line.startsWith('HETATM');
        const chain = line.substring(21, 22).trim();
        const resi = parseInt(line.substring(22, 26).trim());
        const key = `${chain}_${resi}`;

        // Add to FG if it's a Ligand OR a Highlighted Residue
        // We throw ALL hetatoms into FG so we can control opacity/visibility via styles later
        if (isHet || highlightSet.has(key)) {
          fgLines.push(line);
        } else {
          bgLines.push(line);
        }
      } else if (!line.startsWith('MASTER') && !line.startsWith('END') && !line.startsWith('CONECT')) {
        bgLines.push(line);
        fgLines.push(line);
      }
    }

    return { 
      bg: bgLines.join('\n'), 
      fg: fgLines.join('\n') 
    };
  };

  // Initialize Viewer (once: React StrictMode runs effects twice in development, which would
  // otherwise leave a second canvas and WebGL context behind)
  const viewerCreatedRef = useRef(false);
  useEffect(() => {
    if (!viewerRef.current || viewerInstance || viewerCreatedRef.current) return;

    if (window.$3Dmol) {
      viewerCreatedRef.current = true;
      try {
        const viewer = window.$3Dmol.createViewer(viewerRef.current, {
          backgroundColor: theme.colors.viewerBg,
          id: 'mol-viewer',
          // zoomTo keeps at least this radius (Å) around its target in view. The 5 Å default
          // fills the screen with a lone ion or residue; 10 Å also shows what surrounds it.
          minimumZoomToDistance: 10,
        });
        setViewerInstance(viewer);
      } catch (e) {
        console.error("Failed to initialize 3Dmol viewer", e);
        setError("Failed to initialize 3D viewer.");
      }
    } else {
      setError("3Dmol.js library not loaded.");
    }
  }, [viewerInstance]);

  // Keep the WebGL background in step with the colour theme
  useEffect(() => {
    if (!viewerInstance) return;
    try {
      viewerInstance.setBackgroundColor(theme.colors.viewerBg);
      viewerInstance.render();
    } catch (e) {}
  }, [viewerInstance, themeId]);

  // A narrow window cannot hold the canvas and a 248px column side by side, so crossing the
  // breakpoint decides for you: the inspector steps aside below 1024px and returns above it.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setInspectorOpen(!e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Co-fold needs the server's NVIDIA key: the tool shows only where it is set up
  useEffect(() => {
    if (!onCofold) return;
    let isMounted = true;
    cofoldAvailable().then(ok => { if (isMounted) setCofoldReady(ok); });
    return () => { isMounted = false; };
  }, []);

  // Effect 1: Fetch the structure (experimental PDB entry, AlphaFold model, or a prediction made in this session)
  useEffect(() => {
    if (!pdbId) return;
    let isMounted = true;
    setLoading(true);
    setError(null);

    const fetchStructure = async () => {
      try {
        if (isEsm) {
          const folded = getPrediction(pdbId);
          if (!folded) throw new Error('This prediction is no longer in memory. Paste the sequence again to refold it.');
          if (isMounted) {
            contentIdRef.current = structureId;
            setAfModel(null);
            setCofoldModel(null);
            setEsmModel(folded);
            setPdbContent(folded.pdb);
          }
          return;
        }
        if (isCofold) {
          const complex = getCofold(pdbId);
          if (!complex) throw new Error('This co-folded complex is no longer in memory. Run Co-fold again to recreate it.');
          if (isMounted) {
            contentIdRef.current = structureId;
            setAfModel(null);
            setEsmModel(null);
            setCofoldModel(complex);
            setPdbContent(complex.pdb);
          }
          return;
        }
        if (afAccession) {
          const result = await fetchAlphaFoldStructure(afAccession);
          if (!result) throw new Error(`No AlphaFold model is available for ${afAccession}.`);
          if (isMounted) {
            contentIdRef.current = structureId;
            afBasePdbRef.current = result.pdb;
            setEsmModel(null);
            setCofoldModel(null);
            setAfModel(result.model);
            setPdbContent(result.pdb);
          }
          return;
        }
        const data = await fetchPdbFile(pdbId); // Cached: switching back to an entry is instant
        if (isMounted) {
          contentIdRef.current = structureId;
          setAfModel(null);
          setEsmModel(null);
          setCofoldModel(null);
          setPdbContent(data);
        }
      } catch (e: any) {
        if (!isMounted) return;
        if (afView) {
          // Opened from an experimental entry: stay on it and say why
          setAfNotice(e.message || 'AlphaFold model unavailable.');
          setAfView(null);
        } else {
          setError(e.message || "Failed to load structure.");
          setPdbContent(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchStructure();
    return () => { isMounted = false; };
  }, [structureId, loadAttempt]);

  // A new answer: back to its own structure. SIFTS (tiny request) lists the UniProt
  // proteins of an experimental entry — for Variant Lens and the AlphaFold switch.
  useEffect(() => {
    if (!pdbId) return;
    let isMounted = true;
    if (sharedAfEntryRef.current !== pdbId.toUpperCase()) {
      sharedAfEntryRef.current = null;
      setAfView(null);
    } // else: a share link opened this entry's AlphaFold model; keep it

    setAfNotice(null);
    setToolMenu(null);
    if (!parseAlphaFoldId(pdbId) && !isEsmFoldId(pdbId) && !isCofoldId(pdbId)) {
      const id = pdbId.toUpperCase();
      fetchSiftsMapping(pdbId)
        .then(mapping => {
          if (isMounted) setEntryProteinList({ pdbId: id, proteins: mapping.filter(p => p.segments.length > 0) });
        })
        .catch(() => {}); // Launchers simply stay hidden
    }
    return () => { isMounted = false; };
  }, [pdbId]);

  // Switching structure clears per-structure state
  useEffect(() => {
    setFocusSite(null);
    setFocusPocket(null);
    setInteractionKey(null);
    setFocusInteraction(null);
    setSelection(emptySelection());
    setHoveredKey(null);
    setHiddenLayers(new Set());
    setAlphaFill(null);
    if (sharedStructureRef.current !== structureId) sharedStructureRef.current = null; // The link's view is done with
    const id = normalizeStructureId(structureId);
    setVariantLens(prev => (prev.data?.structureId === id ? prev : { status: 'idle' }));
    const key = pocketKey(structureId);
    setPockets(prev => (prev.data?.structureId === key ? prev : { status: 'idle' }));
  }, [structureId]);

  // Highlights on an AlphaFold model need the entry -> UniProt residue map
  useEffect(() => {
    if (!afView) {
      setAfResidueMap(null);
      return;
    }
    let isMounted = true;
    setAfResidueMap(null);
    loadUniProtResidueMap(afView.fromPdb, afView.accession)
      .then(map => { if (isMounted) setAfResidueMap(map); })
      .catch(() => { if (isMounted) setAfResidueMap({}); });
    return () => { isMounted = false; };
  }, [afView?.accession, afView?.fromPdb]);

  // AlphaFold models carry no ligands: once one is on screen, add AlphaFill's confident transplants
  // (each fitted onto its site in this model) without moving the camera
  useEffect(() => {
    const accession = afModel?.accession;
    const base = afBasePdbRef.current;
    if (!accession || !base || contentIdRef.current !== structureId) return;
    let isMounted = true;
    loadAlphaFill(accession, base)
      .then(result => {
        if (!isMounted || !result || contentIdRef.current !== structureId) return;
        setAlphaFill(result);
        if (result.transplants.length > 0) {
          skipZoomRef.current = true;
          setPdbContent(result.pdb);
        }
      })
      .catch(() => {}); // AlphaFill unreachable: the model stays without ligands
    return () => { isMounted = false; };
  }, [afModel?.accession, structureId]);

  // Predicted models open in confidence colouring; experimental B-factors aren't confidences.
  // An open Variant Lens or Pocket Radar stays open (Pocket Radar only where PrankWeb can follow).
  // A co-folded complex is about its ligand: element colours with the protein faded, like an
  // experimental structure (its confidence colouring is one choice away).
  useEffect(() => {
    if (keepSharedSchemeRef.current && sharedStructureRef.current === structureId) {
      // A share link chose this structure's colouring: keep it, also once a predicted model has loaded
      if (predictedModelId || !isPredicted) keepSharedSchemeRef.current = false;
      return;
    }
    const complex = isCofoldId(predictedModelId);
    if (predictedModelId && !complex) {
      const keepOverlay = colorSchemeRef.current === 'pathogenicity' || colorSchemeRef.current === 'interactions'
        || (colorSchemeRef.current === 'pockets' && pocketsSupported(structureId));
      if (!keepOverlay) {
        setColorScheme('confidence');
        setStructureOpacity(100);
      }
    } else if (colorSchemeRef.current === 'confidence' || (complex && (colorSchemeRef.current === 'pathogenicity' || colorSchemeRef.current === 'pockets'))) {
      setColorScheme('element');
      // The opacity rule ran earlier while confidence colouring was still on (full opacity):
      // apply it again so this structure's highlights stand out
      setStructureOpacity(activeHighlights.length > 0 ? HIGHLIGHT_FADE : 100);
    }
  }, [predictedModelId]);

  useEffect(() => {
    if (!afNotice) return;
    const timer = setTimeout(() => setAfNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [afNotice]);

  useEffect(() => {
    if (!toolMenu) return;
    const onDown = (e: MouseEvent) => {
      // A dropdown inside the menu draws its options over the page, outside the toolbar: those count as inside
      if ((e.target as Element | null)?.closest?.('[data-dropdown-menu]')) return;
      if (sheetRef.current?.contains(e.target as Node)) return; // On a phone the menu is in the sheet
      if (phone) {
        // A tap on the structure puts a phone's menu away (the header's own buttons toggle it themselves)
        if (!(e.target as Element | null)?.closest?.('[data-sheet-toggle]')) closeSheet();
        return;
      }
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolMenu(null);
    };
    // An open dropdown inside the menu handles its own Escape (and marks it handled)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) setToolMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [toolMenu]);

  // A phone's list of tools is a menu too: a tap elsewhere puts it away (the inspector stays: picking
  // residues on the structure is what its Focus section is for)
  useEffect(() => {
    if (!phone || phoneSheet !== 'tools' || toolMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (sheetRef.current?.contains(target as Node) || target?.closest?.('[data-sheet-toggle], [data-dropdown-menu]')) return;
      closeSheet();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [phone, phoneSheet, toolMenu]);

  // Variant Lens data: loaded on demand, only while the pathogenicity colouring is active
  useEffect(() => {
    if (colorScheme !== 'pathogenicity' || !pdbId) return;
    let isMounted = true;
    const id = normalizeStructureId(structureId);
    setVariantLens(prev => (prev.status === 'ready' && prev.data?.structureId === id ? prev : { status: 'loading' }));

    loadVariantLens(id)
      .then(data => {
        if (isMounted) setVariantLens({ status: 'ready', data });
      })
      .catch((e: any) => {
        if (isMounted) setVariantLens({ status: 'error', error: e?.message || 'network error' });
      });
    return () => { isMounted = false; };
  }, [colorScheme, structureId, lensRetry]);

  // Pocket Radar data: requested from PrankWeb only while the pocket colouring is on. Waits for the
  // structure itself, whose atoms name the ligands already sitting in each pocket.
  useEffect(() => {
    if (colorScheme !== 'pockets' || !pdbId) return;
    const key = pocketKey(structureId);
    if (!key) {
      setPockets({ status: 'unsupported' });
      return;
    }
    setPockets(prev => (prev.status === 'ready' && prev.data?.structureId === key ? prev : { status: 'loading' }));
    if (contentIdRef.current !== structureId || !pdbContent) return;

    const controller = new AbortController();
    loadPockets(structureId, pdbContent, controller.signal, {
      onProgress: progress => setPockets(prev => (prev.status === 'ready' ? prev : { status: 'computing', progress })),
      onUpgrade: data => {
        setPockets({ status: 'ready', data, upgraded: true });
        setFocusPocket(null); // Pockets are renumbered by the new prediction
      },
    })
      .then(data => setPockets(prev => (prev.status === 'ready' && prev.data === data ? prev : { status: 'ready', data })))
      .catch((e: any) => {
        if (!controller.signal.aborted) setPockets({ status: 'error', error: e?.message || 'network error' });
      });
    return () => controller.abort();
  }, [colorScheme, structureId, pdbContent, pocketRetry]);

  // Overlay: the file of the structure laid over (PDB entries and AlphaFold models are cached, so
  // laying one over again is instant)
  useEffect(() => {
    if (!overlayTarget) return;
    let isMounted = true;
    setOverlayFile(prev => (prev?.id === overlayTarget && prev.pdb ? prev : { id: overlayTarget }));
    loadStructureText(overlayTarget)
      .then(pdb => { if (isMounted) setOverlayFile({ id: overlayTarget, pdb }); })
      .catch((e: any) => { if (isMounted) setOverlayFile({ id: overlayTarget, error: (e?.message || 'network error').replace(/\.$/, '') }); });
    return () => { isMounted = false; };
  }, [overlayTarget, overlayRetry]);

  // Another structure on screen ends the overlay; leaving the overlay forgets what was laid over
  useEffect(() => {
    if (colorScheme === 'overlay' && !overlayTarget) closeOverlay();
  }, [colorScheme, overlayTarget]);
  useEffect(() => {
    if (colorScheme === 'overlay') return;
    setOverlayWith(null);
    setOverlayChains({});
    setOverlayChoosing(false);
    setOverlayShown(true);
  }, [colorScheme]);

  // What the chat is told about the overlay on screen
  useEffect(() => {
    rememberOverlay(structureId, overlayResult);
    return () => rememberOverlay(structureId, null);
  }, [structureId, overlayResult]);

  // Effect 2: Manage Models (Single vs Split) & Hover Listeners
  useEffect(() => {
    if (!viewerInstance || !pdbContent) return;

    try {
      const needsSplit = (vizStyle === 'stick' || vizStyle === 'sphere') && activeHighlights.length > 0;
      
      // Clear everything
      viewerInstance.clear();
      viewerInstance.removeAllSurfaces();
      viewerInstance.removeAllLabels();
      surfaceIdRef.current = null; // Reset surface tracking
      overlayModelRef.current = null; // Cleared with the rest; the styling pass adds it back after the handlers below
      setTooltip(null); // The hovered atom no longer exists, so its unhover callback won't fire

      if (needsSplit) {
        const { bg, fg } = splitPdbContent(pdbContent, activeHighlights);
        if (bg && bg.trim().length > 0) viewerInstance.addModel(bg, "pdb");
        else viewerInstance.addModel("HEADER    EMPTY", "pdb"); 
        
        if (fg && fg.trim().length > 0) viewerInstance.addModel(fg, "pdb");
        else viewerInstance.addModel("HEADER    EMPTY", "pdb");
      } else {
        viewerInstance.addModel(pdbContent, "pdb");
      }
      
      // SETUP HOVER LISTENERS
      viewerInstance.setHoverable({}, true, (atom: any, viewer: any, event: any, container: any) => {
          if (!atom) return;
          
          const rect = viewerRef.current?.getBoundingClientRect();
          const x = event.clientX - (rect?.left || 0);
          const y = event.clientY - (rect?.top || 0);

          // 1. Identify if this atom is part of a Highlighted Region
          const highlight = activeHighlights.find(h => 
             h.chain === atom.chain && h.resi.includes(atom.resi)
          );

          // 2. Resolve Names
          const resFull = AMINO_ACID_MAP[atom.resn] || atom.resn;
          let mainText = "";
          let subText = "";

          const transplant = atom.hetflag && atom.resi >= FIRST_TRANSPLANT_RESIDUE
             ? alphaFillRef.current?.transplants.find(t => t.resi === atom.resi && t.chain === atom.chain)
             : undefined;

          // Co-folded complex: the predicted ligand, kept cofactors, and the crystal pose added for comparison
          const complex = atom.hetflag ? cofoldRef.current : null;
          const cofoldPart = !complex ? null
             : atom.chain === complex.ligandChain ? 'ligand'
             : atom.chain === complex.compare?.chain ? 'second'
             : atom.chain === complex.reference?.chain ? 'reference'
             : complex.cofactors.some(c => c.chain === atom.chain) ? 'cofactor'
             : null;

          if (complex && (cofoldPart === 'ligand' || cofoldPart === 'second')) {
             const molecule = cofoldPart === 'second' ? complex.compare!.other : complex;
             const iptm = molecule.scores.ligandIptm ?? molecule.scores.iptm;
             mainText = molecule.ligand.name;
             subText = `Predicted pose · Boltz-2${iptm !== null ? ` · ligand ipTM ${iptm.toFixed(2)}` : ''}${molecule.affinity ? ` · IC50 ≈ ${formatIc50(molecule.affinity.log10Ic50)}` : ''}`;
          } else if (complex?.reference && cofoldPart === 'reference') {
             // In a comparison the crystal pose may be the second molecule's
             const owner = complex.compare?.reference === 'b' ? complex.compare.other : complex;
             mainText = `${owner.ligand.name} · crystal pose`;
             subText = `From ${complex.reference.from}, for comparison · ${complex.reference.centroidDistance.toFixed(1)} Å from the prediction`;
          } else if (complex && cofoldPart === 'cofactor') {
             mainText = LIGAND_NAMES[atom.resn] ?? atom.resn;
             subText = 'Kept from the structure · placed by Boltz-2';
          } else if (highlight && highlight.label) {
             // AI Context Available
             mainText = highlight.label;
             subText = `${resFull} ${atom.resi} (Chain ${atom.chain})`;
          } else if (transplant) {
             // A ligand AlphaFill copied into this AlphaFold model
             mainText = transplant.name === transplant.compound ? transplant.compound : `${transplant.name} (${transplant.compound})`;
             subText = `AlphaFill · from PDB ${transplant.sourcePdb} (${Math.round(transplant.identity * 100)}% identical) · ${transplant.confidence} confidence`;
          } else if (atom.hetflag) {
             // Ligand/Substrate
             mainText = resFull;
             subText = `Ligand • Chain ${atom.chain}:${atom.resi}`;
          } else {
             // Standard Residue
             mainText = `${resFull} ${atom.resi}`;
             subText = `Chain ${atom.chain}`;
          }

          // 3. Variant Lens context (AlphaMissense + known variants)
          const lens = colorSchemeRef.current === 'pathogenicity' ? variantDataRef.current : null;
          if (lens && !atom.hetflag) {
             const key = variantKey(atom.chain, atom.resi, atom.icode);
             const rv = lens.residues[key];
             if (rv) {
                const icode = (atom.icode ?? '').trim();
                const inStructure = lens.mismatches[key];
                const known = rv.known.slice(0, 2).map(k => `${k.wt}${k.position}${k.alt}`).join(', ');
                mainText = `${highlight?.label ?? `${resFull} ${atom.resi}${icode}`} · AM ${rv.mean.toFixed(2)}`;
                subText = [
                  AM_CLASS_LABEL[rv.amClass],
                  `${rv.protein} ${rv.wt}${rv.position}${inStructure ? ` (${inStructure} here)` : ''} · Chain ${atom.chain}`,
                  known && `Known: ${known}${rv.known.length > 2 ? ` +${rv.known.length - 2}` : ''}`,
                ].filter(Boolean).join(' · ');
             } else {
                subText = `${subText} · no AlphaMissense data`;
             }
          }

          // 4. Pocket Radar: which predicted pocket this residue lines
          if (colorSchemeRef.current === 'pockets' && !atom.hetflag) {
             const view = pocketViewRef.current;
             const index = view.byResidue.get(variantKey(atom.chain, atom.resi, atom.icode));
             if (index !== undefined) {
                const pocket = view.shown[index];
                subText = `${subText} · Pocket ${pocket.rank} (${Math.round(pocket.probability * 100)}%)`;
             }
          }

          // 4b. Interactions: what this residue does for the ligand on show
          if (colorSchemeRef.current === 'interactions' && !atom.hetflag) {
             const site = selectedSiteRef.current;
             const icode = (atom.icode ?? '').trim();
             const mine = site?.interactions.filter(i => i.partner.chain === atom.chain && i.partner.resi === atom.resi && i.partner.icode === icode) ?? [];
             if (site && mine.length > 0) {
                const kinds = [...new Set(mine.map(i => INTERACTION_LABELS[i.type].one.toLowerCase()))];
                subText = `${subText} · ${kinds.join(', ')} with ${site.code} (${Math.min(...mine.map(i => i.distance)).toFixed(1)} Å)`;
             }
          }

          // 4c. Overlay: how far this residue sits from its partner in the structure laid over it
          const laidOver = colorSchemeRef.current === 'overlay' && !atom.hetflag ? overlayResultRef.current : null;
          if (laidOver) {
             const key = `${atom.chain}|${atom.resi}|${(atom.icode ?? '').trim()}`;
             const d = laidOver.distances.get(key);
             const change = laidOver.changed.find(c => c.key === key);
             if (d !== undefined) subText = `${subText} · ${d.toFixed(1)} Å from ${laidOver.id}${change ? ` (${change.to} there)` : ''}`;
             else if (atom.chain === laidOver.mainChain) subText = `${subText} · not in ${laidOver.id}`;
          }

          // 5. Predicted models: per-residue confidence
          if (isPredictedRef.current && !atom.hetflag && typeof atom.b === 'number') {
             subText = `${subText} · pLDDT ${Math.round(plddtValue(atom.b))} (${plddtBand(atom.b).label.toLowerCase()})`;
          }

          setTooltip({ text: mainText, subtext: subText, x, y });
          setHoveredKey(`${atom.chain}|${atom.resi}|${(atom.icode ?? '').trim()}`);

      }, (atom: any) => {
          setTooltip(null);
          setHoveredKey(null);
      });

      // CLICK TO SELECT: every professional viewer answers a click on the structure; ours used to
      // answer only a hover. Plain click picks, Ctrl/Cmd adds, Shift extends along the chain.
      viewerInstance.setClickable({}, true, (atom: any, _viewer: any, event: any) => {
          if (!atom) return;
          const key = `${atom.chain}|${atom.resi}|${(atom.icode ?? '').trim()}`;
          const source = event?.sourceEvent ?? event;
          pickResidueRef.current(key, { toggle: Boolean(source?.ctrlKey || source?.metaKey), range: Boolean(source?.shiftKey) });
      });

      // Signal styling to run
      setStylingTrigger(prev => prev + 1);

    } catch (e) {
      console.error("Model Management Error:", e);
    }
  }, [viewerInstance, pdbContent, vizStyle, JSON.stringify(activeHighlights)]);

  // Effect 3: Auto-adjust Opacity State (Logic only)
  useEffect(() => {
    // While a share link's answer is on screen, its opacity stands (highlights mapped onto an
    // AlphaFold model arrive later and would otherwise re-run the rule)
    if (initialView?.opacity !== undefined && highlights === sharedHighlightsRef.current) {
      setStructureOpacity(initialView.opacity);
      return;
    }
    if (colorSchemeRef.current === 'interactions') return; // Interactions keep their faded protein
    // Keep data colourings (Variant Lens heatmap, pockets, model confidence) fully visible; highlights are drawn on top
    const dataColouring = isOverlayScheme(colorSchemeRef.current) || colorSchemeRef.current === 'confidence';
    if (activeHighlights.length > 0 && !dataColouring) {
      setStructureOpacity(HIGHLIGHT_FADE);
    } else {
      setStructureOpacity(100);
    }
  }, [JSON.stringify(activeHighlights)]);

  // Effect 3b: Mutation-focused answers open Variant Lens automatically (human proteins only)
  useEffect(() => {
    if (!lensAvailable || !highlights.some(h => h.category === 'mutation')) return;
    // Once per answer: switching to its AlphaFold model and back mustn't reopen a lens the user closed
    const key = `${pdbId}|${JSON.stringify(highlights)}`;
    if (lensAutoKey.current === key) return;
    lensAutoKey.current = key;
    enableLens();
  }, [structureId, JSON.stringify(highlights), lensAvailable]);

  // Effect 4: Apply Styles (The Rendering Loop)
  useEffect(() => {
    if (!viewerInstance || !viewerInstance.setStyle) return;

    const safeSetStyle = (selection: any, style: any) => {
        if (!viewerInstance) return;
        if (selection && typeof selection.model === 'number') {
            try {
                const m = viewerInstance.getModel(selection.model);
                if (!m) return;
            } catch (e) { return; }
        }
        try { viewerInstance.setStyle(selection, style); } catch (e) {}
    };

    try {
      const baseOpacity = structureOpacity / 100.0;
      const isSplitMode = (vizStyle === 'stick' || vizStyle === 'sphere') && activeHighlights.length > 0;

      // --- OVERLAY MODEL: added here, after Effect 2 set the hover and click handlers, so it never
      // answers them; replaced when the file laid over changes, removed when it is hidden or closed ---
      const ghostPdb = colorScheme === 'overlay' && overlayResult && overlayShown ? overlayResult.pdb : null;
      if (overlayModelRef.current && overlayModelRef.current.pdb !== ghostPdb) {
        try { viewerInstance.removeModel(overlayModelRef.current.model); } catch (e) {}
        overlayModelRef.current = null;
      }
      if (ghostPdb && !overlayModelRef.current) {
        try { overlayModelRef.current = { model: viewerInstance.addModel(ghostPdb, 'pdb'), pdb: ghostPdb }; } catch (e) {}
      }
      const ghostChain = overlayModelRef.current ? overlayResult?.shownChain : undefined;
      // The structure on screen only: its surface and its rainbow's range leave the overlay out
      const onScreenOnly = (sel: Record<string, unknown>) => (ghostChain ? { ...sel, predicate: (a: any) => a.chain !== ghostChain } : sel);

      // --- COLOR HELPERS ---
      const getHydrophobicityColor = (atom: any) => {
        const colors: {[key: string]: string} = {
          ILE: '#f87171', VAL: '#f87171', LEU: '#f87171', PHE: '#f87171',
          CYS: '#f87171', MET: '#f87171', ALA: '#f87171', TRP: '#f87171',
          TYR: '#f87171',
          HIS: '#60a5fa', GLU: '#60a5fa', GLN: '#60a5fa', ASP: '#60a5fa',
          ASN: '#60a5fa', LYS: '#60a5fa', ARG: '#60a5fa', SER: '#60a5fa',
          THR: '#60a5fa',
          GLY: '#cbd5e1', PRO: '#cbd5e1'
        };
        return colors[atom.resn] || '#e2e8f0';
      };

      const variantData = variantLens.status === 'ready' ? variantLens.data ?? null : null;
      const getPathogenicityColor = (atom: any) => {
        const rv = variantData?.residues[variantKey(atom.chain, atom.resi, atom.icode)];
        return rv ? amColor(rv.mean) : AM_NO_DATA_COLOR;
      };

      // Pockets in their colours; the rest of the protein recedes in a neutral grey
      const pocketBaseColor = theme.colorScheme === 'dark' ? theme.colors.inkMuted : theme.colors.inkDim;
      const getPocketColor = (atom: any) => {
        const index = pocketView.byResidue.get(variantKey(atom.chain, atom.resi, atom.icode));
        return index === undefined ? pocketBaseColor : POCKET_COLORS[index];
      };

      // Overlay: each residue by how far it sits from its partner (blue, white at 2 Å, red), or the
      // chain laid on in blue; the same grey as above where there is no partner. One chain lies on
      // one chain, so the structure's other chains also recede.
      const overlayOn = colorScheme === 'overlay' ? overlayResult : null;
      const getOverlayColor = (atom: any) => {
        if (overlayColour === 'pair') return atom.chain === overlayOn?.mainChain ? PAIR_COLORS.main : pocketBaseColor;
        const d = overlayOn?.distances.get(`${atom.chain}|${atom.resi}|${(atom.icode ?? '').trim()}`);
        return d === undefined ? pocketBaseColor : distanceColor(d);
      };
      const overlayFaded = overlayOn && model ? model.chains.map(c => c.chain).filter(c => c !== overlayOn.mainChain) : [];
      const fadedStyle = vizStyle === 'stick' ? { stick: { radius: 0.15, color: pocketBaseColor, opacity: 0.25 } }
        : vizStyle === 'sphere' ? { sphere: { scale: 0.85, color: pocketBaseColor, opacity: 0.25 } }
        : { cartoon: { style: 'oval', thickness: 0.5, color: pocketBaseColor, opacity: 0.25 } };

      // 3Dmol understands color 'spectrum' on cartoons only; sticks, spheres and surfaces get the
      // same sinebow-by-residue-number rainbow as an explicit gradient (same direction as cartoons)
      let rainbowScheme: object | null = null;
      if (colorScheme === 'rainbow' && vizStyle !== 'cartoon') {
        let minResi = Infinity;
        let maxResi = -Infinity;
        for (const atom of viewerInstance.selectedAtoms(onScreenOnly({ hetflag: false }))) {
          if (atom.resi < minResi) minResi = atom.resi;
          if (atom.resi > maxResi) maxResi = atom.resi;
        }
        if (minResi < maxResi) rainbowScheme = { prop: 'resi', gradient: 'sinebow', min: maxResi, max: minResi };
      }

      const getColorProps = (cartoon = false) => {
          switch (colorScheme) {
              case 'rainbow':
                  if (cartoon) return { color: 'spectrum' };
                  return rainbowScheme ? { colorscheme: rainbowScheme } : { colorscheme: 'Jmol' };
              case 'chain': return { colorscheme: 'chain' };
              case 'hydrophobicity': return { colorfunc: getHydrophobicityColor };
              case 'residue': return { colorscheme: 'amino' };
              case 'pathogenicity': return { colorfunc: getPathogenicityColor };
              case 'pockets': return { colorfunc: getPocketColor };
              case 'interactions': return { colorfunc: () => pocketBaseColor };
              case 'overlay': return { colorfunc: getOverlayColor };
              case 'confidence': return { colorfunc: (atom: any) => plddtColor(atom.b) };
              case 'element':
              default: return { colorscheme: 'Jmol' };
          }
      };

      // Crimson highlights would vanish into the red end of the heatmap
      const highlightColor = colorScheme === 'pathogenicity'
        ? (theme.colorScheme === 'dark' ? '#fafafa' : theme.colors.inkStrong)
        : theme.colors.brandFg;

      // --- SURFACE OPTIMIZATION ---
      // Check if we are in surface mode and can reuse the existing surface
      const canReuseSurface = vizStyle === 'surface' &&
                              surfaceIdRef.current !== null &&
                              prevVizStyle.current === 'surface' &&
                              prevColorScheme.current === colorScheme &&
                              prevPdbContent.current === pdbContent &&
                              prevVariantData.current === variantData &&
                              prevPocketData.current === pocketData &&
                              (colorScheme !== 'overlay' || (prevOverlay.current.result === overlayResult && prevOverlay.current.colour === overlayColour)) &&
                              ((colorScheme !== 'pockets' && colorScheme !== 'overlay') || prevThemeId.current === themeId); // Their grey follows the theme

      if (vizStyle === 'surface') {
          const surfaceStyle = {
             opacity: Math.max(0.1, baseOpacity * 0.85),
             ...getColorProps()
          };

          // Atom styles are rebuilt on every pass (highlights, ligands and the lens focus are
          // added on top below); this doesn't touch the surface itself
          safeSetStyle({}, {});

          if (canReuseSurface && surfaceIdRef.current !== null) {
              // OPTIMIZED PATH: Just update material, don't rebuild geometry
              viewerInstance.setSurfaceMaterialStyle(surfaceIdRef.current, surfaceStyle);
          } else {
              // FULL REBUILD PATH
              viewerInstance.removeAllSurfaces();
              // Surface usually on protein only; with an overlay, only on the chain laid on (the others recede as faint ribbons)
              const sel = overlayOn ? { hetflag: false, chain: overlayOn.mainChain } : onScreenOnly({ hetflag: false });
              try {
                  // Without a callback addSurface returns a Promise carrying the surface ID as .surfid
                  const result = viewerInstance.addSurface(window.$3Dmol.SurfaceType.SES, surfaceStyle, sel);
                  surfaceIdRef.current = typeof result === 'number' ? result : result?.surfid ?? null;
              } catch (e) {
                  console.warn("Surface generation failed", e);
              }
          }
      } else {
          // If not in surface mode, clean up any surfaces
          if (surfaceIdRef.current !== null || prevVizStyle.current === 'surface') {
              viewerInstance.removeAllSurfaces();
              surfaceIdRef.current = null;
          }
      }
      
      // Update Refs
      prevVizStyle.current = vizStyle;
      prevColorScheme.current = colorScheme;
      prevPdbContent.current = pdbContent;
      prevVariantData.current = variantData;
      prevPocketData.current = pocketData;
      prevOverlay.current = { result: overlayResult, colour: overlayColour };
      prevThemeId.current = themeId;

      // --- NON-SURFACE STYLING (Cartoon/Stick) ---
      // We still apply this if not surface, OR if surface generation failed and we fell back
      // Note: If surface mode is active, we generally hide the atoms (handled above in else block), 
      // but we still need to render highlights and hetatoms (Ligands).

      // 1. Metals & Substrates Selectors
      const metalElements = ["Fe", "Zn", "Mg", "Mn", "Ca", "Co", "Ni", "Cu", "Na", "K", "Ag", "Au", "Pt", "Hg", "Cd", "Pb"];
      const metalHighlights = activeHighlights.filter(h => h.category === 'metal');
      const metalHighlightResidues = metalHighlights.flatMap(h => h.resi.map(r => ({chain: h.chain, resi: r})));

      const substrateHighlights = activeHighlights.filter(h => h.category === 'substrate');
      const substrateHighlightResidues = substrateHighlights.flatMap(h => h.resi.map(r => ({chain: h.chain, resi: r})));

      // Base Styles
      const bgSplitStyle = vizStyle === 'stick' 
        ? { stick: { radius: 0.15, ...getColorProps(), opacity: baseOpacity } }
        : { sphere: { scale: 0.85, ...getColorProps(), opacity: baseOpacity } };

      const getActiveSiteStyle = () => {
         if (!showActiveSiteBalls) return isSplitMode ? bgSplitStyle : null;
         return {
             stick: { radius: 0.22, color: highlightColor, opacity: 1.0 },
             sphere: { scale: 0.45, color: highlightColor, opacity: 1.0 }
         };
      };

      if (isSplitMode) {
        // === SPLIT MODEL === (Wireframe/Spacefill only)
        safeSetStyle({ model: 0 }, bgSplitStyle);
        if (overlayFaded.length > 0) safeSetStyle({ model: 0, chain: overlayFaded }, fadedStyle);

        // Model 1: Active Sites + Ligands
        const activeSiteStyle = getActiveSiteStyle();

        if (showActiveSiteBalls) {
            safeSetStyle({ model: 1, hetflag: false }, activeSiteStyle);
        } else {
             safeSetStyle({ model: 1, hetflag: false }, bgSplitStyle);
        }

        // Ligands/Substrates (Always render these even in surface mode usually)
        const ligandStyle = showLigands 
            ? (vizStyle === 'sphere' ? { sphere: { scale: 1.0, colorscheme: 'greenCarbon', opacity: 1.0 } } 
                                     : { stick: { radius: 0.3, colorscheme: 'greenCarbon', opacity: 1.0 } })
            : { stick: { radius: 0, hidden: true }, sphere: { scale: 0, hidden: true }, opacity: 0 };
        
        safeSetStyle({ model: 1, hetflag: true }, ligandStyle);

        const substrateStyle = showSubstrates
            ? (vizStyle === 'sphere' ? { sphere: { scale: 1.0, colorscheme: 'magentaCarbon', opacity: 1.0 } }
                                     : { stick: { radius: 0.4, colorscheme: 'magentaCarbon', opacity: 1.0 } }) 
            : { stick: { radius: 0, hidden: true }, sphere: { scale: 0, hidden: true }, opacity: 0 };
        
        if (substrateHighlightResidues.length > 0) {
            safeSetStyle({ model: 1, or: substrateHighlightResidues }, substrateStyle);
        }

        const metalStyle = showMetals
            ? { sphere: { scale: 1.0, colorscheme: 'Jmol', opacity: 1.0 } }
            : { sphere: { scale: 0, hidden: true }, stick: { radius: 0, hidden: true }, opacity: 0 };
        
        safeSetStyle({ model: 1, elem: metalElements }, metalStyle);
        if (metalHighlightResidues.length > 0) {
            safeSetStyle({ model: 1, or: metalHighlightResidues }, metalStyle);
        }

      } else {
        // === SINGLE MODEL ===
        const structureSel = { hetflag: false };

        if (vizStyle === 'cartoon') {
            const cartoonStyle = { style: 'oval', thickness: 0.5, ...getColorProps(true), opacity: baseOpacity };
            safeSetStyle(structureSel, { cartoon: cartoonStyle });
        } else if (vizStyle === 'surface') {
            // Already handled in surface block above
        } else if (vizStyle === 'stick') {
             safeSetStyle(structureSel, { stick: { radius: 0.15, ...getColorProps(), opacity: baseOpacity } });
        } else if (vizStyle === 'sphere') {
             safeSetStyle(structureSel, { sphere: { scale: 0.85, ...getColorProps(), opacity: baseOpacity } });
        }
        if (overlayFaded.length > 0) safeSetStyle({ hetflag: false, chain: overlayFaded }, fadedStyle);

        // Highlights (Active Sites); Interactions draw their own partner residues instead
        if (showActiveSiteBalls && colorScheme !== 'interactions') {
            activeHighlights.forEach((h) => {
                if (h.resi && h.resi.length > 0 && h.category !== 'metal' && h.category !== 'substrate' && h.category !== 'ligand') {
                    const selection = { chain: h.chain, resi: h.resi };
                    // Large sets (an interface, a pocket lining) as sticks only: balls on dozens of residues bury the structure
                    const hlStyle = h.resi.length > MAX_BALL_RESIDUES
                        ? { stick: { radius: 0.22, color: highlightColor, opacity: 1.0 } }
                        : getActiveSiteStyle();
                    
                    if (vizStyle === 'cartoon') {
                        safeSetStyle(selection, {
                            cartoon: { ...getColorProps(true), opacity: 1.0, thickness: 0.8 },
                            ...hlStyle
                        });
                    } else if (vizStyle === 'surface') {
                        // Overlay sticks/balls on surface
                        viewerInstance.addStyle(selection, hlStyle);
                    } else {
                        // Blend style
                         viewerInstance.addStyle(selection, hlStyle);
                    }
                }
            });
        }

        // HETATMs
        const ligandStyle = showLigands 
           ? { stick: { radius: 0.3, colorscheme: 'greenCarbon', opacity: 1.0 } }
           : { stick: { radius: 0, hidden: true }, opacity: 0 };
        safeSetStyle({ hetflag: true }, ligandStyle);

        const substrateStyle = showSubstrates
           ? { stick: { radius: 0.4, colorscheme: 'magentaCarbon', opacity: 1.0 } }
           : { stick: { radius: 0, hidden: true }, opacity: 0 };
        if (substrateHighlightResidues.length > 0) safeSetStyle({ or: substrateHighlightResidues }, substrateStyle);

        const metalStyle = showMetals
           ? { sphere: { scale: 0.8, colorscheme: 'Jmol', opacity: 1.0 } }
           : { sphere: { scale: 0, hidden: true }, stick: { radius: 0, hidden: true }, opacity: 0 };
        safeSetStyle({ elem: metalElements }, metalStyle);
        if (metalHighlightResidues.length > 0) safeSetStyle({ or: metalHighlightResidues }, metalStyle);
      }

      // --- CO-FOLD: the crystal pose of the same ligand, thin and grey beside the prediction ---
      const reference = cofoldModel?.reference;
      const comparison = cofoldModel?.compare;
      const hiddenStyle = { stick: { radius: 0, hidden: true }, sphere: { scale: 0, hidden: true }, opacity: 0 };
      if (reference && showLigands) {
        const referenceColor = theme.colorScheme === 'dark' ? theme.colors.inkMuted : theme.colors.inkDim;
        // In a comparison the crystal pose belongs to one molecule, and hides with it
        const ownerHidden = comparison?.reference ? compareHidden[comparison.reference] : false;
        safeSetStyle(
          isSplitMode ? { model: 1, chain: reference.chain } : { chain: reference.chain, hetflag: true },
          ownerHidden ? hiddenStyle : { stick: { radius: 0.14, color: referenceColor, opacity: 0.8 } }
        );
      }

      // --- COMPARISON: each molecule in its own carbon colour (blue / orange), either can be hidden ---
      if (comparison && cofoldModel && showLigands) {
        const select = (chain: string) => (isSplitMode ? { model: 1, chain } : { chain, hetflag: true });
        const drawn = (scheme: string) => (isSplitMode && vizStyle === 'sphere'
          ? { sphere: { scale: 1.0, colorscheme: scheme, opacity: 1.0 } }
          : { stick: { radius: 0.3, colorscheme: scheme, opacity: 1.0 } });
        safeSetStyle(select(cofoldModel.ligandChain), compareHidden.a ? hiddenStyle : drawn(COMPARE_COLORS.a.scheme));
        safeSetStyle(select(comparison.chain), compareHidden.b ? hiddenStyle : drawn(COMPARE_COLORS.b.scheme));
      }

      // --- MEASUREMENTS ---
      viewerInstance.removeAllLabels(); 
      viewerInstance.removeAllShapes();

      const getAtomPosition = (spec: AtomSpec) => {
        let selection: any = { chain: spec.chain, resi: spec.resi };
        if (spec.atom) selection.atom = spec.atom;
        let atoms = viewerInstance.selectedAtoms(selection);
        if (!atoms || atoms.length === 0) atoms = viewerInstance.selectedAtoms({ chain: spec.chain, resi: spec.resi });
        if (!atoms || atoms.length === 0) atoms = viewerInstance.selectedAtoms({ resi: spec.resi });
        if (!atoms || atoms.length === 0) return null;
        if (spec.atom) {
          const exact = atoms.find((a: any) => a.atom === spec.atom);
          if (exact) return exact;
        }
        const ca = atoms.find((a: any) => a.atom === "CA");
        if (ca) return ca;
        let x = 0, y = 0, z = 0;
        atoms.forEach((a: any) => { x += a.x; y += a.y; z += a.z; });
        return { x: x / atoms.length, y: y / atoms.length, z: z / atoms.length };
      };

      const addDashedLine = (start: any, end: any, color: string = theme.colors.warn, radius = 0.12, dash = 0.4, gap = 0.2) => {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const dz = end.z - start.z;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist < 0.1 || isNaN(dist)) return;

          const step = dash + gap;
          const segments = Math.floor(dist / step);
          const norm = { x: dx/dist, y: dy/dist, z: dz/dist };

          for (let i = 0; i < segments + 1; i++) {
              const current = i * step;
              if (current >= dist) break;
              const s = { x: start.x + norm.x * current, y: start.y + norm.y * current, z: start.z + norm.z * current };
              let next = current + dash;
              if (next > dist) next = dist;
              const e = { x: start.x + norm.x * next, y: start.y + norm.y * next, z: start.z + norm.z * next };
              viewerInstance.addCylinder({ start: s, end: e, radius, color, fromCap:1, toCap:1 });
          }
      };

      if (viewMeasurements.length > 0) {
        viewMeasurements.forEach((m) => {
           const start = getAtomPosition(m.start);
           const end = getAtomPosition(m.end);
           if (start && end) {
             addDashedLine(start, end);
             const dist = Math.sqrt(Math.pow(start.x-end.x,2)+Math.pow(start.y-end.y,2)+Math.pow(start.z-end.z,2)).toFixed(1);
             const mid = { x: (start.x+end.x)/2, y: (start.y+end.y)/2, z: (start.z+end.z)/2 };
             viewerInstance.addLabel(`${dist} Å`, {
                position: mid, backgroundColor: theme.colors.canvas, fontColor: theme.colors.warn, fontSize: 16,
                showBackground: true, inFront: true, backgroundOpacity: 0.9, padding: 6, borderRadius: 4
             });
           }
        });
      }

      // --- VARIANT LENS FOCUS (residue picked from the panel) ---
      if (focusSite && colorScheme === 'pathogenicity') {
        const residueSel = { chain: focusSite.chain, resi: focusSite.resi };
        const atoms = (viewerInstance.selectedAtoms(residueSel) || [])
          .filter((a: any) => (a.icode ?? '').trim() === focusSite.icode);
        const anchor = atoms.find((a: any) => a.atom === 'CA') || atoms[0];
        if (anchor) {
          viewerInstance.addStyle(residueSel, { stick: { radius: 0.26, colorscheme: 'whiteCarbon' } });
          viewerInstance.addLabel(focusSite.label, {
            position: { x: anchor.x, y: anchor.y, z: anchor.z }, backgroundColor: theme.colors.canvas, fontColor: theme.colors.inkStrong,
            fontSize: 13, showBackground: true, inFront: true, backgroundOpacity: 0.9, padding: 5, borderRadius: 4,
            borderColor: theme.colors.line2, borderThickness: 1
          });
        }
      }

      // --- POCKET RADAR FOCUS (pocket picked from the panel): its residues as sticks, labelled at their centre ---
      const focusedIndex = focusPocket === null || colorScheme !== 'pockets' ? -1 : pocketView.shown.findIndex(p => p.rank === focusPocket);
      const focusedSelection = focusedIndex >= 0 ? pocketSelection(pocketView.shown[focusedIndex].rank) : null;
      if (focusedSelection) {
        const pocket = pocketView.shown[focusedIndex];
        viewerInstance.addStyle(focusedSelection, { stick: { radius: 0.24, color: POCKET_COLORS[focusedIndex] } });
        const atoms = viewerInstance.selectedAtoms(focusedSelection) || [];
        if (atoms.length > 0) {
          const center = { x: 0, y: 0, z: 0 };
          for (const a of atoms) { center.x += a.x; center.y += a.y; center.z += a.z; }
          viewerInstance.addLabel(
            `Pocket ${pocket.rank} · ${Math.round(pocket.probability * 100)}%${pocket.ligands.length ? ` · ${pocket.ligands[0]}` : ''}`,
            {
              position: { x: center.x / atoms.length, y: center.y / atoms.length, z: center.z / atoms.length },
              backgroundColor: theme.colors.canvas, fontColor: theme.colors.inkStrong, fontSize: 13, showBackground: true,
              inFront: true, backgroundOpacity: 0.9, padding: 5, borderRadius: 4, borderColor: POCKET_COLORS[focusedIndex], borderThickness: 1.5
            }
          );
        }
      }

      // --- INTERACTIONS: the chosen ligand's contacts as dashed lines (one colour per kind), its partner residues as sticks ---
      if (colorScheme === 'interactions' && selectedSite) {
        const site = selectedSite;
        const point = (p: [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] });
        const partnerKeys = new Set(site.interactions.filter(i => i.partner.resn !== 'HOH').map(i => variantKey(i.partner.chain, i.partner.resi, i.partner.icode)));
        if (partnerKeys.size > 0) {
          viewerInstance.addStyle(
            { hetflag: false, predicate: (atom: any) => partnerKeys.has(variantKey(atom.chain, atom.resi, atom.icode)) },
            { stick: { radius: 0.17, colorscheme: 'Jmol' } }
          );
        }
        if (showLigands) viewerInstance.addStyle({ chain: site.chain, resi: site.resi, resn: site.code }, { stick: { radius: 0.3, colorscheme: 'greenCarbon' } });
        for (const bridge of site.interactions.filter(i => i.via)) {
          viewerInstance.addStyle({ chain: bridge.via!.chain, resi: bridge.via!.resi }, { sphere: { radius: 0.32, color: INTERACTION_COLORS.water_bridge } });
        }
        site.interactions.forEach((interaction, index) => {
          const color = INTERACTION_COLORS[interaction.type];
          const focused = focusInteraction === index;
          const radius = focused ? 0.15 : interaction.type === 'hydrophobic' ? 0.055 : 0.09;
          const legs = interaction.via ? [[interaction.from, interaction.via.position], [interaction.via.position, interaction.to]] : [[interaction.from, interaction.to]];
          for (const [a, b] of legs) addDashedLine(point(a), point(b), color, radius, 0.28, 0.18);
          if (interaction.type === 'pi_stacking' || interaction.type === 'pi_cation') {
            for (const p of [interaction.from, interaction.to]) viewerInstance.addSphere({ center: point(p), radius: 0.2, color });
          }
          if (focused) {
            const mid = { x: (interaction.from[0] + interaction.to[0]) / 2, y: (interaction.from[1] + interaction.to[1]) / 2, z: (interaction.from[2] + interaction.to[2]) / 2 };
            viewerInstance.addLabel(`${INTERACTION_LABELS[interaction.type].one} · ${interaction.distance.toFixed(1)} Å`, {
              position: mid, backgroundColor: theme.colors.canvas, fontColor: theme.colors.inkStrong, fontSize: 12, showBackground: true,
              inFront: true, backgroundOpacity: 0.9, padding: 4, borderRadius: 4, borderColor: color, borderThickness: 1.5
            });
          }
        });
        // One label per partner residue with a specific contact (hydrophobic ones only when focused)
        const multiChainPartners = new Set(site.interactions.map(i => i.partner.chain)).size > 1;
        const labelled = new Set<string>();
        site.interactions.forEach((interaction, index) => {
          const key = variantKey(interaction.partner.chain, interaction.partner.resi, interaction.partner.icode);
          if (labelled.has(key) || interaction.partner.resn === 'HOH') return;
          if (interaction.type === 'hydrophobic' && focusInteraction !== index) return;
          labelled.add(key);
          const atoms = (viewerInstance.selectedAtoms({ chain: interaction.partner.chain, resi: interaction.partner.resi }) || [])
            .filter((a: any) => (a.icode ?? '').trim() === interaction.partner.icode);
          const sideChain = atoms.filter((a: any) => !['N', 'C', 'O', 'CA'].includes(a.atom));
          const shown = sideChain.length > 0 ? sideChain : atoms;
          if (shown.length === 0) return;
          const at = shown.reduce((s: any, a: any) => ({ x: s.x + a.x / shown.length, y: s.y + a.y / shown.length, z: s.z + a.z / shown.length }), { x: 0, y: 0, z: 0 });
          viewerInstance.addLabel(partnerLabel(interaction.partner, multiChainPartners), {
            position: at, backgroundColor: theme.colors.canvas, fontColor: theme.colors.ink, fontSize: 11, showBackground: true,
            inFront: true, backgroundOpacity: 0.8, padding: 2, borderRadius: 3, borderColor: theme.colors.line2, borderThickness: 1
          });
        });
      }

      // --- LAYERS: anything switched off in the inspector is drawn as nothing ---
      for (const id of hiddenLayers) {
        if (id.startsWith('chain:')) safeSetStyle({ chain: id.slice(6), hetflag: false }, {});
        else if (id === 'ligands') safeSetStyle({ hetflag: true, predicate: (a: any) => a.resn !== 'HOH' && a.resn !== 'DOD' }, {});
        else if (id === 'waters') safeSetStyle({ hetflag: true, predicate: (a: any) => a.resn === 'HOH' || a.resn === 'DOD' }, {});
      }

      // --- SELECTION: what the user picked, drawn over everything else ---
      // One bright colour at every granularity, so
      // a pick made in the sequence strip and one made in the canvas look identical.
      if (selection.keys.size > 0) {
        const selectionColor = theme.colorScheme === 'dark' ? '#FACC15' : '#A16207';
        const spec = toAtomSpec(selection.keys);
        viewerInstance.addStyle(spec, { stick: { radius: 0.26, color: selectionColor } });
        if (selection.keys.size <= MAX_BALL_RESIDUES) {
          viewerInstance.addStyle(spec, { sphere: { scale: 0.32, color: selectionColor } });
        }
        if (selection.focus && model) {
          const focused = model.byKey.get(selection.focus);
          if (focused) {
            viewerInstance.addLabel(`${residueLabel(focused)} · ${focused.chain}`, {
              position: { x: focused.center[0], y: focused.center[1], z: focused.center[2] },
              backgroundColor: theme.colors.canvas, fontColor: theme.colors.inkStrong, fontSize: 12, showBackground: true,
              inFront: true, backgroundOpacity: 0.9, padding: 4, borderRadius: 4, borderColor: selectionColor, borderThickness: 1.5,
            });
          }
        }
      }

      // --- OVERLAY: the structure laid over. Distance: a thin line in one plain colour, as the
      // colouring of the structure on screen already says how far each part moved. Two colours: a
      // full ribbon in orange against the blue. Styled last, so the styles above that reach every
      // model ("all ligands", "all metals") never stick to it ---
      const ghost = overlayModelRef.current;
      if (ghost && overlayResult) {
        const plain = theme.colorScheme === 'dark' ? OVERLAY_LINE.dark : OVERLAY_LINE.light;
        ghost.model.setStyle({}, {});
        ghost.model.setStyle({ hetflag: false }, overlayColour === 'pair'
          ? (vizStyle === 'stick' ? { stick: { radius: 0.15, color: PAIR_COLORS.other } } : { cartoon: { style: 'oval', thickness: 0.5, color: PAIR_COLORS.other } })
          : (vizStyle === 'stick' ? { stick: { radius: 0.1, color: plain } } : { cartoon: { style: 'trace', thickness: 0.35, color: plain } }));
        if (showLigands && !hiddenLayers.has('ligands')) ghost.model.setStyle({ hetflag: true }, { stick: { radius: 0.2, colorscheme: 'orangeCarbon' } });
      }

      viewerInstance.render();

    } catch (e) {
      console.error("Render Loop Error:", e);
    }
  }, [
    viewerInstance, 
    stylingTrigger, 
    colorScheme,
    showActiveSiteBalls,
    showLigands,
    showSubstrates,
    showMetals,
    vizStyle,
    structureOpacity,
    JSON.stringify(activeHighlights),
    JSON.stringify(viewMeasurements),
    variantLens.data,
    variantLens.status,
    JSON.stringify(focusSite),
    pocketView,
    focusPocket,
    themeId,
    cofoldModel,
    compareHidden,
    selectedSite,
    focusInteraction,
    selection,
    hiddenLayers,
    overlayResult,
    overlayColour,
    overlayShown
  ]);

  // Interactions: the view moves to the ligand on show when the panel opens or another ligand is picked
  const shownSiteKey = colorScheme === 'interactions' ? selectedSite?.key ?? null : null;
  useEffect(() => {
    if (!viewerInstance || !shownSiteKey || !selectedSite || contentIdRef.current !== structureId) return;
    try {
      viewerInstance.zoomTo({ chain: selectedSite.chain, resi: selectedSite.resi, resn: selectedSite.code }, 800, true);
    } catch (e) {}
  }, [shownSiteKey]);

  // A structure just laid over, or another chain pair picked: the view takes in both copies of the
  // chain. After Effect 4, which has added the overlay's model by then.
  const framedOverlayRef = useRef<string | null>(null);
  useEffect(() => {
    if (!overlayTarget) framedOverlayRef.current = null;
    if (!viewerInstance || !overlayResult || !overlayTarget) return;
    const key = `${overlayTarget}|${overlayResult.mainChain}|${overlayResult.otherChain}`;
    if (framedOverlayRef.current === key) return;
    framedOverlayRef.current = key;
    try {
      viewerInstance.zoomTo({ or: [{ chain: overlayResult.mainChain, hetflag: false }, { chain: overlayResult.shownChain, hetflag: false }] }, 800, true);
    } catch (e) {}
  }, [overlayResult, overlayTarget]);

  // The whole structure: its chains, which is what a viewer opens on. Not every atom — the file's
  // waters and buffer ions sit all round the crystal and would leave the molecule small in the middle.
  const frameWhole = (duration = 0) => {
    if (!viewerInstance) return;
    try {
      const chains = { hetflag: false };
      if (viewerInstance.selectedAtoms(chains).length > 0) viewerInstance.zoomTo(chains, duration, true);
      else viewerInstance.zoomTo();
    } catch (e) {
      try { viewerInstance.zoomTo(); } catch (e2) {}
    }
  };

  // Every part an answer (or a tour step, or a quiz answer) marks, together in view
  const zoomToHighlights = (hls: Highlight[]) => {
    if (!viewerInstance) return;
    try {
      const parts = { or: hls.map(h => ({ chain: h.chain, resi: h.resi })) };
      if (viewerInstance.selectedAtoms(parts).length > 0) viewerInstance.zoomTo(parts, 1000, true);
      else frameWhole();
    } catch (e) {
      frameWhole();
    }
  };

  // Effect 5: the camera
  // Animated zooms use 3Dmol's fixed-path mode: its default mode applies relative
  // steps, so two overlapping zooms add up and can park the camera behind the model.
  useEffect(() => {
    if (!viewerInstance) return;
    if (contentIdRef.current !== structureId) return; // New structure still loading; zoom once it arrives
    if (skipZoomRef.current) { // Only AlphaFill's ligands were added: keep the view
      skipZoomRef.current = false;
      return;
    }
    // A prediction (co-fold, comparison, ESMFold) loads from memory at once, so its ID can arrive a
    // render before its atoms do: wait until the content has really changed before framing it
    if (framedStructureRef.current !== structureId && pdbContent === framedContentRef.current) return;
    // A structure opens whole, so you see what you are looking at before any detail. The view moves
    // in only when something asks for a part: a tour step, a quiz answer, a follow-up answer about
    // the same structure, or a click on a highlight, residue, pocket or interaction.
    const firstLook = framedStructureRef.current !== structureId;
    framedStructureRef.current = structureId;
    framedContentRef.current = pdbContent;
    if (pendingCameraRef.current && sharedStructureRef.current === structureId) {
      const camera = pendingCameraRef.current; // The camera of a share link
      pendingCameraRef.current = null;
      try {
        viewerInstance.setView(camera);
        return;
      } catch (e) {
        // Not a view 3Dmol accepts: fall back to the automatic framing
      }
    }
    if (firstLook || activeHighlights.length === 0) frameWhole();
    else zoomToHighlights(activeHighlights);
  }, [pdbContent, JSON.stringify(activeHighlights)]);

  // Handle Resize: the window, and the canvas's own box (a phone's sheet rising or settling, a pane
  // revealed again), redrawn once per frame at most
  useEffect(() => {
      if (!viewerInstance) return;
      let frame = 0;
      const handleResize = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          try { viewerInstance.resize(); } catch (e) {}
        });
      };
      window.addEventListener('resize', handleResize);
      const observer = new ResizeObserver(handleResize);
      if (viewerRef.current) observer.observe(viewerRef.current);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', handleResize);
        observer.disconnect();
      };
  }, [viewerInstance]);

  const handleResetView = () => frameWhole(600); // The same whole view a structure opens on

  // What the structure is made of, as switchable layers, each with the same control
  const layers: Layer[] = useMemo(() => {
    if (!model) return [];
    const toggle = (id: string) => () => setHiddenLayers(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    const zoom = (spec: any) => () => {
      try { viewerInstance?.zoomTo(spec, 800, true); } catch (e) {}
    };
    const ligands = model.ligands.filter(l => l.kind !== 'water');
    return [
      ...model.chains.map(c => ({
        id: `chain:${c.chain}`,
        kind: 'chain' as const,
        badge: c.chain,
        name: c.name ? c.name.replace(/\s*\([^)]*\)/g, '') : `Chain ${c.chain}`,
        detail: `${c.residues.length}`,
        visible: !hiddenLayers.has(`chain:${c.chain}`),
        onToggle: toggle(`chain:${c.chain}`),
        onFocus: zoom({ chain: c.chain, hetflag: false }),
      })),
      ...(ligands.length > 0
        ? [{
            id: 'ligands',
            kind: 'ligands' as const,
            name: ligands.length === 1 ? ligands[0].resn : 'Ligands & ions',
            detail: `${ligands.length}`,
            visible: !hiddenLayers.has('ligands'),
            onToggle: toggle('ligands'),
            onFocus: zoom({ hetflag: true, predicate: (a: any) => a.resn !== 'HOH' && a.resn !== 'DOD' }),
          }]
        : []),
      ...(model.waters > 0
        ? [{ id: 'waters', kind: 'waters' as const, name: 'Waters', detail: `${model.waters}`, visible: !hiddenLayers.has('waters'), onToggle: toggle('waters') }]
        : []),
    ];
  }, [model, hiddenLayers, viewerInstance]);

  // Residues an answer highlights appear as marks under the sequence, so the biology stays visible
  const sequenceMarks: SequenceMark[] = useMemo(() => {
    if (!model) return [];
    const marks: SequenceMark[] = [];
    const answer = new Set<string>();
    for (const h of activeHighlights) for (const resi of h.resi) answer.add(`${h.chain}|${resi}|`);
    if (answer.size > 0) marks.push({ keys: answer, color: theme.colors.brandFg, label: 'Highlighted in the answer' });
    if (colorScheme === 'pockets') {
      pocketView.shown.forEach((pocket, i) => {
        marks.push({ keys: new Set(pocket.residues.map(r => `${r.chain}|${r.resi}|${r.icode}`)), color: POCKET_COLORS[i], label: `Pocket ${pocket.rank}` });
      });
    }
    if (colorScheme === 'interactions' && selectedSite) {
      marks.push({
        keys: new Set(selectedSite.interactions.map(i => `${i.partner.chain}|${i.partner.resi}|${i.partner.icode}`)),
        color: theme.colors.good,
        label: `Holds ${selectedSite.code}`,
      });
    }
    if (colorScheme === 'overlay' && overlayResult) {
      const moved = [...overlayResult.distances].filter(([, d]) => d > OVERLAY_CUTOFF).map(([key]) => key);
      if (moved.length > 0) marks.push({ keys: new Set(moved), color: distanceColor(2 * OVERLAY_CUTOFF), label: `More than 2 Å from ${overlayResult.id}` });
      if (overlayResult.changed.length > 0) marks.push({ keys: new Set(overlayResult.changed.map(c => c.key)), color: theme.colors.warn, label: `Different in ${overlayResult.id}` });
    }
    return marks;
  }, [model, activeHighlights, colorScheme, pocketView, selectedSite, overlayResult, themeId]);

  // Toolbar under the structure badge
  const showAfTool = Boolean(afView) || (!propAccession && entryProteins.length > 0 && !error);
  const showLensTool = lensAvailable && !loading && !error;
  const showPocketTool = pocketsSupported(structureId) && Boolean(pdbContent) && !loading && !error;
  const showInteractionsTool = ligandsPresent && Boolean(pdbContent) && !loading && !error;
  const showPartnersTool = Boolean(onFindPartners) && partnerTargets.length > 0 && !loading && !error;
  const showCofoldTool = cofoldReady && Boolean(onCofold) && cofoldKind !== null && (cofoldKind !== 'sequence' || Boolean(esmModel))
    && Boolean(pdbContent) && searchableChains.length > 0 && !loading && !error;
  const showSimilarTool = Boolean(onFindSimilar && pdbContent && searchableChains.length > 0 && !loading && !error);
  const showOverlayTool = Boolean(pdbContent) && searchableChains.length > 0 && !loading && !error;
  const hasOverlayTools = showLensTool || showPocketTool || showInteractionsTool || showOverlayTool;

  // What the Overlay picker offers: the protein's other PDB entries (the chain on show decides which
  // protein in a complex), its AlphaFold model from an experimental entry, the entry an AlphaFold
  // model was opened from
  const overlayAccession = afAccession
    ?? entryProteins.find(p => p.segments.some(s => s.chain === (overlayResult?.mainChain ?? activeChain)))?.accession
    ?? entryProteins[0]?.accession
    ?? null;
  const overlayChoices: OverlayChoice[] = afView
    ? [{ id: afView.fromPdb, label: afView.fromPdb, detail: 'The experimental entry this model was opened from' }]
    : !isPredicted && overlayAccession
      ? [{ id: alphaFoldId(overlayAccession), label: 'AlphaFold', detail: `The predicted model of ${entryProteins.find(p => p.accession === overlayAccession)?.identifier ?? overlayAccession}` }]
      : [];
  const overlayExclude = [structureId, ...(afView ? [] : [pdbId])]; // Never offered: the structure on screen
  const overlaySource = afAccession ? 'the AlphaFold model' : isEsm ? 'your prediction' : isCofold ? 'the co-folded complex' : pdbId.toUpperCase();
  const overlayPicker = <OverlayPicker accession={overlayAccession} choices={overlayChoices} exclude={overlayExclude} onPick={startOverlay} />;
  const hasActionTools = showCofoldTool || showPartnersTool || showSimilarTool;

  // Tool labels only while the labelled toolbar fits in the header beside the structure's ID and a
  // readable stretch of its title; otherwise icons with tooltips. Labels hidden in compact mode still
  // report their full width (scrollWidth), so both modes measure the same need.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => {
      const bar = toolbarRef.current;
      if (!bar) return;
      const hidden = [...bar.querySelectorAll<HTMLElement>('[data-tool-label], [data-tool-extra]')].reduce((sum, el) => sum + el.scrollWidth - el.clientWidth, 0);
      const needed = bar.scrollWidth + hidden;
      const reserved = (titleIdRef.current?.offsetWidth ?? 48) + 140;
      setCompactTools(needed > header.clientWidth - reserved - 24);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    return () => observer.disconnect();
  }, [inspectorOpen, showAfTool, showLensTool, showPocketTool, showInteractionsTool, showOverlayTool, showPartnersTool, showCofoldTool, showSimilarTool, afView?.fromPdb, entryProteins.length, partnerTargets.length]);

  // Residues by number (the palette's "A:25", the chat's "select A:25"): selected and brought into view
  const selectResidues = ({ chain, from, to }: { chain?: string; from: number; to: number }) => {
    if (!model) return false;
    const keys: string[] = [];
    for (const c of model.chains) {
      if (chain && c.chain.toUpperCase() !== chain.toUpperCase()) continue;
      for (const r of c.residues) if (r.resi >= from && r.resi <= to) keys.push(residueKey(r));
    }
    if (keys.length === 0) return false;
    setSelection({ keys: new Set(keys), focus: keys[0] });
    openSection('focus');
    setActiveChain(model.byKey.get(keys[0])?.chain ?? activeChain);
    setTimeout(() => {
      try { viewerInstance?.zoomTo(toAtomSpec(new Set(keys)), 800, true); } catch (e) {}
    }, 0);
    return true;
  };

  // An answer's highlights selected and brought into view (the chat's "Marked in 3D" rows, the
  // inspector's "Select the marked residues"); false when none of them are in this structure
  const focusHighlights = (hls: Highlight[]) => {
    // Answers number residues like the entry; on its AlphaFold model they are mapped across first
    const mapped = toModelHighlights(hls) ?? [];
    if (!model || mapped.length === 0) return false;
    const keys: string[] = [];
    for (const h of mapped) {
      const wanted = new Set(h.resi);
      for (const [key, r] of model.byKey) if (r.chain === h.chain && wanted.has(r.resi)) keys.push(key);
    }
    if (keys.length === 0) return false;
    setSelection({ keys: new Set(keys), focus: keys[0] });
    openSection('focus');
    setActiveChain(model.byKey.get(keys[0])?.chain ?? activeChain);
    setTimeout(() => {
      try { viewerInstance?.zoomTo(toAtomSpec(new Set(keys)), 800, true); } catch (e) {}
    }, 0);
    return true;
  };

  type ToolName = Parameters<WorkspaceCommands['openTool']>[0];
  const toolAvailable = (tool: ToolName) =>
    tool === 'pockets' ? showPocketTool
    : tool === 'interactions' ? showInteractionsTool
    : tool === 'pathogenicity' ? showLensTool
    : tool === 'overlay' ? showOverlayTool
    : tool === 'cofold' ? showCofoldTool
    : tool === 'partners' ? showPartnersTool
    : tool === 'similar' ? showSimilarTool
    : tool === 'alphafold' ? showAfTool
    : false;
  const openTool = (tool: ToolName) => {
    setToolMenu(null);
    if (tool === 'pockets' || tool === 'interactions' || tool === 'pathogenicity') openOverlay(tool);
    else if (tool === 'overlay') setToolMenu('overlay'); // What to lay over is picked there
    else if (tool === 'cofold') setToolMenu('cofold');
    else if (tool === 'similar') findSimilar();
    else if (tool === 'partners' && partnerTargets[0]) findPartners(partnerTargets[0].accession, partnerTargets[0].label);
    else if (tool === 'alphafold' && entryProteins[0]) openAlphaFold(entryProteins[0].accession);
  };
  // Why a tool the chat asked for isn't there
  const TOOL_MISSING: Record<ToolName, string> = {
    pockets: "pocket predictions aren't available for this structure",
    interactions: 'this structure has no ligands to show interactions for',
    pathogenicity: 'Variant Lens needs a human protein with AlphaMissense scores',
    overlay: 'there is no protein chain here to line up',
    cofold: "co-folding isn't available for this structure",
    partners: 'no protein here has interaction data to look up',
    similar: 'there is no protein chain to search with',
    alphafold: 'this entry has no AlphaFold model to open',
  };

  // An overlay the chat asked for reports once it is lined up (or why it couldn't be), not when it starts
  const overlayWaiterRef = useRef<{ id: string; resolve: (state: OverlayState | null) => void } | null>(null);
  useEffect(() => {
    const waiter = overlayWaiterRef.current;
    if (!waiter) return;
    if (overlayWith?.id !== waiter.id || colorScheme !== 'overlay') {
      overlayWaiterRef.current = null;
      waiter.resolve(null); // Closed, or something else replaced it first
    } else if (overlayState.status === 'ready' || overlayState.status === 'error') {
      overlayWaiterRef.current = null;
      waiter.resolve(overlayState);
    }
  }, [overlayState, overlayWith, colorScheme]);

  /** One chat action, run now: what it did, or why it couldn't (an overlay: once it is lined up). */
  const runChatAction = (action: ChatAction): ActionResult | Promise<ActionResult> => {
    const toggleLayer = (id: string, shown: boolean) => setHiddenLayers(current => {
      const next = new Set(current);
      if (shown) next.delete(id);
      else next.add(id);
      return next;
    });
    switch (action.kind) {
      case 'shape':
        setVizStyle(action.shape);
        return actionDone(action);
      case 'colour':
        if (action.colouring === 'confidence' && !isPredicted) return actionFailed(action, 'only predicted models carry a confidence');
        selectColorScheme(action.colouring);
        return actionDone(action);
      case 'opacity':
        setStructureOpacity(Math.round(Math.min(100, Math.max(0, action.opacity))));
        return actionDone(action);
      case 'part':
        if (action.part === 'waters') {
          if (!model?.waters) return actionFailed(action, 'this structure has no waters');
          toggleLayer('waters', action.shown);
        } else {
          ({ highlights: setShowActiveSiteBalls, ligands: setShowLigands, substrates: setShowSubstrates, metals: setShowMetals })[action.part](action.shown);
        }
        return actionDone(action);
      case 'chain': {
        const chain = model?.chains.find(c => c.chain.toUpperCase() === action.chain.toUpperCase())?.chain;
        if (!chain) return actionFailed(action, `this structure has no chain ${action.chain}`);
        toggleLayer(`chain:${chain}`, action.shown);
        return actionDone(action);
      }
      case 'tool':
        if (!toolAvailable(action.tool)) return actionFailed(action, TOOL_MISSING[action.tool]);
        // Both run as chat turns, which wait for the one in progress
        if ((action.tool === 'similar' || action.tool === 'partners') && isChatBusy) return actionFailed(action, 'the chat is busy; ask again once it is done');
        openTool(action.tool);
        return actionDone(action);
      case 'close-tool': {
        if (!isOverlayScheme(colorScheme)) return actionFailed(action, 'no tool is open');
        const name = colorScheme === 'pockets' ? 'Pockets' : colorScheme === 'interactions' ? 'Interactions' : colorScheme === 'overlay' ? 'Overlay' : 'Variant Lens';
        closeOverlay();
        return actionDone(action, `${name} closed`);
      }
      case 'overlay': {
        if (!showOverlayTool) return actionFailed(action, TOOL_MISSING.overlay);
        let id = action.with;
        if (id === 'alphafold') {
          if (afAccession) return actionFailed(action, 'the AlphaFold model is the structure on screen');
          if (!overlayAccession) return actionFailed(action, 'no AlphaFold model is known for this structure');
          id = alphaFoldId(overlayAccession);
        }
        const target = id.trim().toUpperCase();
        if (target === structureId || (!afView && target === pdbId.toUpperCase())) return actionFailed(action, "that's the structure on screen");
        overlayWaiterRef.current?.resolve(null);
        startOverlay(target);
        return new Promise<ActionResult>(resolve => {
          overlayWaiterRef.current = {
            id: target,
            resolve: state => resolve(state?.status === 'ready'
              ? actionDone(action, `Overlay: ${state.result.id}`)
              : actionFailed(action, state?.status === 'error' ? state.error : 'something else replaced it first')),
          };
        });
      }
      case 'reset':
        handleResetView();
        return actionDone(action);
      case 'select':
        return selectResidues(action) ? actionDone(action) : actionFailed(action, 'this structure has no such residues');
      case 'clear-selection':
        clearSelection();
        return actionDone(action);
      case 'inspector':
        showInspector(action.open);
        return actionDone(action);
      default:
        return actionFailed(action, "that isn't something the viewer does"); // Theme and tour belong to the chat
    }
  };

  // Chat actions wait until their structure is on screen and has made its own automatic choices
  // (confidence colouring, the fade behind highlights), so those don't overwrite them. Tools that
  // depend on the entry's UniProt mapping (Variant Lens, AlphaFold, Partners) also wait for that,
  // up to 8 s.
  const handledActionsRef = useRef<number | null>(null);
  const [mappingWaitOver, setMappingWaitOver] = useState<number | null>(null);
  useEffect(() => {
    const request = actionRequest;
    if (!request || handledActionsRef.current === request.id) return;
    if (request.target && request.target.toUpperCase() !== pdbId.toUpperCase()) return; // Its structure is still on its way
    const failed = error ? "the structure didn't load" : null;
    const settled = Boolean(pdbContent) && !loading && contentIdRef.current === structureId && (!isPredicted || Boolean(predictedModelId));
    if (!failed && !settled) return;
    const needsMapping = request.actions.some(a => (a.kind === 'tool' && (a.tool === 'pathogenicity' || a.tool === 'alphafold' || a.tool === 'partners')) || (a.kind === 'overlay' && a.with === 'alphafold'));
    const mappingKnown = Boolean(parseAlphaFoldId(pdbId)) || isEsm || isCofold || entryProteinList.pdbId === pdbId.toUpperCase();
    if (!failed && needsMapping && !mappingKnown && mappingWaitOver !== request.id) {
      const timer = setTimeout(() => setMappingWaitOver(request.id), 8000);
      return () => clearTimeout(timer);
    }
    handledActionsRef.current = request.id;
    // A moment later for an answer's new structure, so the camera has framed it first
    setTimeout(() => {
      Promise.all(request.actions.map(a => (failed ? actionFailed(a, failed) : runChatAction(a))))
        .then(results => onActionsDone?.(request.id, results));
    }, request.target ? 150 : 0);
  }, [actionRequest?.id, pdbId, pdbContent, loading, error, structureId, predictedModelId, entryProteinList, mappingWaitOver]);

  // What the palette and the keyboard can drive. Published on every render so it never goes stale.
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = {
      setVizStyle,
      setColorScheme: scheme => selectColorScheme(scheme as ColorScheme),
      resetView: handleResetView,
      toggleInspector: () => showInspector(phone ? phoneSheet !== 'inspector' : !inspectorOpen),
      clearSelection,
      selectResidues,
      focusHighlights,
      openTool,
      available: tool => toolAvailable(tool as ToolName),
      structureId,
      chains: model?.chains.map(c => c.chain) ?? [],
    };
  });

  // What "Share" puts in its link besides the answer: always the current values
  useEffect(() => {
    if (!viewStateRef) return;
    viewStateRef.current = () => {
      let camera: number[] | undefined;
      try {
        const view = viewerInstance?.getView?.();
        if (Array.isArray(view)) camera = view;
      } catch (e) {}
      // Links don't carry an overlay yet: they keep the colouring under it
      const scheme = colorScheme === 'overlay' ? (isOverlayScheme(schemeBeforeOverlay.current) ? 'element' : schemeBeforeOverlay.current) : colorScheme;
      return { colorScheme: scheme, vizStyle, opacity: structureOpacity, ...(afView ? { alphaFold: afView.accession } : {}), ...(camera ? { camera } : {}) };
    };
  });

  // The inspector's sections: in the column beside the canvas, or in a phone's sheet, where an open
  // tool's panel comes first, so it is what rises into view
  const focusSection = (
    <InspectorSection
      id="focus"
      title="Focus"
      icon={SECTION_ICONS.focus}
      open={openSections.includes('focus')}
      onToggle={toggleSection}
      badge={selection.keys.size > 0 ? selection.keys.size : undefined}
    >
      <FocusSection
        model={model}
        selection={selection}
        onPick={pickResidue}
        onZoom={zoomToSelection}
        onClear={clearSelection}
        onAsk={onAsk}
        onCofold={showCofoldTool && selection.keys.size >= 3 ? () => setToolMenu('cofold') : undefined}
        onSelectMarked={highlights.length > 0 ? () => { focusHighlights(highlights); } : undefined}
        onSelectChain={chain => { selectResidues({ chain, from: -Infinity, to: Infinity }); }}
        onHover={setHoveredKey}
      />
    </InspectorSection>
  );
  const compareSection = (
    <>
    {/* A comparison: show either molecule or both, like the checkbox column of a docking viewer */}
    {cofoldModel?.compare && (
      <InspectorSection id="compare" title="Comparison" icon={SECTION_ICONS.compare} open={openSections.includes('compare')} onToggle={toggleSection}>
        <div className="space-y-1" role="group" aria-label="Molecules shown">
          {(['a', 'b'] as const).map(side => {
            const molecule = side === 'a' ? cofoldModel : cofoldModel.compare!.other;
            const iptm = molecule.scores.ligandIptm ?? molecule.scores.iptm;
            const otherSide = side === 'a' ? 'b' : 'a';
            const lastVisible = !compareHidden[side] && compareHidden[otherSide];
            return (
              <div
                key={side}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-colors ${compareHidden[side] ? 'border-line opacity-60' : 'border-line-2 bg-chip/30'}`}
                title={lastVisible ? 'At least one molecule stays visible' : undefined}
              >
                <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-line-2" style={{ background: COMPARE_COLORS[side].swatch }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-ink-strong" title={molecule.ligand.name}>{molecule.ligand.name}</span>
                  <span className="block truncate text-[10.5px] text-ink-dim tabular-nums">
                    {iptm !== null ? `ipTM ${iptm.toFixed(2)}` : ''}{molecule.affinity ? ` · ≈ ${formatIc50(molecule.affinity.log10Ic50)}` : ''}
                  </span>
                </span>
                <Switch
                  checked={!compareHidden[side]}
                  disabled={lastVisible}
                  onChange={() => setCompareHidden(h => ({ ...h, [side]: !h[side] }))}
                  label={`Show ${molecule.ligand.name}`}
                />
              </div>
            );
          })}
          <p className="px-0.5 pt-1 text-[10.5px] leading-snug text-ink-dim tabular-nums">
            {cofoldModel.compare.shared.length} of {cofoldModel.compare.shared.length + cofoldModel.compare.onlyA.length + cofoldModel.compare.onlyB.length} residues shared · {cofoldModel.compare.centroidDistance.toFixed(1)} Å apart
          </p>
        </div>
      </InspectorSection>
    )}
    </>
  );
  const toolSections = (
    <>
    {/* An open tool docks here, under the selection, rather than floating over the structure or
        waiting at the bottom of the column */}
    {colorScheme === 'pathogenicity' && (
      <InspectorSection id="lens" title="Variant Lens" icon={<DnaIcon />} active open={!foldedTools.includes('lens')} onToggle={toggleTool} onClose={closeOverlay} closeLabel="Close Variant Lens">
        <VariantLensPanel
          docked
          status={variantLens.status}
          data={variantLens.data}
          error={variantLens.error}
          collapsed={false}
          focused={focusSite}
          onToggleCollapsed={() => {}}
          onClose={closeOverlay}
          onRetry={() => setLensRetry(n => n + 1)}
          onFocus={focusOnSite}
        />
      </InspectorSection>
    )}

    {colorScheme === 'pockets' && (
      <InspectorSection id="pockets" title="Pocket Radar" icon={<RadarIcon />} active open={!foldedTools.includes('pockets')} onToggle={toggleTool} onClose={closeOverlay} closeLabel="Close Pocket Radar">
        <PocketRadarPanel
          docked
          state={pockets}
          collapsed={false}
          focusedRank={focusPocket}
          isSurface={vizStyle === 'surface'}
          onToggleCollapsed={() => {}}
          onClose={closeOverlay}
          onRetry={() => setPocketRetry(n => n + 1)}
          onFocus={focusOnPocket}
          onToggleSurface={() => setVizStyle(v => (v === 'surface' ? 'cartoon' : 'surface'))}
          onCofold={showCofoldTool && !isChatBusy ? cofoldIntoPocket : undefined}
        />
      </InspectorSection>
    )}

    {colorScheme === 'overlay' && overlayState.status !== 'idle' && (
      <InspectorSection id="overlay" title="Overlay" icon={<OverlayIcon />} active open={!foldedTools.includes('overlay')} onToggle={toggleTool} onClose={closeOverlay} closeLabel="Close Overlay">
        <OverlayPanel
          state={overlayState}
          sourceLabel={overlaySource}
          colour={overlayColour}
          shown={overlayShown}
          choosing={overlayChoosing}
          picker={overlayPicker}
          onChoosing={setOverlayChoosing}
          onColour={setOverlayColour}
          onShown={setOverlayShown}
          onChains={(main, other) => {
            setOverlayChains({ main, other });
            setActiveChain(main);
          }}
          onFocus={focusOverlayKeys}
          onRetry={() => setOverlayRetry(n => n + 1)}
        />
      </InspectorSection>
    )}

    {colorScheme === 'interactions' && (
      <InspectorSection id="interactions" title="Interactions" icon={<InteractionsIcon />} active open={!foldedTools.includes('interactions')} onToggle={toggleTool} onClose={closeOverlay} closeLabel="Close Interactions">
        <InteractionsPanel
          docked
          sites={interactionSites}
          selected={selectedSite}
          focused={focusInteraction}
          collapsed={false}
          names={interactionNames}
          onSelect={selectInteractionLigand}
          onFocus={focusOnInteraction}
          onToggleCollapsed={() => {}}
          onClose={closeOverlay}
        />
      </InspectorSection>
    )}
    </>
  );
  const styleSection = (
    <InspectorSection id="style" title="Style" icon={SECTION_ICONS.style} open={openSections.includes('style')} onToggle={toggleSection}>
      <StyleSection
        vizStyle={vizStyle}
        colorScheme={colorScheme}
        colorOptions={[
          ...(isPredicted ? [{ value: 'confidence', label: 'Model confidence' }] : []),
          { value: 'element', label: 'Element' },
          { value: 'rainbow', label: 'Rainbow' },
          { value: 'chain', label: 'Chain' },
          { value: 'hydrophobicity', label: 'Hydrophobic' },
          { value: 'residue', label: 'Residue type' },
          { value: 'pathogenicity', label: 'Pathogenicity' },
          ...(pocketsSupported(structureId) ? [{ value: 'pockets', label: 'Pockets' }] : []),
          ...(ligandsPresent ? [{ value: 'interactions', label: 'Interactions' }] : []),
          // Opened from the toolbar, where the structure to lay over is picked; listed while it is on
          ...(colorScheme === 'overlay' ? [{ value: 'overlay', label: 'Overlay' }] : []),
        ]}
        opacity={structureOpacity}
        toggles={[
          { part: 'highlights', label: 'Highlights', checked: showActiveSiteBalls, onChange: setShowActiveSiteBalls, hint: 'Residues the answer calls out' },
          { part: 'ligands', label: 'Ligands', checked: showLigands, onChange: setShowLigands, hint: 'Ligands the answer marks' },
          { part: 'substrates', label: 'Substrates', checked: showSubstrates, onChange: setShowSubstrates, hint: 'Substrates the answer marks' },
          { part: 'metals', label: 'Metals & ions', checked: showMetals, onChange: setShowMetals, hint: 'Metals and ions the answer marks' },
        ]}
        onVizStyle={setVizStyle}
        onColorScheme={v => selectColorScheme(v as ColorScheme)}
        onOpacity={setStructureOpacity}
      />
    </InspectorSection>
  );
  const layersSection = (
    <InspectorSection id="layers" title="Layers" icon={SECTION_ICONS.layers} open={openSections.includes('layers')} onToggle={toggleSection} badge={layers.length || undefined}>
      <LayersSection layers={layers} />
    </InspectorSection>
  );

  // --- A phone's tools: one list, each tool named and explained (no hover to ask an icon what it is) ---
  const phoneTools: { key: string; icon: React.ReactNode; label: string; detail: string; on?: boolean; more?: boolean; disabled?: boolean; run: () => void }[] = [
    ...(afView
      ? [{ key: 'experimental', icon: <ArrowLeftIcon />, label: `Experimental ${afView.fromPdb}`, detail: 'Back to the structure from the PDB', run: () => { setAfView(null); closeSheet(); } }]
      : showAfTool
        ? [{
            key: 'alphafold', icon: <SparkIcon />, label: 'AlphaFold model', detail: 'The full-length predicted structure, coloured by confidence',
            more: entryProteins.length > 1,
            run: () => (entryProteins.length === 1 ? (openAlphaFold(entryProteins[0].accession), closeSheet()) : setToolMenu('alphafold')),
          }]
        : []),
    ...(showLensTool ? [{ key: 'lens', icon: <DnaIcon />, label: 'Variant Lens', detail: 'How harmful each mutation is predicted to be, and known disease variants', on: colorScheme === 'pathogenicity', run: () => (colorScheme === 'pathogenicity' ? closeOverlay() : enableLens()) }] : []),
    ...(showPocketTool ? [{ key: 'pockets', icon: <RadarIcon />, label: 'Pockets', detail: 'Where ligands and drugs could bind', on: colorScheme === 'pockets', run: () => (colorScheme === 'pockets' ? closeOverlay() : openOverlay('pockets')) }] : []),
    ...(showInteractionsTool ? [{ key: 'interactions', icon: <InteractionsIcon />, label: 'Interactions', detail: 'What holds each ligand: hydrogen bonds, salt bridges, stacking', on: colorScheme === 'interactions', run: () => (colorScheme === 'interactions' ? closeOverlay() : openOverlay('interactions')) }] : []),
    ...(showOverlayTool ? [{ key: 'overlay', icon: <OverlayIcon />, label: 'Overlay', detail: 'Lay another structure of this protein over it, to see what moved', on: colorScheme === 'overlay', more: colorScheme !== 'overlay', run: () => (colorScheme === 'overlay' ? closeOverlay() : setToolMenu('overlay')) }] : []),
    ...(showCofoldTool ? [{ key: 'cofold', icon: <MoleculeIcon />, label: 'Co-fold', detail: 'Predict how a molecule binds, and how strongly', more: true, run: () => setToolMenu('cofold') }] : []),
    ...(showPartnersTool
      ? [{
          key: 'partners', icon: <NetworkIcon />, label: 'Partners', detail: isChatBusy ? 'Once the current answer has arrived' : 'The proteins it works with, and the complexes they form',
          disabled: isChatBusy, more: partnerTargets.length > 1,
          run: () => (partnerTargets.length === 1 ? (findPartners(partnerTargets[0].accession, partnerTargets[0].label), closeSheet()) : setToolMenu('partners')),
        }]
      : []),
    ...(showSimilarTool ? [{ key: 'similar', icon: <SimilarIcon />, label: 'Find similar', detail: isChatBusy ? 'Once the current answer has arrived' : 'Proteins with a similar 3D shape', disabled: isChatBusy, run: () => { findSimilar(); closeSheet(); } }] : []),
  ];
  const activeTool = phoneTools.find(t => t.on);

  const sheetTitle = toolMenu === 'alphafold' ? 'AlphaFold model'
    : toolMenu === 'partners' ? 'Interaction partners'
    : toolMenu === 'overlay' ? 'Overlay'
    : toolMenu === 'cofold' ? 'Co-fold a molecule'
    : phoneSheet === 'tools' ? `Tools for ${afAccession ?? (isEsm ? 'your prediction' : isCofold ? 'the complex' : pdbId.toUpperCase())}`
    : 'Inspector';
  const phoneList = (heading: string, items: { key: string; label: string; detail: string }[], onPick: (key: string) => void) => (
    <div className="py-2">
      <p className="px-4 pt-1 pb-2 text-[12px] text-ink-muted">{heading}</p>
      {items.map(item => (
        <button key={item.key} type="button" onClick={() => onPick(item.key)} className="w-full flex items-center gap-3 min-h-[52px] px-4 text-left active:bg-chip">
          <span className="text-[15px] font-semibold text-ink-strong">{item.label}</span>
          <span className="text-[13px] text-ink-dim tabular-nums">{item.detail}</span>
        </button>
      ))}
    </div>
  );
  const sheetBody = !phone ? null
    : toolMenu === 'alphafold' && !afView ? phoneList('The predicted model of which protein in this entry?', entryProteins.map(p => ({ key: p.accession, label: p.identifier, detail: p.accession })), accession => { openAlphaFold(accession); closeSheet(); })
    : toolMenu === 'partners' ? phoneList('Interaction partners of which protein?', partnerTargets.map(t => ({ key: t.accession, label: t.label, detail: t.accession })), accession => {
        const target = partnerTargets.find(t => t.accession === accession);
        if (target) findPartners(target.accession, target.label);
        closeSheet();
      })
    : toolMenu === 'overlay' ? <OverlayMenu inline sourceLabel={overlaySource} accession={overlayAccession} choices={overlayChoices} exclude={overlayExclude} onPick={startOverlay} />
    : toolMenu === 'cofold' && cofoldOptions ? (
        <CofoldMenu
          inline
          key={`${structureId}|${cofoldPreset ?? ''}`}
          setup={cofoldOptions}
          initialSiteId={cofoldPreset ?? undefined}
          sourceLabel={cofoldKind === 'pdb' ? pdbId.toUpperCase() : cofoldKind === 'alphafold' ? 'the AlphaFold model' : 'your ESMFold prediction'}
          disabledReason={isChatBusy ? 'Available once the current answer has arrived' : undefined}
          onSubmit={choice => { startCofold(choice); closeSheet(); }}
        />
      )
    : phoneSheet === 'tools' ? (
        <div className="py-1.5" role="list">
          {phoneTools.map(t => (
            <button
              key={t.key}
              type="button"
              role="listitem"
              data-phone-tool={t.key}
              disabled={t.disabled}
              aria-pressed={t.more ? undefined : t.on}
              // An open tool shows its panel (its own X there closes it)
              onClick={t.on ? () => { setToolMenu(null); setPhoneSheet('inspector'); setSheetSize('half'); } : t.run}
              className="w-full flex items-center gap-3.5 min-h-[60px] px-4 py-2 text-left active:bg-chip disabled:opacity-45"
            >
              <span className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border [&>svg]:w-[18px] [&>svg]:h-[18px] ${t.on ? 'bg-chip border-line-2 text-brand-fg' : 'border-line text-ink-muted'}`}>{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-tight text-ink-strong">{t.label}</span>
                <span className="block mt-0.5 text-[12.5px] leading-snug text-ink-muted">{t.detail}</span>
              </span>
              {t.on ? (
                <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-strong"><span className="w-1.5 h-1.5 rounded-full bg-good" />On</span>
              ) : t.more ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-ink-dim"><path d="m9 18 6-6-6-6" /></svg>
              ) : null}
            </button>
          ))}
        </div>
      )
    : (
        <>
          {toolSections}
          {compareSection}
          {focusSection}
          {styleSection}
          {layersSection}
        </>
      );
  // The line under a phone's canvas says what is on screen, as the header has no room for the name
  const phoneCaption = [
    afAccession && afModel?.description ? afModel.description : title,
    isPredicted ? `${isEsm ? 'Predicted' : isCofold ? 'Co-folded' : 'AlphaFold'}${prediction?.meanPlddt !== undefined ? ` · pLDDT ${Math.round(prediction.meanPlddt)}` : ''}` : null,
  ].filter(Boolean).join(' · ');

  return (
    // The workspace: sequence above the canvas, status below it, inspector alongside, with the canvas
    // edge to edge rather than in a card.
    <div className="flex w-full h-full bg-canvas overflow-hidden">
    <div ref={viewerRootRef} className="relative flex-1 min-w-0 flex flex-col group">
      {/* The canvas column's header, level with the chat's and the inspector's: what is on screen on
          the left, the tools for it on the right. Nothing floats over the structure itself. */}
      <div ref={headerRef} className={`relative ${toolMenu ? 'z-40' : 'z-30'} flex-shrink-0 flex items-center border-b border-line bg-canvas ${phone ? 'h-11 touch:h-12 gap-2 pl-2 pr-1.5' : 'h-11 gap-3 pl-3 pr-2'}`}>
        {headerStart}
        {onShowChat && (
          <HeaderIconButton onClick={onShowChat} title="Show the chat (B)" label="Show the chat">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
          </HeaderIconButton>
        )}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span ref={titleIdRef} data-structure-id className="flex-shrink-0 inline-flex items-center h-[22px] px-1.5 rounded-md bg-chip/70 border border-line text-[12px] font-semibold text-ink-strong tabular-nums tracking-tight">
            {afAccession ?? (isEsm ? 'ESMFold' : isCofold ? 'Boltz-2' : pdbId.toUpperCase())}
          </span>
          {/* A phone shows the name in the line under the canvas instead, where it has the width */}
          {!phone && (
            <span className="min-w-0 truncate text-[13px] text-ink-muted" title={afAccession && afModel?.description ? afModel.description : title}>
              {afAccession && afModel?.description ? afModel.description : title}
            </span>
          )}
          {isPredicted && !phone && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 h-5 px-1.5 rounded-md bg-chip/50 text-[10.5px] font-medium text-ink-muted whitespace-nowrap">
              <span className="flex text-brand-fg [&>svg]:w-[10px] [&>svg]:h-[10px]"><SparkIcon /></span>
              {isEsm ? 'Predicted' : isCofold ? 'Co-folded' : 'AlphaFold'}{prediction?.meanPlddt !== undefined ? ` · pLDDT ${Math.round(prediction.meanPlddt)}` : ''}
            </span>
          )}
          {alphaFill && alphaFill.transplants.length > 0 && !phone && (
            <span
              className="hidden sm:inline-flex items-center flex-shrink-0 cursor-help h-5 px-1.5 rounded-md bg-chip/50 text-[10.5px] font-medium text-ink-muted whitespace-nowrap"
              title={`Ligands AlphaFill copied in from related PDB structures (not part of the AlphaFold prediction):\n${alphaFill.transplants
                .map(t => `• ${t.name}${t.name !== t.compound ? ` (${t.compound})` : ''} — from ${t.sourcePdb}, ${Math.round(t.identity * 100)}% identical, ${t.confidence} confidence`)
                .join('\n')}`}
            >
              AlphaFill · {alphaFill.transplants.length} {alphaFill.transplants.length === 1 ? 'ligand' : 'ligands'}
            </span>
          )}
        </div>

        {/* A phone: one labelled button for the tools (named after the open one), one for the inspector */}
        {phone && (
          <>
            {phoneTools.length > 0 && (
              <button
                type="button"
                data-sheet-toggle
                onClick={() => {
                  if (phoneSheet === 'tools' || toolMenu) return closeSheet();
                  setToolMenu(null);
                  setPhoneSheet('tools');
                  setSheetSize('half');
                  sheetForToolRef.current = false;
                }}
                aria-expanded={phoneSheet === 'tools' || toolMenu !== null}
                aria-label={activeTool ? `Tools: ${activeTool.label} is open` : 'Tools'}
                className={`flex-shrink-0 flex items-center gap-1.5 h-9 pl-2.5 pr-3 rounded-lg border text-[13px] font-medium transition-colors ${
                  phoneSheet === 'tools' || toolMenu ? 'bg-chip text-ink-strong border-line-2' : activeTool ? 'bg-chip/60 text-ink-strong border-line-2' : 'text-ink border-line'
                }`}
              >
                <span className={`flex [&>svg]:w-4 [&>svg]:h-4 ${activeTool ? 'text-brand-fg' : 'text-ink-muted'}`}>{activeTool?.icon ?? <ToolsIcon />}</span>
                {activeTool?.label ?? 'Tools'}
              </button>
            )}
            <button
              type="button"
              data-sheet-toggle
              onClick={() => showInspector(phoneSheet !== 'inspector')}
              aria-label={phoneSheet === 'inspector' ? 'Hide the inspector' : 'Show the inspector'}
              aria-expanded={phoneSheet === 'inspector'}
              title="Style, selection and layers"
              className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${phoneSheet === 'inspector' ? 'bg-chip text-ink-strong' : 'text-ink-muted'}`}
            >
              <SlidersIcon />
            </button>
          </>
        )}

        {/* Tools for what is on screen. Labels show while they fit; otherwise icons with tooltips. */}
        {!phone && (showAfTool || showLensTool || showPocketTool || showInteractionsTool || showOverlayTool || showPartnersTool || showCofoldTool || showSimilarTool) && (
          <div className="relative flex-shrink-0" ref={toolsRef}>
            <div ref={toolbarRef} role="toolbar" aria-label="Tools" className="flex items-center gap-0.5">
              {afView ? (
                <ToolButton
                  compact={compactTools}
                  icon={<ArrowLeftIcon />}
                  label={`Experimental ${afView.fromPdb}`}
                  title="Back to the experimental structure"
                  onClick={() => setAfView(null)}
                />
              ) : showAfTool ? (
                <ToolButton
                  compact={compactTools}
                  icon={<SparkIcon />}
                  label="AlphaFold model"
                  title="Open the full-length predicted structure from AlphaFold DB, coloured by confidence"
                  expanded={entryProteins.length > 1 ? toolMenu === 'alphafold' : undefined}
                  trailing={entryProteins.length > 1 && <MenuChevron open={toolMenu === 'alphafold'} />}
                  onClick={() => (entryProteins.length === 1 ? openAlphaFold(entryProteins[0].accession) : setToolMenu(m => (m === 'alphafold' ? null : 'alphafold')))}
                />
              ) : null}
              {(afView || showAfTool) && (hasOverlayTools || hasActionTools) && <ToolDivider />}
              {showLensTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<DnaIcon className="w-[13px] h-[13px]" />}
                  label="Variant Lens"
                  title={colorScheme === 'pathogenicity'
                    ? 'Close Variant Lens'
                    : 'Colour residues by predicted pathogenicity of mutations (AlphaMissense) and list known disease variants'}
                  active={colorScheme === 'pathogenicity'}
                  onClick={() => {
                    setToolMenu(null);
                    if (colorScheme === 'pathogenicity') closeOverlay();
                    else enableLens();
                  }}
                />
              )}
              {showPocketTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<RadarIcon className="w-[13px] h-[13px]" />}
                  label="Pockets"
                  title={colorScheme === 'pockets'
                    ? 'Close Pocket Radar'
                    : 'Predict where ligands and drugs could bind (P2Rank via PrankWeb)'}
                  active={colorScheme === 'pockets'}
                  onClick={() => {
                    setToolMenu(null);
                    if (colorScheme === 'pockets') closeOverlay();
                    else openOverlay('pockets');
                  }}
                />
              )}
              {showInteractionsTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<InteractionsIcon className="w-[13px] h-[13px]" />}
                  label="Interactions"
                  title={colorScheme === 'interactions'
                    ? 'Close Interactions'
                    : 'Show what holds each ligand: hydrogen bonds, salt bridges, stacking, metals, hydrophobic contacts'}
                  active={colorScheme === 'interactions'}
                  onClick={() => {
                    setToolMenu(null);
                    if (colorScheme === 'interactions') closeOverlay();
                    else openOverlay('interactions');
                  }}
                />
              )}
              {showOverlayTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<OverlayIcon className="w-[13px] h-[13px]" />}
                  label="Overlay"
                  title={colorScheme === 'overlay'
                    ? 'Close Overlay'
                    : 'Lay another structure of the same protein over this one, to see what moved: another entry, or its AlphaFold model'}
                  active={colorScheme === 'overlay'}
                  expanded={colorScheme === 'overlay' ? undefined : toolMenu === 'overlay'}
                  trailing={colorScheme !== 'overlay' && <MenuChevron open={toolMenu === 'overlay'} />}
                  onClick={() => {
                    if (colorScheme === 'overlay') {
                      setToolMenu(null);
                      closeOverlay();
                    } else setToolMenu(m => (m === 'overlay' ? null : 'overlay'));
                  }}
                />
              )}
              {hasOverlayTools && hasActionTools && <ToolDivider />}
              {showCofoldTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<MoleculeIcon />}
                  label="Co-fold"
                  title="Predict how a small molecule binds this protein, and how strongly (Boltz-2)"
                  expanded={toolMenu === 'cofold'}
                  trailing={<MenuChevron open={toolMenu === 'cofold'} />}
                  onClick={() => setToolMenu(m => (m === 'cofold' ? null : 'cofold'))}
                />
              )}
              {showPartnersTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<NetworkIcon />}
                  label="Partners"
                  title={isChatBusy
                    ? 'Available once the current answer has arrived'
                    : 'Interaction partners from STRING, and the solved complexes they form with this protein'}
                  disabled={isChatBusy}
                  expanded={partnerTargets.length > 1 ? toolMenu === 'partners' : undefined}
                  trailing={partnerTargets.length > 1 && <MenuChevron open={toolMenu === 'partners'} />}
                  onClick={() => (partnerTargets.length === 1
                    ? findPartners(partnerTargets[0].accession, partnerTargets[0].label)
                    : setToolMenu(m => (m === 'partners' ? null : 'partners')))}
                />
              )}
              {showSimilarTool && (
                <ToolButton
                  compact={compactTools}
                  icon={<SimilarIcon />}
                  label="Find similar"
                  title={isChatBusy
                    ? 'Available once the current answer has arrived'
                    : 'Search PDB and AlphaFold DB for proteins with a similar 3D shape (Foldseek)'}
                  disabled={isChatBusy}
                  onClick={() => {
                    setToolMenu(null);
                    findSimilar();
                  }}
                />
              )}
            </div>

            {toolMenu === 'alphafold' && !afView && (
              <ToolMenu title="Predicted model for" items={entryProteins.map(p => ({ key: p.accession, label: p.identifier, detail: p.accession }))} onPick={openAlphaFold} />
            )}
            {toolMenu === 'partners' && (
              <ToolMenu
                title="Interaction partners of"
                items={partnerTargets.map(t => ({ key: t.accession, label: t.label, detail: t.accession }))}
                onPick={accession => {
                  const target = partnerTargets.find(t => t.accession === accession);
                  if (target) findPartners(target.accession, target.label);
                }}
              />
            )}
            {toolMenu === 'overlay' && (
              <OverlayMenu sourceLabel={overlaySource} accession={overlayAccession} choices={overlayChoices} exclude={overlayExclude} onPick={startOverlay} />
            )}
            {toolMenu === 'cofold' && cofoldOptions && (
              <CofoldMenu
                key={`${structureId}|${cofoldPreset ?? ''}`}
                setup={cofoldOptions}
                initialSiteId={cofoldPreset ?? undefined}
                sourceLabel={cofoldKind === 'pdb' ? pdbId.toUpperCase() : cofoldKind === 'alphafold' ? 'the AlphaFold model' : 'your ESMFold prediction'}
                disabledReason={isChatBusy ? 'Available once the current answer has arrived' : undefined}
                onSubmit={startCofold}
              />
            )}
          </div>
        )}

        {!phone && !inspectorOpen && (
          <HeaderIconButton onClick={() => setInspectorOpen(true)} title="Show the inspector (I)" label="Show the inspector">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></svg>
          </HeaderIconButton>
        )}
      </div>

      {model && model.chains.length > 0 && (
        <SequenceBar
          model={model}
          selection={selection}
          marks={sequenceMarks}
          activeChain={activeChain || model.chains[0].chain}
          onActiveChain={setActiveChain}
          onPick={pickResidue}
          onPickRange={pickRange}
          onSelectChain={pickChain}
          onHover={setHoveredKey}
        />
      )}

      <div className="relative flex-1 min-h-0">
      {/* The stage: the canvas and what sits over it. A phone's sheet takes the bottom of the space, and
          the stage the rest, so the structure is framed in what can still be seen. */}
      <div className="absolute inset-x-0 top-0" data-sheet-open={sheetOpen || undefined} style={{ bottom: sheetOpen ? `${SHEET_HEIGHT[sheetSize]}%` : 0 }}>
      {/* 3Dmol's unhover callback never fires when the pointer leaves the canvas. touch-none: a finger's
          drag and pinch turn and zoom the structure, never the page. */}
      <div ref={viewerRef} className="w-full h-full relative z-10 touch-none" onMouseLeave={() => { setTooltip(null); setHoveredKey(null); }} />

      {/* A failed switch to the AlphaFold model says why, briefly, over the corner of the canvas */}
      {afNotice && (
        <div className="absolute top-3 left-3 z-20 max-w-[calc(100%-1.5rem)] pointer-events-none text-[11px] text-bad bg-canvas/90 backdrop-blur-md border border-bad/40 rounded-md px-2 py-1 shadow-float animate-argus-fade-in">
          {afNotice}
        </div>
      )}

      {/* A tour's narration, centred under the structure. It lives inside the canvas so the
          inspector beside it never pulls it off centre. */}
      {subtitle && (
        <div className={`absolute left-1/2 -translate-x-1/2 w-full max-w-lg z-30 pointer-events-none ${phone ? 'bottom-3 px-3' : 'bottom-6 px-4'}`}>
          <div className={`bg-canvas/85 backdrop-blur-md text-ink text-center rounded-2xl border border-brand/30 shadow-[0_0_24px_-8px_rgb(var(--c-accent)/0.30),0_12px_40px_-16px_rgb(var(--c-shadow)/calc(0.8*var(--shadow-k)))] animate-in fade-in slide-in-from-bottom-2 duration-300 ${phone ? 'px-4 py-3' : 'px-5 py-3'}`}>
            <p className={`font-medium leading-normal tracking-tight text-ink ${phone ? 'text-[15px]' : 'text-base'}`}>{subtitle}</p>
            {/* On a phone the chat's tour buttons are out of sight: the narration carries its own */}
            {tourControls && (
              <div className="mt-2.5 flex items-center justify-center gap-2 pointer-events-auto">
                <button
                  type="button"
                  onClick={tourControls.onPause}
                  aria-label={tourControls.paused ? 'Resume the tour' : 'Pause the tour'}
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-chip/70 text-[13px] font-medium text-ink-strong"
                >
                  {tourControls.paused ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                  )}
                  {tourControls.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={tourControls.onStop}
                  aria-label="Stop the tour"
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-full border border-line text-[13px] font-medium text-ink-muted"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
                  Stop
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legends */}
      {colorScheme === 'hydrophobicity' && (
        <div className={LEGEND_CARD}>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-2">Surface Properties</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-red-500 border border-red-600/50"></div>
              <div><span className="text-xs font-semibold text-ink block">Hydrophobic</span></div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-blue-500 border border-blue-600/50"></div>
              <div><span className="text-xs font-semibold text-ink block">Hydrophilic</span></div>
            </div>
          </div>
        </div>
      )}

      {colorScheme === 'residue' && (
        <div className={LEGEND_CARD}>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-2">Residue Key</p>
          <div className="space-y-2">
             {/* Acidic */}
            <div className="flex items-start gap-2">
              <div className="w-3 h-3 mt-0.5 rounded-sm bg-[#E60A0A] shadow-sm"></div>
              <div>
                <span className="text-[11px] font-semibold text-ink block leading-none">Acidic (-)</span>
                <span className="text-[9px] text-ink-dim leading-tight">Asp, Glu</span>
              </div>
            </div>
            {/* Basic */}
            <div className="flex items-start gap-2">
              <div className="w-3 h-3 mt-0.5 rounded-sm bg-[#3b82f6] shadow-sm"></div>
              <div>
                <span className="text-[11px] font-semibold text-ink block leading-none">Basic (+)</span>
                <span className="text-[9px] text-ink-dim leading-tight">Arg, Lys</span>
              </div>
            </div>
             {/* Hydrophobic */}
             <div className="flex items-start gap-2">
              <div className="w-3 h-3 mt-0.5 rounded-sm bg-[#22c55e] shadow-sm"></div>
              <div>
                <span className="text-[11px] font-semibold text-ink block leading-none">Hydrophobic</span>
                <span className="text-[9px] text-ink-dim leading-tight">Leu, Val, Ile, Ala</span>
              </div>
            </div>
             {/* Polar */}
             <div className="flex items-start gap-2">
              <div className="w-3 h-3 mt-0.5 rounded-sm bg-[#FA9600] shadow-sm"></div>
              <div>
                <span className="text-[11px] font-semibold text-ink block leading-none">Polar</span>
                <span className="text-[9px] text-ink-dim leading-tight">Ser, Thr</span>
              </div>
            </div>
             {/* Cys/Met */}
             <div className="flex items-start gap-2">
              <div className="w-3 h-3 mt-0.5 rounded-sm bg-[#E6E600] shadow-sm"></div>
              <div>
                <span className="text-[11px] font-semibold text-ink block leading-none">Sulfur</span>
                <span className="text-[9px] text-ink-dim leading-tight">Cys, Met</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {colorScheme === 'confidence' && (
        <div className={LEGEND_CARD}>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-2">Model confidence (pLDDT)</p>
          <div className="space-y-1.5">
            {PLDDT_BANDS.map(band => (
              <div key={band.label} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: band.color }}></div>
                <span className="text-xs font-semibold text-ink">{band.label}</span>
                <span className="ml-auto text-[10px] text-ink-dim tabular-nums">{band.range}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-ink-dim">
            {prediction?.source ?? 'The model'}'s own per-residue accuracy estimate. Below 50 often means a flexible or disordered region
            {prediction?.fractionVeryLow ? ` (${Math.round(prediction.fractionVeryLow * 100)}% of this model)` : ''}.
          </p>
          {alphaFill && alphaFill.transplants.length > 0 && (
            <p className="mt-1.5 text-[10px] leading-snug text-ink-dim">
              Ligands: copied in by AlphaFill from related PDB structures — hover one for its source.
            </p>
          )}
          {cofoldModel && (
            <p className="mt-1.5 text-[10px] leading-snug text-ink-dim">
              {cofoldModel.compare
                ? `Blue: ${cofoldModel.ligand.name}; orange: ${cofoldModel.compare.other.ligand.name}, where Boltz-2 places them`
                : `Green: ${cofoldModel.ligand.name} where Boltz-2 places it`}
              {cofoldModel.reference ? `; grey: the crystal pose from ${cofoldModel.reference.from}` : ''}.
            </p>
          )}
        </div>
      )}

      {colorScheme === 'overlay' && overlayResult && (
        <OverlayLegend
          className={LEGEND_CARD}
          result={overlayResult}
          colour={overlayColour}
          sourceLabel={overlaySource}
          shown={overlayShown}
          noPartner={theme.colorScheme === 'dark' ? theme.colors.inkMuted : theme.colors.inkDim}
          line={theme.colorScheme === 'dark' ? OVERLAY_LINE.dark : OVERLAY_LINE.light}
        />
      )}

      {/* Co-folded complex: what the green and grey sticks are (confidence colouring has its own legend) */}
      {cofoldModel && (colorScheme === 'element' || colorScheme === 'chain' || colorScheme === 'rainbow') && (
        <div className={LEGEND_CARD}>
          <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em] mb-2">{cofoldModel.compare ? 'Comparison' : 'Co-folded complex'}</p>
          <div className="space-y-1.5">
            {cofoldModel.compare ? (
              [
                { name: cofoldModel.ligand.name, swatch: COMPARE_COLORS.a.swatch, hidden: compareHidden.a },
                { name: cofoldModel.compare.other.ligand.name, swatch: COMPARE_COLORS.b.swatch, hidden: compareHidden.b },
              ].map(m => (
                <div key={m.name} className={`flex items-center gap-2 ${m.hidden ? 'opacity-40' : ''}`}>
                  <div className="w-3 h-1.5 rounded-full flex-shrink-0" style={{ background: m.swatch }}></div>
                  <span className="text-xs font-semibold text-ink leading-tight truncate">{m.name}{m.hidden ? ' (hidden)' : ''}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-3 h-1.5 rounded-full flex-shrink-0 bg-[#00ff00]"></div>
                <span className="text-xs font-semibold text-ink leading-tight">{cofoldModel.ligand.name} · Boltz-2 pose</span>
              </div>
            )}
            {cofoldModel.reference && (
              <div className="flex items-center gap-2">
                <div className="w-3 h-1.5 rounded-full flex-shrink-0" style={{ background: theme.colorScheme === 'dark' ? theme.colors.inkMuted : theme.colors.inkDim }}></div>
                <span className="text-xs font-semibold text-ink leading-tight">
                  {cofoldModel.compare ? `${(cofoldModel.compare.reference === 'b' ? cofoldModel.compare.other : cofoldModel).ligand.name} in the crystal` : 'Crystal pose'} · {cofoldModel.reference.from}
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-3 h-1.5 rounded-full flex-shrink-0" style={{ background: theme.colors.brandFg }}></div>
              <span className="text-xs font-semibold text-ink leading-tight">{cofoldModel.compare ? 'Residues within 4 Å of either' : 'Residues within 4 Å'}</span>
            </div>
          </div>
          <p className="mt-2 text-[10px] leading-snug text-ink-dim">
            A prediction (mean pLDDT {Math.round(cofoldModel.meanPlddt)}); Colouring → Confidence shows Boltz-2's per-residue certainty.
          </p>
        </div>
      )}

      {/* The tool panels now live in the inspector column, not over the canvas */}

      {tooltip && (
        <div
          className="absolute z-50 px-3 py-2 bg-canvas/95 backdrop-blur-sm text-ink rounded-lg pointer-events-none shadow-tooltip transform -translate-x-1/2 -translate-y-[120%] border border-line-2"
          style={{ top: tooltip.y, left: tooltip.x, minWidth: '140px', maxWidth: '280px' }}
        >
          <p className="text-xs font-bold leading-tight mb-0.5">{tooltip.text}</p>
          {tooltip.subtext && (
            <p className="text-[10px] text-ink-muted leading-tight">{tooltip.subtext}</p>
          )}
          <div className="absolute left-1/2 bottom-0 transform -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-canvas rotate-45 border-r border-b border-line-2"></div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/85 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3">
             <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand/25 border-t-brand shadow-[0_0_18px_-2px_rgb(var(--c-accent)/0.5)]"></div>
             <p className="text-sm font-medium text-ink tracking-tight">Rendering Structure...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/85 backdrop-blur-[2px]">
          <div className="text-bad bg-bad/10 px-4 py-3 rounded-lg border border-bad/40 shadow-float max-w-xs text-center">
            <p className="font-semibold text-sm">Error</p>
            <p className="text-xs mt-1 text-ink">{error}</p>
            {window.$3Dmol && viewerInstance && (
              <button
                onClick={() => setLoadAttempt(n => n + 1)}
                className="mt-2.5 px-3 py-1 rounded-md border border-line bg-canvas/85 text-xs font-medium text-ink hover:text-brand-text hover:border-brand/40 transition-colors"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}
      </div>

      {sheetOpen && (
        <PhoneSheet
          sheetRef={sheetRef}
          title={sheetTitle}
          label={phoneSheet === 'inspector' && !toolMenu ? 'Inspector' : undefined}
          size={sheetSize}
          onSize={setSheetSize}
          onClose={closeSheet}
          onBack={toolMenu && phoneSheet ? () => setToolMenu(null) : undefined}
        >
          {sheetBody}
        </PhoneSheet>
      )}
      </div>

      {/* A phone's sheet covers this line: what it says is in the sheet's Focus section */}
      {!sheetOpen && (
        <StatusBar
          model={model}
          selection={selection}
          hovered={hoveredKey}
          busy={loading ? 'Loading the structure…' : null}
          caption={phone ? phoneCaption : undefined}
          onClearSelection={clearSelection}
          onOpenPalette={() => onOpenPalette?.()}
          onResetView={handleResetView}
        />
      )}
    </div>

    {/* The inspector: every control in one column, each section collapsible, nothing over the canvas */}
    {inspectorOpen && !phone && (
      <>
        <ResizeHandle
          value={inspectorWidth}
          min={200}
          max={420}
          invert
          label="Resize the inspector"
          onChange={setInspectorWidth}
          onToggleCollapse={() => setInspectorOpen(false)}
        />
        <aside
          className="flex-shrink-0 flex flex-col bg-surface/40 overflow-y-auto"
          style={{ width: inspectorWidth }}
          aria-label="Inspector"
        >
          {/* Level with the chat's header and the canvas's, so the three columns share one top edge */}
          <div className="flex items-center h-11 pl-3 pr-2 border-b border-line flex-shrink-0">
            <span className="text-[13px] font-semibold tracking-tight text-ink-strong">Inspector</span>
            <button
              onClick={() => setInspectorOpen(false)}
              className="ml-auto w-7 h-7 flex items-center justify-center rounded-md text-ink-muted hover:bg-chip/60 hover:text-ink-strong transition-colors"
              title="Hide the inspector (I)"
              aria-label="Hide the inspector"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></svg>
            </button>
          </div>

          {focusSection}
          {compareSection}
          {toolSections}
          {styleSection}
          {layersSection}

        </aside>
      </>
    )}
    </div>
  );
};

// Toggle Row Component
const ToggleRow = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
  <label className="flex items-center justify-between cursor-pointer group hover:bg-chip p-1.5 -mx-1 rounded-md transition-colors select-none">
     <span className="text-[11px] font-medium text-ink group-hover:text-ink-strong transition-colors pl-1">{label}</span>

     {/* Modern Toggle Switch */}
     <div className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 ease-in-out ${checked ? 'bg-brand shadow-[0_0_10px_-2px_rgb(var(--c-accent)/0.6)]' : 'bg-line group-hover:bg-line-2'}`}>
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-knob ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`}
        />
        <input 
            type="checkbox" 
            checked={checked} 
            onChange={(e) => onChange(e.target.checked)} 
            className="hidden" 
        />
     </div>
  </label>
);

// A tool in the header. Flat until hovered or pressed, so a row of them reads as one quiet strip.
// In compact mode (the labels don't fit) the label and a menu's chevron collapse to zero width but
// keep their content, so the toolbar can still measure them; the icon, tooltip and aria-label remain.
const ToolButton = ({ icon, label, title, onClick, active, disabled = false, expanded, trailing, compact = false }: {
  icon: React.ReactNode;
  label: string;
  title: string; // What it does: the tooltip's second line
  onClick: () => void;
  active?: boolean; // Toggle tools (Variant Lens, Pockets): pressed state
  disabled?: boolean;
  expanded?: boolean; // Tools that open a menu
  trailing?: React.ReactNode;
  compact?: boolean;
}) => (
  <span className="relative flex group/tool">
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-description={title}
      aria-pressed={active}
      aria-expanded={expanded}
      className={`flex items-center h-8 px-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active || expanded ? 'bg-chip text-ink-strong ring-1 ring-inset ring-line-2' : 'text-ink-muted enabled:hover:bg-chip/60 enabled:hover:text-ink-strong'
      }`}
    >
      {/* Every tool icon at 16px, whatever size it was drawn at; an open tool's in the accent */}
      <span className={`flex-shrink-0 flex [&>svg]:w-4 [&>svg]:h-4 ${active ? 'text-brand-fg' : ''}`}>{icon}</span>
      <span data-tool-label className={`overflow-hidden ${compact ? 'max-w-0' : 'max-w-[16rem]'}`}>
        <span className="pl-1.5">{label}</span>
      </span>
      {/* A menu's chevron folds away with the label (icons only: the tooltip says what it opens) */}
      {trailing && (
        <span data-tool-extra className={`flex items-center overflow-hidden ${compact ? 'max-w-0' : 'max-w-[2rem]'}`}>
          <span className="pl-1 flex items-center">{trailing}</span>
        </span>
      )}
    </button>
    {/* The tool's name and what it does: after a short hover, or at once for keyboard focus */}
    {!expanded && (
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 mt-2 z-50 w-max max-w-[250px] rounded-lg border border-line bg-elevated px-2.5 py-1.5 shadow-menu opacity-0 -translate-y-0.5 transition duration-150 group-hover/tool:opacity-100 group-hover/tool:translate-y-0 group-hover/tool:delay-500 group-has-[:focus-visible]/tool:opacity-100 group-has-[:focus-visible]/tool:translate-y-0"
      >
        <span className="block text-[11.5px] font-semibold text-ink-strong">{label}</span>
        <span className="block mt-0.5 text-[11px] leading-snug text-ink-muted whitespace-normal">{title}</span>
      </span>
    )}
  </span>
);

// Icon-only button for the header's edges: reopening the chat or the inspector
const HeaderIconButton = ({ onClick, title, label, children }: { onClick: () => void; title: string; label: string; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={label}
    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-ink-muted hover:bg-chip/60 hover:text-ink-strong transition-colors"
  >
    {children}
  </button>
);

const MenuChevron = ({ open }: { open: boolean }) => (
  <svg width="9" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`text-ink-dim transition-transform duration-150 ${open ? 'rotate-180' : ''}`}><path d="M1 1L5 5L9 1" /></svg>
);

// Menu under the toolbar for tools that first need a protein picked (entries with several proteins).
// The toolbar sits at the header's right edge, so its menus open leftwards from there.
const ToolMenu = ({ title, items, onPick }: { title: string; items: { key: string; label: string; detail: string }[]; onPick: (key: string) => void }) => (
  <div className="absolute top-full right-0 mt-3 min-w-[210px] bg-surface border border-line rounded-lg shadow-menu z-50 overflow-hidden animate-argus-fade-in">
    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold text-ink-muted uppercase tracking-[0.18em]">{title}</p>
    {items.slice(0, 8).map(item => (
      <button
        key={item.key}
        onClick={() => onPick(item.key)}
        className="w-full text-left px-2.5 py-1.5 text-xs transition-colors hover:bg-chip flex items-baseline gap-2"
      >
        <span className="font-semibold text-ink">{item.label}</span>
        <span className="text-[10px] text-ink-dim tabular-nums">{item.detail}</span>
      </button>
    ))}
  </div>
);

const NetworkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="3.5" r="1.8"/><circle cx="4.5" cy="18.5" r="1.8"/><circle cx="19.5" cy="18.5" r="1.8"/><path d="M12 9.5V5.3M9.9 13.4l-4 3.6M14.1 13.4l4 3.6"/></svg>
);

const MoleculeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3.5 15 7v7l-6 3.5L3 14V7z"/><path d="m15 14 3.6 2.2"/><circle cx="20.4" cy="17.6" r="2.1"/></svg>
);

const SparkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
);

// "Find similar": two overlapping shapes. The magnifier already means "search commands" in the top bar.
const SimilarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>
);

// The inspector's section icons (14px, drawn on a 24px grid)
const sectionIcon = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const SECTION_ICONS = {
  focus: sectionIcon(<><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2.2" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>),
  style: sectionIcon(<><path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-3.6 3.5h-1.9a1.8 1.8 0 0 0-1.3 3.1c.9.9.3 2.4-2.2 2.4z" /><circle cx="7.5" cy="11" r="1.2" fill="currentColor" /><circle cx="11" cy="7" r="1.2" fill="currentColor" /><circle cx="16" cy="8.5" r="1.2" fill="currentColor" /></>),
  layers: sectionIcon(<><path d="m12 3 9 4.6-9 4.6-9-4.6z" /><path d="m3 12 9 4.6 9-4.6M3 16.4 12 21l9-4.6" /></>),
  compare: sectionIcon(<><rect x="3" y="4" width="7.5" height="16" rx="2" /><rect x="13.5" y="4" width="7.5" height="16" rx="2" /></>),
};

// Thin rule between groups of tools: switching the view, overlays on it, and actions that start a search or prediction
const ToolDivider = () => <span aria-hidden="true" className="w-px h-4 mx-1.5 bg-line flex-shrink-0" />;

// A phone's header: the tools (four tiles) and the inspector (sliders)
const ToolsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><circle cx="17" cy="17" r="3.6"/></svg>
);
const SlidersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>
);

const ArrowLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
);

export default ProteinViewer;
