import { memo, useRef, useEffect, useState, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Flag } from 'lucide-react';
import { PipelineManager } from '@/lib/pipeline-manager';
import { LayerCompositor } from '@/lib/layer-compositor';
import { useEditorStore } from '@/store';
import type { ProcessingNodeData } from '@/types/graph';

const THUMB_W = 160;
const DEFAULT_H = 100;

function OutputNodeInner({ id, data, selected }: NodeProps & { data: ProcessingNodeData }) {
  const isHighlighted = useEditorStore((s) => s.highlightedNodeId === id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(DEFAULT_H);

  const drawOutput = useCallback((source: HTMLCanvasElement) => {
    const canvas = canvasRef.current;
    if (!canvas || source.width === 0 || source.height === 0) return;
    const aspect = source.height / source.width;
    const h = Math.round(THUMB_W * aspect);
    canvas.width = THUMB_W;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, THUMB_W, h);
    setHeight(h);
  }, []);

  useEffect(() => {
    // Draw current output immediately (pipeline may have already rendered)
    const current = PipelineManager.getOutput();
    if (current && current.width > 0) drawOutput(current);

    const unsubPipeline = PipelineManager.subscribe(drawOutput);
    const unsubCompositor = LayerCompositor.subscribe(drawOutput);
    return () => {
      unsubPipeline();
      unsubCompositor();
    };
  }, [drawOutput]);

  return (
    <div
      className={`glass-panel transition-shadow ${
        isHighlighted ? 'ring-2 ring-accent shadow-lg' : selected ? 'ring-1 ring-accent/40' : ''
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
        <span className="text-[11px] font-medium text-text-primary truncate">{data.label ?? 'Output'}</span>
      </div>
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-accent !border-2 !border-white" />
    </div>
  );
}

export const OutputNode = memo(OutputNodeInner);
