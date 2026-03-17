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

/** Format a param value for display */
function formatValue(key: string, value: number | Float32Array): string | null {
  if (value instanceof Float32Array) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value)}`;
}

/** Pretty label for a param key */
function formatLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Keys to display per node type */
const PARAM_FILTER: Record<string, readonly string[]> = {
  light: LIGHT_PARAM_KEYS,
  color: COLOR_PARAM_KEYS,
};

function AdjustmentNodeInner({ id, data, type, selected }: NodeProps & { data: ProcessingNodeData; type: ProcessingNodeType }) {
  const Icon = NODE_ICONS[type] ?? Sun;
  const highlightedNodeId = useEditorStore((s) => s.highlightedNodeId);
  const isHighlighted = highlightedNodeId === id;

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

  const params = useMemo(() => {
    if (!adj) return [];
    const result: { key: string; label: string; value: string }[] = [];
    for (const [key, val] of Object.entries(adj.params)) {
      if (filterKeys && !(filterKeys as readonly string[]).includes(key)) continue;
      const formatted = formatValue(key, val);
      if (formatted) result.push({ key, label: formatLabel(key), value: formatted });
    }
    return result;
  }, [adj, filterKeys]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.adjustmentId) return;

    const layers = useEditorStore.getState().layers;
    for (const layer of layers) {
      const targetAdj = layer.adjustmentStack.adjustments.find((a) => a.id === data.adjustmentId);
      if (targetAdj) {
        useEditorStore.getState().updateAdjustmentMeta(layer.id, targetAdj.id, { enabled: !enabled });
        return;
      }
    }
  };

  return (
    <div
      className={`glass-panel min-w-[180px] transition-shadow ${
        isHighlighted ? 'ring-2 ring-accent shadow-lg' : selected ? 'ring-1 ring-accent/40' : ''
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

      {/* Body — vertical param rows */}
      <div className="flex flex-col">
        {params.length > 0
          ? params.map((p) => (
              <div
                key={p.key}
                className="flex items-center justify-between px-3 py-1 border-b border-separator last:border-b-0"
              >
                <span className="text-[10px] text-text-secondary">{p.label}</span>
                <span className="text-[10px] text-text-primary tabular-nums">{p.value}</span>
              </div>
            ))
          : (
              <div className="px-3 py-1.5">
                <span className="text-[10px] text-text-secondary">Default</span>
              </div>
            )}
      </div>

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const AdjustmentNode = memo(AdjustmentNodeInner);
