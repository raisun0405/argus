import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReasoningEngine from './components/ReasoningEngine';
import ProteinViewer, { type ActionRequest, type WorkspaceCommands } from './components/ProteinViewer';
import { actionFailed, type ActionResult, type ChatAction } from './services/chatActions';
import { ProteinAnalysis, Highlight, SimilarSearchQuery, PartnerQuery, CofoldRequest } from './types';
import { SHARE_PREFIX, buildShareUrl, canShare, readShareHash, type SharedViewState } from './services/shareService';
import { isCofoldId } from './services/cofoldService';
import CommandPalette, { type PaletteResult } from './components/workspace/CommandPalette';
import ResizeHandle, { usePaneSize } from './components/workspace/ResizeHandle';
import ShortcutSheet from './components/workspace/ShortcutSheet';
import PaneSwitch, { type Pane } from './components/workspace/PaneSwitch';
import { isTyping, matchesChord, parseResidueQuery, type Command } from './services/commands';
import { THEME_LIST } from './themes';
import { useTheme } from './useTheme';
import { PHONE_QUERY, useMediaQuery } from './useMedia';

// Mock data for initial state (Insulin)
const INITIAL_DATA: ProteinAnalysis = {
  pdbId: '1TRZ',
  title: 'Human Insulin',
  summary: 'Insulin is a peptide hormone produced by beta cells of the pancreatic islets. This structure shows the T-state of human insulin. The disulfide bonds (Cys residues) are critical for stability and are highlighted in the detailed view.',
  highlights: [
    { chain: 'A', resi: [6, 7, 11, 20], label: "Intrachain Disulfide (A6-A11)", category: 'active_site' }, // Cys residues
    { chain: 'B', resi: [7, 19], label: "Interchain Disulfide (A7-B7, A20-B19)", category: 'active_site' },
    { chain: 'B', resi: [31], label: "Zinc Ion", category: 'metal' }, // 1TRZ holds its two Zn ions as B31 and D31
    { chain: 'D', resi: [31], label: "Zinc Ion", category: 'metal' }
  ],
  measurements: [],
  tour: [
    {
      text: "Welcome to the structure of Human Insulin. This small protein is essential for regulating blood sugar. Let's look at its key stabilizing features.",
      focus: [] // General view
    },
    {
      text: "Here on Chain A, we see an intrachain disulfide bond between Cysteine 6 and Cysteine 11. This creates a rigid loop vital for the receptor binding.",
      focus: [{ chain: 'A', resi: [6, 11], label: "Intrachain Disulfide", category: 'active_site' }]
    },
    {
      text: "Holding the two chains together are these interchain disulfide bridges. Without these, the molecule would fall apart.",
      focus: [
        { chain: 'A', resi: [7, 20], label: "Cys A7/A20", category: 'active_site' },
        { chain: 'B', resi: [7, 19], label: "Cys B7/B19", category: 'active_site' }
      ]
    }
  ]
};

const CHAT_MIN = 320;
const CHAT_MAX = 720;

