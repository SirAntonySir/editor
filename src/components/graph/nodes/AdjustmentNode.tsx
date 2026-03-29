import { memo, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sun, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import type { ProcessingNodeData } from '@/types/graph';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { useNodePreview } from '@/hooks/useNodePreview';
import { NodeScrubber } from './NodeScrubber';

const THUMB_W = 180;
const THUMB_DEBOUNCE = 300;

/** Pretty label for a param key */
function formatLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function AdjustmentNodeInner({ id, data, type, selected }: NodeProps & { data: ProcessingNodeData; type: string }) {
  const def = ProcessingRegistry.get(type);
  const Icon = def?.icon ?? Sun;
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const isHighlighted = highlightedNodeId === id;
  const [showThumb, setShowThumb] = useState(true);

  const adj = useEditorStore((s) => {
    if (!data.adjustmentId) return undefined;
    for (const layer of s.layers) {
      const a = layer.adjustmentStack.adjustments.find((x) => x.id === data.adjustmentId);
      if (a) return a;
    }
    return undefined;
  });

  const enabled = adj?.enabled !== false;

  // Per-node thumbnail preview (debounced)
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const { height: thumbH } = useNodePreview(
    thumbRef, type, data.layerId, data.adjustmentId, THUMB_W, THUMB_DEBOUNCE,
  );

  // Get the param keys for compact scrubber mode — from the ProcessingDefinition
  const paramKeys = useMemo(() => {
    if (!def) return [];
    return def.params.map((p) => p.key);
  }, [def]);

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
      className={`glass-panel transition-shadow ${
        isHighlighted ? 'node-focused' : selected ? 'ring-1 ring-accent/40' : ''
      } ${!enabled ? 'opacity-50' : ''}`}
      style={{ width: THUMB_W }}
    >
      {/* Inline thumbnail — collapsible */}
      {showThumb && (
        <canvas
          ref={thumbRef}
          className="block rounded-t-[inherit]"
          style={{ width: THUMB_W, height: thumbH }}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-separator nodrag">
        <Icon size={14} className="text-accent flex-none" />
        <span className="text-xs font-medium text-text-primary flex-1 cursor-default">
          {data.label}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setShowThumb(!showThumb); }}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          {showThumb ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <button
          onClick={handleToggle}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>

      {/* Compact display: scrubber values or custom compact component */}
      <div className="flex flex-col">
        {def?.NodeCompactDisplay && data.layerId ? (
          <def.NodeCompactDisplay layerId={data.layerId} adjustmentId={data.adjustmentId} />
        ) : paramKeys.length > 0 && data.adjustmentId ? (
          paramKeys.map((key) => (
            <NodeScrubber
              key={key}
              nodeType={type}
              adjustmentId={data.adjustmentId!}
              paramKey={key}
              label={formatLabel(key)}
            />
          ))
        ) : (
          <div className="px-3 py-1.5">
            <span className="text-[10px] text-text-secondary">
              {adj?.name ?? data.label}
            </span>
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const AdjustmentNode = memo(AdjustmentNodeInner);
