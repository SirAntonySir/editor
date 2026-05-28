import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { UnifiedWidget } from '@/lib/widget-projection';
import type { ProcessingDefinition } from '@/types/processing';
import type { Scope } from '@/types/widget';

interface ToolWidgetCardProps {
  uw: UnifiedWidget;
}

/**
 * Resolve which ProcessingDefinition's Panel to render for an Adjustment.
 *
 * `Adjustment.type` is the *shader* key (basic / curves / kelvin / levels / lut)
 * — not the processing id. For shader keys with a single processing
 * (curves, levels, kelvin, lut, ...) we can look the def up directly.
 * For shared keys (basic ⇢ Light + Color) we disambiguate by `Adjustment.name`
 * (set when the tool drops the widget). AI-materialized adjustments fall back
 * to the first matching processing.
 */
function resolveProcessing(type: string, name: string): ProcessingDefinition | undefined {
  const direct = ProcessingRegistry.get(type);
  if (direct) return direct;
  const byLabel = ProcessingRegistry.getAll().find((p) => p.label === name);
  if (byLabel) return byLabel;
  return ProcessingRegistry.getByAdjustmentType(type)[0];
}

export function ToolWidgetCard({ uw }: ToolWidgetCardProps) {
  const adj = uw._adjustment;
  if (!adj) return null;
  const processing = resolveProcessing(adj.adjustment.type, adj.adjustment.name);
  const Panel = processing?.Panel;
  const Icon = processing?.icon;

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    useEditorStore.getState().removeAdjustment(adj!.layerId, adj!.adjustment.id);
  }

  const wide = adj.adjustment.type === 'curves';
  return (
    <div
      className="rounded-md bg-surface/95 border border-glass-border flex flex-col overflow-hidden shadow-lg backdrop-blur-sm"
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
          <Panel layerId={adj.layerId} adjustmentId={adj.adjustment.id} />
        ) : (
          <p className="text-[10px] text-text-secondary px-1">No panel for {adj.adjustment.type}</p>
        )}
      </div>
    </div>
  );
}

function scopeLabel(scope: Scope): string {
  const kind = (scope as { kind: string }).kind;
  switch (kind) {
    case 'global': return 'image';
    case 'named_region':
    case 'mask:proposed':
      return (scope as { label: string }).label;
    case 'mask:click':
      return (scope as { mask_id?: string }).mask_id ? 'segment' : 'image';
    case 'mask':
      return (scope as { maskRef?: string }).maskRef ? 'segment' : 'image';
    default: return 'image';
  }
}
