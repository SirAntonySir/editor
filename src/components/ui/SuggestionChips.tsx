import { useState } from 'react';
import { Check, Eye, Info, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import * as Popover from '@radix-ui/react-popover';
import { useReactFlow } from '@xyflow/react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';
import type { Widget } from '@/types/widget';

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
  const pendingIds = useBackendState((s) => s.pendingSuggestionIds);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);

  const pending: Widget[] = [];
  for (const w of widgets) {
    if (pendingIds.has(w.id) && w.status === 'active') pending.push(w);
  }

  return (
    <AnimatePresence initial={false}>
      {pending.length > 0 && (
        <motion.div
          key="suggestion-chips"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex-none overflow-hidden border-b border-separator bg-ai/10"
          role="region"
          aria-label="AI suggestions awaiting approval"
        >
          <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto">
            <Sparkles size={13} className="text-ai shrink-0" aria-hidden />
            <span className="text-[10px] uppercase tracking-wide text-text-secondary shrink-0">
              {pending.length} pending
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <AnimatePresence initial={false}>
                {pending.map((w) => (
                  <SuggestionChip key={w.id} widget={w} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface SuggestionChipProps {
  widget: Widget;
}

function SuggestionChip({ widget }: SuggestionChipProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const resolve = useBackendState((s) => s.resolvePendingSuggestion);
  const addAccepted = useBackendState((s) => s.addAcceptedSuggestion);
  const previewingIds = useBackendState((s) => s.previewingSuggestionIds);
  const setPreview = useBackendState((s) => s.setPreviewSuggestion);
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
    resolve(widget.id);
  }

  function handleDeny() {
    if (sessionId) {
      void backendTools.delete_widget(sessionId, {
        widget_id: widget.id,
        suppress_similar: false,
      });
    }
    resolve(widget.id);
  }

  const isPreviewing = previewingIds.has(widget.id);
  const reasoning = widget.reasoning?.trim();

  return (
    <motion.div
      layout
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="inline-flex items-center gap-0.5 rounded-[var(--radius-button)] bg-surface border border-separator pl-2 pr-0.5 py-0.5 text-[11px]"
    >
      <span className="max-w-[180px] truncate text-text-primary" title={widget.intent}>
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
            className="overlay w-[260px] p-2.5 text-[11px] text-text-primary z-[60] leading-snug"
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
