
import React, { useState, useEffect, useRef } from 'react';
import { Message, ProteinAnalysis, Highlight, SimilarSearchQuery, SimilarSearchResult, SimilarStructureHit, InteractionPartner, PartnerQuery, PartnerSearchResult, CofoldRequest, TourStep } from '../types';
import { SPEECH_ENABLED, analyzeProteinQuery, generateSpeech, rememberAnalysis } from '../services/analysisService';
import QuizCard from './QuizCard';
import ThemeSwitcher from './ThemeSwitcher';
import SimilarStructuresCard from './SimilarStructuresCard';
import PartnersCard from './PartnersCard';
import CofoldCard from './CofoldCard';
import CompareCard from './CompareCard';
import ShareButton from './ShareButton';
import { shortcutLabel } from '../services/commands';
import { tweaksEnabled, useChatDemo, useChatLook } from './chat/chatLook';
import ChatBackground from './chat/ChatBackground';
import ChatLoader, { Orb } from './chat/ChatLoader';
import Composer from './chat/Composer';
import EmptyState from './chat/EmptyState';
import MarkedParts from './chat/MarkedParts';
import ActionReceipt from './chat/ActionReceipt';
import AnswerChecks from './chat/AnswerChecks';
import TweakPanel from './chat/TweakPanel';
import { actionDone, actionFailed, actionFromId, actionPlanned, parseChatCommand, type ActionResult, type ChatAction } from '../services/chatActions';
import { THEME_LIST, type ThemeId } from '../themes';
import { useTheme } from '../useTheme';
import { searchSimilarStructures } from '../services/foldseekService';
import { ESMFOLD_MAX_LENGTH, SequenceInput, foldSequence, parseSequenceInput } from '../services/esmfoldService';
import { checkAnswer, checkIdentity, correctAnswer, correctIdentity, getStructureFacts, inspectAnswer, inspectIdentity, loadStructureFacts } from '../services/groundingService';
import { collectChecks, type CheckTrail } from '../services/answerChecks';
import { complexInterface, findPartners } from '../services/partnerService';
import { cofoldAnalysis, cofoldAvailable, compareAnalysis, compareCofolds, defaultCofoldRequest, isCofoldId, parseCofoldCommand, parseCompareCommand, runCofold } from '../services/cofoldService';
import InvestigationCard from './chat/InvestigationCard';
import type { ComposerMode } from './chat/ComposerMenu';
import { fallbackWriteUp, highlightsFor, loadStructureText, requestPlan, requestWriteUp, runInvestigationSteps, stepHighlights, type InvestigationState, type InvestigationStep } from '../services/investigation';
import { fallbackPlan, parseInvestigateCommand, stepLabel, stripCitations } from '../services/investigationPlan';

interface ReasoningEngineProps {
  onAnalysisComplete: (data: ProteinAnalysis, options?: { quiet?: boolean }) => void; // quiet: open it without switching a phone to the structure
  onTourStep: (highlights: Highlight[]) => void;
  onSubtitleChange: (text: string | null) => void;
  currentAnalysis?: ProteinAnalysis;
  isInitialLoad?: boolean;
  similarityRequest?: { id: number; query: SimilarSearchQuery } | null; // "Find similar" from the viewer
  partnersRequest?: { id: number; query: PartnerQuery } | null; // "Partners" from the viewer
  cofoldRequest?: { id: number; request: CofoldRequest; compareWith?: string } | null; // "Co-fold" (or "Compare") from the viewer
  askRequest?: { id: number; question: string } | null; // A question sent from the workspace's Focus panel
  onOpenPalette?: () => void; // The header's search button
  onBusyChange?: (busy: boolean) => void; // Lets the viewer disable its chat tools while the chat is busy
  sharedAnalysis?: ProteinAnalysis; // Opened from a share link
  sharedError?: string | null; // A share link that couldn't be opened, and why
  getShareLink?: () => string | null;
  shareDisabledReason?: string;
  onFocusHighlights?: (highlights: Highlight[]) => void; // A "Marked in 3D" row was clicked: bring that part into view
  onRunActions?: (actions: ChatAction[], target?: string) => Promise<ActionResult[]>; // The viewer runs what the chat asks for, and says what it did
  headerStart?: React.ReactNode; // In place of the name at the header's left (a phone's switch between chat and structure)
  onTourState?: (state: { active: boolean; paused: boolean }) => void; // So the viewer can offer the tour's controls too
  tourControlsRef?: React.MutableRefObject<{ pause: () => void; stop: () => void } | null>;
}

// What the tour button (and "play the tour" without one) asks the AI for
const TOUR_REQUEST = 'Generate a cinematic tour explaining the key features of this structure.';

