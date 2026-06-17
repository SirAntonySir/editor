import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Loader2, AlertCircle, Sparkles, ArrowRight, Image as ImageIcon, Command as CommandIcon, X as XIcon } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useEditorStore } from '@/store';
import { spawnRegistryOp, spawnRegistryPreset } from '@/lib/toolrail-spawn';
import { proposeFromPalette } from '@/lib/palette-actions';
import { useMenuActions } from '@/lib/menu-actions';
import { usePreferencesStore } from '@/store/preferences-store';
import { analyseActiveImageLayer, useAiSession } from '@/hooks/useImageContext';
import type { Scope } from '@/types/widget';
import {
  buildAdjustmentSections,
  buildPresetSections,
  buildMenuActionSections,
  buildPreferencesSections,
  filterSections,
  flattenSections,
  imageNodeLabel,
  resolveInitialTargetId,
  nextTargetId,
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

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  /** Sub-phase of the AI flow shown in the input placeholder while a
   *  request is in flight: 'analyze' (image context being built) → 'propose'
   *  (LLM stack call). `null` outside the AI path. */
  const [pendingPhase, setPendingPhase] = useState<'analyze' | 'propose' | null>(null);
  const [errorState, setErrorState] = useState<{ code?: string; message: string; hint?: string } | null>(null);
  /** Context items attached to the AI prompt — populated when the user picks
   *  "Ask AI about this" on a chip menu, or drops a chip onto Cmd+K. Each
   *  item is prepended to the LLM prompt as a structured `Image context:` block. */
  const [attachedContext, setAttachedContext] = useState<AttachedContextItem[]>([]);

  const imageNodes = useEditorStore((s) => s.imageNodes);
  const layers = useEditorStore((s) => s.layers);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);
  const menuActions = useMenuActions();

  // Right-sidebar geometry — used to keep the palette centered over the
  // canvas column rather than the full viewport. RightSidebar unmounts when
  // there are no layers, and goes to width 0 when collapsed (SidebarShell),
  // so the effective offset is 0 in both cases.
  const rightSidebarWidth = usePreferencesStore((s) => s.rightSidebarWidth);
  const rightSidebarCollapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const sidebarOffset =
    layers.length > 0 && !rightSidebarCollapsed ? rightSidebarWidth : 0;

  // Section order: Adjustments → Presets → Commands → AI. Commands sit
  // below domain operations so a bare "light" query still surfaces the
  // Light adjustment first; users searching for "open" / "undo" / "zoom"
  // still find them by name and the Kbd chip reminds them of the shortcut.
  const allSections = useMemo<PaletteSection[]>(
    () => [
      ...STATIC_REGISTRY_SECTIONS,
      ...buildMenuActionSections(menuActions),
    ],
    [menuActions],
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
    () => (query.trim()
      ? {
          id: 'ai',
          kind: 'ai',
          label: `"${query.trim()}"`,
          description: 'Send as a prompt',
        }
      : null),
    [query],
  );

  // Flat command list for arrow navigation. Order mirrors the rendered
  // layout: primary rows → AI row → secondary (description-only) rows.
  const flat = useMemo<PaletteCommand[]>(
    () => {
      const primaryFlat = flattenSections(primarySections);
      const secondaryFlat = flattenSections(secondarySections);
      return [
        ...primaryFlat,
        ...(aiCommand ? [aiCommand] : []),
        ...secondaryFlat,
      ];
    },
    [primarySections, secondarySections, aiCommand],
  );

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
      const detail = (e as CustomEvent<{ attachContext?: Array<Omit<AttachedContextItem, 'id'>> }>).detail;
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
        setQuery('');
        setActiveIndex(0);
        setPending(null);
        setPendingPhase(null);
        setErrorState(null);
        setOpen(true);
      }
    }
    window.addEventListener('spawn-palette:open', onOpen);
    return () => window.removeEventListener('spawn-palette:open', onOpen);
  }, [setActiveImageNode, open]);

  // Clear attached context whenever the palette closes — opening it from
  // scratch (plain Cmd+K) should never inherit a stale attachment. Done
  // synchronously during render via the canonical previous-prop pattern
  // (https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes)
  // rather than an effect with setState.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setAttachedContext([]);
  }

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

  const run = useCallback(
    async (cmd: PaletteCommand | undefined) => {
      if (!cmd) return;
      if (cmd.kind === 'op' && cmd.opId) {
        spawnRegistryOp(cmd.opId, cmd.label);
        setOpen(false);
        return;
      }
      if (cmd.kind === 'preset' && cmd.presetId) {
        spawnRegistryPreset(cmd.presetId, cmd.label);
        setOpen(false);
        return;
      }
      if (cmd.kind === 'menu' && cmd.run) {
        if (cmd.disabled) return;
        cmd.run();
        setOpen(false);
        return;
      }
      if (cmd.kind === 'ai') {
        if (pending) return; // already in flight — ignore double-submit
        // Forward an explicit mask scope when one is set; otherwise fall back
        // to plain global — image-node selection lives in activeImageNodeId.
        const state = useEditorStore.getState();
        const oid = state.activeObjectId;
        const scope: Scope = oid !== null
          ? { kind: 'mask', mask_id: oid }
          : { kind: 'global' };
        const submitted = query.trim();
        setPending(submitted);
        setErrorState(null);

        // Backend's propose_stack(mcp_user_prompt) rejects with
        // `missing_context` when the image hasn't been analyzed. Rather than
        // surface a dead-end error, auto-run analyze first — the user types
        // a prompt and presses Enter, gets a single pending state for both
        // the analyze and the AI call.
        const aiSession = useAiSession.getState();
        if (!aiSession.context) {
          setPendingPhase('analyze');
          try {
            await analyseActiveImageLayer();
          } catch (err) {
            setPending(null);
            setPendingPhase(null);
            setErrorState({
              message: err instanceof Error ? err.message : 'Analyze failed.',
            });
            return;
          }
          setPendingPhase('propose');
          // Bail if the user hit ESC mid-analyze.
          if (useAiSession.getState().context == null) {
            setPending(null);
            setPendingPhase(null);
            return;
          }
        }

        const result = await proposeFromPalette(submitted, scope, attachedContext);
        // If the user ESC'd while the request was in flight, the dialog
        // unmounts and the setStates below short-circuit harmlessly.
        if (result.ok) {
          setPending(null);
          setPendingPhase(null);
          setOpen(false);
        } else {
          setPending(null);
          setPendingPhase(null);
          setErrorState({
            code: result.error.code,
            message: result.error.message,
            hint: result.error.recovery_hint,
          });
        }
      }
    },
    [query, pending, attachedContext],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    [flat, activeIndex, aiCommand, cycleTarget, run],
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
  const primaryCount = useMemo(
    () => primarySections.reduce((n, s) => n + s.commands.length, 0),
    [primarySections],
  );
  const aiStartIndex = aiCommand ? primaryCount : -1;
  const secondaryBase = primaryCount + (aiCommand ? 1 : 0);
  const secondaryStartIndices = useMemo(() => {
    const map: number[] = [];
    let cursor = secondaryBase;
    for (const s of secondarySections) {
      map.push(cursor);
      cursor += s.commands.length;
    }
    return map;
  }, [secondarySections, secondaryBase]);

  // Icon for the search bar: shifts to a violet Sparkles when the user has
  // typed something (it's now an AI prompt), to a spinner when in-flight.
  const searchIconNode = pending ? (
    <Loader2 size={14} className="text-[var(--color-ai)] animate-spin" />
  ) : query.trim() ? (
    <Sparkles size={14} className="text-[var(--color-ai)] ai-glow-pulse" />
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
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                {/* Context attachment strip — shows above the input when the
                    user has pinned chips via "Ask AI about this" (or, soon,
                    via drag). Items are bundled into the AI prompt at submit
                    time as a structured preamble. Removable individually. */}
                {attachedContext.length > 0 && (
                  <ContextAttachmentStrip
                    items={attachedContext}
                    onRemove={(id) => setAttachedContext((prev) => prev.filter((c) => c.id !== id))}
                  />
                )}
                {/* Search row + target chip — the row gets the violet shimmer
                    when an AI request is in flight, so the user sees that the
                    panel itself is doing work. */}
                <div
                  className={`flex items-center gap-2.5 px-3.5 py-3 border-b border-separator${
                    pending ? ' ai-shimmer' : ''
                  }`}
                >
                  {searchIconNode}
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); if (errorState) setErrorState(null); }}
                    placeholder={
                      pending
                        ? pendingPhase === 'analyze'
                          ? `Analyzing image first — then “${pending}”…`
                          : `Sending “${pending}”…`
                        : 'Search tools or ask AI…'
                    }
                    disabled={!!pending}
                    className="flex-1 min-w-0 bg-transparent outline-none text-xs text-text-primary placeholder:text-text-secondary disabled:opacity-60"
                  />
                  {targetLabel && (
                    <TargetChip label={targetLabel} onCycle={cycleTarget} />
                  )}
                </div>

                {errorState && (
                  <div className="flex items-start gap-2 px-3.5 py-2 border-b border-separator bg-[color-mix(in_srgb,var(--color-danger,#e5484d)_8%,transparent)]">
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
                    Plain overflow-y-auto here — the Radix ScrollArea hides
                    its track via h-full on a viewport that needs an explicit
                    parent height to compute, and the dialog's max-h-only
                    container doesn't give it one (the symptom: rows just
                    overflow past the dialog bottom instead of scrolling). */}
                <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
                  {primarySections.map((section, sIdx) => (
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
                  ))}
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
                  {secondarySections.map((section, sIdx) => (
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
                  ))}
                  {flat.length === 0 && (
                    <div className="px-3.5 py-3 text-xs text-text-secondary">No matches.</div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3.5 px-3.5 py-2 border-t border-separator text-[10px] text-text-secondary">
                  <span>↑↓ navigate</span><span>↵ run</span>
                  {aiCommand && <span>⌘↵ AI</span>}
                  <span>⇥ target</span><span>esc close</span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Target chip — shows the active image node's name. Truncates long file
 *  names so the chip never blows out the row layout (the bug the screenshot
 *  showed). */
interface AttachedContextItem {
  id: string;
  label: string;
  value: string;
  sourceId?: string;
}

/** Strip of attached-context chips above the Cmd+K input. Each chip shows
 *  the same label + value identity the Info tab uses, with an × to remove.
 *  Wraps when the row overflows so the strip never pushes the input out
 *  of view. */
function ContextAttachmentStrip({
  items,
  onRemove,
}: {
  items: AttachedContextItem[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-1.5 px-3.5 py-2 border-b border-separator
      bg-[color-mix(in_srgb,var(--color-ai)_8%,transparent)]">
      <Sparkles size={11} className="mt-[2px] flex-none text-[var(--color-ai)] ai-glow-pulse" />
      <div className="flex flex-wrap gap-1 flex-1 min-w-0">
        {items.map((c) => (
          <div
            key={c.id}
            className="inline-flex items-center gap-1 max-w-full text-[10px]
              rounded-[3px] px-1.5 py-0.5
              bg-[color-mix(in_srgb,var(--color-ai)_15%,transparent)]
              text-[var(--color-ai)] border border-[color-mix(in_srgb,var(--color-ai)_30%,transparent)]"
            title={`${c.label}: ${c.value}`}
          >
            <span className="text-[var(--color-ai)]/80 uppercase tracking-wide">{c.label}</span>
            <span className="text-text-primary tabular-nums truncate">{c.value}</span>
            <button
              type="button"
              onClick={() => onRemove(c.id)}
              className="ml-0.5 text-text-secondary hover:text-text-primary"
              aria-label={`Detach ${c.label}`}
            >
              <XIcon size={9} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TargetChip({ label, onCycle }: { label: string; onCycle: () => void }) {
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`Change target (Tab) — currently “${label}”`}
      className="flex-none flex items-center gap-1 max-w-[160px] text-[10px] text-text-secondary
        bg-surface-secondary px-2 py-1 rounded hover:text-text-primary transition-colors"
    >
      <ImageIcon size={10} className="flex-none opacity-70" />
      <span className="truncate min-w-0">{label}</span>
      <ArrowRight size={10} className="flex-none opacity-50" />
    </button>
  );
}

function SectionHeader({ title, tone = 'default' }: { title: string; tone?: 'default' | 'ai' }) {
  const aiTone = tone === 'ai';
  return (
    <div
      className={`flex items-center gap-1.5 text-[9px] uppercase tracking-wide px-3.5 py-0.5 mt-0.5
        ${aiTone ? 'text-[var(--color-ai)]' : 'text-text-secondary'}`}
    >
      {aiTone && <Sparkles size={9} className="ai-glow-pulse" />}
      <span>{title}</span>
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
      className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left transition-colors
        ${active && !disabled ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
        ${isAi ? 'border-l-2 border-[var(--color-ai)]' : ''}`}
    >
      <span
        className={`w-4 flex-none flex justify-center ${isAi ? 'text-[var(--color-ai)]' : 'text-text-secondary'}`}
      >
        {isAi ? (
          <Sparkles size={14} className="ai-glow-pulse" />
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
      {/* Description sits flush right — short category tags ("Appearance",
          "Send as a prompt") read as a right-rail label rather than getting
          lost between the label and the shortcut chip. */}
      {command.description && (
        <span className="ml-auto flex-none text-[10px] text-text-secondary truncate max-w-[50%] text-right">
          {command.description}
        </span>
      )}
      {/* Kbd has `ml-auto` built in, which still pins it right when no
          description is present. */}
      {command.shortcut && <Kbd keys={command.shortcut} />}
    </button>
  );
}
