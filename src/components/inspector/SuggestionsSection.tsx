import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useCursorBindStore } from '@/store/cursor-bind-slice';
import { selectAllWidgets } from '@/lib/widget-projection';
import { backendTools } from '@/lib/backend-tools';
import { scopeEquals, type Scope as StoreScope } from '@/types/scope';
import { AskAiInput } from './AskAiInput';

export function SuggestionsSection() {
  // Subscribe so projection recomputes when snapshot or layers change.
  useBackendState((s) => s.snapshot?.revision ?? 0);
  useEditorStore((s) =>
    s.layers.map((l) => `${l.id}:${l.adjustmentStack.adjustments.length}`).join('|'),
  );
  const activeScope = useEditorStore((s) => s.activeScope);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const sessionId = useBackendState((s) => s.sessionId);

  const all = selectAllWidgets();
  const suggestions = all.filter((w) =>
    w.variant === 'ai' && w._widget?.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );

  function onRowClick(widgetId: string, widgetScope: StoreScope | null) {
    useCursorBindStore.getState().startSuggestion(widgetId, widgetScope);
  }

  function onDismiss(e: React.MouseEvent, widgetId: string) {
    e.stopPropagation();
    if (!sessionId) return;
    void backendTools.delete_widget(sessionId, { widget_id: widgetId, suppress_similar: true });
  }

  // Convert the widget-projection scope into a store-side Scope for cursor-bind.
  function toStoreScope(s: unknown): StoreScope | null {
    const sc = s as { kind: string; mask_id?: string };
    if (sc.kind === 'mask' && sc.mask_id) return { kind: 'mask', mask_id: sc.mask_id };
    if (sc.kind === 'named_region') return s as StoreScope;
    if (sc.kind === 'mask:proposed') return s as StoreScope;
    return { kind: 'global' };
  }

  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
        Suggestions
        <span className="bg-surface-secondary px-1 rounded text-[8px]">{suggestions.length}</span>
      </div>
      <AskAiInput />
      {suggestions.map((w) => {
        const matches = !activeScope || activeScope.kind === 'global' || scopeEquals(activeScope, w.scope);
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onRowClick(w.id, toStoreScope(w.scope))}
            className="grid w-full items-center text-left text-[10px] py-1 px-1 rounded
              hover:bg-surface-secondary transition-colors"
            style={{ gridTemplateColumns: '14px 1fr auto 14px', gap: 6, opacity: matches ? 1 : 0.1 }}
          >
            <span className="w-3.5 h-3.5 rounded-sm bg-accent text-white flex items-center
              justify-center text-[7px] font-semibold">AI</span>
            <span className="truncate">{w.intent}</span>
            <span className="text-text-secondary text-[9px]">{scopeLabel(w.scope)}</span>
            <span
              onClick={(e) => onDismiss(e, w.id)}
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
  if (s.kind === 'mask') return 'segment';
  return '—';
}
