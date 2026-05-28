import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { UnifiedWidget } from '@/lib/widget-projection';
import type { Scope } from '@/types/widget';

interface ToolWidgetCardProps {
  uw: UnifiedWidget;
}

export function ToolWidgetCard({ uw }: ToolWidgetCardProps) {
  const adj = uw._adjustment;
  if (!adj) return null;
  const processing = ProcessingRegistry.get(adj.adjustment.type);
  const Panel = processing?.Panel;
  const Icon = processing?.icon;

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    useEditorStore.getState().removeAdjustment(adj!.layerId, adj!.adjustment.id);
  }

  // Curves needs more horizontal room than slider-based panels; let the
  // wrapper grow to fit when the processing asks for it. Other panels keep
  // the compact 200–280px envelope.
  const wide = adj.adjustment.type === 'curves';
  return (
    <div
      className="rounded-lg bg-surface border border-glass-border flex flex-col overflow-hidden"
      style={wide ? { minWidth: 260, maxWidth: 320 } : { minWidth: 200, maxWidth: 280 }}
    >
      {/* Header strip */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-secondary/40">
        <span className="flex items-center justify-center w-4 h-4 rounded-sm bg-surface-secondary text-text-secondary">
          {Icon ? <Icon size={10} /> : <span className="text-[10px]">·</span>}
        </span>
        <span className="text-xs font-medium text-text-primary flex-1 truncate">
          {processing?.label ?? uw.intent}
        </span>
        <span className="text-[9px] text-text-secondary">{scopeLabel(uw.scope)}</span>
        <button
          type="button"
          onClick={close}
          className="text-text-secondary hover:text-text-primary text-sm leading-none px-1"
          aria-label="Close tool widget"
        >
          ×
        </button>
      </div>
      {/* Panel */}
      <div className="px-2.5 py-2">
        {Panel ? (
          <Panel layerId={adj.layerId} />
        ) : (
          <p className="text-[10px] text-text-secondary">No panel registered for {adj.adjustment.type}</p>
        )}
      </div>
    </div>
  );
}

function scopeLabel(scope: Scope): string {
  const kind = (scope as { kind: string }).kind;
  switch (kind) {
    case 'global': return 'global';
    case 'named_region':
    case 'mask:proposed':
      return (scope as { label: string }).label;
    case 'mask:click':
      return (scope as { mask_id?: string }).mask_id ? 'segment' : 'global';
    case 'mask':
      return (scope as { maskRef?: string }).maskRef ? 'segment' : 'global';
    default: return 'global';
  }
}
