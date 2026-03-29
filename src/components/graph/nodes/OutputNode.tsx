import { memo, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Flag } from 'lucide-react';
import { useGraphStore } from '@/store/graph-store';
import { useOutputPreview } from '@/hooks/useOutputPreview';
import type { ProcessingNodeData } from '@/types/graph';

const THUMB_W = 160;

function OutputNodeInner({ id, data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const isHighlighted = useGraphStore((s) => s.highlightedNodeId === id);
  const setHighlightedNode = useGraphStore((s) => s.setHighlightedNode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { height } = useOutputPreview(canvasRef, THUMB_W);

  return (
    <div
      className={`glass-panel transition-shadow ${
        isHighlighted ? 'node-focused' : selected ? 'ring-1 ring-accent/40' : ''
      }`}
      style={{ width: THUMB_W }}
    >
      <canvas
        ref={canvasRef}
        className="block rounded-t-[inherit]"
        style={{ width: THUMB_W, height }}
      />
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <Flag size={11} className="text-text-secondary flex-none" />
        <span
          className="text-[11px] font-medium text-text-primary truncate cursor-default"
          onDoubleClick={(e) => { e.stopPropagation(); setHighlightedNode(isHighlighted ? null : id); }}
        >
          {data.label ?? 'Output'}
        </span>
      </div>
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const OutputNode = memo(OutputNodeInner);
