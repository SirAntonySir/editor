import { useEditorStore } from '@/store';
import { duplicateLayer } from '@/store/segment-actions';
import { UI } from '@/config';

/**
 * Whole-layer → image-node operations for the layer right-click menu.
 *
 * Two variants, mirroring Photoshop's "Layer via Copy" / "Layer via Cut":
 *  - {@link copyLayerToNewImageNode} (via Copy) — duplicate the layer's pixels
 *    into a NEW standalone image node; the source node keeps the original.
 *  - {@link moveLayerToNewImageNode} (via Cut)  — detach the layer OUT of its
 *    current image node into a new one; the source node loses it.
 *
 * Both leave the selection on the freshly-created node so the result is
 * visible. They operate on the layer as a whole — no SAM mask involved.
 */

/** "New image node via Copy": duplicate the whole layer into a new standalone
 *  image node, positioned beside the source. The source node is untouched.
 *  Returns the new node id, or null if the layer/node can't be resolved. */
export function copyLayerToNewImageNode(
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

/** "New image node via Cut": move the layer out of its current image node into
 *  a new one (the source node loses the layer). Thin wrapper over the store's
 *  {@link splitImageNode} that also selects the new node. Returns the new node
 *  id, or null when the layer isn't on the source node. */
export function moveLayerToNewImageNode(
  layerId: string,
  sourceImageNodeId: string,
): string | null {
  const editor = useEditorStore.getState();
  const newId = editor.splitImageNode(sourceImageNodeId, layerId);
  if (newId) editor.setActiveImageNode(newId);
  return newId;
}
