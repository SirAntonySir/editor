import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useFocusedWidget } from '@/store/focus-slice';
import { selectAllWidgets, type UnifiedWidget } from '@/lib/widget-projection';
import { backendTools } from '@/lib/backend-tools';
import { scopeMatches } from '@/lib/scope-match';

export function ActiveSection() {
  useBackendState((s) => s.snapshot?.revision ?? 0);
  useEditorStore((s) =>
    s.layers.map((l) => `${l.id}:${l.adjustmentStack.adjustments.length}`).join('|'),
  );
  const activeScope = useEditorStore((s) => s.activeScope);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const sessionId = useBackendState((s) => s.sessionId);

  const all = selectAllWidgets();
  const actives = all.filter((w) =>
    w.variant === 'tool' || w._widget?.origin.kind !== 'mcp_autonomous' || accepted.has(w.id),
  );

  function onRowClick(widgetId: string) {
    useFocusedWidget.getState().setFocused(widgetId);
  }

  function onRemove(e: React.MouseEvent, uw: UnifiedWidget) {
    e.stopPropagation();
    if (uw.variant === 'tool' && uw._adjustment) {
      useEditorStore
        .getState()
        .removeAdjustment(uw._adjustment.layerId, uw._adjustment.adjustment.id);
    } else if (sessionId) {
      void backendTools.delete_widget(sessionId, { widget_id: uw.id, suppress_similar: false });
    }
  }

  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
        Active
        <span className="bg-surface-secondary px-1 rounded text-[8px]">{actives.length}</span>
      </div>
      {actives.map((w) => {
        const matches = scopeMatches(activeScope, w.scope as never);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onRowClick(w.id)}
            className="grid w-full items-center text-left text-[10px] py-1 px-1 rounded
              hover:bg-surface-secondary transition-colors"
            style={{ gridTemplateColumns: '14px 1fr auto 14px', gap: 6, opacity: matches ? 1 : 0.1 }}
          >
            <span
              className={
                'w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-semibold ' +
                (w.variant === 'ai'
                  ? 'bg-accent text-white'
                  : 'bg-surface-secondary text-text-secondary')
              }
            >
              {w.variant === 'ai' ? 'AI' : '·'}
            </span>
            <span className="truncate">{w.intent}</span>
            <span className="text-text-secondary text-[9px]">{scopeLabel(w.scope as never)}</span>
            <span
              onClick={(e) => onRemove(e, w)}
              className="text-text-secondary hover:text-text-primary text-[12px] leading-none"
            >×</span>
          </button>
        );
      })}
    </section>
  );
}

function scopeLabel(s: { kind: string; label?: string }): string {
  if (s.kind === 'global') return 'image';
  if (s.kind === 'mask:proposed' || s.kind === 'named_region') return s.label ?? 'region';
  if (s.kind === 'mask' || s.kind === 'mask:click') return 'segment';
  return '—';
}
