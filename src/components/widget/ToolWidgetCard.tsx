import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { UnifiedWidget } from '@/lib/widget-projection';
import type { Scope } from '@/types/widget';

interface ToolWidgetCardProps {
  uw: UnifiedWidget; // expected variant === 'tool', so _adjustment is set
}

export function ToolWidgetCard({ uw }: ToolWidgetCardProps) {
  const adj = uw._adjustment;
  if (!adj) return null;
  const processing = ProcessingRegistry.get(adj.adjustment.type);
  const Panel = processing?.Panel;
  const Icon = processing?.icon;

  function close() {
    useEditorStore.getState().removeAdjustment(adj!.layerId, adj!.adjustment.id);
  }

  return (
    <div
      className="rounded-lg bg-surface border border-glass-border p-3 flex flex-col gap-3"
      style={{ minWidth: 220 }}
    >
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-sm bg-surface-secondary flex items-center justify-center text-text-secondary text-[10px]">
          {Icon ? <Icon size={10} /> : '·'}
        </div>
        <span className="text-xs font-medium text-text-primary">
          {processing?.label ?? uw.intent}
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-text-secondary">scope · {scopeLabel(uw.scope)}</span>
      </div>
      {Panel ? (
        <Panel layerId={adj.layerId} />
      ) : (
        <p className="text-xs text-text-secondary">
          No panel registered for {adj.adjustment.type}
        </p>
      )}
      <div className="flex justify-end">
        <button
          onClick={close}
          className="text-xs px-2 py-1 rounded bg-surface-secondary text-text-secondary"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'named_region':
      return scope.label;
    case 'mask:proposed':
      return scope.label;
    case 'mask:click':
      return scope.mask_id ? 'segment' : 'global';
  }
}