const App: React.FC = () => {
  // A share link (#view=...) opens its answer and view instead of the default insulin
  const [shared] = useState(() => readShareHash(window.location.hash));
  const sharedView = shared && 'analysis' in shared ? shared : null;
  const [currentAnalysis, setCurrentAnalysis] = useState<ProteinAnalysis>(sharedView?.analysis ?? INITIAL_DATA);
  const viewStateRef = useRef<(() => SharedViewState) | null>(null); // The viewer's colouring, camera...

  // The link stays in the address bar while its answer is on screen (a reload keeps it), and goes
  // once the conversation moves on, so the address never claims a view that isn't showing
  useEffect(() => {
    if (!window.location.hash.startsWith(SHARE_PREFIX)) return;
    if (sharedView && currentAnalysis === sharedView.analysis) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [currentAnalysis]);

  // A share link opened in a tab already showing Argus only changes the fragment (no page load):
  // start over with it, exactly as a fresh visit would
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.startsWith(SHARE_PREFIX)) window.location.reload();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const getShareLink = () =>
    canShare(currentAnalysis)
      ? buildShareUrl(currentAnalysis, viewStateRef.current?.() ?? {}, window.location.origin + window.location.pathname)
      : null;
  const [tourHighlights, setTourHighlights] = useState<Highlight[]>([]);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  // "Find similar" in the viewer runs as a chat turn, so the results land in the conversation
  const [similarityRequest, setSimilarityRequest] = useState<{ id: number; query: SimilarSearchQuery } | null>(null);
  const [partnersRequest, setPartnersRequest] = useState<{ id: number; query: PartnerQuery } | null>(null); // "Partners", likewise
  const [cofoldRequest, setCofoldRequest] = useState<{ id: number; request: CofoldRequest; compareWith?: string } | null>(null); // "Co-fold" (or "Compare"), likewise
  const [askRequest, setAskRequest] = useState<{ id: number; question: string } | null>(null); // A question sent from the workspace
  const [isChatBusy, setIsChatBusy] = useState(false); // An answer, fold or search is running

  // What the chat asks the viewer to do ("surface", "open pockets", an answer's actions). The viewer
  // runs a request once its structure is on screen and reports back; a newer request, another
  // structure opening first, or 45 s without one settles a waiting request as not done.
  const [actionRequest, setActionRequest] = useState<ActionRequest | null>(null);
  const actionWaiterRef = useRef<{ request: ActionRequest; resolve: (results: ActionResult[]) => void; timer: number } | null>(null);
  const actionSeqRef = useRef(0);
  const settleActions = (id: number, results: ActionResult[] | null, note = '') => {
    const waiter = actionWaiterRef.current;
    if (!waiter || waiter.request.id !== id) return;
    clearTimeout(waiter.timer);
    actionWaiterRef.current = null;
    setActionRequest(null);
    waiter.resolve(results ?? waiter.request.actions.map(a => actionFailed(a, note)));
  };
  const runActions = (actions: ChatAction[], target?: string) => new Promise<ActionResult[]>(resolve => {
    const waiting = actionWaiterRef.current;
    if (waiting) settleActions(waiting.request.id, null, 'a newer request came first');
    const request: ActionRequest = { id: ++actionSeqRef.current, ...(target ? { target } : {}), actions };
    const timer = window.setTimeout(() => settleActions(request.id, null, 'the structure took too long to load'), 45000);
    actionWaiterRef.current = { request, resolve, timer };
    setActionRequest(request);
  });

  // --- Workspace layout ---
  // 380: the compact chat's 13px text keeps about the line length 14px had at 420 (the old default)
  const [chatWidth, setChatWidth] = usePaneSize('argus-chat-width', 380, [420]);
  const [chatOpen, setChatOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const commandsRef = useRef<WorkspaceCommands | null>(null);
  const [, setTheme] = useTheme();
  // Phones show one pane at a time, as they cannot hold both (on its side too: wide, but too short)
  const narrow = useMediaQuery(PHONE_QUERY);
  const [phoneTab, setPhoneTab] = useState<Pane>('chat');
  const [unseen3d, setUnseen3d] = useState(false); // An answer changed the 3D view while the chat was showing
  useEffect(() => {
    if (phoneTab === 'structure') setUnseen3d(false);
  }, [phoneTab]);
  // The tour, for the viewer's own controls on a phone, where the chat (and its tour buttons) is out of sight
  const [tour, setTour] = useState<{ active: boolean; paused: boolean }>({ active: false, paused: false });
  const tourControlsRef = useRef<{ pause: () => void; stop: () => void } | null>(null);
  // A tour plays on the structure, so a phone shows it
  useEffect(() => {
    if (narrow && tour.active) setPhoneTab('structure');
  }, [narrow, tour.active]);

  // --- Everything the palette can run ---
  const commands: Command[] = useMemo(() => {
    const w = () => commandsRef.current;
    const tool = (id: string, title: string, key: Parameters<WorkspaceCommands['openTool']>[0], keywords?: string, shortcut?: string): Command => ({
      id, title, group: 'Tools', keywords, shortcut,
      disabled: !w()?.available(key),
      run: () => w()?.openTool(key),
    });
    const style = (id: string, title: string, value: string): Command => ({
      id, title, group: 'View', run: () => w()?.setVizStyle(value as 'cartoon'),
    });
    const colour = (id: string, title: string, value: string, keywords?: string): Command => ({
      id, title, group: 'View', keywords, run: () => w()?.setColorScheme(value),
    });
    return [
      tool('tool-pockets', 'Pockets', 'pockets', 'binding site p2rank prankweb cavity'),
      tool('tool-interactions', 'Interactions', 'interactions', 'hydrogen bond salt bridge stacking contacts plip'),
      tool('tool-overlay', 'Overlay another structure', 'overlay', 'superpose superimpose align compare open closed form conformation rmsd matchmaker'),
      tool('tool-cofold', 'Co-fold a molecule', 'cofold', 'dock boltz ligand affinity drug'),
      tool('tool-lens', 'Variant Lens', 'pathogenicity', 'alphamissense mutation disease variant'),
      tool('tool-partners', 'Interaction partners', 'partners', 'string complex'),
      tool('tool-similar', 'Find similar structures', 'similar', 'foldseek fold search'),
      tool('tool-alphafold', 'Open the AlphaFold model', 'alphafold', 'predicted structure'),
      tool('tool-pae', 'Confidence map', 'pae', 'pae predicted aligned error alphafold domains arrangement'),
      style('view-cartoon', 'Shape: cartoon', 'cartoon'),
      style('view-stick', 'Shape: wireframe', 'stick'),
      style('view-sphere', 'Shape: spacefill', 'sphere'),
      style('view-surface', 'Shape: surface', 'surface'),
      colour('colour-element', 'Colour by element', 'element'),
      colour('colour-chain', 'Colour by chain', 'chain'),
      colour('colour-rainbow', 'Colour by rainbow', 'rainbow', 'spectrum position'),
      colour('colour-hydro', 'Colour by hydrophobicity', 'hydrophobicity', 'water polar'),
      colour('colour-residue', 'Colour by residue type', 'residue', 'amino acid'),
      colour('colour-confidence', 'Colour by model confidence', 'confidence', 'plddt predicted'),
      { id: 'view-reset', title: 'Reset the view', group: 'View', shortcut: 'r', run: () => w()?.resetView() },
      { id: 'view-picture', title: 'Save a picture of the 3D view', hint: 'A PNG of what is on screen', group: 'View', shortcut: 'p', keywords: 'download image screenshot snapshot png export photo', run: () => { w()?.savePicture(); } },
      { id: 'selection-clear', title: 'Clear the selection', group: 'Selection', shortcut: 'escape', run: () => w()?.clearSelection() },
      { id: 'ws-inspector', title: 'Show or hide the inspector', group: 'Workspace', shortcut: 'i', run: () => w()?.toggleInspector() },
      { id: 'ws-chat', title: 'Show or hide the chat', group: 'Workspace', shortcut: 'b', run: () => setChatOpen(o => !o) },
      {
        id: 'ws-share', title: 'Copy a link to this view', group: 'Workspace', keywords: 'share url',
        disabled: !canShare(currentAnalysis),
        run: () => {
          const link = getShareLink();
          if (link) navigator.clipboard?.writeText(link).catch(() => {});
        },
      },
      ...THEME_LIST.map(t => ({
        id: `theme-${t.id}`, title: `Theme: ${t.name}`, hint: t.tagline, group: 'Workspace' as const, keywords: 'colour appearance dark light',
        run: () => setTheme(t.id),
      })),
      { id: 'help-shortcuts', title: 'Keyboard shortcuts', group: 'Help', shortcut: 'shift+?', run: () => setShortcutsOpen(true) },
      // The landing page, in a new tab, so the session here stays as it is
      { id: 'help-about', title: 'About Argus', hint: 'What it does and how, in a new tab', group: 'Help', keywords: 'home landing page website project', run: () => window.open('/', '_blank', 'noopener') },
    ];
  }, [currentAnalysis, setTheme]);

  // Typing a residue in the palette offers to go there
  const dynamicResults = useMemo(
    () => (query: string): PaletteResult[] => {
      const parsed = parseResidueQuery(query);
      const workspace = commandsRef.current;
      if (!parsed || !workspace) return [];
      const chains = parsed.chain ? [parsed.chain] : workspace.chains.slice(0, 4);
      return chains.map(chain => ({
        key: `goto-${chain}-${parsed.from}-${parsed.to}`,
        title: `${chain}:${parsed.from}${parsed.to !== parsed.from ? `–${parsed.to}` : ''}`,
        hint: parsed.name ? `select ${parsed.name}${parsed.from}` : 'select and zoom',
        group: 'Go to' as const,
        run: () => workspace.selectResidues({ ...parsed, chain }),
      }));
    },
    []
  );

  // --- Global keyboard ---
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesChord(event, 'mod+k')) {
        event.preventDefault();
        setPaletteOpen(open => !open);
        return;
      }
      if (paletteOpen || shortcutsOpen) return; // Those dialogs own the keyboard while they are up
      if (matchesChord(event, 'shift+?')) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (isTyping(event.target)) return; // Never steal a letter from the chat box
      const workspace = commandsRef.current;
      if (matchesChord(event, 'escape')) workspace?.clearSelection();
      else if (matchesChord(event, 'i')) workspace?.toggleInspector();
      else if (matchesChord(event, 'b')) setChatOpen(open => !open);
      else if (matchesChord(event, 'r')) workspace?.resetView();
      else if (matchesChord(event, 'p')) workspace?.savePicture();
      else if (matchesChord(event, '1')) workspace?.setVizStyle('cartoon');
      else if (matchesChord(event, '2')) workspace?.setVizStyle('stick');
      else if (matchesChord(event, '3')) workspace?.setVizStyle('sphere');
      else if (matchesChord(event, '4')) workspace?.setVizStyle('surface');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, shortcutsOpen]);

  // A pane out of sight is hidden, never unmounted: the chat when it is collapsed on a desktop or on
  // the other tab on a phone, the viewer on a phone. Unmounting would throw away the conversation,
  // anything still running in it (an answer, a co-fold, a tour), and the viewer's state.
  const chatHidden = narrow ? phoneTab !== 'chat' : !chatOpen;
  const workspaceHidden = narrow && phoneTab !== 'structure';

  // A pane revealed from display:none has no size until the viewer measures again
  useEffect(() => {
    if (!narrow) return;
    const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => clearTimeout(timer);
  }, [phoneTab, narrow]);

  // Phones cannot hold a conversation and a 3D workspace at once: one at a time, switched from the
  // left of whichever header is showing
  const paneSwitch = narrow ? <PaneSwitch pane={phoneTab} onChange={setPhoneTab} news={unseen3d ? 'structure' : undefined} /> : undefined;

  return (
    <div className="flex flex-col argus-app w-screen overflow-hidden bg-canvas">
      <div className="flex flex-1 min-h-0 w-full">
        <div
          className={`h-full flex-shrink-0 z-20 ${chatHidden ? 'hidden' : ''}`}
          // Never more than 45% of the window: on a small screen the chat gives way to the structure
          style={narrow ? { width: '100%' } : { width: chatWidth, maxWidth: '45vw' }}
        >
          <ReasoningEngine
            onAnalysisComplete={(data, options) => {
              // Actions still waiting for another structure won't get it now
              const waiting = actionWaiterRef.current;
              if (waiting?.request.target && waiting.request.target !== data.pdbId) settleActions(waiting.request.id, null, 'another structure opened first');
              setCurrentAnalysis(data);
              setTourHighlights([]); // Reset any tour when new data arrives
              // A phone shows a newly opened structure; an answer about the one already open stays
              // readable in the chat, and the 3D switch carries a dot for what changed there
              if (narrow && !options?.quiet) {
                if (data.pdbId !== currentAnalysis.pdbId) setPhoneTab('structure');
                else if (phoneTab === 'chat' && data.highlights.length > 0) setUnseen3d(true);
              }
            }}
            onRunActions={runActions}
            onTourStep={(highlights) => setTourHighlights(highlights)}
            onSubtitleChange={(text) => setSubtitle(text)}
            currentAnalysis={currentAnalysis}
            isInitialLoad={true}
            similarityRequest={similarityRequest}
            partnersRequest={partnersRequest}
            cofoldRequest={cofoldRequest}
            askRequest={askRequest}
            onBusyChange={setIsChatBusy}
            sharedAnalysis={sharedView?.analysis}
            sharedError={shared && 'error' in shared ? shared.error : null}
            getShareLink={getShareLink}
            shareDisabledReason={canShare(currentAnalysis)
              ? undefined
              : `A ${isCofoldId(currentAnalysis.pdbId) ? 'co-folded complex' : 'folded sequence'} lives only in this browser, so it can't be shared yet`}
            onOpenPalette={() => setPaletteOpen(true)}
            onFocusHighlights={(highlights) => {
              if (commandsRef.current?.focusHighlights(highlights) && narrow) setPhoneTab('structure');
            }}
            headerStart={paneSwitch}
            onTourState={setTour}
            tourControlsRef={tourControlsRef}
          />
        </div>

        {chatOpen && !narrow && (
          <ResizeHandle
            value={chatWidth}
            min={CHAT_MIN}
            max={CHAT_MAX}
            label="Resize the chat"
            onChange={setChatWidth}
            onToggleCollapse={() => setChatOpen(false)}
          />
        )}

        <div className={`flex-1 min-w-0 h-full relative ${workspaceHidden ? 'hidden' : ''}`}>
          <ProteinViewer
            pdbId={currentAnalysis.pdbId}
            title={currentAnalysis.title}
            highlights={currentAnalysis.highlights}
            measurements={currentAnalysis.measurements}
            tourHighlights={tourHighlights}
            // These run as chat turns, so a phone goes to the chat to show them working
            onFindSimilar={(query) => {
              setSimilarityRequest({ id: Date.now(), query });
              if (narrow) setPhoneTab('chat');
            }}
            onFindPartners={(query) => {
              setPartnersRequest({ id: Date.now(), query });
              if (narrow) setPhoneTab('chat');
            }}
            onCofold={(request, compareWith) => {
              setCofoldRequest({ id: Date.now(), request, ...(compareWith ? { compareWith } : {}) });
              if (narrow) setPhoneTab('chat');
            }}
            isChatBusy={isChatBusy}
            initialView={sharedView?.view}
            viewStateRef={viewStateRef}
            commandsRef={commandsRef}
            onOpenPalette={() => setPaletteOpen(true)}
            onAsk={(question) => {
              setAskRequest({ id: Date.now(), question });
              if (narrow) setPhoneTab('chat');
            }}
            onShowChat={!chatOpen && !narrow ? () => setChatOpen(true) : undefined}
            phone={narrow}
            headerStart={paneSwitch}
            subtitle={subtitle}
            tourControls={narrow && tour.active ? {
              paused: tour.paused,
              onPause: () => tourControlsRef.current?.pause(),
              onStop: () => tourControlsRef.current?.stop(),
            } : undefined}
            actionRequest={actionRequest}
            onActionsDone={(id, results) => {
              settleActions(id, results);
              // On a phone, show what changed (searches report back in the chat, so they stay there)
              const visible = results.some(r => r.ok && !(r.action.kind === 'tool' && (r.action.tool === 'similar' || r.action.tool === 'partners')));
              if (narrow && visible) setPhoneTab('structure');
            }}
          />
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        dynamic={dynamicResults}
        onClose={() => setPaletteOpen(false)}
      />
      <ShortcutSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
};

export default App;
