import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, AlertCircle, Sparkles, ArrowRight, Image as ImageIcon, Command as CommandIcon, X as XIcon, SquareDashed } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { pixelStore } from '@/core/pixel-store';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { spawnRegistryOp, spawnRegistryPreset } from '@/lib/toolrail-spawn';
import { PromptEditor, type PromptEditorHandle } from '@/components/ui/PromptEditor';
import { RegionSuggestions } from './RegionSuggestions';
import { rankElements, type PaletteElement } from '@/lib/region-suggest';
import { docToPlainText, serializePromptDoc, type PromptDoc } from '@/lib/prompt-doc';
import { submitAgentPrompt } from '@/lib/palette-submit';
import { usePaletteRuntime } from '@/store/palette-runtime';
import { useMenuActions } from '@/lib/menu-actions';
import { usePreferencesStore } from '@/store/preferences-store';
import { useAiSession } from '@/hooks/useImageContext';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { useSmartMatch } from '@/hooks/useSmartMatch';
import { useAsk } from '@/hooks/useAsk';
import { useAiAccess } from '@/lib/ai-access';
import { CommandPaletteAskView } from './CommandPaletteAskView';
import {
  buildAdjustmentSections,
  buildPresetSections,
  buildMenuActionSections,
  buildPreferencesSections,
  buildRegionsSections,
  buildTargetElements,
  filterSections,
  flattenSections,
  imageNodeLabel,
  resolveInitialTargetId,
  nextTargetId,
  type AttachedContextItem,
  type PaletteCommand,
  type PaletteSection,
} from '@/lib/command-palette';

/** Built once at module load — registry is static after Vite eager-glob.
 *  Menu actions are added per-render inside the component because their
 *  closures depend on hook state (canUndo, hasLayers, ...). Preferences
 *  commands sit here too — their `run` closures pull live state at click
 *  time, so they don't need to be rebuilt on store changes. */
const STATIC_REGISTRY_SECTIONS: PaletteSection[] = [
  ...buildAdjustmentSections(),
  ...buildPresetSections(),
  ...buildPreferencesSections(),
];

