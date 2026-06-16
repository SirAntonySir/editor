/**
 * Per-image-node actions exposed by the image-node ContextMenu and the
 * header DropdownMenu in both ImageNode variants. Thin wrappers around the
 * existing single-layer export pipeline (`@/lib/export`) and the workspace
 * delete primitive (`editorDocument.workspace.deleteImageNode`) — the only
 * new behaviour is the per-node naming + the "rejoin source" semantic that
 * follows the `sourceImageNodeId` provenance set at extract time.
 */

import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { exportImage, saveAs, type ExportFormat } from '@/lib/export';
import { toast } from '@/components/ui/Toast';

/** Export the image-node's pixels in the requested format. Saves via the
 *  shared File-System-Access / download-link fallback in `lib/export`.
 *
 *  Implementation note: we export the first image layer of the node. Most
 *  image-nodes have a single layer (file-picker open, extract-to-image-node);
 *  multi-layer nodes are not yet expected from the canvas flow. If that
 *  changes, swap to a per-image-node composite renderer. */
export async function exportImageNode(
  imageNodeId: string,
  format: ExportFormat,
): Promise<void> {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node) return;
  const layerId = node.layerIds.find(
    (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
  );
  if (!layerId) {
    toast.info('Export: no image layer to render.');
    return;
  }
  const blob = await exportImage({
    format,
    quality: format === 'jpeg' ? 0.92 : 1,
    layerId,
  });
  if (!blob) {
    toast.info('Export failed: nothing to render.');
    return;
  }
  const layer = editor.layers.find((l) => l.id === layerId);
  const docName = editor.documentMeta?.name ?? 'image';
  const baseName = (node.name ?? layer?.name ?? docName).replace(/\.[^.]+$/, '');
  const ext = format === 'jpeg' ? 'jpg' : format;
  await saveAs(blob, `${baseName}.${ext}`);
}

/** Undo an "Extract to Image Node" — delete the extracted node + its
 *  exclusive layer(s), and refocus the source it came from. The new node
 *  carries the source's id via `sourceImageNodeId` (set in the extract
 *  action), so we know which node to focus. Returns true when a rejoin
 *  actually happened — false when this node has no source provenance. */
export function rejoinSourceImage(imageNodeId: string): boolean {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node?.sourceImageNodeId) return false;
  const sourceId = node.sourceImageNodeId;
  // Defer to the shared delete-image-node helper so the rejoin shares its
  // layer-cleanup pass (drop exclusive layers, pixel-data lifecycle hook).
  editorDocument.workspace.deleteImageNode(imageNodeId);
  // Refocus the source so the user lands back where they came from.
  if (editor.imageNodes[sourceId]) {
    editor.setActiveImageNode(sourceId);
  }
  return true;
}
