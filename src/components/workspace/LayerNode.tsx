import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { LayerStrip } from './drafting/LayerStrip';

export interface LayerNodeData extends Record<string, unknown> {
  /** The image node whose layers this node renders. */
  imageNodeId: string;
}

interface LayerNodeProps {
  id: string;
  data: LayerNodeData;
}

/**
 * React Flow wrapper that renders the `LayerStrip` for one image node as a
 * standalone, moveable node. The store is the source of truth — we look up the
 * owning image node every render so layer adds / removes propagate without RF's
 * `data` prop needing to change.
 *
 * Two sets of handles live here:
 *  - the per-layer `layer-tether-<layerId>` TARGET handles (emitted inside
 *    LayerStrip) — the surface widget tethers land on;
 *  - four SOURCE outlets (like `InfoNode`) for the calm attribution edge back
 *    to the image node, routed to whichever side faces the image.
 */
export function LayerNode({ id, data }: LayerNodeProps) {
  const image = useEditorStore((s) => s.imageNodes[data.imageNodeId]);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 150, h: 80 });

  // Measure the rendered size so the source-outlet positions (and the tether
  // handle picker) track the visible extent.
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

  // Persist the measured size so CanvasWorkspace's edge routing can reach the
  // node's real extent (falls back to a default until this lands).
  const setLayerNodeSize = useEditorStore((s) => s.setLayerNodeSize);
  useEffect(() => {
    setLayerNodeSize(id, { w: naturalSize.w, h: naturalSize.h });
  }, [id, naturalSize.w, naturalSize.h, setLayerNodeSize]);

  if (!image) return null;

  return (
    <>
      {/* Four INVISIBLE attribution anchors — the layers node is never a manual
          connection source, so these carry no visible dot and aren't
          connectable; they only give the single auto-routed image-node tether a
          nearest-side attach point (`pickTetherHandles` chooses the side). */}
      <Handle type="source" position={Position.Top}    id="tether-out-top"    className="layers-attach-anchor" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="tether-out-bottom" className="layers-attach-anchor" isConnectable={false} />
      <Handle type="source" position={Position.Left}   id="tether-out-left"   className="layers-attach-anchor" isConnectable={false} />
      <Handle type="source" position={Position.Right}  id="tether-out-right"  className="layers-attach-anchor" isConnectable={false} />
      <div ref={innerRef}>
        <LayerStrip imageNodeId={data.imageNodeId} layerIds={image.layerIds} />
      </div>
    </>
  );
}
