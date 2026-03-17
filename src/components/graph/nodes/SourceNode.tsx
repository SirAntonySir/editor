import { memo, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Image } from 'lucide-react';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';
import type { ProcessingNodeData } from '@/types/graph';

const THUMB_SIZE = 48;

function SourceNodeInner({ data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Re-trigger when pixel data changes (image load, destructive edits)
  const pixelVersion = useEditorStore((s) => s.pixelVersion);

  useEffect(() => {
    if (!data.layerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // CanvasRegistry may not be populated yet — poll briefly
    const tryDraw = () => {
      const source = CanvasRegistry.get(data.layerId!);
      if (!source) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.clearRect(0, 0, THUMB_SIZE, THUMB_SIZE);
      const scale = Math.min(THUMB_SIZE / source.width, THUMB_SIZE / source.height);
      const w = source.width * scale;
      const h = source.height * scale;
      ctx.drawImage(source, (THUMB_SIZE - w) / 2, (THUMB_SIZE - h) / 2, w, h);
      return true;
    };

    if (!tryDraw()) {
      // Retry once after a frame in case registration is pending
      const id = requestAnimationFrame(() => tryDraw());
      return () => cancelAnimationFrame(id);
    }
  }, [data.layerId, pixelVersion]);

  return (
    <div
      className={`glass-panel px-3 py-2 min-w-[180px] transition-shadow ${
        selected ? 'ring-2 ring-accent shadow-lg' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <canvas
          ref={canvasRef}
          width={THUMB_SIZE}
          height={THUMB_SIZE}
          className="rounded-sm bg-surface-secondary flex-none"
          style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1">
            <Image size={12} className="text-text-secondary flex-none" />
            <span className="text-xs font-medium text-text-primary truncate">{data.label}</span>
          </div>
          <span className="text-[10px] text-text-secondary">Source</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const SourceNode = memo(SourceNodeInner);
