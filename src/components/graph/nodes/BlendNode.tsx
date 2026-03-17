import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Layers } from 'lucide-react';
import { useEditorStore } from '@/store';
import type { ProcessingNodeData } from '@/types/graph';

function BlendNodeInner({ data, selected }: NodeProps & { data: ProcessingNodeData }) {
  // Read volatile blend data from store directly
  const layer = useEditorStore((s) =>
    data.layerId ? s.layers.find((l) => l.id === data.layerId) : undefined,
  );
  const blendLabel = layer?.blendMode ?? 'normal';
  const opacityPct = Math.round((layer?.opacity ?? 1) * 100);

  return (
    <div
      className={`glass-panel min-w-[160px] px-3 py-2 transition-shadow ${
        selected ? 'ring-2 ring-accent shadow-lg' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <Layers size={14} className="text-accent flex-none" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-medium text-text-primary capitalize">{blendLabel}</span>
          <span className="text-[10px] text-text-secondary tabular-nums">{opacityPct}% opacity</span>
        </div>
      </div>

      {/* Base input — top left */}
      <Handle
        type="target"
        position={Position.Left}
        id="base"
        style={{ top: '30%' }}
        className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white"
      />

      {/* Overlay input — bottom left */}
      <Handle
        type="target"
        position={Position.Left}
        id="overlay"
        style={{ top: '70%' }}
        className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white"
      />

      {/* Output — right */}
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const BlendNode = memo(BlendNodeInner);
