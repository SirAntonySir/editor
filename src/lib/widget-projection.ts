import { useBackendState } from '@/store/backend-state-slice';
import type { Widget, Scope, ControlBinding, WidgetAnchor } from '@/types/widget';

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

  // All widgets come from the backend snapshot. Tool-origin widgets are those
  // with origin.kind === 'tool_invoked'; AI widgets are 'mcp_user_prompt' or
  // 'mcp_autonomous'. The variant field is derived from the origin kind.
  const snap = useBackendState.getState().snapshot;
  if (snap) {
    for (const w of snap.widgets) {
      if (w.status !== 'active') continue;
      const variant: 'ai' | 'tool' = w.origin.kind === 'tool_invoked' ? 'tool' : 'ai';
      out.push({
        id: w.id,
        variant,
        intent: w.intent,
        scope: w.scope,
        anchor: w.origin.anchor ?? anchorForScope(w.scope),
        bindings: w.bindings,
        processingId: w.fused_tool_id,
        status: 'active',
        source: 'backend-state',
        _widget: w,
      });
    }
  }

  return out;
}
