import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { pixelStore } from '@/core/pixel-store';
import { toast } from '@/components/ui/Toast';
import { backendTools } from '@/lib/backend-tools';
import { widgetTargetLayerIds } from '@/lib/widget-targets';
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
 * Resolve every active widget targeting the merged (removed) layers BEFORE
 * they die. The flattened raster BAKES their effect into pixels, so a widget
 * outliving the merge is a zombie: it renders on the canvas pointing at
 * layers that no longer exist, its dismiss is a canonical no-op (nothing to
 * clear), and re-applying it would double-grade. "Apply them all first":
 * engaged widgets are ACCEPTED (their values are in the bake — accepting
 * records that and retires the card); still-pending suggestions are
 * DISMISSED (the composite mutes them, so their effect is NOT in the bake,
 * and the user never approved them). Fire-and-forget: the pixel bake is
 * already done synchronously by the caller; the widgets clear via SSE.
 */
export function resolveWidgetsForMergedLayers(mergedLayerIds: string[]): void {
  const sessionId = useBackendState.getState().sessionId;
  if (!sessionId) return;
  const merged = new Set(mergedLayerIds);
  const pending = useSuggestionsUi.getState().pendingSuggestionIds;
  const widgets = useBackendState.getState().snapshot?.widgets ?? [];
  for (const w of widgets) {
    if (w.status !== 'active') continue;
    if (!widgetTargetLayerIds(w).some((l) => merged.has(l))) continue;
    if (pending.has(w.id)) {
      void backendTools.delete_widget(sessionId, { widgetId: w.id, suppressSimilar: false });
      useSuggestionsUi.getState().resolvePending(w.id);
    } else {
      void backendTools.accept_widget(sessionId, { widgetId: w.id });
    }
  }
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
  // Apply-all-first: retire the widgets whose effects the bake just froze
  // into pixels, BEFORE their target layers are removed below.
  resolveWidgetsForMergedLayers(removedIds);
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