const ReasoningEngine: React.FC<ReasoningEngineProps> = ({ onAnalysisComplete, onTourStep, onSubtitleChange, currentAnalysis, isInitialLoad, similarityRequest, partnersRequest, cofoldRequest, askRequest, onOpenPalette, onBusyChange, sharedAnalysis, sharedError, getShareLink, shareDisabledReason, onFocusHighlights, onRunActions, headerStart, onTourState, tourControlsRef }) => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<string | null>(null); // New state for granular feedback
  const [loadingKind, setLoadingKind] = useState<'think' | 'work'>('think'); // An answer being written, or a tool running
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true); // Scrolled up: a button brings the latest back
  const [composerFocus, setComposerFocus] = useState(0); // Bumped to focus the composer (a picked prompt)
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const look = useChatLook();
  const demo = useChatDemo();
  const [, setTheme] = useTheme();
  const messageSeqRef = useRef(0); // IDs for messages updated after they appear (their actions report back)
  const [composerMode, setComposerMode] = useState<ComposerMode | null>(null); // From the + menu, for the next message
  const [cofoldReady, setCofoldReady] = useState<boolean | null>(null); // Whether this server can co-fold (asked once)
  useEffect(() => { cofoldAvailable().then(setCofoldReady, () => setCofoldReady(false)); }, []);
  useEffect(() => { if (cofoldReady === false) setComposerMode(m => (m === 'cofold' ? null : m)); }, [cofoldReady]); // Never a mode that can't run
  const [investigatingId, setInvestigatingId] = useState<number | null>(null); // The investigation running (its card shows the progress)
  const investigationRef = useRef<{ id: number; controller: AbortController } | null>(null);

  // Voice & Video State
  const [isListening, setIsListening] = useState(false);
  
  // Tour State
  const [isTourActive, setIsTourActive] = useState(false); 
  const [isPaused, setIsPaused] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false); // Loading state for tour audio
  const [tourStep, setTourStep] = useState<{ index: number; count: number } | null>(null);
  
  // Refs
  const isTourActiveRef = useRef(false);
  const tourRunRef = useRef(0); // Bumped on every Play/Stop, so a stopped tour's loop can't carry on
  const isPausedRef = useRef(false); // Read by the tour loop's timed waits
  const recognitionRef = useRef<any>(null);
  const prefetchedAudioPromiseRef = useRef<Promise<AudioBuffer | null> | null>(null); // Store pre-fetched audio
  const activeRequestRef = useRef(0); // ID of the API request in flight (0 = none), for the loading phases
  const requestSeqRef = useRef(0); // Source of those IDs; only ever increases
  
  // Audio Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // SCROLL: the conversation follows new messages and loader changes, but only while the reader is
  // at its end, or has just sent something; scrolled up to re-read, they are left where they are (the
  // "Latest message" button brings them back). Only the conversation scrolls: scrollIntoView would
  // also nudge every scrollable ancestor.
  const atBottomRef = useRef(true);
  const messageCountRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    const last = messages[messages.length - 1];
    const justSent = messages.length > messageCountRef.current && last?.role === 'user';
    messageCountRef.current = messages.length;
    if (el && (atBottomRef.current || justSent)) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, loadingPhase, isLoading]);

  // Fetch UniProt/PDBe facts for the loaded structure while the user reads, so a question doesn't wait for them
  useEffect(() => {
    if (currentAnalysis?.pdbId) loadStructureFacts(currentAnalysis.pdbId).catch(() => {});
  }, [currentAnalysis?.pdbId]);

  useEffect(() => {
    if (isInitialLoad && messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          welcome: true,
          content: "I'm Argus — your AI co-scientist for protein analysis. Ask me to visualize a structure, explain a mechanism, or walk you through a binding site. Try: 'Show me HIV protease' or 'Explain hemoglobin oxygen transport'.",
        },
        // A share link: its answer (labelled as shared), or why it couldn't be opened
        ...(sharedAnalysis
          ? [{ role: 'assistant' as const, content: sharedAnalysis.summary || sharedAnalysis.title, data: sharedAnalysis, shared: true }]
          : sharedError
            ? [{ role: 'assistant' as const, notice: 'error' as const, content: `This share link couldn't be opened: ${sharedError}. Here's the default view instead.` }]
            : []),
      ]);
    }
  }, [isInitialLoad, messages.length]);

  // Initialize Speech Recognition (the AudioContext is created on the first tour play: browsers
  // only let it start after a click, and narration is disabled in this build anyway)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          setIsListening(false);
        };

        recognition.onerror = (event: any) => {
          console.error("Speech recognition error", event.error);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }

    return () => {
      audioCtxRef.current?.close();
    };
  }, []);

  // --- AUDIO LOGIC ---

  const playAudioBuffer = (buffer: AudioBuffer): Promise<void> => {
    return new Promise(async (resolve) => {
        if (!audioCtxRef.current) {
             resolve();
             return;
        }

        // Attempt to resume if suspended (not awaited: resume() never settles when the browser
        // refuses audio; the watchdog below still moves the tour on)
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {});
        }

        const source = audioCtxRef.current.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = 1.15; // Speed up speech
        source.connect(audioCtxRef.current.destination);
        
        activeSourceRef.current = source;

        // WATCHDOG: Ensure we never hang if audio glitch occurs
        // If audio doesn't end within (duration + 1s), forced resolve
        const safeDuration = (buffer.duration / source.playbackRate.value) * 1000 + 1000;
        const watchdog = setTimeout(() => {
            if (activeSourceRef.current === source) {
                console.warn("Audio watchdog triggered - forced next step");
                resolve();
            }
        }, safeDuration);

        source.onended = () => {
            clearTimeout(watchdog);
            activeSourceRef.current = null;
            resolve();
        };

        source.start(0);
    });
  };

  // --- TOUR CONTROLS ---

  // Helper: Fetch with timeout to prevent deadlock
  const fetchAudioSafe = async (text: string): Promise<AudioBuffer | null> => {
      if (!SPEECH_ENABLED) return null; // Narration off: timed subtitles
      try {
          // Race between fetch and a 6-second timeout
          const fetchPromise = generateSpeech(text, audioCtxRef.current || undefined);
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
          
          return await Promise.race([fetchPromise, timeoutPromise]);
      } catch (e) {
          console.warn("Audio fetch failed", e);
          return null;
      }
  };

  // Waits `ms` of un-paused time. Resolves false as soon as this tour run is stopped or replaced.
  const tourWait = async (run: number, ms: number) => {
    let remaining = ms;
    while (remaining > 0) {
      if (tourRunRef.current !== run) return false;
      const tick = Math.min(remaining, 100);
      await new Promise(r => setTimeout(r, tick));
      if (!isPausedRef.current) remaining -= tick;
    }
    return tourRunRef.current === run;
  };

  // The steps are passed in when a tour starts straight after its answer (this render's answer is older)
  const handlePlayTour = async (steps: TourStep[] | undefined = currentAnalysis?.tour) => {
    if (!steps?.length || isTourActiveRef.current) return;

    // Audio for narration: created inside this click, and never awaited, since resume() stays
    // pending forever when the browser refuses to start audio (the tour must run regardless)
    if (SPEECH_ENABLED && !audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx({ sampleRate: 24000 });
    }
    if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
    }

    const run = ++tourRunRef.current;
    setIsTourActive(true);
    setIsPaused(false);
    isPausedRef.current = false;
    isTourActiveRef.current = true;

    try {
        // --- RELAY RACE BUFFERING STRATEGY ---
        
        // 1. Step 0 Check: Did we pre-fetch it during analysis?
        let nextAudioPromise: Promise<AudioBuffer | null>;

        if (prefetchedAudioPromiseRef.current) {
            // Use the pre-fetched promise (already safe/caught)
            nextAudioPromise = prefetchedAudioPromiseRef.current;
            prefetchedAudioPromiseRef.current = null; // Clear usage
        } else {
             // Cold start (rare)
             nextAudioPromise = fetchAudioSafe(steps[0].text);
        }

        for (let i = 0; i < steps.length; i++) {
            if (tourRunRef.current !== run) break;

            const step = steps[i];

            // 2. Await the audio for THIS step (started in previous iteration or init)
            let buffer: AudioBuffer | null = null;
            
            // Start buffering indicator
            setIsBuffering(true);
            try {
                // If fetch hangs, the 'fetchAudioSafe' wrapper ensures we don't wait forever
                buffer = await nextAudioPromise;
            } catch (e) {
                console.error(`Audio fetch error step ${i}`, e);
            }
            // End buffering indicator
            setIsBuffering(false);

            // 3. IMMEDIATELY start fetching the NEXT step (if exists)
            // This runs in parallel with the current step's playback
            if (i + 1 < steps.length) {
                nextAudioPromise = fetchAudioSafe(steps[i+1].text);
            }

            // 4. Update Visuals (Synced with start of playback)
            if (tourRunRef.current !== run) break;
            onTourStep(step.focus);
            setTourStep({ index: i, count: steps.length });
            onSubtitleChange(step.text);

            // 5. Play Audio (or Fallback Delay)
            if (buffer) {
                await playAudioBuffer(buffer);
            } else {
                // Fallback: If audio failed or timed out, read-time delay (approx 200wpm)
                // This ensures the tour progresses even if TTS fails; the wait honours Pause
                const wordCount = step.text.split(' ').length;
                const readingMs = Math.max(2500, wordCount * 300);
                if (!(await tourWait(run, readingMs))) break;
            }

            // 6. Cinematic pause between steps
            if (i < steps.length - 1 && !(await tourWait(run, 600))) break;
        }
    } catch (e) {
        console.error("Tour Error", e);
    } finally {
        // A newer tour may have started after this one was stopped; leave it running
        if (tourRunRef.current === run) handleStopTour();
    }
  };

  const handlePauseTour = () => {
      const pause = !isPausedRef.current;
      isPausedRef.current = pause;
      setIsPaused(pause);
      // Narration (when available) pauses with the audio clock; timed steps watch isPausedRef
      const ctx = audioCtxRef.current;
      (pause ? ctx?.suspend() : ctx?.resume())?.catch(() => {});
  };

  const handleStopTour = () => {
      tourRunRef.current++;
      setTourStep(null);
      isTourActiveRef.current = false;
      isPausedRef.current = false;
      setIsTourActive(false);
      setIsPaused(false);
      setIsBuffering(false);

      if (activeSourceRef.current) {
          try { activeSourceRef.current.stop(); } catch(e) {}
      }
      
      if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
      }

      onTourStep([]);
      onSubtitleChange(null);
  };

  // A new answer (or another opened structure) ends a running tour: its steps describe the old one
  useEffect(() => {
    if (isTourActiveRef.current) handleStopTour();
  }, [currentAnalysis]);

  // The tour's state and controls, for the viewer's own buttons where this header is out of sight
  useEffect(() => onTourState?.({ active: isTourActive, paused: isPaused }), [isTourActive, isPaused]);
  useEffect(() => {
    if (tourControlsRef) tourControlsRef.current = { pause: handlePauseTour, stop: handleStopTour };
  });

  const toggleListening = () => {
    if (!recognitionRef.current) {
        alert("Speech recognition is not supported in this browser.");
        return;
    }
    if (isListening) {
        recognitionRef.current.stop();
        setIsListening(false);
    } else {
        try {
            recognitionRef.current.start();
        } catch (e) {
            return; // Still shutting down from the last stop; the next click works
        }
        setInput('');
        setIsListening(true);
    }
  };

  // --- ACTIONS: the chat changes the workspace (services/chatActions) ---

  // View and tool actions go to the viewer, which runs them once their structure is on screen; theme
  // and tour run here, after the viewer's, so a tour starts on the structure it describes. Every
  // result comes from what actually happened.
  const runActions = async (actions: ChatAction[], options: { target?: string; tour?: TourStep[] } = {}): Promise<ActionResult[]> => {
    const forViewer = actions.filter(a => a.kind !== 'theme' && a.kind !== 'tour');
    const viewerResults = forViewer.length > 0 || options.target
      ? (onRunActions ? await onRunActions(forViewer, options.target) : forViewer.map(a => actionFailed(a, "the viewer isn't ready")))
      : [];
    return actions.map(action => {
      if (action.kind === 'theme') {
        setTheme(action.theme as ThemeId);
        return actionDone(action);
      }
      if (action.kind === 'tour') {
        if (!action.play) {
          if (!isTourActiveRef.current) return actionFailed(action, 'no tour is playing');
          handleStopTour();
          return actionDone(action);
        }
        const steps = options.tour ?? currentAnalysis?.tour;
        if (!steps?.length) return actionFailed(action, 'this answer has no tour');
        if (isTourActiveRef.current) return actionFailed(action, 'a tour is already playing');
        void handlePlayTour(steps);
        return actionDone(action);
      }
      return viewerResults[forViewer.indexOf(action)] ?? actionFailed(action, "the viewer didn't answer");
    });
  };

  // A plain request ("surface", "hide waters", "open pockets"): run at once, no AI call, and the
  // reply says what changed. "Play the tour" with no tour asks the AI for one, then plays it.
  const runCommandTurn = async (text: string, actions: ChatAction[], hidden: boolean) => {
    const id = ++messageSeqRef.current;
    const tour = actions.find(a => a.kind === 'tour' && a.play);
    const askForTour = Boolean(tour) && !currentAnalysis?.tour?.length;
    const now = askForTour ? actions.filter(a => a !== tour) : actions;
    setMessages(prev => [
      ...prev,
      ...(hidden ? [] : [{ role: 'user' as const, content: text }]),
      { id, role: 'assistant' as const, content: '', actionResults: actions.map(actionPlanned) },
    ]);
    const results = now.length > 0 ? await runActions(now) : [];
    if (askForTour && tour) results.push(actionDone(tour, 'Asking the AI for a tour'));
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, actionResults: results } : m)));
    if (askForTour) processQuery(TOUR_REQUEST, true, { playTour: true });
  };

  const processQuery = async (userQuery: string, hidden: boolean = false, options: { playTour?: boolean } = {}) => {
    if (!userQuery.trim() || isLoading) return;

    // "investigate: <question>": the AI plans steps, the app runs its own tools, the AI writes up the results
    const investigateQuestion = parseInvestigateCommand(userQuery);
    if (investigateQuestion) return runInvestigation(investigateQuestion);

    // "cofold <molecule> vs <molecule>": two predictions on the structure on screen, compared
    const pair = parseCompareCommand(userQuery);
    if (pair && currentAnalysis) {
      const analysis = currentAnalysis;
      return runCompareTurn(userQuery.trim(), pair, async () => {
        if (!(await cofoldAvailable())) throw new Error("co-folding isn't set up on this server (it needs an NVIDIA API key)");
        return defaultCofoldRequest(analysis, pair[0]);
      });
    }

    // "cofold <molecule>" or "dock <molecule>": Boltz-2 on the structure on screen (no LLM call)
    const molecule = parseCofoldCommand(userQuery);
    if (molecule && currentAnalysis) {
      const analysis = currentAnalysis;
      return runCofoldTurn(userQuery.trim(), molecule, async () => {
        if (!(await cofoldAvailable())) throw new Error("co-folding isn't set up on this server (it needs an NVIDIA API key)");
        return defaultCofoldRequest(analysis, molecule);
      });
    }

    // A pasted protein sequence is folded directly with ESMFold (no LLM call)
    const sequenceInput = parseSequenceInput(userQuery);
    if (sequenceInput) return runFold(sequenceInput);

    // A plain request to change the view, open a tool, select residues, switch theme or play the
    // tour runs at once (no LLM call); anything else, including mixed requests, goes to the AI
    const command = parseChatCommand(userQuery, THEME_LIST);
    if (command) return runCommandTurn(userQuery.trim(), command, hidden);
    setIsLoading(true);
    setLoadingKind('think');
    const requestId = ++requestSeqRef.current;
    activeRequestRef.current = requestId; // Phase timers below only update their own request
    setLoadingPhase('Looking up the structure…'); // Initial phase

    if (!hidden) {
        setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
    }

    // Run phase transitions IN PARALLEL with API call (fire and forget)
    // TIMING FIX: Shifted timing earlier to ensure visibility on cached (fast) responses
    (async () => {
        // Immediate check for 2nd phase to handle fast connection
        await new Promise(r => setTimeout(r, 600));
        if (activeRequestRef.current === requestId) setLoadingPhase('Thinking it through…');

        await new Promise(r => setTimeout(r, 1500));
        if (activeRequestRef.current === requestId) setLoadingPhase('Writing the answer…');

        await new Promise(r => setTimeout(r, 2500));
        if (activeRequestRef.current === requestId) setLoadingPhase('Nearly there…');
    })();

    try {
      // 1. Analyze, grounded in curated facts about the loaded structure (sent without them if they're slow)
      const structureFacts = await getStructureFacts(currentAnalysis?.pdbId, userQuery);
      const onRateLimitWait = (seconds: number) => {
        activeRequestRef.current = 0; // The timed phases would overwrite this message
        setLoadingPhase(`The AI is busy, trying again in ${seconds} s…`);
      };
      let analysis = await analyzeProteinQuery(userQuery, currentAnalysis, structureFacts, { writeCache: false, onRateLimitWait });

      // API returned. Stop background updates.
      activeRequestRef.current = 0;

      // 1b. Check the answer against the structure it names (residues, ligands, the PDB ID itself).
      // Exact local fixes first (UniProt numbering, misplaced ligands: no extra AI call); whatever
      // still doesn't fit goes back to the model once, with that structure's facts and the problems.
      // The trail keeps each step for the line under the answer (services/answerChecks.ts).
      setLoadingPhase('Checking the answer against the file…');
      const trail: CheckTrail = {};
      let inspection = await inspectAnswer(analysis);
      if (inspection && inspection.problems.length > 0) {
        const corrected = await correctAnswer(analysis);
        if (corrected) {
          const remaining = await inspectAnswer(corrected.analysis);
          if (remaining !== null && remaining.problems.length < inspection.problems.length) {
            analysis = corrected.analysis;
            inspection = remaining;
            trail.local = { renumbered: corrected.renumbered, moved: corrected.moved, examples: corrected.conversions };
          }
        }
      }
      const problems = inspection?.problems ?? null;
      // ...and the protein it names against the entry's own records (title, molecules, UniProt names):
      // a different protein altogether goes back to the model too
      const named = await inspectIdentity(analysis);
      const identity = named.problem;
      if ((problems && problems.length > 0) || identity) {
        setLoadingPhase(identity ? 'Checking which protein this is…' : 'Fixing the residue numbers…');
        const missingEntry = (problems ?? []).some(p => /not an existing PDB entry|not a valid PDB ID/.test(p));
        const issues = [...(identity ? [identity] : []), ...(problems ?? [])];
        const repairFacts = missingEntry ? null : await getStructureFacts(analysis.pdbId, userQuery, 6000);
        const note = `[Correction needed] Your previous answer used ${analysis.pdbId}, but these parts do not match that file: ${issues.join('; ')}. ` +
          (missingEntry
            ? 'Choose a real, existing PDB entry instead.'
            : identity
              ? `Either describe ${analysis.pdbId} as the protein it really is (see STRUCTURE FACTS), or choose the PDB entry that shows the protein you meant; use only residues and ligands that exist in the entry you answer with.`
              : `Answer again for ${analysis.pdbId}, using only residues and ligands that exist in this file and naming each one by the amino acid it really is (see STRUCTURE FACTS).`);
        // The API takes up to 2000 characters
        const repairQuery = `${userQuery.slice(0, 900)}\n\n${note}`.slice(0, 2000);
        const first = {
          entry: analysis.pdbId,
          title: analysis.title,
          missing: inspection?.exists === false,
          holds: identity ? named.name : '',
          problems: inspection ? inspection.missing + inspection.wrong + inspection.misnamed : 0,
        };
        try {
          const repaired = await analyzeProteinQuery(repairQuery, analysis, repairFacts, { readCache: false, writeCache: false, onRateLimitWait });
          const remaining = await checkAnswer(repaired);
          const remainingIdentity = await checkIdentity(repaired);
          // Keep the correction unless it is no better than the first answer
          const after = (remaining?.length ?? 0) + (remainingIdentity ? 1 : 0);
          const kept = (remaining === null && !remainingIdentity) || after < issues.length;
          if (kept) analysis = repaired;
          trail.retry = { ...first, outcome: kept ? 'kept' : 'first' };
        } catch (e) {
          // The first answer stands
          trail.retry = { ...first, outcome: 'failed' };
        }
      }
      // A protein that still doesn't match its entry: the heading takes the entry's title, and the answer says so
      const shown = await correctIdentity(analysis);
      trail.corrected = shown !== analysis;
      analysis = shown;
      rememberAnalysis(userQuery, currentAnalysis, structureFacts, analysis);
      const checks = await collectChecks(analysis, trail);

      // 2. Draft Response & Pre-load Audio (skipped while narration is disabled: nothing to load)
      if (SPEECH_ENABLED && analysis.tour && analysis.tour.length > 0) {
          setLoadingPhase('Preparing the tour…');
          
          // Allow UI to update and user to see the message
          await new Promise(r => setTimeout(r, 600)); 
          
          setLoadingPhase('Loading the narration…');
          
          // Trigger pre-fetch in background with SAFE WRAPPER
          // This ensures pre-fetch doesn't crash the next step if it fails
          prefetchedAudioPromiseRef.current = fetchAudioSafe(analysis.tour[0].text);

          // Wait a moment so the "Pre-loading" text is visible and the fetch gets a head start
          await new Promise(r => setTimeout(r, 800));
      }

      // What the answer changes in the viewer runs once its structure is on screen; the message
      // lists those changes as planned, then as they actually turned out
      const planned = (analysis.actions ?? []).map(actionFromId).filter((a): a is ChatAction => a !== null);
      if (options.playTour && analysis.tour?.length && !planned.some(a => a.kind === 'tour')) planned.push({ kind: 'tour', play: true });
      const id = ++messageSeqRef.current;
      setMessages(prev => [
        ...prev,
        {
          id,
          role: 'assistant',
          content: analysis.summary,
          data: analysis,
          ...(checks ? { checks } : {}),
          ...(planned.length ? { actionResults: planned.map(actionPlanned) } : {}),
        }
      ]);
      onAnalysisComplete(analysis);
      if (planned.length) {
        runActions(planned, { target: analysis.pdbId, tour: analysis.tour })
          .then(results => setMessages(prev => prev.map(m => (m.id === id ? { ...m, actionResults: results } : m))));
      }
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          notice: 'error',
          ...(hidden ? {} : { retry: userQuery }),
          content: error?.status === 429
            ? "The AI is answering a lot of questions right now (rate limit). Please try again in a minute."
            : "Couldn't complete that analysis. Try rephrasing your query or choosing a different protein."
        }
      ]);
    } finally {
      setIsLoading(false);
      activeRequestRef.current = 0;
      setLoadingPhase(null);
    }
  };

  // --- FOLD A PASTED SEQUENCE (ESMFold; no LLM tokens) ---

  const describeConfidence = (meanPlddt: number) =>
    meanPlddt >= 90 ? 'very high — most likely a well-folded domain'
    : meanPlddt >= 70 ? 'confident overall; yellow and orange parts are less certain'
    : meanPlddt >= 50 ? 'low — parts may be flexible, or the prediction is uncertain'
    : 'very low — likely disordered, or too unusual for a single-sequence prediction';

  const runFold = async ({ sequence, name, invalid, skippedRecords }: SequenceInput) => {
    const preview = sequence.length > 48 ? `${sequence.slice(0, 48)}…` : sequence;
    setMessages(prev => [...prev, { role: 'user', content: `Fold ${name ?? 'this sequence'} (${sequence.length} residues)\n${preview}` }]);

    const reject = (content: string) => setMessages(prev => [...prev, { role: 'assistant', notice: 'error', content }]);
    if (invalid.length > 0) {
      return reject(`ESMFold needs the 20 standard amino acids, but this sequence contains ${invalid.join(', ')}. Replace or remove ${invalid.length > 1 ? 'those letters' : 'that letter'} and paste it again.`);
    }
    if (sequence.length > ESMFOLD_MAX_LENGTH) {
      return reject(`ESMFold's free server folds up to ${ESMFOLD_MAX_LENGTH} residues, and this sequence has ${sequence.length}. Fold one domain at a time (for example residues 1–${ESMFOLD_MAX_LENGTH}), or, if it's a known protein, ask me for its AlphaFold model.`);
    }

    setIsLoading(true);
    setLoadingKind('work');
    setLoadingPhase('Folding with ESMFold…');
    try {
      const prediction = await foldSequence(sequence, name);
      const mean = Math.round(prediction.meanPlddt);
      const analysis: ProteinAnalysis = {
        pdbId: prediction.id,
        title: name ? `${name} · ESMFold prediction` : `Your sequence · ${prediction.length} residues`,
        summary:
          `Predicted with ESMFold from the ${prediction.length}-residue sequence. Mean confidence (pLDDT) is ${mean}: ${describeConfidence(prediction.meanPlddt)}. ` +
          `ESMFold works from the sequence alone, so it is fast but often less accurate than AlphaFold. Use "Find similar" to see which known proteins share this fold.` +
          (skippedRecords
            ? ` Only the first sequence was folded; the other ${skippedRecords === 1 ? 'one was' : `${skippedRecords} were`} left out, because ESMFold predicts one chain at a time.`
            : ''),
        highlights: [],
      };
      setMessages(prev => [...prev, { role: 'assistant', content: analysis.summary, data: analysis }]);
      onAnalysisComplete(analysis);
    } catch (error: any) {
      reject(`Couldn't fold the sequence${error?.message ? ` (${error.message})` : ''}. Try again in a moment.`);
    } finally {
      setIsLoading(false);
      setLoadingPhase(null);
    }
  };

  // --- SIMILAR STRUCTURES (Foldseek; no LLM tokens) ---

  const runSimilaritySearch = async (query: SimilarSearchQuery) => {
    if (isLoading || !currentAnalysis) return;
    const origin = currentAnalysis;
    setMessages(prev => [...prev, { role: 'user', content: `Find structures similar to ${query.label}` }]);
    setIsLoading(true);
    setLoadingKind('work');
    setLoadingPhase('Sending the structure to Foldseek…');

    try {
      const result = await searchSimilarStructures(query, status => setLoadingPhase(status));
      const families = result.proteins.length;
      const experimental = result.experimental.length;
      const content = families + experimental > 0
        ? `Found ${families} protein ${families === 1 ? 'family' : 'families'} and ${experimental} experimental ${experimental === 1 ? 'structure' : 'structures'} with a fold similar to ${query.label}. Pick one to open it in the viewer.`
        : `No clearly similar structures turned up for ${query.label}.`;
      setMessages(prev => [...prev, { role: 'assistant', content, similar: { result, origin } }]);
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: 'error', content: `Couldn't complete the structure search${error?.message ? ` (${error.message})` : ''}. Try again in a moment.` },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingPhase(null);
    }
  };

  useEffect(() => {
    onBusyChange?.(isLoading);
  }, [isLoading]);

  // The viewer disables "Find similar" while the chat is busy; a click that slips in just
  // before that waits here and runs once the current answer has arrived
  const handledSimilarityRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!similarityRequest || isLoading || handledSimilarityRequest.current === similarityRequest.id) return;
    handledSimilarityRequest.current = similarityRequest.id;
    runSimilaritySearch(similarityRequest.query);
  }, [similarityRequest?.id, isLoading]);

  // --- INTERACTION PARTNERS (STRING + RCSB; no LLM tokens) ---

  const runPartnerSearch = async (query: PartnerQuery) => {
    if (isLoading || !currentAnalysis) return;
    const origin = currentAnalysis;
    setMessages(prev => [...prev, { role: 'user', content: `Find interaction partners of ${query.label}` }]);
    setIsLoading(true);
    setLoadingKind('work');
    setLoadingPhase('Asking STRING for interaction partners…');

    try {
      const result = await findPartners(query, status => setLoadingPhase(status));
      const solved = result.partners.filter(p => p.bestComplex).length;
      const content = result.partners.length > 0
        ? `STRING lists ${result.partners.length} interaction ${result.partners.length === 1 ? 'partner' : 'partners'} of ${result.name}` +
          (solved > 0
            ? `; ${solved} of them ${solved === 1 ? 'has' : 'have'} been solved together with it in the PDB. "View complex" opens one with the interface marked.`
            : ', none solved together with it in the PDB yet.')
        : `STRING has no partners of ${result.name} at medium confidence or higher.`;
      setMessages(prev => [...prev, { role: 'assistant', content, partners: { result, origin } }]);
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', notice: 'error', content: `Couldn't look up interaction partners${error?.message ? ` (${error.message})` : ''}.` },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingPhase(null);
    }
  };

  const handledPartnersRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!partnersRequest || isLoading || handledPartnersRequest.current === partnersRequest.id) return;
    handledPartnersRequest.current = partnersRequest.id;
    runPartnerSearch(partnersRequest.query);
  }, [partnersRequest?.id, isLoading]);

  const openPartnerComplex = async (partner: InteractionPartner, result: PartnerSearchResult) => {
    const pdbId = partner.bestComplex;
    if (!pdbId || !partner.accession || isLoading) return;
    setIsLoading(true);
    setLoadingKind('work');
    setLoadingPhase(`Loading ${pdbId} and finding the interface…`);
    try {
      let highlights: Highlight[] = [];
      try {
        highlights = await complexInterface(pdbId, { accession: result.query.accession, name: result.name }, { accession: partner.accession, name: partner.name });
      } catch {
        // The complex still opens; only the interface marks are missing
      }
      const [own, theirs] = highlights;
      const resolution = partner.bestComplexResolution ? ` at ${partner.bestComplexResolution} Å` : '';
      const others = (partner.complexes ?? 1) - 1;
      const analysis: ProteinAnalysis = {
        pdbId,
        title: `${result.name} with ${partner.name}`,
        summary:
          `${pdbId} holds both ${result.name} and ${partner.name}${resolution}` +
          (others > 0 ? `, the best-resolved of ${others + 1} PDB entries with both. ` : '. ') +
          (own && theirs
            ? `Highlighted: the interface, residues within 4.5 Å of the other protein (${own.resi.length} on ${result.name} chain ${own.chain}, ${theirs.resi.length} on ${partner.name} chain ${theirs.chain}).`
            : `The interface couldn't be marked automatically in this entry.`),
        highlights,
      };
      setMessages(prev => [...prev, { role: 'assistant', content: analysis.summary, data: analysis }]);
      onAnalysisComplete(analysis);
    } finally {
      setIsLoading(false);
      setLoadingPhase(null);
    }
  };

  // --- CO-FOLD (Boltz-2 on the server; no LLM tokens) ---

  const runCofoldTurn = async (userText: string, molecule: string, getRequest: () => Promise<CofoldRequest>) => {
    if (isLoading || !currentAnalysis) return;
    const origin = currentAnalysis;
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setIsLoading(true);
    setLoadingKind('work');
    setLoadingPhase('Preparing Co-fold…');
    try {
      const result = await runCofold(await getRequest(), status => setLoadingPhase(status));
      const analysis = cofoldAnalysis(result);
      setMessages(prev => [...prev, { role: 'assistant', content: analysis.summary, data: analysis, cofold: { result, origin } }]);
      onAnalysisComplete(analysis);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', notice: 'error', content: `Couldn't co-fold ${molecule}${error?.message ? `: ${error.message}` : ''}.` }]);
    } finally {
      setIsLoading(false);
      setLoadingPhase(null);
    }
  };

  // Two molecules under the same conditions (only the molecule differs), predicted side by side
  // and combined into one complex. Each prediction is cached, so a molecule co-folded earlier is instant.
  const runCompareTurn = async (userText: string, pair: [string, string], getRequest: () => Promise<CofoldRequest>) => {
    if (isLoading || !currentAnalysis) return;
    const origin = currentAnalysis;
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setIsLoading(true);
    setLoadingKind('work');
    setLoadingPhase('Preparing the comparison…');
    const started = Date.now();
    const finished: string[] = [];
    const tick = () => setLoadingPhase(
      `Boltz-2 is predicting ${pair[0]} and ${pair[1]}… ${Math.round((Date.now() - started) / 1000)} s${finished.length ? ` · ${finished.join(', ')} done` : ''}`
    );
    const timer = setInterval(tick, 1000);
    try {
      const request = await getRequest();
      // The same cofactors for both, and neither molecule kept as a cofactor of the other
      const codes = pair.map(m => m.trim().toUpperCase());
      const cofactors = request.cofactors.filter(c => !codes.includes(c));
      tick();
      const [a, b] = await Promise.all(pair.map(text =>
        runCofold({ ...request, ligandText: text, cofactors }, () => {})
          .then(result => { finished.push(text); tick(); return result; })
          .catch((e: any) => { throw new Error(`${text}: ${e?.message ?? 'the prediction failed'}`); })
      ));
      const result = compareCofolds(a, b);
      const analysis = compareAnalysis(result);
      setMessages(prev => [...prev, { role: 'assistant', content: analysis.summary, data: analysis, compare: { result, origin } }]);
      onAnalysisComplete(analysis);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', notice: 'error', content: `Couldn't compare ${pair[0]} and ${pair[1]}${error?.message ? ` (${error.message})` : ''}.` }]);
    } finally {
      clearInterval(timer);
      setIsLoading(false);
      setLoadingPhase(null);
    }
  };

  // --- INVESTIGATE (the AI plans, the app runs its own tools, the AI writes up their results) ---

  const runInvestigation = async (question: string) => {
    if (isLoading || !currentAnalysis) return;
    const origin = currentAnalysis;
    const id = ++messageSeqRef.current;
    const controller = new AbortController();
    investigationRef.current = { id, controller };
    const update = (change: (s: InvestigationState) => InvestigationState) =>
      setMessages(prev => prev.map(m => (m.id === id && m.investigation ? { ...m, investigation: change(m.investigation) } : m)));
    const onRateLimitWait = (seconds: number) => update(s => ({ ...s, notice: `The AI is busy, retrying in ${seconds} s` }));
    const stopped = () => controller.signal.aborted;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: question },
      { id, role: 'assistant', content: '', investigation: { question, phase: 'planning', startedAt: Date.now(), steps: [] } },
    ]);
    setIsLoading(true);
    setLoadingKind('work');
    setInvestigatingId(id);
    try {
      // 1. The plan: the AI's, or one from the question's words when the AI can't make one
      const planned = await requestPlan(question, { pdbId: origin.pdbId, title: origin.title }, onRateLimitWait).catch(() => null);
      if (stopped()) throw new Error('stopped');
      let plan = planned ?? fallbackPlan(question, origin.pdbId);

      // 2. The structure's file, which the steps read; an entry that won't load gives way to the one on screen
      let pdb: string;
      let unavailable: string | undefined;
      try {
        pdb = await loadStructureText(plan.structure);
      } catch (e) {
        if (plan.structure === origin.pdbId) throw e;
        unavailable = plan.structure;
        plan = { ...plan, structure: origin.pdbId };
        pdb = await loadStructureText(origin.pdbId);
      }
      if (stopped()) throw new Error('stopped');
      update(s => ({
        ...s,
        phase: 'running',
        notice: undefined,
        structure: plan.structure,
        ...(unavailable ? { unavailable } : {}),
        title: plan.title,
        planSource: planned ? 'ai' : 'fallback',
        steps: plan.steps.map((p, i) => ({ index: i + 1, plan: p, label: stepLabel(p), status: 'pending' as const })),
      }));
      // The viewer opens it while the steps run (quietly: a phone keeps showing the steps)
      if (plan.structure !== origin.pdbId) onAnalysisComplete({ pdbId: plan.structure, title: plan.title, summary: '', highlights: [] }, { quiet: true });

      // 3. The steps, side by side, each reporting as it goes
      const steps = await runInvestigationSteps(
        plan.structure, pdb, plan,
        step => update(s => ({ ...s, steps: s.steps.map(x => (x.index === step.index ? step : x)) })),
        controller.signal,
      );
      if (stopped()) throw new Error('stopped');

      // 4. The write-up, from those results alone (the results themselves when the AI can't write one)
      update(s => ({ ...s, phase: 'writing', steps }));
      const written = await requestWriteUp(question, { id: plan.structure, title: plan.title }, steps, onRateLimitWait).catch(() => null);
      if (stopped()) throw new Error('stopped');
      const writeUp = written ?? fallbackWriteUp(steps, plan.title);
      const title = writeUp.title || plan.title;
      const highlights = highlightsFor(writeUp.marks, steps);
      const analysis: ProteinAnalysis = { pdbId: plan.structure, title, summary: stripCitations(writeUp.answer), highlights };
      setMessages(prev => prev.map(m => (m.id === id && m.investigation ? {
        ...m,
        data: analysis,
        investigation: {
          ...m.investigation,
          phase: 'done',
          notice: undefined,
          finishedAt: Date.now(),
          writeUp: { ...writeUp, title, highlights, ...(written ? {} : { fallback: true }) },
        },
      } : m)));
      onAnalysisComplete(analysis);
    } catch (error: any) {
      if (stopped()) update(s => ({ ...s, phase: 'stopped', notice: undefined, finishedAt: Date.now() }));
      else update(s => ({ ...s, phase: 'failed', notice: undefined, error: error?.message || 'something went wrong', finishedAt: Date.now() }));
    } finally {
      if (investigationRef.current?.id === id) investigationRef.current = null;
      setIsLoading(false);
      setInvestigatingId(null);
    }
  };

  // A finished step shown in 3D: its workspace tool (Variant Lens, Pockets, Interactions), else its residues
  const showInvestigationStep = (state: InvestigationState, step: InvestigationStep) => {
    if (!state.structure || currentAnalysis?.pdbId !== state.structure) return;
    const view = step.result?.view;
    if (view) {
      void runActions([{ kind: 'tool', tool: view }], { target: state.structure });
      return;
    }
    const highlights = stepHighlights(step);
    if (highlights.length > 0) onFocusHighlights?.(highlights);
  };

  // "Ask" in the workspace's Focus panel: the selection becomes an ordinary question
  const handledAskRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!askRequest || isLoading || handledAskRequest.current === askRequest.id) return;
    handledAskRequest.current = askRequest.id;
    processQuery(askRequest.question);
  }, [askRequest?.id, isLoading]);

  const handledCofoldRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!cofoldRequest || isLoading || handledCofoldRequest.current === cofoldRequest.id) return;
    handledCofoldRequest.current = cofoldRequest.id;
    const { request } = cofoldRequest;
    const where = request.source.kind === 'pdb'
      ? `${request.source.pdbId}, ${request.source.chains.length > 1 ? 'chains' : 'chain'} ${request.source.chains.join(', ')}`
      : request.source.kind === 'alphafold' ? 'AlphaFold model' : 'ESMFold prediction';
    const into = request.pocket ? ` into ${request.pocket.label.toLowerCase()}` : '';
    const second = cofoldRequest.compareWith;
    if (second) {
      runCompareTurn(`Compare ${request.ligandText} and ${second}${into} in ${request.proteinName} (${where})`, [request.ligandText, second], async () => request);
      return;
    }
    runCofoldTurn(`Co-fold ${request.ligandText}${into} with ${request.proteinName} (${where})`, request.ligandText, async () => request);
  }, [cofoldRequest?.id, isLoading]);

  const openSimilarHit = (hit: SimilarStructureHit, result: SimilarSearchResult) => {
    const identity = Math.round(hit.identity);
    const analysis: ProteinAnalysis = {
      pdbId: hit.structureId,
      title: hit.name,
      summary:
        `${hit.name}${hit.organism ? ` (${hit.organism})` : ''} has a fold similar to ${result.queryLabel}: ` +
        `Foldseek probability ${hit.probability.toFixed(2)}, ${identity}% sequence identity over ${Math.round(hit.coverage * 100)}% of the query.` +
        (identity < 30 ? ' Sharing a shape at such low sequence identity points to a distant evolutionary relationship.' : ''),
      highlights: [],
    };
    setMessages(prev => [...prev, { role: 'assistant', content: analysis.summary, data: analysis }]);
    onAnalysisComplete(analysis);
  };

  const handleRequestTour = () => {
      processQuery(TOUR_REQUEST, false);
  };

  const shouldShowHeader = (currentMsg: Message, idx: number) => {
    if (!currentMsg.data) return false;
    let lastDataMsg: Message | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].data) {
        lastDataMsg = messages[i];
        break;
      }
    }
    if (!lastDataMsg) return true;
    if (lastDataMsg.data?.pdbId !== currentMsg.data.pdbId) return true;
    return false;
  };

  const handleQuizSuccess = (answerHighlights: Highlight[], parentAnalysis: ProteinAnalysis) => {
    if (!answerHighlights || answerHighlights.length === 0) return;
    const focusedAnalysis: ProteinAnalysis = {
      ...parentAnalysis,
      highlights: answerHighlights
    };
    onAnalysisComplete(focusedAnalysis);
  };

  const hasTour = currentAnalysis?.tour && currentAnalysis.tour.length > 0;
  const micAvailable = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const showWelcomeScreen = look.emptyState === 'hero' && messages.every(m => m.welcome) && !isLoading && !demo.loader && !demo.error && !demo.tour && !isTourActive;

  const submitInput = () => {
    if (isLoading) return; // Enter while busy: keep the text for when the current answer arrives
    const q = input.trim();
    if (!q) return;
    setInput('');
    // A mode from the + menu holds for one message
    if (composerMode === 'investigate') {
      setComposerMode(null);
      runInvestigation(parseInvestigateCommand(q) ?? q);
      return;
    }
    if (composerMode === 'cofold') {
      setComposerMode(null);
      processQuery(/^\s*(?:co-?fold|dock)\b/i.test(q) ? q : `Co-fold ${q}`); // "imatinib vs nilotinib" compares the two
      return;
    }
    processQuery(q);
  };

  const answerLabel = (msg: Message) => (msg.shared ? 'Shared view' : msg.compare ? 'Comparison' : msg.cofold ? 'Co-folded complex' : 'Answer');
  const structureTag = (pdbId: string) => (/^ESM-/i.test(pdbId) ? 'ESMFold' : isCofoldId(pdbId) ? 'Boltz-2' : pdbId);

  // What an answer says: its header (once per structure), text, the parts it marks in 3D, and any card
  const answerBody = (msg: Message, idx: number) => msg.investigation ? (
    <InvestigationCard
      state={msg.investigation}
      live={Boolean(msg.investigation.structure) && msg.investigation.structure === currentAnalysis?.pdbId}
      structureTag={structureTag(msg.investigation.structure ?? '')}
      onStop={() => {
        const running = investigationRef.current;
        if (running && running.id === msg.id) running.controller.abort();
      }}
      onRetry={() => runInvestigation(msg.investigation!.question)}
      onOpenStructure={() => msg.data && onAnalysisComplete(msg.data)}
      onShowStep={step => showInvestigationStep(msg.investigation!, step)}
      onFocus={highlights => onFocusHighlights?.(highlights)}
      onOpenSimilar={(hit, result) => openSimilarHit(hit, result)}
      onOpenPartner={(partner, result) => openPartnerComplex(partner, result)}
    />
  ) : (
    <>
      {msg.data && shouldShowHeader(msg, idx) && (
        <div className="mb-2">
          <p className="text-[11px] font-medium text-ink-dim">{answerLabel(msg)}</p>
          <div className="mt-0.5 flex items-start gap-2">
            <h3 data-answer-title className="min-w-0 text-chat-title font-semibold leading-snug tracking-tight text-ink-strong">{msg.data.title}</h3>
            <span className="ml-auto mt-px flex-shrink-0 px-1.5 py-0.5 rounded-md border border-line bg-chip/70 text-[10.5px] font-semibold tracking-wide tabular-nums text-ink-strong">{structureTag(msg.data.pdbId)}</span>
          </div>
        </div>
      )}
      {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
      {msg.actionResults && msg.actionResults.length > 0 && (
        <div className={msg.content ? 'mt-2.5' : ''}>
          <ActionReceipt results={msg.actionResults} />
        </div>
      )}
      {msg.shared && (
        <p className="mt-2 text-[11px] leading-snug text-ink-dim">
          Opened from a share link: this answer was shared with you, not generated in this session.
        </p>
      )}

      {/* The parts the answer marks in 3D: named, and a click away (only while that structure is on screen) */}
      {msg.data && shouldShowHeader(msg, idx) && msg.data.highlights.length > 0 && (
        <MarkedParts
          highlights={msg.data.highlights}
          live={Boolean(onFocusHighlights) && msg.data.pdbId === currentAnalysis?.pdbId}
          onFocus={highlights => onFocusHighlights?.(highlights)}
        />
      )}

      {/* What the app checked in the answer before showing it, and what it fixed first */}
      {msg.checks && <AnswerChecks checks={msg.checks} />}

      {msg.data?.quiz && (
        <QuizCard
          quiz={msg.data.quiz}
          onCorrectAnswer={() => {
            if (msg.data && msg.data.quiz && msg.data.quiz.answerHighlights) handleQuizSuccess(msg.data.quiz.answerHighlights, msg.data);
          }}
        />
      )}
      {msg.similar && (
        <SimilarStructuresCard
          result={msg.similar.result}
          origin={msg.similar.origin}
          currentStructureId={currentAnalysis?.pdbId}
          onOpen={(hit) => openSimilarHit(hit, msg.similar!.result)}
          onBack={() => onAnalysisComplete(msg.similar!.origin)}
        />
      )}
      {msg.partners && (
        <PartnersCard
          result={msg.partners.result}
          origin={msg.partners.origin}
          currentStructureId={currentAnalysis?.pdbId}
          onOpenComplex={(partner) => openPartnerComplex(partner, msg.partners!.result)}
          onBack={() => onAnalysisComplete(msg.partners!.origin)}
        />
      )}
      {msg.cofold && (
        <CofoldCard
          result={msg.cofold.result}
          origin={msg.cofold.origin}
          currentStructureId={currentAnalysis?.pdbId}
          onView={() => msg.data && onAnalysisComplete(msg.data)}
          onBack={() => onAnalysisComplete(msg.cofold!.origin)}
        />
      )}
      {msg.compare && (
        <CompareCard
          result={msg.compare.result}
          origin={msg.compare.origin}
          currentStructureId={currentAnalysis?.pdbId}
          onView={() => msg.data && onAnalysisComplete(msg.data)}
          onBack={() => onAnalysisComplete(msg.compare!.origin)}
        />
      )}
    </>
  );

  // Errors read as notices (with Retry when the question can simply be sent again), not as answers
  const notice = (content: string, retry?: string, key?: React.Key) => (
    <div key={key} data-message="assistant" data-notice="error" className="argus-rise flex items-start gap-2.5 rounded-xl border border-bad/30 bg-bad/[0.06] px-3.5 py-3">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-bad" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
      <p className="min-w-0 flex-1 text-chat-aside leading-relaxed text-ink">{content}</p>
      {retry && (
        <button
          type="button"
          onClick={() => processQuery(retry)}
          disabled={isLoading}
          className="flex-shrink-0 h-7 px-2.5 rounded-md border border-line bg-canvas/60 text-[12px] font-medium text-ink hover:border-line-2 hover:text-ink-strong disabled:opacity-40 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );

  const avatar = (
    <Orb kind={look.thinkingOrb} size={20} paused />
  );

  const renderMessage = (msg: Message, idx: number) => {
    // The welcome screen stands in for the greeting
    if (msg.welcome && look.emptyState === 'hero') return null;
    if (msg.role === 'user') {
      return (
        <div key={idx} data-message="user" className="flex justify-end argus-rise">
          <div
            className={`max-w-[85%] px-chat-x py-chat-y rounded-2xl rounded-br-md text-chat whitespace-pre-wrap break-words ${
              look.userBubble === 'accent' ? 'bg-brand text-brand-ink font-medium'
              : look.userBubble === 'outline' ? 'border border-line-2 bg-canvas/40 text-ink-strong'
              : 'bg-chip text-ink-strong'
            }`}
          >
            {msg.content}
          </div>
        </div>
      );
    }
    if (msg.notice === 'error') return notice(msg.content, msg.retry, idx);
    if (look.messages === 'cards') {
      return (
        <div key={idx} data-message="assistant" className="argus-rise rounded-2xl border border-line bg-surface/60 backdrop-blur-md px-4 py-3.5 text-chat text-ink shadow-float">
          {answerBody(msg, idx)}
        </div>
      );
    }
    if (look.messages === 'timeline') {
      return (
        <div key={idx} data-message="assistant" className="relative pl-10 argus-rise">
          <div className="absolute left-0 top-0 w-7 h-7 flex items-center justify-center rounded-full border border-line bg-canvas">{avatar}</div>
          <div className="text-chat text-ink pt-0.5">{answerBody(msg, idx)}</div>
        </div>
      );
    }
    return (
      <div key={idx} data-message="assistant" className="flex items-start gap-3 argus-rise">
        <div className="flex-shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center" aria-hidden="true">{avatar}</div>
        <div className="min-w-0 flex-1 text-chat text-ink">{answerBody(msg, idx)}</div>
      </div>
    );
  };

  return (
    // overflow-clip, not hidden: the background is clipped, but the column itself can never be scrolled
    <div data-chat-column data-density={look.density} className="relative flex flex-col h-full bg-canvas border-r border-line overflow-clip">
      <ChatBackground kind={look.background} strength={look.backgroundStrength} />

      {/* Header: one dense row, so the conversation gets the height instead */}
      {/* relative z-30: the blur makes the header its own layer; this keeps its menus above the messages */}
      <div className={`relative z-30 h-11 flex-shrink-0 border-b border-line bg-canvas/70 backdrop-blur-md flex justify-between items-center gap-2 ${headerStart ? 'pl-2 pr-1.5 touch:h-12' : 'px-3'}`}>
        {headerStart ?? (
          // The tagline shows only where it fits whole: without room it wraps onto a second line, which is clipped
          <div className="select-none flex flex-wrap items-baseline gap-x-2 min-w-0 h-[15px] overflow-hidden">
              <h1 className="flex-shrink-0 whitespace-nowrap text-[15px] font-black leading-none tracking-[-0.04em] text-ink-strong">Argus</h1>
              <p className="whitespace-nowrap text-[10px] font-medium leading-none uppercase tracking-[0.18em] text-ink-dim">Molecular co-scientist</p>
          </div>
        )}

        <div className="flex items-center gap-0.5">
            {tweaksEnabled() && !headerStart && (
              <button
                onClick={() => setTweaksOpen(o => !o)}
                aria-pressed={tweaksOpen}
                title="Tweak the chat's design"
                aria-label="Tweaks"
                className={`w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors ${tweaksOpen ? 'bg-chip text-ink-strong' : 'text-ink-muted hover:bg-chip/60 hover:text-ink-strong'}`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4-1 1 5 5 1-1a3.5 3.5 0 0 0-5-5Z" /><path d="M14 5 3.5 15.5a2.1 2.1 0 0 0 3 3L17 8" /><path d="M5 3v4M3 5h4M19 15v4M17 17h4" /></svg>
              </button>
            )}
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                title={`Search commands and residues (${shortcutLabel('mod+k')})`}
                aria-label="Search commands"
                className="w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors text-ink-muted hover:bg-chip/60 hover:text-ink-strong"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              </button>
            )}
            <ThemeSwitcher />

            {getShareLink && <ShareButton getLink={getShareLink} disabledReason={shareDisabledReason} />}

            {/* Cinematic Tour Controls */}
            {isTourActive ? (
                <div className="flex items-center gap-0.5 rounded-md bg-chip/60">
                    <button
                        onClick={handlePauseTour}
                        className="w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors text-ink-strong hover:bg-chip"
                        title={isPaused ? "Resume Tour" : "Pause Tour"}
                        aria-label={isPaused ? "Resume the tour" : "Pause the tour"}
                    >
                        {isPaused ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                        )}
                    </button>
                    <button
                        onClick={handleStopTour}
                        className="w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors text-ink-strong hover:bg-chip"
                        title="Stop Tour"
                        aria-label="Stop the tour"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="5" y="5" width="14" height="14" rx="1"></rect></svg>
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => hasTour ? handlePlayTour() : handleRequestTour()}
                    disabled={isLoading}
                    className={`w-7 h-7 touch:w-9 touch:h-9 flex items-center justify-center rounded-md transition-colors relative disabled:opacity-40 disabled:cursor-not-allowed ${
                        hasTour ? 'text-ink-strong hover:bg-chip/60' : 'text-ink-muted enabled:hover:bg-chip/60 enabled:hover:text-ink-strong'
                    }`}
                    title={hasTour ? "Play Cinematic Tour" : "Generate Cinematic Tour"}
                >
                    {/* A ready tour is marked with a dot rather than a lit-up button */}
                    {hasTour && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-ink-strong" />}
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>
                    </svg>
                </button>
            )}
        </div>
      </div>

      {/* The conversation */}
      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          atBottomRef.current = near;
          setAtBottom(near);
        }}
        className="relative z-10 flex-1 overflow-y-auto"
      >
        {showWelcomeScreen ? (
          <div className="h-full px-4">
            <EmptyState
              subject={currentAnalysis?.title}
              look={look}
              onSend={text => processQuery(text)}
              onMode={mode => { setComposerMode(mode); setComposerFocus(n => n + 1); }}
              cofoldReady={cofoldReady}
            />
          </div>
        ) : (
          <div className={`relative px-4 py-5 ${look.density === 'compact' ? 'space-y-4' : 'space-y-6'}`}>
            {look.messages === 'timeline' && <div aria-hidden="true" className="absolute left-[29.5px] top-8 bottom-8 w-px bg-line" />}
            {messages.map(renderMessage)}

            {/* An investigation shows its own progress in its card */}
            {(isLoading || demo.loader) && investigatingId === null && (
              <ChatLoader
                kind={demo.loader ?? loadingKind}
                phase={demo.loader === 'work' ? 'Boltz-2 is predicting Benzamidine with Beta-trypsin… 12 s' : demo.loader === 'think' ? 'Synthesizing analysis…' : (loadingPhase || 'Thinking…')}
                look={look}
              />
            )}

            {demo.error && notice('The AI service is busy right now. Please try again in a moment.', 'Explain how insulin works')}

            {(isTourActive || demo.tour) && (
              <div className="flex justify-center argus-rise" role="status">
                <div className="inline-flex items-center gap-2 pl-1.5 pr-3 h-7 rounded-full border border-line bg-surface/80 backdrop-blur text-[11px] font-medium text-ink-muted">
                  <Orb kind="ring" size={20} paused={isPaused} />
                  <span>
                    {isBuffering ? 'Loading narration…' : isPaused ? 'Tour paused' : 'Tour playing'}
                    {tourStep ? ` · step ${tourStep.index + 1} of ${tourStep.count}` : demo.tour && !isTourActive ? ' · step 2 of 3' : ''}
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="relative z-10 px-3 pb-3 pt-2">
        {!atBottom && !showWelcomeScreen && (
          <button
            type="button"
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
            aria-label="Scroll to the latest message"
            title="Latest message"
            className="absolute -top-10 left-1/2 -translate-x-1/2 w-8 h-8 flex items-center justify-center rounded-full border border-line bg-surface/90 backdrop-blur text-ink-muted hover:text-ink-strong shadow-float argus-rise"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
          </button>
        )}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={submitInput}
          busy={isLoading}
          working={isLoading || Boolean(demo.loader)}
          listening={isListening}
          micAvailable={micAvailable}
          onToggleMic={toggleListening}
          subject={currentAnalysis?.title}
          modelLabel="Nemotron 3 Super · Nebius"
          look={look}
          focusSignal={composerFocus}
          mode={composerMode}
          onModeChange={setComposerMode}
          cofoldReady={cofoldReady}
        />
      </div>

      {tweaksOpen && <TweakPanel onClose={() => setTweaksOpen(false)} />}
    </div>
  );
};

export default ReasoningEngine;
