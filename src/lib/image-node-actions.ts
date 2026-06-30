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
import { exportImageNodeBlob, saveAs, type ExportFormat } from '@/lib/export';
import { toast } from '@/components/ui/Toast';
import { pixelStore } from '@/core/pixel-store';
import { putSource } from '@/core/pixel-source-store';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';

/**
 * Persist an OffscreenCanvas as a Blob in IDB so Cmd+R reload can rehydrate
 * the layer. Best-effort and fire-and-forget — failures are non-fatal.
 * Mirrors the helper of the same name in `segment-actions.ts`.
 */
function persistCanvasSource(layerId: string, canvas: OffscreenCanvas): void {
  const sid =
    useAiSession.getState().sessionId ?? useBackendState.getState().sessionId;
  if (!sid) return;
  void canvas
    .convertToBlob({ type: 'image/png' })
    .then((blob) => putSource(sid, layerId, blob))
    .catch((err) =>
      console.warn('[image-node-actions] persist source failed:', err),
    );
}

/** Export the image-node's pixels in the requested format. Saves via the
 *  shared File-System-Access / download-link fallback in `lib/export`.
 *
 *  Renders WYSIWYG via the on-screen composite pipeline (per-layer adjustments
 *  + node-scope adjustments + crop/rotate geometry), so the saved file matches
 *  the canvas. See `exportImageNodeBlob` / `renderImageNodeToCanvas`. */
export async function exportImageNode(
  imageNodeId: string,
  format: ExportFormat,
): Promise<void> {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node) return;
  const hasImageLayer = node.layerIds.some(
    (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
  );
  if (!hasImageLayer) {
    toast.info('Export: no image layer to render.');
    return;
  }
  const blob = await exportImageNodeBlob(
    imageNodeId,
    format,
    format === 'jpeg' ? 0.92 : 1,
  );
  if (!blob) {
    toast.info('Export failed: nothing to render.');
    return;
  }
  const docName = editor.documentMeta?.name ?? 'image';
  const baseName = (node.name ?? docName).replace(/\.[^.]+$/, '');
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

  // ── Un-crop: restore each cutout layer to the full source-image coordinate space ──
  // Layers extracted with cropToMaskBbox:true carry a `sourceOrigin` recording
  // where their (smaller) bbox sat in source pixels. The compositor draws every
  // layer at (0,0), so without this step the cutout would appear in the
  // top-left corner of the source image instead of its original position.
  const sourceNode = editor.imageNodes[sourceId];
  const { w: srcW, h: srcH } = sourceNode.sourceSize;
  const currentLayerIds = useEditorStore.getState().imageNodes[imageNodeId]?.layerIds ?? [];
  for (const lid of currentLayerIds) {
    const layer = useEditorStore.getState().layers.find((l) => l.id === lid);
    if (!layer?.sourceOrigin) continue; // regular layer — no offset to restore

    const { x: ox, y: oy } = layer.sourceOrigin;
    const cutoutCanvas = pixelStore.get(lid);
    if (!cutoutCanvas) continue; // no pixel data registered — skip silently

    // 1. Draw the cutout into a full-size canvas at (sourceOrigin.x, sourceOrigin.y).
    const full = new OffscreenCanvas(srcW, srcH);
    const ctx = full.getContext('2d');
    if (!ctx) continue;
    ctx.drawImage(cutoutCanvas, ox, oy);

    // 2. Replace the pixel-store entry with the expanded canvas.
    pixelStore.replaceSource(lid, full);
    persistCanvasSource(lid, full);

    // 3. Clear sourceOrigin — the layer now lives at (0,0) of its own canvas.
    useEditorStore.setState((s) => {
      const l = s.layers.find((sl) => sl.id === lid);
      if (l) delete l.sourceOrigin;
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
