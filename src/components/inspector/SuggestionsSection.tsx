import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';
import { scopeEquals, type Scope as StoreScope } from '@/types/scope';
import type { Widget } from '@/types/widget';
import { AskAiInput } from './AskAiInput';

export function SuggestionsSection() {
  const snapshot = useBackendState((s) => s.snapshot);
  const activeScope = useEditorStore((s) => s.activeScope);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  const addAcceptedSuggestion = useBackendState((s) => s.addAcceptedSuggestion);
  const sessionId = useBackendState((s) => s.sessionId);

  const suggestions = (snapshot?.widgets ?? []).filter((w) =>
    w.status === 'active' &&
    w.origin.kind === 'mcp_autonomous' &&
    !accepted.has(w.id),
  );

  function onRowClick(widget: Widget, widgetScope: StoreScope | null) {
    // Frontend-only engage: add to acceptedSuggestions so the canvas shell
    // picks it up. Does NOT call backendTools.accept_widget (that is the
    // backend BAKE step, triggered later when the user clicks Apply).
    addAcceptedSuggestion(widget.id);
    const store = useEditorStore.getState();
    if (widgetScope) store.setActiveScope(widgetScope);
    store.focusWidget(widget.id);
    // Tether to the active ImageNode so the engaged suggestion gets a canvas
    // footprint. No-op when no image node is selectable (the row still moves
    // to Active).
    tetherWorkspaceWidgetOnEngage(widget);
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
            onClick={() => onRowClick(w, toStoreScope(w.scope))}
            className="grid w-full items-center text-left text-[10px] py-1 px-1 rounded
              hover:bg-surface-secondary transition-colors group"
            style={{ gridTemplateColumns: '14px 1fr auto 20px 14px', gap: 6, opacity: matches ? 1 : 0.1 }}
          >
            <span className="w-3.5 h-3.5 rounded-sm bg-accent text-white flex items-center
              justify-center text-[7px] font-semibold">AI</span>
            <span className="truncate">{w.intent}</span>
            <span className="text-text-secondary text-[9px]">{scopeLabel(w.scope)}</span>
            {/* ↗ affordance — signals the suggestion moves to the canvas */}
            <span
              aria-hidden="true"
              className="text-text-secondary group-hover:text-accent text-[11px] leading-none transition-colors"
            >↗</span>
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
