import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { MaskSummary, Widget } from '@/types/widget';
import { BindingRow } from './BindingRow';
import { LifecycleActions } from './LifecycleActions';

interface WidgetCardProps {
  widget: Widget;
  isSuggestion: boolean;
  variant?: 'ai' | 'tool';             // default 'ai'
  mode?: 'canvas' | 'inspector-row';   // default 'canvas'; only 'canvas' active in v1
}

// Stable empty array so the masks selector never returns a new reference.
const EMPTY_MASKS: MaskSummary[] = [];

export function WidgetCard({ widget, isSuggestion, variant = 'ai', mode = 'canvas' }: WidgetCardProps) {
  void mode;
  const sessionId = useBackendState((s) => s.sessionId);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const optimistic = useBackendState((s) => s.optimistic);
  const applyOptimistic = useBackendState((s) => s.applyOptimistic);
  const baseRevision = useBackendState((s) => s.snapshot?.revision ?? 0);

  function effectiveValue(paramKey: string, fallback: Widget['bindings'][number]['value']): Widget['bindings'][number]['value'] {
    const patch = optimistic.get(widget.id);
    const hit = patch?.bindings.find((b) => b.paramKey === paramKey);
    return hit ? hit.value : fallback;
  }

  function closeHeader(e: React.MouseEvent) {
    e.stopPropagation();
    if (!sessionId) return;
    void backendTools.delete_widget(sessionId, {
      widget_id: widget.id,
      // Suggestions: suppress similar so they don't come back. Active: just delete.
      suppress_similar: isSuggestion,
    });
  }

  return (
    <div
      className={
        'rounded-lg bg-surface border flex flex-col overflow-hidden ' +
        (variant === 'ai' ? 'border-accent/60' : 'border-glass-border')
      }
      style={{ minWidth: 180, maxWidth: 220 }}
    >
      {/* Header strip */}
      <div
        className={
          'flex items-center gap-1.5 px-2 py-1 ' +
          (variant === 'ai' ? 'bg-accent/10' : 'bg-surface-secondary/40')
        }
      >
        <span
          className={
            'flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none ' +
            (variant === 'ai'
              ? 'bg-accent text-white px-1 py-px'
              : 'bg-surface-secondary text-text-secondary px-1 py-px')
          }
        >
          {variant === 'ai' ? 'AI' : '·'}
        </span>
        <span className="text-[11px] font-medium text-text-primary flex-1 truncate">{widget.intent}</span>
        <button
          type="button"
          onClick={closeHeader}
          className="text-text-secondary hover:text-text-primary text-sm leading-none px-1"
          aria-label={isSuggestion ? 'Dismiss suggestion' : 'Delete widget'}
        >
          ×
        </button>
      </div>

      {/* Bindings */}
      {widget.bindings.length > 0 && (
        <div className="flex flex-col gap-1 px-2 py-1.5">
          {widget.bindings.map((b) => (
            <BindingRow
              key={b.param_key}
              binding={b}
              effectiveValue={effectiveValue(b.param_key, b.value)}
              maskSummaries={masks}
              onChange={(value) => {
                if (!sessionId) return;
                applyOptimistic(widget.id, {
                  baseRevision,
                  bindings: [{ paramKey: b.param_key, value }],
                });
                void backendTools.set_widget_param(sessionId, {
                  widget_id: widget.id, param_key: b.param_key, value,
                });
              }}
            />
          ))}
        </div>
      )}

      {/* Lifecycle */}
      <div className="px-2 pb-1.5">
        <LifecycleActions widget={widget} isSuggestion={isSuggestion} variant={variant} />
      </div>
    </div>
  );
}
