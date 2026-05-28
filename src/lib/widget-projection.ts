import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import type { Widget, Scope, ControlBinding, WidgetAnchor } from '@/types/widget';
import type { Adjustment } from '@/store/layer-slice';

export interface UnifiedWidget {
  id: string;
  variant: 'ai' | 'tool';
  intent: string;
  scope: Scope;
  anchor: WidgetAnchor;
  bindings: ControlBinding[];
  processingId?: string;
  status: 'active' | 'pending';
  source: 'backend-state' | 'editor-store';
  _widget?: Widget;
  _adjustment?: { layerId: string; adjustment: Adjustment };
}

function anchorForScope(scope: Scope): WidgetAnchor {
  if (scope.kind === 'global') return { kind: 'global' };
  if (scope.kind === 'named_region') return { kind: 'region_label', label: scope.label };
  if (scope.kind === 'mask:proposed') return { kind: 'region_label', label: scope.label };
  if (scope.kind === 'mask') return { kind: 'mask_id', mask_id: scope.mask_id };
  return { kind: 'global' };
}

export function selectAllWidgets(): UnifiedWidget[] {
  const out: UnifiedWidget[] = [];

  // AI widgets — from backend snapshot
  const snap = useBackendState.getState().snapshot;
  if (snap) {
    for (const w of snap.widgets) {
      if (w.status !== 'active') continue;
      out.push({
        id: w.id,
        variant: 'ai',
        intent: w.intent,
        scope: w.scope,
        anchor: w.origin.anchor ?? anchorForScope(w.scope),
        bindings: w.bindings,
        status: 'active',
        source: 'backend-state',
        _widget: w,
      });
    }
  }

  // Tool widgets — from scoped adjustments on visible layers
  const layers = useEditorStore.getState().layers;
  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const adj of layer.adjustmentStack.adjustments) {
      if (!adj.enabled) continue;
      if (!adj.scope) continue; // only scoped adjustments become tool widgets
      // adj.scope is the narrow Scope from @/types/scope; cast to widget Scope for UnifiedWidget
      const widgetScope = adj.scope as unknown as Scope;
      out.push({
        id: adj.id,
        variant: 'tool',
        // Prefer the AI provenance label over the raw shader type when this
        // adjustment was materialized from an accepted suggestion.
        intent: adj.aiSource?.intent ?? adj.name,
        scope: widgetScope,
        anchor: anchorForScope(widgetScope),
        bindings: [],
        processingId: adj.type,
        status: 'active',
        source: 'editor-store',
        _adjustment: { layerId: layer.id, adjustment: adj },
      });
    }
  }

  return out;
}
