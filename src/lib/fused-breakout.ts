import { useEditorStore } from '@/store';
import {
  nextSpawnPositionFor,
  type PlacedRect,
} from '@/components/workspace/workspace-layout';
import { fusedSliceNodeIdFor } from '@/store/workspace-slice';

/** Estimated satellite footprint for collision-aware placement, until React
 *  Flow has measured the real card (persisted onto the slice node). */
const SLICE_SPAWN_SIZE = { w: 226, h: 160 } as const;

/**
 * Break out one op-node of a fused widget as a projection satellite on the
 * canvas, positioned beside the parent widget's node rect.
 *
 * Idempotent per (parentWidgetId, nodeId): if a satellite already exists it is
 * left in place (no duplicate spawn) and its id is returned so the caller can
 * focus it. Otherwise a new satellite is spawned via `addFusedSliceNode`.
 *
 * Frontend-only — no backend round-trip. Returns the satellite id, or null when
 * the parent widget has no canvas node yet (nothing to anchor the placement to).
 */
export function breakOutFusedOp(parentWidgetId: string, nodeId: string): string | null {
  const editor = useEditorStore.getState();
  const sliceId = fusedSliceNodeIdFor(parentWidgetId, nodeId);

  // Already broken out → focus (caller decides how); don't spawn a duplicate.
  if (editor.fusedSliceNodes[sliceId]) return sliceId;

  // Anchor placement to the parent widget's canvas node. The fused widget must
  // be tethered (positioned) for a break-out to make spatial sense.
  const parentNode = editor.widgetNodes[parentWidgetId];
  if (!parentNode) return null;

  const targetRect: PlacedRect = {
    position: parentNode.position,
    size: parentNode.size ?? { w: 226, h: 220 },
  };

  // Collision list: every image node, positioned widget, and existing satellite.
  const occupied: PlacedRect[] = [
    ...Object.values(editor.imageNodes).map((n) => ({ position: n.position, size: n.size })),
    ...Object.values(editor.widgetNodes).map((wn) => ({
      position: wn.position,
      size: wn.size ?? SLICE_SPAWN_SIZE,
    })),
    ...Object.values(editor.fusedSliceNodes).map((sn) => ({
      position: sn.position,
      size: sn.size ?? SLICE_SPAWN_SIZE,
    })),
  ];

  // Spawn to the RIGHT of the fused widget by default (the braid to the image is
  // usually on the left toward the photo). No viewport here, so we don't run
  // pickSpawnSide — a fixed side is an acceptable, documented fallback.
  const pos = nextSpawnPositionFor(targetRect, SLICE_SPAWN_SIZE, 'widget', occupied, 'right');

  return editor.addFusedSliceNode(parentWidgetId, nodeId, pos);
}
