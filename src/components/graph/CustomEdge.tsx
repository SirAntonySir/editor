import { useState } from 'react';
import { type EdgeProps, BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { openPaletteWith } from '@/lib/palette-bus';
import type { TargetRef } from '@/types/ai-target';

export function CustomEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  ...rest
}: EdgeProps) {
  const [hover, setHover] = useState(false);
  const { getNode } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  function handlePlusClick(e: React.MouseEvent) {
    e.stopPropagation();
    const sourceNode = getNode(source);
    const nodeData = sourceNode?.data as Record<string, unknown> | undefined;
    const upstreamLayerId = nodeData?.layerId as string | undefined;
    const upstreamAdjustmentId = nodeData?.adjustmentId as string | undefined;

    if (!upstreamLayerId) {
      console.warn('[Edge+] missing layerId on source node data', { edgeId: id, source });
      return;
    }

    const ref: TargetRef = upstreamAdjustmentId
      ? { kind: 'node', layerId: upstreamLayerId, adjustmentId: upstreamAdjustmentId }
      : { kind: 'layer', layerId: upstreamLayerId };

    openPaletteWith(ref, 'splice');
  }

  return (
    <>
      <BaseEdge
        {...rest}
        path={edgePath}
        style={{ stroke: 'var(--color-accent)', strokeWidth: 2, strokeOpacity: 0.6 }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            position: 'absolute',
            pointerEvents: 'all',
            opacity: hover ? 1 : 0,
            transition: 'opacity 120ms',
          }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <button
            type="button"
            className="w-5 h-5 rounded-full bg-accent text-white flex items-center justify-center shadow-md"
            title="Insert AI step here"
            onClick={handlePlusClick}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
