import { useEditorStore } from '@/store';
import { duplicateLayer } from '@/store/segment-actions';
import { UI } from '@/config';

/**
 * Whole-layer Duplicate operations for the layer context menus.
 *
 * Both are NON-DESTRUCTIVE (the source layer is always kept) — the vocabulary
 * rule is "whole unit → Duplicate". The destructive "move a layer out" path
 * (via `splitImageNode`) is no longer surfaced as a user verb.
 *
 *  - {@link duplicateLayerInPlace} — duplicate the layer as a new sheet in the
 *    SAME image node, directly above the source.
 *  - {@link duplicateLayerToNewImageNode} — duplicate the layer into a NEW
 *    standalone image node beside the source.
 *
 * Both operate on the layer as a whole — no SAM mask involved.
 */

/** Duplicate the layer as a sibling sheet in the same image node, inserted
 *  directly above the source. Returns the new layer id, or null if it can't be
 *  resolved. */
export function duplicateLayerInPlace(
  layerId: string,
  imageNodeId: string,
): string | null {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node) return null;
  const newLayerId = duplicateLayer(layerId);
  if (!newLayerId) return null;
  // Attach the duplicate to this image node right above the source layer so it
  // reads as "a copy of that sheet". duplicateLayer only registers the layer in
  // the layer store; the node's layerIds must reference it to render it.
  useEditorStore.setState((s) => {
    const n = s.imageNodes[imageNodeId];
    if (!n || n.layerIds.includes(newLayerId)) return;
    const idx = n.layerIds.indexOf(layerId);
    if (idx === -1) n.layerIds.push(newLayerId);
    else n.layerIds.splice(idx + 1, 0, newLayerId);
  });
  return newLayerId;
}

/** Duplicate the whole layer into a new standalone image node, positioned
 *  beside the source. The source node is untouched. Returns the new node id, or
 *  null if the layer/node can't be resolved. */
export function duplicateLayerToNewImageNode(
  layerId: string,
  sourceImageNodeId: string,
): string | null {
  const editor = useEditorStore.getState();
  const src = editor.imageNodes[sourceImageNodeId];
  if (!src) return null;
  const newLayerId = duplicateLayer(layerId);
  if (!newLayerId) return null;
  const position = { x: src.position.x + src.size.w + UI.splitGapPx, y: src.position.y };
  const newNodeId = editor.addImageNode([newLayerId], position, src.sourceSize, sourceImageNodeId);
  editor.setActiveImageNode(newNodeId);
  return newNodeId;
}