type PaletteMode = 'agent' | 'ask';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  /** The prompt is a segment doc so region references can live inline as
   *  atomic chips. `query` (the plain-text projection) drives the command-list
   *  filter, smart-match and AI row exactly as before. */
  const [doc, setDoc] = useState<PromptDoc>([]);
  const query = useMemo(() => docToPlainText(doc), [doc]);
  const editorRef = useRef<PromptEditorHandle>(null);
  /** Caret-anchored region picker state: the ranked matches, the highlighted
   *  row, and the caret rect to anchor under. `regions: []` means closed. */
  const [suggest, setSuggest] = useState<{
    regions: PaletteElement[];
    index: number;
    anchor: DOMRect | null;
  }>({ regions: [], index: 0, anchor: null });
  const [activeIndex, setActiveIndex] = useState(0);
  // In-flight Agent-turn state lives in a shared store (not local) so it
  // survives the palette closing on submit and the minimized pill can read it.
  const pending = usePaletteRuntime((s) => s.pending);
  /** Agent mode (default) drives the registry-driven palette. Ask mode swaps
   *  the results scroll for an LLM-answered markdown view. Toggled by the
   *  pill in the input row. */
  const [mode, setMode] = useState<PaletteMode>('agent');
  // Study control condition: strip the palette's AI affordances (Ask mode,
  // "send as a prompt" row, smart-match) but keep the static op/preset/menu
  // search so both study conditions share a keyboard search surface.
  const aiAccess = useAiAccess();
  const ask = useAsk();
  /** Sub-phase of the AI flow shown in the input placeholder while a
   *  request is in flight: 'analyze' (image context being built) → 'propose'
   *  (LLM stack call). `null` outside the AI path. */
  const pendingPhase = usePaletteRuntime((s) => s.phase);
  const errorState = usePaletteRuntime((s) => s.error);
  /** Context items attached to the AI prompt — populated when the user picks
   *  "Ask AI about this" on a chip menu, or drops a chip onto Cmd+K. Each
   *  item is prepended to the LLM prompt as a structured `Image context:` block. */
  const [attachedContext, setAttachedContext] = useState<AttachedContextItem[]>([]);

  const imageNodes = useEditorStore((s) => s.imageNodes);
  const layers = useEditorStore((s) => s.layers);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);
  const menuActions = useMenuActions();

  // Subscribe to AI context + object ownership so the Regions section stays
  // fresh while the palette is open.
  const aiContext = useAiSession((s) => s.context);
  // objectOwnership is a custom external store — snapshot() returns a version
  // int that increments on every mutation, giving useSyncExternalStore a
  // stable snapshot to compare via Object.is.
  const ownershipVersion = useSyncExternalStore(objectOwnership.subscribe, objectOwnership.snapshot);
  // `buildRegionsSections` reads `maskStore` for object names; subscribe to it
  // so the Regions list stays fresh on add / remove / rename (a label change is
  // otherwise invisible to React — see the bug where a renamed object still
  // showed its old name here).
  const maskVersion = useSyncExternalStore(maskStore.subscribe, maskStore.getVersion);

  // Flat region list (committed objects + AI-proposed regions) for the inline
  // caret picker. Reuses the same merge `buildRegionsSections` performs, so the
  // dropdown and the "Regions" list stay in sync. Recomputes when masks or AI
  // context change.
  const regionList = useMemo<PaletteElement[]>(
    () =>
      buildRegionsSections()
        .flatMap((s) => s.commands)
        .map((c) => ({ kind: 'region' as const, label: c.label, sourceId: c.chipSourceId ?? c.id })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aiContext, ownershipVersion, maskVersion],
  );

  // The `@` picker offers regions PLUS targets (image nodes + their image
  // layers). Plain typing still ranks `regionList` only (see handleCaretWord),
  // so a typed sentence doesn't flood the dropdown with every node/layer.
  const elementList = useMemo<PaletteElement[]>(
    () => [...regionList, ...buildTargetElements(imageNodes, layers)],
    [regionList, imageNodes, layers],
  );

  // Right-sidebar geometry — used to keep the palette centered over the
  // canvas column rather than the full viewport. RightSidebar unmounts when
  // there are no layers, and goes to width 0 when collapsed (SidebarShell),
  // so the effective offset is 0 in both cases.
  const rightSidebarWidth = usePreferencesStore((s) => s.rightSidebarWidth);
  const rightSidebarCollapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const sidebarOffset =
    layers.length > 0 && !rightSidebarCollapsed ? rightSidebarWidth : 0;

  // Section order: Regions → Adjustments → Presets → Commands → AI. Regions
  // sit first so a quick label search surfaces the named area immediately.
  // Commands sit below domain operations so a bare "light" query still
  // surfaces the Light adjustment first; users searching for "open" /
  // "undo" / "zoom" still find them by name and the Kbd chip reminds them
  // of the shortcut.
  const allSections = useMemo<PaletteSection[]>(
    () => [
      ...buildRegionsSections(),
      ...STATIC_REGISTRY_SECTIONS,
      ...buildMenuActionSections(menuActions),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuActions, aiContext, ownershipVersion, maskVersion],
  );

  // Filter sections by query. Result is partitioned: `primary` holds rows
  // whose title (or alias / op-id) matched, `secondary` holds rows that only
  // survived on a description match. The AI "Send as a prompt" row is
  // synthesised separately and sits *between* the two groups, so the user
  // sees: tool titles → AI fallback → description-only matches.
  const { primary: primarySections, secondary: secondarySections } = useMemo(
    () => filterSections(allSections, query),
    [allSections, query],
  );
  const aiCommand = useMemo<PaletteCommand | null>(
    () => (query.trim() && aiAccess
      ? {
          id: 'ai',
          kind: 'ai',
          label: `"${query.trim()}"`,
          description: 'Send as a prompt',
        }
      : null),
    [query, aiAccess],
  );

  // ─── Smart match (AI) ──────────────────────────────────────────────
  // Typing-time LLM matcher that ranks op/preset ids by fit to both the
  // query AND the current image. Fires only when the deterministic
  // primary section is sparse — for unambiguous queries ("warm", "fade")
  // the synonym match already nails it and no LLM call runs.
  //
  // Picks come back as {kind, id, reason}. We resolve each id against
  // `allSections` to recover the matching `PaletteCommand` (icon, opId,
  // presetId) so the existing `run()` path executes them with no special
  // case.
  const commandByRegistryId = useMemo<Map<string, PaletteCommand>>(() => {
    const m = new Map<string, PaletteCommand>();
    for (const s of allSections) {
      for (const c of s.commands) {
        if (c.kind === 'op' && c.opId) m.set(`op:${c.opId}`, c);
        else if (c.kind === 'preset' && c.presetId) m.set(`preset:${c.presetId}`, c);
      }
    }
    return m;
  }, [allSections]);
  const primaryCount = useMemo(
    () => primarySections.reduce((n, s) => n + s.commands.length, 0),
    [primarySections],
  );
  // Fire only when the deterministic primary section is sparse — under 3
  // hits means the synonym match didn't fully cover the query, so the LLM
  // has room to add value. Above 3, the deterministic side has the user
  // covered and the AI call would just spend tokens to echo what's there.
  const smartMatch = useSmartMatch(query, { enabled: aiAccess && primaryCount < 3 });
  const smartSection = useMemo<PaletteSection | null>(() => {
    if (smartMatch.picks.length === 0) return null;
    // Map each pick to its canonical PaletteCommand and dedup against the
    // primary section so the smart row never echoes a row already shown.
    const primaryKeys = new Set<string>();
    for (const s of primarySections) {
      for (const c of s.commands) {
        if (c.kind === 'op' && c.opId) primaryKeys.add(`op:${c.opId}`);
        else if (c.kind === 'preset' && c.presetId) primaryKeys.add(`preset:${c.presetId}`);
      }
    }
    const commands: PaletteCommand[] = [];
    for (const pick of smartMatch.picks) {
      const key = `${pick.kind}:${pick.id}`;
      if (primaryKeys.has(key)) continue;
      const base = commandByRegistryId.get(key);
      if (!base) continue;
      // Overlay the LLM's reason as the row's description so the user sees
      // *why* the AI surfaced it ("fits warm-shadows mood") rather than
      // the generic registry description.
      commands.push({ ...base, description: pick.reason || base.description });
    }
    if (commands.length === 0) return null;
    return { id: 'smart-match', title: 'Smart match · AI', commands };
  }, [smartMatch.picks, primarySections, commandByRegistryId]);

  // Flat command list for arrow navigation. Order mirrors the rendered
  // layout: primary rows → smart-match rows → AI row → secondary rows.
  const flat = useMemo<PaletteCommand[]>(
    () => {
      const primaryFlat = flattenSections(primarySections);
      const smartFlat = smartSection ? smartSection.commands : [];
      const secondaryFlat = flattenSections(secondarySections);
      return [
        ...primaryFlat,
        ...smartFlat,
        ...(aiCommand ? [aiCommand] : []),
        ...secondaryFlat,
      ];
    },
    [primarySections, smartSection, secondarySections, aiCommand],
  );

  // Best-match preview: when the user types, highlight the first concrete
  // command (op / preset / tool / menu) so Enter picks the best fuzzy
  // match. Only fall back to the AI row when nothing else matched. The
  // previous behaviour highlighted whatever sat at index 0, which was the
  // AI row whenever the deterministic scorer returned nothing.
  const defaultActiveIndex = useMemo<number>(() => {
    const idx = flat.findIndex(
      (c) => c.kind === 'op' || c.kind === 'preset' || c.kind === 'tool' || c.kind === 'menu',
    );
    return idx === -1 ? 0 : idx;
  }, [flat]);
  // Drive activeIndex from defaultActiveIndex whenever flat changes — same
  // canonical previous-prop pattern used elsewhere in this file. The user
  // can still arrow-navigate freely after that; the reset only fires when
  // the underlying command list changes shape.
  const [lastFlatKey, setLastFlatKey] = useState<string>('');
  const flatKey = flat.map((c) => c.id).join('|');
  if (lastFlatKey !== flatKey) {
    setLastFlatKey(flatKey);
    setActiveIndex(defaultActiveIndex);
  }

  const nodeIds = useMemo(() => Object.keys(imageNodes), [imageNodes]);
  const targetNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
  const targetLabel = targetNode ? imageNodeLabel(targetNode, layers) : '';

  // Open handler — no session/image gate so the palette is usable from
  // the empty-canvas state (the user opens images and runs preferences
  // from here). Image-targeted commands (adjustments, presets, AI) stay
  // disabled via their own `disabled` flag inside the palette when
  // there are no layers / sessionId. When triggered by the per-chip
  // "Ask AI about this" affordance, the dispatching code attaches
  // `detail.attachContext` items which get merged into the attached-
  // context state and shown above the input.
  useEffect(() => {
    function onOpen(e: Event) {
      const ids = Object.keys(useEditorStore.getState().imageNodes);
      // Only auto-promote an active image node when at least one exists.
      // `resolveInitialTargetId` handles empty input, so this guard is
      // strictly defensive against future implementations.
      if (ids.length > 0) {
        const initial = resolveInitialTargetId(ids, useEditorStore.getState().activeImageNodeId);
        if (initial) setActiveImageNode(initial);
      }

      // Pull any context items the dispatcher attached. When the palette
      // is already open and the user fires another "Ask AI" from a chip
      // menu, we *append* to the existing set instead of replacing.
      const detail = (e as CustomEvent<{
        attachContext?: Array<Omit<AttachedContextItem, 'id'>>;
        mode?: PaletteMode;
      }>).detail;
      // Honour an explicit mode in the open event — image-node right-click
      // and the AI menu's "Ask about the image" both open the palette
      // directly in Ask mode. Plain Cmd+K omits this and stays in Agent.
      if (detail?.mode) setMode(detail.mode);
      const incoming: AttachedContextItem[] = (detail?.attachContext ?? []).map((c, i) => ({
        id: `attach-${Date.now().toString(36)}-${i}`,
        label: c.label,
        value: c.value,
        sourceId: c.sourceId,
      }));
      setAttachedContext((prev) => {
        if (incoming.length === 0 && !open) return [];
        // Dedup by `${label}:${value}` so re-clicking the same chip doesn't
        // pile up duplicates.
        const seen = new Set(prev.map((p) => `${p.label}:${p.value}`));
        const merged = [...prev];
        for (const item of incoming) {
          const key = `${item.label}:${item.value}`;
          if (!seen.has(key)) {
            merged.push(item);
            seen.add(key);
          }
        }
        return merged;
      });
      if (!open) {
        // Preserve query + chips across opens. In-flight / error state lives in
        // usePaletteRuntime now and is intentionally NOT cleared here — a turn
        // submitted earlier keeps loading on the pill, and reopening shows it.
        // After a FAILED turn, repopulate the prompt + chips from the restore
        // snapshot so the user can edit and retry instead of retyping.
        const rt = usePaletteRuntime.getState();
        if (rt.error && rt.restore) {
          setDoc(rt.restore.doc);
          setAttachedContext(rt.restore.attachedContext);
        }
        setOpen(true);
      }
    }
    window.addEventListener('spawn-palette:open', onOpen);
    return () => window.removeEventListener('spawn-palette:open', onOpen);
  }, [setActiveImageNode, open]);

  // Palette state (query, chips, mode, ask answer) persists across
  // close → open cycles so the user can hide the palette to glance at
  // something on canvas, then reopen and pick up where they left off.
  // The state resets only on (a) a successful submit (see `resetPalette`
  // calls inside `run`) or (b) the user clearing the input / detaching
  // chips by hand.
  const resetPalette = useCallback(() => {
    setDoc([]);
    editorRef.current?.clear();
    setSuggest({ regions: [], index: 0, anchor: null });
    setActiveIndex(0);
    setAttachedContext([]);
    setMode('agent');
    ask.reset();
  }, [ask]);
  // Drop a previous Ask answer the moment the user toggles back to Agent
  // (or vice versa) so the body doesn't flash stale state for one frame.
  const [lastMode, setLastMode] = useState(mode);
  if (lastMode !== mode) {
    setLastMode(mode);
    ask.reset();
  }
  // Control condition has no Ask mode — if the flag flips to false while the
  // palette sits in Ask (e.g. admin toggle mid-session), snap back to Agent.
  if (!aiAccess && mode === 'ask') setMode('agent');

  // Broadcast open/close so CommandTrigger can hide itself and Framer's
  // shared-layout morph (layoutId="command-palette-shell") has only one
  // element mounted at a time.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(open ? 'palette:opened' : 'palette:closed'));
  }, [open]);

  // ⌘K-as-toggle support: App.tsx dispatches `palette:close-request` when
  // ⌘K is hit while the palette is already open. ESC continues to work via
  // Dialog.Root's built-in handler.
  useEffect(() => {
    function onClose() {
      setOpen(false);
    }
    window.addEventListener('palette:close-request', onClose);
    return () => window.removeEventListener('palette:close-request', onClose);
  }, []);

  const cycleTarget = useCallback(() => {
    const next = nextTargetId(nodeIds, activeImageNodeId);
    if (next) setActiveImageNode(next);
  }, [nodeIds, activeImageNodeId, setActiveImageNode]);

  // Caret moved in the editor — rank regions against the word under it and
  // (re)position the picker. An empty ranking closes the dropdown.
  const handleCaretWord = useCallback(
    (query: string, rect: DOMRect | null, trigger: '@' | null) => {
      // `@` is the explicit "show me everything" affordance: the full element
      // list (regions + targets), all of it on a bare `@`, filtered as the user
      // types. Plain typing keeps the region-only fuzzy behaviour.
      const ranked =
        trigger === '@'
          ? rankElements(elementList, query, { allowEmpty: true, limit: 24, minChars: 1 })
          : rankElements(regionList, query);
      setSuggest({ regions: ranked, index: 0, anchor: rect });
    },
    [regionList, elementList],
  );

  const closeSuggest = useCallback(
    () => setSuggest({ regions: [], index: 0, anchor: null }),
    [],
  );

  // Accept a region: drop it as an inline chip at the caret and close the
  // picker. Attaching a chip is just a reference in the prompt — it must NOT
  // segment or spin up an image node here. That's the AI's decision, made when
  // the prompt is submitted (Enter → agent turn). Used by the keyboard accept,
  // the dropdown, and the Regions chip strip.
  const acceptSuggestion = useCallback(
    (element: { label: string; sourceId: string }) => {
      editorRef.current?.insertChipAtCaret({ label: element.label, sourceId: element.sourceId });
      closeSuggest();
    },
    [closeSuggest],
  );

  const run = useCallback(
    async (cmd: PaletteCommand | undefined) => {
      if (!cmd) return;
      if (cmd.kind === 'op' && cmd.opId) {
        spawnRegistryOp(cmd.opId, cmd.label);
        resetPalette();
        setOpen(false);
        return;
      }
      if (cmd.kind === 'preset' && cmd.presetId) {
        spawnRegistryPreset(cmd.presetId, cmd.label);
        resetPalette();
        setOpen(false);
        return;
      }
      if (cmd.kind === 'menu' && cmd.run) {
        if (cmd.disabled) return;
        cmd.run();
        resetPalette();
        setOpen(false);
        return;
      }
      if (cmd.kind === 'chip') {
        // Drop the region inline at the caret (or end of the prompt) and keep
        // the palette open so the user can keep composing. This is the
        // fallback path to the inline caret picker — same insertion target.
        acceptSuggestion({
          label: cmd.chipValue ?? cmd.label,
          sourceId: cmd.chipSourceId ?? cmd.id,
        });
        return;
      }
      if (cmd.kind === 'ai') {
        if (usePaletteRuntime.getState().pending) return; // already in flight
        // Guard against an empty prompt before we tear the palette down.
        const { intent } = serializePromptDoc(doc, attachedContext);
        if (!intent) return;
        // Fire-and-forget: the turn runs in `submitAgentPrompt` (module scope,
        // driving usePaletteRuntime) so it survives the close. The pill shows
        // the loader; the proposed widgets/segmentation questions stream onto
        // the now-visible canvas; a failure leaves the store in an error state
        // that reopening restores from.
        void submitAgentPrompt(doc, attachedContext);
        resetPalette();
        setOpen(false);
      }
    },
    [doc, attachedContext, resetPalette, acceptSuggestion],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Region picker has precedence over everything while it's open: it owns
      // the navigation keys so the command list / target-cycle don't also fire.
      if (suggest.regions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSuggest((s) => ({ ...s, index: Math.min(s.index + 1, s.regions.length - 1) }));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSuggest((s) => ({ ...s, index: Math.max(s.index - 1, 0) }));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          acceptSuggestion(suggest.regions[suggest.index]);
          return;
        }
        if (e.key === 'Escape') {
          // Stop the native event before it reaches Radix's document-level
          // escape handler, so dismissing the picker doesn't close the dialog.
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          closeSuggest();
          return;
        }
      }
      // Ask mode: Enter submits to the LLM and pins the markdown response
      // in the body. Arrow keys and Tab keep their Agent-mode semantics
      // disabled — there's nothing to navigate in Ask mode.
      if (mode === 'ask') {
        if (e.key === 'Enter') {
          e.preventDefault();
          const docChips = doc
            .filter((s): s is Extract<PromptDoc[number], { kind: 'chip' }> => s.kind === 'chip')
            .map((s) => ({ label: 'Region', value: s.label, sourceId: s.sourceId }));
          const trayChips = attachedContext.map((c) => ({
            label: c.label,
            value: c.value,
            sourceId: c.sourceId,
          }));
          ask.submit(query, [...docChips, ...trayChips]);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleTarget();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && aiCommand) void run(aiCommand);
        else void run(flat[activeIndex]);
      }
    },
    [
      mode,
      ask,
      query,
      doc,
      attachedContext,
      flat,
      activeIndex,
      aiCommand,
      cycleTarget,
      run,
      suggest,
      acceptSuggestion,
      closeSuggest,
    ],
  );

  // Flat index lookup so each rendered section can know which absolute
  // index its first command sits at — needed to mark the right row as
  // `active` against the keyboard's `activeIndex`. Indices walk in render
  // order: primary sections, then AI row, then secondary sections.
  const primaryStartIndices = useMemo(() => {
    const map: number[] = [];
    let cursor = 0;
    for (const s of primarySections) {
      map.push(cursor);
      cursor += s.commands.length;
    }
    return map;
  }, [primarySections]);
  // Smart-match section sits between primary and the AI fallback row, so
  // it pushes every later row's absolute index by `smartCount`.
  const smartCount = smartSection ? smartSection.commands.length : 0;
  const smartStartIndex = smartSection ? primaryCount : -1;
  const aiStartIndex = aiCommand ? primaryCount + smartCount : -1;
  const secondaryBase = primaryCount + smartCount + (aiCommand ? 1 : 0);
  const secondaryStartIndices = useMemo(() => {
    const map: number[] = [];
    let cursor = secondaryBase;
    for (const s of secondarySections) {
      map.push(cursor);
      cursor += s.commands.length;
    }
    return map;
  }, [secondarySections, secondaryBase]);

  // Icon for the input row: previews the active row so the user sees
  // exactly what Enter will fire. Spinner overrides everything while an
  // AI request is in-flight. When the user hasn't typed anything yet
  // (idle), keep the plain Search glyph regardless of what's highlighted —
  // an icon-mirror with nothing typed reads as "this is preselected"
  // when really it's just "first row by default".
  const activeCmd: PaletteCommand | undefined = flat[activeIndex];
  const ActiveIcon = activeCmd?.icon;
  const isIdle = query.trim().length === 0;
  // Ask mode shows a markdown answer instead of the result list, so the
  // icon-mirror has no rows to mirror — pin to a stable Sparkles glyph
  // for the whole Ask session (or the spinner while a request is in
  // flight). Without this the icon would still flip as `flat` updates
  // even though no list is visible.
  const askPending = ask.state.status === 'pending';
  const searchIconNode = pending || askPending ? (
    <Loader2 size={14} className="text-[var(--color-ai)] animate-spin" />
  ) : mode === 'ask' ? (
    <Sparkles size={14} className="text-[var(--color-ai)] ai-glow-pulse" />
  ) : isIdle ? (
    <Search size={14} className="text-text-secondary" />
  ) : activeCmd?.kind === 'ai' ? (
    <Sparkles size={14} className="text-[var(--color-ai)] ai-glow-pulse" />
  ) : activeCmd?.kind === 'chip' ? (
    <SquareDashed size={14} className="text-[var(--color-ai)]" />
  ) : ActiveIcon ? (
    <ActiveIcon size={14} className="text-text-secondary" />
  ) : (
    <Search size={14} className="text-text-secondary" />
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 bg-black/40 z-40"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              onKeyDown={onKeyDown}
              aria-describedby={undefined}
            >
              <motion.div
                layoutId="command-palette-shell"
                // Top-anchored so the input keeps its vertical position as the
                // results list grows/shrinks — the dialog only contracts from
                // the bottom. Was previously centered (-translate-y-1/2),
                // which recentered the whole shell on every height change.
                className="fixed top-[12vh] left-1/2 -translate-x-1/2 z-50 overlay p-0
                  flex flex-col w-[min(44rem,92vw)] max-h-[min(40rem,76vh)] backdrop-blur-md"
                style={{
                  background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
                  // Shift center left by half the sidebar width so the
                  // palette lives over the visible canvas column. Animated
                  // so toggling the sidebar slides the palette into place.
                  marginLeft: -sidebarOffset / 2,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
                // Wheel-anywhere-in-palette → scroll the results viewport.
                // Browsers send the wheel event to the element under the
                // cursor; with the cursor on the input row (where it sits when
                // the palette opens), the viewport never sees it and the user
                // perceives "mouse wheel doesn't work". Forward the deltaY to
                // the Radix viewport when the event originated outside it.
                onWheel={(e) => {
                  const viewport = e.currentTarget.querySelector(
                    '[data-radix-scroll-area-viewport]',
                  ) as HTMLElement | null;
                  if (!viewport) return;
                  if (viewport.contains(e.target as Node)) return; // already inside — Radix handles it
                  viewport.scrollBy({ top: e.deltaY });
                }}
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                {/* Chrome row — mode toggle + context chips only. Renders only
                    when it has content so an empty padded strip never shows.
                    The target chip now lives on the input row below. No
                    separator: it visually fuses with the input row. */}
                {(aiAccess || attachedContext.length > 0) && (
                  <div
                    className={`flex items-center gap-1 px-2 py-1 flex-wrap${
                      pending || ask.state.status === 'pending' ? ' ai-shimmer' : ''
                    }`}
                  >
                    {aiAccess && <ModeToggle mode={mode} onChange={setMode} />}
                    {attachedContext.length > 0 && (
                      <InlineContextChips
                        items={attachedContext}
                        onRemove={(id) => setAttachedContext((prev) => prev.filter((c) => c.id !== id))}
                      />
                    )}
                  </div>
                )}
                {/* Prompt row — search icon + inline-chip editor + target chip
                    on one line. Region references become atomic chips inside
                    the prompt as the user types (fuzzy, accepted Tab/Enter).
                    The target chip sits flush-right on this same row. */}
                <div className="flex items-center gap-2 px-2 py-1.5 border-b border-separator">
                  {searchIconNode}
                  <PromptEditor
                    ref={editorRef}
                    initialDoc={doc}
                    onChange={(d) => { setDoc(d); if (usePaletteRuntime.getState().error) usePaletteRuntime.getState().clearError(); }}
                    onCaretWordChange={handleCaretWord}
                    disabled={mode === 'agent' && !!pending}
                    placeholder={
                      mode === 'ask'
                        ? ask.state.status === 'pending'
                          ? `Answering "${ask.state.query}"…`
                          : 'Ask anything about this photo…'
                        : pending
                          ? pendingPhase === 'analyze'
                            ? `Analyzing image first — then "${pending}"…`
                            : `Sending "${pending}"…`
                          : aiAccess ? 'Search tools or ask AI…' : 'Search tools…'
                    }
                  />
                  {targetLabel && (
                    <TargetChip
                      label={targetLabel}
                      thumbLayerId={targetNode?.layerIds[0]}
                      onCycle={cycleTarget}
                    />
                  )}
                </div>
                <RegionSuggestions
                  elements={suggest.regions}
                  activeIndex={suggest.index}
                  anchorRect={suggest.anchor}
                  onSelect={acceptSuggestion}
                  onHover={(i) => setSuggest((s) => ({ ...s, index: i }))}
                />

                {errorState && (
                  <div className="flex items-start gap-2 px-2 py-1 border-b border-separator bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_8%,transparent)]">
                    <AlertCircle size={12} className="mt-[2px] flex-none text-[var(--color-danger,#e5484d)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-text-primary">{errorState.message}</div>
                      {errorState.hint && (
                        <div className="text-[10px] text-text-secondary mt-0.5">Hint: {errorState.hint}</div>
                      )}
                      <div className="text-[10px] text-text-secondary mt-1">Press Enter to retry.</div>
                    </div>
                  </div>
                )}

                {/* Results: registry-driven sections, then the AI command.
                    Wrapped in the project's Radix ScrollArea so the overlay
                    scrollbar renders the same in light + dark mode as the
                    history dropdown — the previous plain `overflow-y-auto`
                    surfaced the native browser scrollbar which read as a
                    light-grey track in dark mode. The flex-1/min-h-0 outer
                    box gives the Viewport an explicit height. */}
                {/* Wrap the ScrollArea in a definite-height container so
                    Radix's Viewport gets a real height to clip against.
                    `flex-1 min-h-0` alone leaves the ScrollArea Root as
                    auto-height inside Dialog.Content — Viewport then has
                    no overflow to scroll, even though content is bigger.
                    Same fix shape as HistoryDropdown. */}
                {mode === 'ask' ? (
                  <CommandPaletteAskView state={ask.state} pendingQueryDraft={query} />
                ) : (
                <div className="flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full" viewportClassName="py-1">
                  {primarySections.map((section, sIdx) =>
                    section.id === 'regions' ? (
                      <RegionChipStrip
                        key={section.id}
                        commands={section.commands}
                        startIndex={primaryStartIndices[sIdx]}
                        activeIndex={activeIndex}
                        onSelect={run}
                      />
                    ) : (
                      <div key={section.id}>
                        <SectionHeader title={section.title} />
                        {section.commands.map((cmd, cIdx) => {
                          const absIdx = primaryStartIndices[sIdx] + cIdx;
                          return (
                            <CommandRow
                              key={cmd.id}
                              command={cmd}
                              active={absIdx === activeIndex}
                              onSelect={() => run(cmd)}
                            />
                          );
                        })}
                      </div>
                    ),
                  )}
                  {smartSection && (
                    <div key={smartSection.id}>
                      <SectionHeader
                        title={smartSection.title}
                        tone="ai"
                        loading={smartMatch.loading}
                      />
                      {smartSection.commands.map((cmd, cIdx) => {
                        const absIdx = smartStartIndex + cIdx;
                        return (
                          <CommandRow
                            key={`smart:${cmd.id}`}
                            command={cmd}
                            active={absIdx === activeIndex}
                            onSelect={() => run(cmd)}
                          />
                        );
                      })}
                    </div>
                  )}
                  {aiCommand && (
                    <>
                      <SectionHeader title="Ask AI" tone="ai" />
                      <CommandRow
                        command={aiCommand}
                        active={activeIndex === aiStartIndex}
                        onSelect={() => run(aiCommand)}
                      />
                    </>
                  )}
                  {secondarySections.map((section, sIdx) =>
                    section.id === 'regions' ? (
                      <RegionChipStrip
                        key={`sec:${section.id}`}
                        commands={section.commands}
                        startIndex={secondaryStartIndices[sIdx]}
                        activeIndex={activeIndex}
                        onSelect={run}
                      />
                    ) : (
                    <div key={`sec:${section.id}`}>
                      <SectionHeader title={section.title} />
                      {section.commands.map((cmd, cIdx) => {
                        const absIdx = secondaryStartIndices[sIdx] + cIdx;
                        return (
                          <CommandRow
                            key={cmd.id}
                            command={cmd}
                            active={absIdx === activeIndex}
                            onSelect={() => run(cmd)}
                          />
                        );
                      })}
                    </div>
                    ),
                  )}
                  {flat.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-text-secondary">No matches.</div>
                  )}
                </ScrollArea>
                </div>
                )}

                {/* Footer */}
                <div className="flex items-center gap-3.5 px-2 py-1 border-t border-separator text-[10px] text-text-secondary">
                  {mode === 'ask' ? (
                    <>
                      <span>↵ ask</span>
                      <span>⇥ target</span>
                      <span>esc close</span>
                    </>
                  ) : (
                    <>
                      <span>↑↓ navigate</span>
                      <span>↵ run</span>
                      {aiCommand && <span>⌘↵ AI</span>}
                      <span>⇥ target</span>
                      <span>esc close</span>
                    </>
                  )}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Inline context chips rendered inside the input row (just before the
 *  text input). Each chip shows a label + value identity from the Info tab,
 *  with an × to remove. Lives in the same flex row as the search icon and
 *  input; the parent row has flex-wrap so many chips wrap onto a second line
 *  above the input cursor. */
function InlineContextChips({
  items,
  onRemove,
}: {
  items: AttachedContextItem[];
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {items.map((c) => (
        <div
          key={c.id}
          className="inline-flex items-center gap-0.5 max-w-full text-[10px]
            rounded-[3px] px-1 py-px leading-tight
            bg-[color-mix(in_srgb,var(--color-ai)_15%,transparent)]
            text-[var(--color-ai)] border border-[color-mix(in_srgb,var(--color-ai)_30%,transparent)]"
          title={`${c.label}: ${c.value}`}
        >
          <span className="text-[var(--color-ai)]/80 uppercase tracking-wide">{c.label}</span>
          <span className="text-text-primary tabular-nums truncate max-w-[120px]">{c.value}</span>
          <button
            type="button"
            onClick={() => onRemove(c.id)}
            className="ml-px text-text-secondary hover:text-text-primary"
            aria-label={`Detach ${c.label}`}
          >
            <XIcon size={9} />
          </button>
        </div>
      ))}
    </>
  );
}

function TargetChip({
  label,
  thumbLayerId,
  onCycle,
}: {
  label: string;
  thumbLayerId: string | undefined;
  onCycle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`Change target (Tab) — currently "${label}"`}
      className="flex-none flex items-center gap-1 max-w-[160px] text-[10px] text-text-secondary
        bg-surface-secondary px-1.5 py-px rounded hover:text-text-primary transition-colors leading-tight"
    >
      <TargetThumb layerId={thumbLayerId} />
      <span className="truncate min-w-0">{label}</span>
      <ArrowRight size={10} className="flex-none opacity-50" />
    </button>
  );
}

/** Square thumbnail (16 px) showing the target image-node's first layer. Reads
 *  the OffscreenCanvas from `pixelStore` once per layerId change and draws a
 *  cover-cropped scale into a 32 × 32 canvas (1× retina-safe headroom). Falls
 *  back to a Lucide Image icon when the pixels haven't loaded yet (palette
 *  opened before image upload) so the chip's row height stays stable. */
function TargetThumb({ layerId }: { layerId: string | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    setDrawn(false);
    if (!layerId) return;
    const source = pixelStore.getSource(layerId);
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const out = canvas.width;
    const sw = source.width;
    const sh = source.height;
    // Cover crop: take the largest centered square of the source bitmap so
    // the thumbnail isn't letterboxed inside the 16-px chip.
    const side = Math.min(sw, sh);
    const sx = (sw - side) / 2;
    const sy = (sh - side) / 2;
    ctx.clearRect(0, 0, out, out);
    ctx.drawImage(source as unknown as CanvasImageSource, sx, sy, side, side, 0, 0, out, out);
    setDrawn(true);
  }, [layerId]);

  return (
    <span className="relative flex-none inline-flex items-center justify-center w-4 h-4 overflow-hidden rounded-[2px] bg-surface">
      <canvas
        ref={canvasRef}
        width={32}
        height={32}
        className={`w-full h-full ${drawn ? 'opacity-100' : 'opacity-0'} transition-opacity`}
        aria-hidden
      />
      {!drawn && (
        <ImageIcon size={10} className="absolute opacity-70" aria-hidden />
      )}
    </span>
  );
}

