import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { pixelStore } from '@/core/pixel-store';
import { toast } from '@/components/ui/Toast';
import { renderImageNodeComposite } from './image-node-renderer';

/**
 * Restitch an image node's `layerIds` after merging its visible layers into one.
 *
 * Walks the stack (bottom→top): the merged id takes the slot of the bottommost
 * visible layer, the other visible ids are dropped, and hidden ids keep their
 * original positions. Pure — the side-effecting merge lives in
 * {@link mergeVisibleLayersBody}.
 */
export function planMergeVisible(
  layerIds: string[],
  isVisible: (id: string) => boolean,
  mergedId: string,
): { newLayerIds: string[]; removedIds: string[] } {
  const removedIds: string[] = [];
  const newLayerIds: string[] = [];
  let placed = false;
  for (const id of layerIds) {
    if (isVisible(id)) {
      removedIds.push(id);
      if (!placed) {
        newLayerIds.push(mergedId);
        placed = true;
      }
    } else {
      newLayerIds.push(id);
    }
  }
  return { newLayerIds, removedIds };
}

/**
 * Merge the visible layers of one image node into a single flat raster layer
 * ("Merge Visible"). Bakes each visible layer's own adjustments, mask, blend
 * mode and opacity; whole-node adjustments (crop/rotate, node-scoped grades)
 * stay live on the op-graph. Hidden layers are untouched.
 *
 * Side-effecting but synchronous (the renderer + pixel store are sync). NOT
 * wrapped in undo here — the document facade (`editorDocument.mergeVisibleLayers`)
 * wraps it in one `recordSnapshot`. Returns true when a merge happened.
 */
export function mergeVisibleLayersBody(imageNodeId: string): boolean {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node) return false;

  const layersById = new Map(editor.layers.map((l) => [l.id, l] as const));
  const isVisible = (id: string) => layersById.get(id)?.visible ?? false;
  const visibleIds = node.layerIds.filter(isVisible);
  if (visibleIds.length < 2) {
    toast.info('Merge needs 2+ visible layers.');
    return false;
  }

  const w = node.sourceSize.w;
  const h = node.sourceSize.h;

  // Bake the visible layers to a flat raster at full source resolution. The
  // renderer's per-layer pass already skips hidden layers, so passing the full
  // layerIds yields exactly the visible composite.
  const bake = document.createElement('canvas');
  bake.width = w;
  bake.height = h;
  const backend = useBackendState.getState();
  renderImageNodeComposite({
    canvas: bake,
    imageNodeId,
    layerIds: node.layerIds,
    sourceWidth: w,
    sourceHeight: h,
    opGraph: backend.snapshot?.operationGraph,
    widgets: backend.snapshot?.widgets ?? [],
    renderScale: 1,
    bakePerLayerOnly: true,
  });

  // pixelStore holds OffscreenCanvas sources — copy the baked HTMLCanvas in.
  const off = new OffscreenCanvas(w, h);
  const offCtx = off.getContext('2d');
  if (!offCtx) return false;
  offCtx.drawImage(bake, 0, 0);

  const mergedId = crypto.randomUUID();
  pixelStore.register(mergedId, off);
  editor.addLayer({
    id: mergedId,
    type: 'image',
    name: 'Merged',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });

  const { newLayerIds, removedIds } = planMergeVisible(node.layerIds, isVisible, mergedId);
  useEditorStore.setState((s) => {
    const n = s.imageNodes[imageNodeId];
    if (n) n.layerIds = newLayerIds;
  });
  // Removing layers triggers layer-lifecycle cleanup (pixels + masks + backend).
  for (const id of removedIds) {
    try {
      useEditorStore.getState().removeLayer(id);
    } catch {
      /* layer has children — leave it; rare (branched layers). */
    }
  }
  return true;
}
