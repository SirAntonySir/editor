import { useStore } from '@xyflow/react';

/** Hook returning the counter-scale needed to keep a node visually fixed-size
 *  as React Flow's zoom transform changes. Apply as
 *  `transform: scale(useZoomInvariantScale())` on the node's outer container.
 *
 *  Clamps zoom at 0.01 to avoid Infinity from a zero zoom during init. */
export function useZoomInvariantScale(): number {
  const zoom = useStore((s) => s.transform[2]);
  return 1 / Math.max(zoom, 0.01);
}
