import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sun, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import type { ProcessingNodeData } from '@/types/graph';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { NodeScrubber } from './NodeScrubber';

/** Pretty label for a param key */
function formatLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function AdjustmentNodeInner({ id, data, type, selected }: NodeProps & { data: ProcessingNodeData; type: string }) {
  const def = ProcessingRegistry.get(type);
  const Icon = def?.icon ?? Sun;
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const isHighlighted = highlightedNodeId === id;
  const isExpanded = useGraphStore((s) => s.expandedNodeIds.includes(id));
  const toggleExpanded = useGraphStore((s) => s.toggleNodeExpanded);
  const setHighlightedNode = useGraphStore((s) => s.setHighlightedNode);

  const adj = useEditorStore((s) => {
    if (!data.adjustmentId) return undefined;
    for (const layer of s.layers) {
      const a = layer.adjustmentStack.adjustments.find((x) => x.id === data.adjustmentId);
      if (a) return a;
    }
    return undefined;
  });

  const enabled = adj?.enabled !== false;
  const canExpand = def?.expandable ?? false;

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

  const handleExpandToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleExpanded(id);
  };

  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHighlightedNode(isHighlighted ? null : id);
  };

  return (
    <div
      className={`glass-panel min-w-[180px] transition-shadow ${
        isHighlighted ? 'ring-2 ring-accent shadow-lg' : selected ? 'ring-1 ring-accent/40' : ''
      } ${!enabled ? 'opacity-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-separator">
        {canExpand && (
          <button
            onClick={handleExpandToggle}
            className="text-text-secondary hover:text-text-primary transition-colors -ml-1"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        <Icon size={14} className="text-accent flex-none" />
        <span
          className="text-xs font-medium text-text-primary flex-1 cursor-default"
          onDoubleClick={handleTitleDoubleClick}
        >
          {data.label}
        </span>
        <button
          onClick={handleToggle}
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>

      {/* Body */}
      {isExpanded ? (
        /* ── Expanded mode: full editor from ProcessingDefinition ── */
        <div className="nodrag nowheel">
          {(() => {
            if (!def || !data.layerId) return null;
            const ExpandedPanel = def.NodeExpandedPanel ?? def.Panel;
            return (
              <ExpandedPanel
                layerId={data.layerId}
                adjustmentId={data.adjustmentId}
              />
            );
          })()}
        </div>
      ) : (
        /* ── Compact mode: scrubber values or custom display ── */
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
      )}

      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const AdjustmentNode = memo(AdjustmentNodeInner);
