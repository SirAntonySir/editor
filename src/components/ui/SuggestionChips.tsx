import { useState } from 'react';
import { Check, Eye, Info, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import * as Popover from '@radix-ui/react-popover';
import { useReactFlow } from '@xyflow/react';
import { useBackendState } from '@/store/backend-state-slice';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { backendTools } from '@/lib/backend-tools';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';
import type { Widget } from '@/types/widget';
import { UI } from '@/config';

/**
 * One row of allow/deny chips, one chip per pending AI suggestion. Renders
 * inline under the status bar after analyze completes. Allow tethers the
 * widget next to the active image node; Deny calls backendTools.delete_widget.
 * In both cases the widget id leaves the pending set so the chip disappears.
 *
 * Pending widgets are filtered out of the inspector AI section, hidden from
 * the render pipeline (so their adjustments don't live-apply), and skipped by
 * the canvas — they do not exist anywhere in the editor surface until the
 * user decides. After resolution, allowed widgets render normally (inspector
 * + canvas); denied widgets are gone.
 */
export function SuggestionChips() {
  const pendingIds = useSuggestionsUi((s) => s.pendingSuggestionIds);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);

  const pending: Widget[] = [];
  for (const w of widgets) {
    if (pendingIds.has(w.id) && w.status === 'active') pending.push(w);
  }

  // One pill per pending widget — the dock's flex-col stacks them above the
  // cmd+K bar. Width matches the command-trigger pill (300px) so they form
  // a tidy column.
  return (
    <div
      className="flex flex-col items-center gap-1"
      role="region"
      aria-label="AI suggestions awaiting approval"
    >
      <AnimatePresence initial={false}>
        {pending.map((w) => (
          <SuggestionChip key={w.id} widget={w} />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface SuggestionChipProps {
  widget: Widget;
}

function SuggestionChip({ widget }: SuggestionChipProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const resolve = useSuggestionsUi((s) => s.resolvePending);
  const addAccepted = useSuggestionsUi((s) => s.addAcceptedSuggestion);
  const recordDecision = useSuggestionsUi((s) => s.recordSuggestionDecision);
  const previewingIds = useSuggestionsUi((s) => s.previewingSuggestionIds);
  const setPreview = useSuggestionsUi((s) => s.setPreview);
  const rf = useReactFlow();

  // Info popover: open on hover, click toggles sticky-open.
  // Hovering reveals briefly; clicking pins it so the user can read at length.
  const [hover, setHover] = useState(false);
  const [sticky, setSticky] = useState(false);
  const infoOpen = hover || sticky;

  function handleAllow() {
    const { x, y, zoom } = rf.getViewport();
    const screen = { w: window.innerWidth, h: window.innerHeight };
    tetherWorkspaceWidgetOnEngage(widget, { pan: { x, y }, zoom, screen });
    addAccepted(widget.id);
    recordDecision({
      id: widget.id,
      intent: widget.intent,
      reasoning: widget.reasoning ?? undefined,
      decision: 'allowed',
      decidedAt: Date.now(),
    });
    resolve(widget.id);
  }

  function handleDeny() {
    if (sessionId) {
      void backendTools.delete_widget(sessionId, {
        widgetId: widget.id,
        suppressSimilar: false,
      });
    }
    recordDecision({
      id: widget.id,
      intent: widget.intent,
      reasoning: widget.reasoning ?? undefined,
      decision: 'denied',
      decidedAt: Date.now(),
    });
    resolve(widget.id);
  }

  const isPreviewing = previewingIds.has(widget.id);
  const reasoning = widget.reasoning?.trim();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
      style={{
        background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
      }}
      className="overlay ai-snake-border pointer-events-auto backdrop-blur-md
        flex items-center gap-1.5 min-w-[300px] pl-3 pr-1.5 py-1.5 text-[11px]"
    >
      <Sparkles size={12} className="text-ai shrink-0" aria-hidden />
      <span className="flex-1 min-w-0 truncate text-text-primary" title={widget.intent}>
        {widget.intent}
      </span>

      <Popover.Root
        open={infoOpen}
        onOpenChange={(next) => {
          // Radix calls onOpenChange for ESC / click-outside; treat both as
          // "fully close" by also resetting the sticky lock.
          if (!next) {
            setSticky(false);
            setHover(false);
          }
        }}
      >
        <Popover.Anchor asChild>
          <button
            type="button"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              setSticky((s) => !s);
            }}
            onFocus={() => setHover(true)}
            onBlur={() => setHover(false)}
            title="Explanation"
            aria-label={`Explanation for ${widget.intent}`}
            aria-pressed={sticky}
            className={`ml-1 inline-flex items-center justify-center p-0.5 rounded-[3px] ${
              sticky
                ? 'bg-ai/20 text-ai'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'
            }`}
          >
            <Info size={11} aria-hidden />
          </button>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            className="overlay w-[260px] p-2.5 text-[11px] text-text-primary leading-snug"
            style={{ zIndex: UI.zPopover }}
            side="bottom"
            align="start"
            sideOffset={6}
            // Keep the popover from stealing focus on hover-open.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="font-medium mb-1">{widget.intent}</div>
            {reasoning ? (
              <p className="text-text-secondary">{reasoning}</p>
            ) : (
              <p className="text-text-tertiary italic">No explanation provided.</p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <button
        type="button"
        onClick={() => setPreview(widget.id, !isPreviewing)}
        title={isPreviewing ? 'Hide preview' : 'Preview on canvas'}
        aria-label={`${isPreviewing ? 'Hide preview of' : 'Preview'} suggestion: ${widget.intent}`}
        aria-pressed={isPreviewing}
        className={`inline-flex items-center justify-center p-0.5 rounded-[3px] ${
          isPreviewing
            ? 'bg-ai/20 text-ai'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'
        }`}
      >
        <Eye size={11} aria-hidden />
      </button>

      <button
        type="button"
        onClick={handleDeny}
        title="Deny"
        aria-label={`Deny suggestion: ${widget.intent}`}
        className="inline-flex items-center justify-center p-0.5 rounded-[3px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
      >
        <X size={11} aria-hidden />
      </button>

      <button
        type="button"
        onClick={handleAllow}
        title="Allow"
        aria-label={`Allow suggestion: ${widget.intent}`}
        className="inline-flex items-center justify-center p-0.5 rounded-[3px] text-white bg-ai hover:brightness-110"
      >
        <Check size={11} aria-hidden />
      </button>
    </motion.div>
  );
}

const EMPTY_WIDGETS: Widget[] = [];
