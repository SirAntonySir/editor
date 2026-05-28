import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BindingRow } from './BindingRow';
import { LifecycleActions } from './LifecycleActions';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { MaskSummary, Widget } from '@/types/widget';

interface WidgetCardProps {
  widget: Widget;
  isSuggestion: boolean;
  variant?: 'ai' | 'tool';             // default 'ai'
  mode?: 'canvas' | 'inspector-row';   // default 'canvas'; only 'canvas' active in v1
}

// Stable empty array so the masks selector never returns a new reference.
const EMPTY_MASKS: MaskSummary[] = [];

export function WidgetCard({ widget, isSuggestion, variant = 'ai', mode = 'canvas' }: WidgetCardProps) {
  void mode; // reserved for Task 12 inspector-row rendering
  const sessionId = useBackendState((s) => s.sessionId);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const optimistic = useBackendState((s) => s.optimistic);
  const applyOptimistic = useBackendState((s) => s.applyOptimistic);
  const baseRevision = useBackendState((s) => s.snapshot?.revision ?? 0);
  const [expanded, setExpanded] = useState(!isSuggestion);

  function effectiveValue(paramKey: string, fallback: Widget['bindings'][number]['value']): Widget['bindings'][number]['value'] {
    const patch = optimistic.get(widget.id);
    const hit = patch?.bindings.find((b) => b.paramKey === paramKey);
    return hit ? hit.value : fallback;
  }

  return (
    <div
      className={
        'rounded-lg bg-surface border p-3 flex flex-col gap-3 ' +
        (variant === 'ai' ? 'border-accent/60' : 'border-glass-border')
      }
      style={{ minWidth: 200, maxWidth: 320 }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-start gap-1 text-sm font-medium text-text-primary text-left w-full"
          >
            {expanded ? <ChevronDown size={14} className="shrink-0 mt-0.5" /> : <ChevronRight size={14} className="shrink-0 mt-0.5" />}
            <span className="line-clamp-2 break-words">{widget.intent}</span>
          </button>
          {widget.reasoning && (
            <p className="text-xs text-text-secondary mt-1 line-clamp-3 break-words">{widget.reasoning}</p>
          )}
        </div>
      </div>

      {expanded && widget.bindings.length > 0 && (
        <div className="flex flex-col gap-2 pl-4">
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

      {(expanded || isSuggestion) && (
        <div className="pt-1 border-t border-glass-border">
          <LifecycleActions widget={widget} isSuggestion={isSuggestion} variant={variant} />
        </div>
      )}
    </div>
  );
}
