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

/** Undo an "Extract to Image Node" — move the extracted node's image layers
 *  onto the source node, then remove the (now empty) extracted node. Returns
 *  true when a rejoin happened — false when this node has no source provenance.
 *
 *  Non-destructive: the extracted layers (including any edits made to them
 *  since extract) are appended to the source's layer stack rather than being
 *  silently dropped. Pixel data stays alive because the source node holds a
 *  reference to the layer ids before the extracted node is deleted.
 *
 *  Fallback: when the source node has itself been deleted, the extracted node
 *  is removed via the regular deleteImageNode path (legacy behaviour). */
export function rejoinSourceImage(imageNodeId: string): boolean {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node?.sourceImageNodeId) return false;
  const sourceId = node.sourceImageNodeId;

  if (!editor.imageNodes[sourceId]) {
    // Source has been deleted — fall back to the legacy delete path so the
    // extracted node and its layers don't become orphans.
    editorDocument.workspace.deleteImageNode(imageNodeId);
    return true;
  }

  // Strip any layer ids from the extracted node that the source already owns.
  // mergeImageNodes uses a simple push, so we dedup here to prevent the same
  // layer appearing twice on the source after the merge.
  const sourceLayerIds = new Set(editor.imageNodes[sourceId].layerIds);
  const uniqueExtLayerIds = node.layerIds.filter((lid) => !sourceLayerIds.has(lid));
  if (uniqueExtLayerIds.length < node.layerIds.length) {
    useEditorStore.setState((s) => {
      const ext = s.imageNodes[imageNodeId];
      if (ext) s.imageNodes[imageNodeId] = { ...ext, layerIds: uniqueExtLayerIds };
    });
  }

  // Merge the extracted node INTO the source: appends its layerIds to the
  // source's list, redirects any tether edges, and removes the extracted node
  // — all in one history snapshot. Critically, the layer records themselves
  // are NOT removed (only the node reference is), so pixel-data lifecycle
  // cleanup does not fire for the moved layers.
  editorDocument.workspace.mergeImageNodes(imageNodeId, sourceId);

  // Ensure focus lands on the source so the user sees where the cutout landed.
  const afterMerge = useEditorStore.getState();
  if (afterMerge.imageNodes[sourceId] && afterMerge.activeImageNodeId !== sourceId) {
    afterMerge.setActiveImageNode(sourceId);
  }
  return true;
}
