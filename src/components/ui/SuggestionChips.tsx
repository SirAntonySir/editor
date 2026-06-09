import { Check, Eye, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
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
 * Pending widgets are filtered out of the inspector AI section and skipped
 * by the canvas — they do not exist anywhere in the editor surface until the
 * user decides. After resolution, allowed widgets render normally (inspector
 * + canvas); denied widgets are gone.
 */
export function SuggestionChips() {
  const pendingIds = useBackendState((s) => s.pendingSuggestionIds);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const sessionId = useBackendState((s) => s.sessionId);
  const resolve = useBackendState((s) => s.resolvePendingSuggestion);
  const addAccepted = useBackendState((s) => s.addAcceptedSuggestion);
  const previewingIds = useBackendState((s) => s.previewingSuggestionIds);
  const setPreview = useBackendState((s) => s.setPreviewSuggestion);
  const rf = useReactFlow();

  const pending: Widget[] = [];
  for (const w of widgets) {
    if (pendingIds.has(w.id) && w.status === 'active') pending.push(w);
  }

  function handleAllow(widget: Widget) {
    const { x, y, zoom } = rf.getViewport();
    const screen = { w: window.innerWidth, h: window.innerHeight };
    tetherWorkspaceWidgetOnEngage(widget, { pan: { x, y }, zoom, screen });
    // Mark as accepted so the post-resolve auto-tether hook skips this id
    // and doesn't overwrite the placement we just computed.
    addAccepted(widget.id);
    resolve(widget.id);
  }

  function handleDeny(widget: Widget) {
    if (sessionId) {
      void backendTools.delete_widget(sessionId, {
        widget_id: widget.id,
        suppress_similar: false,
      });
    }
    resolve(widget.id);
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
                  <motion.div
                    key={w.id}
                    layout
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="inline-flex items-center gap-0.5 rounded-[var(--radius-button)] bg-surface border border-separator pl-2 pr-0.5 py-0.5 text-[11px]"
                  >
                    <span className="max-w-[180px] truncate text-text-primary" title={w.intent}>
                      {w.intent}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreview(w.id, !previewingIds.has(w.id))}
                      title={previewingIds.has(w.id) ? 'Hide preview' : 'Preview on canvas'}
                      aria-label={`${previewingIds.has(w.id) ? 'Hide preview of' : 'Preview'} suggestion: ${w.intent}`}
                      aria-pressed={previewingIds.has(w.id)}
                      className={`ml-1 inline-flex items-center justify-center p-0.5 rounded-[3px] ${
                        previewingIds.has(w.id)
                          ? 'bg-ai/20 text-ai'
                          : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'
                      }`}
                    >
                      <Eye size={11} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeny(w)}
                      title="Deny"
                      aria-label={`Deny suggestion: ${w.intent}`}
                      className="inline-flex items-center justify-center p-0.5 rounded-[3px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
                    >
                      <X size={11} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAllow(w)}
                      title="Allow"
                      aria-label={`Allow suggestion: ${w.intent}`}
                      className="inline-flex items-center justify-center p-0.5 rounded-[3px] text-white bg-ai hover:brightness-110"
                    >
                      <Check size={11} aria-hidden />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const EMPTY_WIDGETS: Widget[] = [];
