import { memo, useRef, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Image } from 'lucide-react';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import type { ProcessingNodeData } from '@/types/graph';

const THUMB_W = 160;
const DEFAULT_H = 100;

function SourceNodeInner({ id, data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const isHighlighted = useGraphStore((s) => s.highlightedNodeId === id);
  const setHighlightedNode = useGraphStore((s) => s.setHighlightedNode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const [height, setHeight] = useState(DEFAULT_H);

  useEffect(() => {
    if (!data.layerId) return;

    const tryDraw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const source = CanvasRegistry.get(data.layerId!);
      if (!source) return false;
      const aspect = source.height / source.width;
      const h = Math.round(THUMB_W * aspect);
      canvas.width = THUMB_W;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(source, 0, 0, THUMB_W, h);
      setHeight(h);
      return true;
    };

    if (!tryDraw()) {
      const raf = requestAnimationFrame(() => tryDraw());
      return () => cancelAnimationFrame(raf);
    }
  }, [data.layerId, pixelVersion]);

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
        <Image size={11} className="text-text-secondary flex-none" />
        <span
          className="text-[11px] font-medium text-text-primary truncate cursor-default"
          onDoubleClick={(e) => { e.stopPropagation(); setHighlightedNode(isHighlighted ? null : id); }}
        >
          {data.label}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const SourceNode = memo(SourceNodeInner);
