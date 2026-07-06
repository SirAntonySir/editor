import type { ImageNodeState, TetherEdgeState } from '@/types/workspace';

/** Rail handle id convention: `layer-tether-<layerId>` (see LayerStrip). */
const LAYER_HANDLE_PREFIX = 'layer-tether-';

/** Extract the layer id from a rail handle id, or null if it isn't one. */
export function parseLayerHandle(handleId: string | null | undefined): string | null {
  if (!handleId) return null;
  return handleId.startsWith(LAYER_HANDLE_PREFIX)
    ? handleId.slice(LAYER_HANDLE_PREFIX.length)
    : null;
}

/** Resolve which image node owns a layer (layer ids are globally unique). */
export function imageNodeForLayer(
  imageNodes: Record<string, ImageNodeState>,
  layerId: string,
): string | null {
  for (const n of Object.values(imageNodes)) {
    if (n.layerIds.includes(layerId)) return n.id;
  }
  return null;
}

export interface ConnectionLike {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * A tether connection is valid only when it goes widget → layer rail handle,
 * and that exact (widget, layer) pair isn't already tethered. Rejects
 * image↔image, widget↔widget, and duplicate targets.
 */
export function isValidTetherConnection(
  conn: ConnectionLike,
  ctx: { widgetIds: Set<string>; tetherEdges: Record<string, TetherEdgeState> },
): boolean {
  if (!conn.source || !ctx.widgetIds.has(conn.source)) return false;
  const layerId = parseLayerHandle(conn.targetHandle);
  if (!layerId) return false;
  const edgeId = `te-${conn.source}-${layerId}`;
  if (ctx.tetherEdges[edgeId]) return false;
  return true;
}
