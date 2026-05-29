import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { Widget, Scope } from '@/types/widget';

interface ToolWidgetCardProps {
  uw: Widget;
}

export function ToolWidgetCard({ uw }: ToolWidgetCardProps) {
  const processing = uw.fused_tool_id ? ProcessingRegistry.get(uw.fused_tool_id) : undefined;
  const Panel = processing?.Panel;
  const Icon = processing?.icon;
  const sessionId = useBackendState((s) => s.sessionId);

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    if (!sessionId) return;
    void backendTools.delete_widget(sessionId, { widget_id: uw.id, suppress_similar: false });
  }

  // Find the active layer ID from the widget's first node (if any) — used by
  // panel components that need a layerId prop. If not available, pass empty string.
  const layerId = uw.nodes[0]?.layer_id ?? '';
  const widgetId = uw.id;

  const wide = processing?.adjustmentType === 'curves';
  return (
    <div
      className="rounded-md bg-surface border border-separator flex flex-col overflow-hidden shadow-overlay"
      style={wide ? { minWidth: 260, maxWidth: 320 } : { minWidth: 200, maxWidth: 240 }}
    >
      {/* Header strip — minimal, matches mock */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <span className="flex items-center justify-center w-3.5 h-3.5 text-text-secondary">
          {Icon ? <Icon size={10} /> : <span className="text-[10px]">·</span>}
        </span>
        <span className="text-[10px] font-medium text-text-primary flex-1 truncate">
          {processing?.label ?? uw.intent}
        </span>
        <span className="text-[9px] text-text-secondary">{scopeLabel(uw.scope)}</span>
        <button
          type="button"
          onClick={close}
          className="text-text-secondary hover:text-text-primary text-xs leading-none px-1 -mr-1"
          aria-label="Close tool widget"
          data-no-drag
        >×</button>
      </div>
      {/* Panel body */}
      <div className="px-1.5 pb-1.5">
        {Panel ? (
          <Panel layerId={layerId} adjustmentId={widgetId} />
        ) : (
          <p className="text-[10px] text-text-secondary px-1">No panel for {processing?.id ?? uw.intent}</p>
        )}
      </div>
    </div>
  );
}

function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case 'global': return 'image';
    case 'named_region':
    case 'mask:proposed':
      return scope.label;
    case 'mask':
      return scope.mask_id ? 'segment' : 'image';
    default: return 'image';
  }
}
