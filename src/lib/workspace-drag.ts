/** Pure decision helpers for dragging segments on the canvas — shared by the
 *  extract-drag gesture (segment → new image node) and the rejoin gesture
 *  (extracted node dropped back onto its source). Kept free of React / React
 *  Flow so the decisions are unit-testable. */

export interface DragRect {
  position: { x: number; y: number };
  size: { w: number; h: number };
}

/** A press becomes a drag only once it moves past `threshold` px. Below it the
 *  press stays a click (select / SAM-pick), so existing tap behaviour is safe. */
export function exceedsDragThreshold(dx: number, dy: number, threshold = 4): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

/** Extract is valid when the drop lands OUTSIDE the source node's bounds —
 *  i.e. the user pulled the segment away from its image. Dropping inside is a
 *  cancel. Coordinates are canvas/flow space. */
export function isOutsideRect(pt: { x: number; y: number }, rect: DragRect): boolean {
  return (
    pt.x < rect.position.x ||
    pt.x > rect.position.x + rect.size.w ||
    pt.y < rect.position.y ||
    pt.y > rect.position.y + rect.size.h
  );
}

/** A node has unapplied changes when an active (non-pending-suggestion) widget
 *  targets one of its layers. Rejoin is blocked until those are applied or
 *  dismissed — mirrors the "Rejoin source image" menu guard. */
export function nodeHasUnappliedChanges(
  widgets: ReadonlyArray<{ status: string; id: string; nodes: ReadonlyArray<{ layerId?: string | null }> }>,
  pendingSuggestionIds: ReadonlySet<string>,
  layerIds: ReadonlyArray<string>,
): boolean {
  return widgets.some(
    (w) =>
      w.status === 'active' &&
      !pendingSuggestionIds.has(w.id) &&
      w.nodes.some((n) => n.layerId != null && layerIds.includes(n.layerId)),
  );
}

/** For rejoin: the dragged extracted node's source id, but only when that
 *  source is among the nodes it currently overlaps. Null otherwise (no source,
 *  or not dropped on the source → plain reposition). */
export function rejoinTargetId(
  sourceImageNodeId: string | undefined,
  intersectingNodeIds: ReadonlyArray<string>,
): string | null {
  if (!sourceImageNodeId) return null;
  return intersectingNodeIds.includes(sourceImageNodeId) ? sourceImageNodeId : null;
}
