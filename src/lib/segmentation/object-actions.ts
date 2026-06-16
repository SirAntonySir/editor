/**
 * Object (committed-mask) actions shared by the on-canvas label
 * ContextMenu and the image-node ContextMenu. Each helper is a thin wrapper
 * around the relevant backend tool + optimistic local state update.
 *
 * All four mirror the menu items in `ImageNodeObjectsLayer`. The image-node
 * menu calls these directly; the label menu wraps them with the inline
 * editing state needed for in-place rename.
 */

import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { extractLayerFromMask } from '@/store/segment-actions';
import { toast } from '@/components/ui/Toast';
import { UI } from '@/config';

/** Trim, optimistic local update, then backend rename_mask. Caller is
 *  responsible for whatever inline-edit UI sourced the new label. */
export async function renameObject(maskId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  useBackendState.getState().pushMaskRename(maskId, trimmed);
  const sessionId = useAiSession.getState().sessionId;
  if (!sessionId) return;
  const env = await backendTools.rename_mask(sessionId, { maskId, label: trimmed });
  if (!env.ok) toast.info(`Rename failed: ${env.error?.message ?? 'unknown error'}`);
}

/** Apply the mask as the active layer's `layerMask`. The mask's `layerId`
 *  points at the owning layer; LayerCompositor reads `layer.layerMask` and
 *  multiplies alpha at render time. */
export function convertObjectToLayerMask(maskId: string): void {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Convert to Layer Mask: mask no longer exists.');
    return;
  }
  const editor = useEditorStore.getState();
  const layerId = mask.layerId;
  if (!editor.layers.find((l) => l.id === layerId)) {
    toast.info('Convert to Layer Mask: owning layer no longer exists.');
    return;
  }
  editor.updateLayer(layerId, { layerMask: maskId });
  toast.info(`Applied "${mask.label ?? 'object'}" as layer mask.`);
}

/** Bake the masked pixels into a new layer and place it on a new ImageNode
 *  positioned right-adjacent to the source. */
export function extractObjectToImageNode(maskId: string, sourceImageNodeId: string): void {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Extract: mask no longer exists.');
    return;
  }
  const editor = useEditorStore.getState();
  const srcNode = editor.imageNodes[sourceImageNodeId];
  if (!srcNode) return;
  try {
    const newLayerId = extractLayerFromMask({
      sourceLayerId: mask.layerId,
      maskRef: maskId,
      cropToMaskBbox: true,
    });
    // Cutout is cropped to the mask's bbox — its `sourceSize` matches the
    // cropped canvas, so the new image-node takes the object's aspect ratio
    // instead of inheriting the source photo's full dimensions.
    const baked = pixelStore.getSource(newLayerId);
    const sourceSize = baked
      ? { w: baked.width, h: baked.height }
      : srcNode.sourceSize;
    const position = {
      x: srcNode.position.x + srcNode.size.w + UI.splitGapPx,
      y: srcNode.position.y,
    };
    const newNodeId = editor.addImageNode([newLayerId], position, sourceSize);
    // Match the cutout's on-screen size to how the object appeared inside the
    // source node. addImageNode enters every node at the default full width,
    // so without this a small cutout balloons to the size of a whole new photo.
    const srcScale =
      srcNode.sourceSize.w > 0 ? srcNode.size.w / srcNode.sourceSize.w : 1;
    editor.setImageNodeDisplayWidth(newNodeId, sourceSize.w * srcScale);
    editor.setActiveImageNode(newNodeId);
  } catch (err) {
    toast.info(`Extract failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Optimistic delete: filter the snapshot's masksIndex + clear ownership +
 *  reset activeScope locally, then ask the backend to drop the mask. */
export async function deleteObject(maskId: string): Promise<void> {
  useBackendState.getState().pushMaskDeleted(maskId);
  const sessionId = useAiSession.getState().sessionId;
  if (!sessionId) return;
  const env = await backendTools.delete_mask(sessionId, { maskId });
  if (!env.ok) toast.info(`Delete failed: ${env.error?.message ?? 'unknown error'}`);
}

/** Trigger the inline-rename input on the object's label chip. Switches the
 *  image-node into Objects mode (so the label is mounted) and stamps the
 *  pending-rename id the label consumes on mount. */
export function startObjectRename(maskId: string, imageNodeId: string): void {
  const editor = useEditorStore.getState();
  editor.setImageNodeMode(imageNodeId, 'objects');
  editor.requestObjectRename(maskId);
}
