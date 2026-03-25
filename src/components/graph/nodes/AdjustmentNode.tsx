import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Sun, Palette, Thermometer, Spline, SlidersHorizontal, Image, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import type { ProcessingNodeType, ProcessingNodeData } from '@/types/graph';
import { LIGHT_PARAM_KEYS, COLOR_PARAM_KEYS } from '@/types/graph';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import { NodeScrubber } from './NodeScrubber';
import { InlineCurvesEditor } from './InlineCurvesEditor';
import { InlineFilterSelector } from './InlineFilterSelector';
import { LightEditor, ColorEditor, KelvinEditor, LevelsEditor } from '../GraphPropertiesPanel';
import type { LucideIcon } from 'lucide-react';

const NODE_ICONS: Record<string, LucideIcon> = {
  light: Sun,
  color: Palette,
  kelvin: Thermometer,
  curves: Spline,
  levels: SlidersHorizontal,
  filter: Image,
};

/** Pretty label for a param key */
function formatLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Keys to display per node type (for scrubber compact mode) */
const PARAM_KEYS: Record<string, readonly string[]> = {
  light: LIGHT_PARAM_KEYS,
  color: COLOR_PARAM_KEYS,
  kelvin: ['kelvin', 'tint'],
  levels: ['inBlack', 'inWhite', 'gamma', 'outBlack', 'outWhite'],
};

/** Node types that support expanded slider mode */
const EXPANDABLE_TYPES = new Set<string>(['light', 'color', 'kelvin', 'levels', 'curves', 'filter']);

function AdjustmentNodeInner({ id, data, type, selected }: NodeProps & { data: ProcessingNodeData; type: ProcessingNodeType }) {
  const Icon = NODE_ICONS[type] ?? Sun;
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
  const canExpand = EXPANDABLE_TYPES.has(type);

  // Get the param keys for compact scrubber mode
  const paramKeys = useMemo(() => {
    if (type === 'curves' || type === 'filter') return [];
    return PARAM_KEYS[type] ?? [];
  }, [type]);

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
        /* ── Expanded mode: full sliders / editors ── */
        <div className="nodrag nowheel">
          {type === 'curves' && data.layerId && (
            <InlineCurvesEditor layerId={data.layerId} />
          )}
          {type === 'filter' && data.layerId && (
            <InlineFilterSelector layerId={data.layerId} />
          )}
          {type === 'light' && data.adjustmentId && (
            <div className="p-3"><LightEditor adjustmentId={data.adjustmentId} /></div>
          )}
          {type === 'color' && data.adjustmentId && (
            <div className="p-3"><ColorEditor adjustmentId={data.adjustmentId} /></div>
          )}
          {type === 'kelvin' && data.adjustmentId && (
            <div className="p-3"><KelvinEditor adjustmentId={data.adjustmentId} /></div>
          )}
          {type === 'levels' && data.adjustmentId && (
            <div className="p-3"><LevelsEditor adjustmentId={data.adjustmentId} /></div>
          )}
        </div>
      ) : (
        /* ── Compact mode: scrubber values ── */
        <div className="flex flex-col">
          {paramKeys.length > 0 && data.adjustmentId
            ? paramKeys.map((key) => (
                <NodeScrubber
                  key={key}
                  nodeType={type}
                  adjustmentId={data.adjustmentId!}
                  paramKey={key}
                  label={formatLabel(key)}
                />
              ))
            : type === 'curves'
              ? (
                  <div className="px-3 py-1.5">
                    <span className="text-[10px] text-text-secondary">Curves</span>
                  </div>
                )
              : type === 'filter'
                ? (
                    <div className="px-3 py-1.5">
                      <span className="text-[10px] text-text-secondary">
                        {adj?.name ?? 'No filter'}
                      </span>
                    </div>
                  )
                : (
                    <div className="px-3 py-1.5">
                      <span className="text-[10px] text-text-secondary">Default</span>
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
