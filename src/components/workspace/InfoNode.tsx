import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { InfoWidgetShell } from '@/components/widget/InfoWidgetShell';

export interface InfoNodeData extends Record<string, unknown> {
  infoNodeId: string;
}

interface InfoNodeProps {
  id: string;
  data: InfoNodeData;
}

/**
 * React Flow wrapper that renders an `InfoWidgetShell` at the node's
 * canvas position. The store is the source of truth — we look up the
 * current node every render so adds / removes / edits propagate without
 * RF's data prop needing to change.
 *
 * Mirrors `WidgetNode`'s four invisible tether handles so the auto-drawn
 * edge (built in CanvasWorkspace's `edges` memo) can connect from any
 * side, whichever is nearest to the parent image node.
 */
export function InfoNode({ id, data }: InfoNodeProps) {
  const node = useEditorStore((s) => s.infoNodes[data.infoNodeId]);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 280, h: 80 });

  // Measure the actual rendered size so the source-handle positions track
  // the visible extent — important for the tether-handle picker, which
  // routes edges to the side nearest the image.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setNaturalSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, naturalSize.w, naturalSize.h, updateNodeInternals]);

  if (!node) return null;

  return (
    <>
      {/* Four tether outlets — same visible dot + border-anchoring as WidgetNode.
          Positioned entirely by React Flow's per-position defaults (centred on
          each border of the measured node box); `.tether-outlet` draws the dot.
          `pickTetherHandles` picks whichever side faces the image. */}
      <Handle type="source" position={Position.Top}    id="tether-out-top"    className="tether-outlet" />
      <Handle type="source" position={Position.Bottom} id="tether-out-bottom" className="tether-outlet" />
      <Handle type="source" position={Position.Left}   id="tether-out-left"   className="tether-outlet" />
      <Handle type="source" position={Position.Right}  id="tether-out-right"  className="tether-outlet" />
      <div ref={innerRef}>
        <InfoWidgetShell node={node} />
      </div>
    </>
  );
}