/**
 * Regions section, rendered as a single horizontal scroll strip of chips
 * (instead of a vertical list + "Regions" header). A leading SquareDashed icon
 * marks the strip; each chip stays keyboard-navigable via `activeIndex` so
 * up/down + Enter still work alongside clicking.
 */
function RegionChipStrip({
  commands,
  startIndex,
  activeIndex,
  onSelect,
}: {
  commands: PaletteCommand[];
  startIndex: number;
  activeIndex: number;
  onSelect: (cmd: PaletteCommand) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto">
      <SquareDashed size={13} className="flex-none text-text-secondary" aria-hidden />
      {commands.map((cmd, i) => {
        const active = startIndex + i === activeIndex;
        return (
          <button
            key={cmd.id}
            type="button"
            onClick={() => onSelect(cmd)}
            className={`flex-none inline-flex items-center text-[11px] rounded-[3px] px-1.5 py-0.5 border transition-colors ${
              active
                ? 'bg-[color-mix(in_srgb,var(--color-ai)_15%,transparent)] border-[color-mix(in_srgb,var(--color-ai)_40%,transparent)] text-[var(--color-ai)]'
                : 'bg-surface-secondary border-separator text-text-primary hover:border-[var(--color-ai)]'
            }`}
          >
            <span className="truncate max-w-[140px]">{cmd.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SectionHeader({
  title,
  tone = 'default',
  loading = false,
}: {
  title: string;
  tone?: 'default' | 'ai';
  /** When true, render a tiny inline spinner after the title — used by the
   *  Smart match section while its backend call is in flight. Keeps the
   *  header presence stable so the surrounding layout doesn't jump on
   *  every debounced fire. */
  loading?: boolean;
}) {
  const aiTone = tone === 'ai';
  return (
    <div
      className={`flex items-center gap-1.5 text-[9px] uppercase tracking-wide px-2 py-0.5 mt-0.5
        ${aiTone ? 'text-[var(--color-ai)]' : 'text-text-secondary'}`}
    >
      {aiTone && <Sparkles size={9} className="ai-glow-pulse" />}
      <span>{title}</span>
      {loading && <Loader2 size={9} className="animate-spin opacity-70" />}
    </div>
  );
}

function CommandRow({
  command,
  active,
  onSelect,
}: {
  command: PaletteCommand;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = command.icon;
  const isAi = command.kind === 'ai';
  const isMenu = command.kind === 'menu';
  const isChip = command.kind === 'chip';
  const disabled = !!command.disabled;
  const ref = useRef<HTMLButtonElement>(null);
  // Keep the keyboard-active row inside the scroll viewport. `block: 'nearest'`
  // is the right default — it only scrolls when the row is actually off-screen,
  // so clicking a mid-list row doesn't jump the list.
  useEffect(() => {
    if (active && ref.current) ref.current.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 px-2 py-1 text-left transition-colors border-l-2
        ${active && !disabled ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${
          active && !disabled
            ? isAi
              ? 'border-l-[var(--color-ai)]'
              : 'border-l-[var(--color-accent)]'
            : 'border-l-transparent'
        }`}
    >
      <span
        className={`w-4 flex-none flex justify-center ${isAi || isChip ? 'text-[var(--color-ai)]' : 'text-text-secondary'}`}
      >
        {isAi ? (
          <Sparkles size={14} className="ai-glow-pulse" />
        ) : isChip ? (
          // Region / Object chip — same SquareDashed used in the input row's
          // active-row preview when a chip is highlighted.
          <SquareDashed size={13} />
        ) : isMenu ? (
          // Generic command glyph for menu actions so the column doesn't
          // sit empty next to every File/Edit/View row.
          <CommandIcon size={12} className="opacity-70" />
        ) : Icon ? (
          <Icon size={14} />
        ) : (
          '·'
        )}
      </span>
      <span
        className={`text-xs truncate min-w-0 ${isAi ? 'text-[var(--color-ai)] font-medium' : 'text-text-primary'}`}
      >
        {command.label}
      </span>
      {/* Right rail. Chip commands preview the chip they'd attach (same
          styling as the inline strip in the input row) so the user sees
          exactly what's about to land. Other commands fall back to the
          plain description text. */}
      {command.kind === 'chip' ? (
        <span
          className="ml-auto flex-none inline-flex items-center gap-0.5 max-w-[60%] text-[10px]
            rounded-[3px] px-1 py-px leading-tight
            bg-[color-mix(in_srgb,var(--color-ai)_15%,transparent)]
            text-[var(--color-ai)] border border-[color-mix(in_srgb,var(--color-ai)_30%,transparent)]"
          aria-hidden
        >
          <span className="text-[var(--color-ai)]/80 uppercase tracking-wide">
            {command.description}
          </span>
          <span className="text-text-primary truncate max-w-[120px]">
            {command.chipValue ?? command.label}
          </span>
        </span>
      ) : command.description ? (
        <span className="ml-auto flex-none text-[10px] text-text-secondary truncate max-w-[50%] text-right">
          {command.description}
        </span>
      ) : null}
      {/* Kbd has `ml-auto` built in, which still pins it right when no
          description is present. */}
      {command.shortcut && <Kbd keys={command.shortcut} />}
    </button>
  );
}

/** Two-position pill that flips the palette between Agent (registry-driven
 *  command list) and Ask (LLM markdown answer). Sits flush-left in the
 *  input row so the active mode is the first thing the eye lands on. */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: PaletteMode;
  onChange: (m: PaletteMode) => void;
}) {
  return (
    <div className="inline-flex flex-none items-center rounded-[3px] bg-surface-secondary p-px text-[10px]">
      <ModeButton
        active={mode === 'agent'}
        onClick={() => onChange('agent')}
        label="Agent"
        title="Search tools and ask the agent to act"
      />
      <ModeButton
        active={mode === 'ask'}
        onClick={() => onChange('ask')}
        label="Ask"
        title="Get a grounded answer about the photo"
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-1.5 py-px rounded-[3px] transition-colors leading-tight ${
        active
          ? 'bg-surface text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}
