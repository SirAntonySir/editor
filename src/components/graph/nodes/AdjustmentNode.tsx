import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sun, Palette, Thermometer, Spline, SlidersHorizontal, Image, Eye, EyeOff } from 'lucide-react';
import type { ProcessingNodeType, ProcessingNodeData } from '@/types/graph';
import { LIGHT_PARAM_KEYS, COLOR_PARAM_KEYS } from '@/types/graph';
import { useEditorStore } from '@/store';
import type { LucideIcon } from 'lucide-react';

const NODE_ICONS: Record<string, LucideIcon> = {
  light: Sun,
  color: Palette,
  kelvin: Thermometer,
  curves: Spline,
  levels: SlidersHorizontal,
  filter: Image,
};

/** Format a param value for the chip display */
function formatParam(key: string, value: number | Float32Array): string | null {
  if (value instanceof Float32Array) return null;
  if (value === 0) return null;
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  const sign = value > 0 ? '+' : '';
  return `${label} ${sign}${Math.round(value)}`;
}

/** Keys to display per node type */
const PARAM_FILTER: Record<string, readonly string[]> = {
  light: LIGHT_PARAM_KEYS,
  color: COLOR_PARAM_KEYS,
};

function AdjustmentNodeInner({ data, type, selected }: NodeProps & { data: ProcessingNodeData; type: ProcessingNodeType }) {
  const Icon = NODE_ICONS[type] ?? Sun;

  // Read volatile data from store so graph doesn't rebuild on every slider tick
  const adj = useEditorStore((s) => {
    if (!data.adjustmentId) return undefined;
    for (const layer of s.layers) {
      const a = layer.adjustmentStack.adjustments.find((x) => x.id === data.adjustmentId);
      if (a) return a;
    }
    return undefined;
  });

  const enabled = adj?.enabled !== false;
  const filterKeys = PARAM_FILTER[type];

  const chips = useMemo(() => {
    if (!adj) return [];
    const result: string[] = [];
    for (const [key, val] of Object.entries(adj.params)) {
      if (filterKeys && !(filterKeys as readonly string[]).includes(key)) continue;
      const formatted = formatParam(key, val);
      if (formatted) result.push(formatted);
    }
    return result;
  }, [adj, filterKeys]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.adjustmentId) return;

    // Find the layer containing this adjustment
    const layers = useEditorStore.getState().layers;
    for (const layer of layers) {
      const adj = layer.adjustmentStack.adjustments.find((a) => a.id === data.adjustmentId);
      if (adj) {
        useEditorStore.getState().updateAdjustmentMeta(layer.id, adj.id, { enabled: !enabled });
        return;
      }
    }
  };

  return (
    <div
      className={`glass-panel min-w-[200px] transition-shadow ${
        selected ? 'ring-2 ring-accent shadow-lg' : ''
      } ${!enabled ? 'opacity-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-separator">
        <Icon size={14} className="text-accent flex-none" />
        <span className="text-xs font-medium text-text-primary flex-1">{data.label}</span>
        <button
          onClick={handleToggle}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>

      {/* Body — param chips */}
      {chips.length > 0 && (
        <div className="px-3 py-1.5 flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span
              key={chip}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary text-text-secondary tabular-nums"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {chips.length === 0 && (
        <div className="px-3 py-1.5">
          <span className="text-[10px] text-text-secondary">Default</span>
        </div>
      )}

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const AdjustmentNode = memo(AdjustmentNodeInner);
