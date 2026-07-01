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
import { extractLayerFromMask, duplicateLayer } from '@/store/segment-actions';
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

/** Build the inverse of the given mask's alpha channel and inject it as a
 *  preview candidate for the source image-node's SegmentHitLayer. The user
 *  then sees the same Save / Cancel UI a fresh SAM pick offers, and a saved
 *  inversion becomes a real Object marker with the full per-object menu.
 *  No mask is registered client-side here — that happens only after Save. */
export function selectInvertedObject(maskId: string, imageNodeId: string): void {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Select Inverted: mask no longer exists.');
    return;
  }
  const inverted = new Uint8Array(mask.data.length);
  for (let i = 0; i < mask.data.length; i++) inverted[i] = 255 - mask.data[i];
  // TEMP DIAGNOSTIC (Select Inverted "one point" bug) — remove after triage.
  // Reports the source mask's value distribution + the inverse fill so we can
  // see whether the source is clean-binary (bg exactly 0) or not.
  {
    let on = 0, zero = 0, other = 0, invOn = 0;
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i];
      if (v === 255) on++; else if (v === 0) zero++; else other++;
      if (inverted[i] === 255) invOn++;
    }
    console.warn('[selectInverted] mask stats', {
      w: mask.width, h: mask.height, len: mask.data.length,
      expectedLen: mask.width * mask.height,
      fg255: on, bg0: zero, otherValues: other, inverseFg255: invOn,
    });
  }
  const label = mask.label ? `Inverted of ${mask.label}` : 'Inverted selection';
  window.dispatchEvent(
    new CustomEvent('segment-hit:external-candidate', {
      detail: {
        imageNodeId,
        mask: { width: mask.width, height: mask.height, data: inverted },
        label,
        origin: 'client_new' as const,
      },
    }),
  );
}

/** Build a selection from a layer's alpha channel — opaque pixels become the
 *  selection (or its complement when `invert`). Surfaces as a Save/Cancel
 *  candidate (same path as Select Inverted), so the user can commit it as an
 *  Object and adjust within it. Useful for cutout/extracted layers; a fully
 *  opaque layer selects the whole image (empty when inverted). */
export function createSelectionFromLayer(
  layerId: string,
  imageNodeId: string,
  { invert = false }: { invert?: boolean } = {},
): void {
  const source = pixelStore.getSource(layerId);
  if (!source) {
    toast.info('Selection: layer has no pixels yet.');
    return;
  }
  const ctx = source.getContext('2d');
  if (!ctx) return;
  const { data } = ctx.getImageData(0, 0, source.width, source.height);
  const mask = new Uint8Array(source.width * source.height);
  for (let i = 0; i < mask.length; i++) {
    const a = data[i * 4 + 3];
    mask[i] = invert ? 255 - a : a;
  }
  const name = useEditorStore.getState().layers.find((l) => l.id === layerId)?.name ?? 'layer';
  const label = invert ? `Inverted of ${name}` : `Selection from ${name}`;
  window.dispatchEvent(
    new CustomEvent('segment-hit:external-candidate', {
      detail: {
        imageNodeId,
        mask: { width: source.width, height: source.height, data: mask },
        label,
        origin: 'client_new' as const,
      },
    }),
  );
}

/** Apply the mask as a layer's `layerMask`. The mask's `layerId` points at
 *  the owning layer; LayerCompositor reads `layer.layerMask` and multiplies
 *  alpha at render time. AI-proposed masks carry a synthetic 'ai-proposed'
 *  sentinel instead of a real id — when that's the case, fall back to the
 *  active layer (when it lives on the image node) or the node's first layer. */
export function convertObjectToLayerMask(
  maskId: string,
  sourceImageNodeId?: string,
): void {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Convert to Layer Mask: mask no longer exists.');
    return;
  }
  const editor = useEditorStore.getState();
  const isRealLayer = editor.layers.some((l) => l.id === mask.layerId);
  let sourceLayerId: string | undefined;
  if (isRealLayer) {
    sourceLayerId = mask.layerId;
  } else if (sourceImageNodeId) {
    const node = editor.imageNodes[sourceImageNodeId];
    if (node) {
      sourceLayerId =
        editor.activeLayerId && node.layerIds.includes(editor.activeLayerId)
          ? editor.activeLayerId
          : node.layerIds[0];
    }
  }
  if (!sourceLayerId) {
    toast.info('Convert to Layer Mask: no target layer available.');
    return;
  }
  const newLayerId = duplicateLayer(sourceLayerId);
  if (!newLayerId) {
    toast.info('Convert to Layer Mask: could not duplicate the source layer.');
    return;
  }
  editor.updateLayer(newLayerId, { layerMask: maskId });
  if (sourceImageNodeId) {
    useEditorStore.setState((s) => {
      const node = s.imageNodes[sourceImageNodeId];
      if (node && !node.layerIds.includes(newLayerId)) {
        node.layerIds.push(newLayerId);
      }
    });
  }
  toast.info(`Applied "${mask.label ?? 'object'}" as layer mask on a new layer.`);
}

/** Bake the masked pixels into a new layer and place it on a new ImageNode
 *  positioned right-adjacent to the source. */
export function extractObjectToImageNode(
  maskId: string,
  sourceImageNodeId: string,
): { imageNodeId: string; layerId: string } | null {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Extract: mask no longer exists.');
    return null;
  }
  const editor = useEditorStore.getState();
  const srcNode = editor.imageNodes[sourceImageNodeId];
  if (!srcNode) return null;
  // AI-proposed masks carry a synthetic `layerId: 'ai-proposed'` sentinel
  // (set in useBackendSession.rehydrateMaskBytes) rather than a real layer
  // id. Resolve the real source layer from the image node when the mask's
  // layerId doesn't match anything — prefer the active layer if it lives on
  // this node, otherwise the first layer.
  const isRealLayer = editor.layers.some((l) => l.id === mask.layerId);
  const sourceLayerId = isRealLayer
    ? mask.layerId
    : (editor.activeLayerId && srcNode.layerIds.includes(editor.activeLayerId)
        ? editor.activeLayerId
        : srcNode.layerIds[0]);
  if (!sourceLayerId) {
    toast.info('Extract: no source layer available on this image node.');
    return null;
  }
  try {
    const newLayerId = extractLayerFromMask({
      sourceLayerId,
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
    const newNodeId = editor.addImageNode(
      [newLayerId], position, sourceSize, sourceImageNodeId,
    );
    // Match the cutout's on-screen size to how the object appeared inside the
    // source node. addImageNode enters every node at the default full width,
    // so without this a small cutout balloons to the size of a whole new photo.
    const srcScale =
      srcNode.sourceSize.w > 0 ? srcNode.size.w / srcNode.sourceSize.w : 1;
    editor.setImageNodeDisplayWidth(newNodeId, sourceSize.w * srcScale);
    editor.setActiveImageNode(newNodeId);
    // Make the guarantee explicit at the verb level (don't rely on
    // extractLayerFromMask's internal setActiveLayer): the baked layer is the
    // edit target after extraction.
    editor.setActiveLayer(newLayerId);
    return { imageNodeId: newNodeId, layerId: newLayerId };
  } catch (err) {
    toast.info(`Extract failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Bake the masked pixels into a new layer on top of the source layer, in the
 *  SAME image node (a visible cutout, transparent elsewhere). Unlike
 *  extractObjectToImageNode this does NOT spawn a new node. Returns the new
 *  layer id, or null on failure. */
export function extractObjectToLayer(
  maskId: string,
  sourceImageNodeId: string,
): string | null {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Extract: mask no longer exists.');
    return null;
  }
  const editor = useEditorStore.getState();
  const srcNode = editor.imageNodes[sourceImageNodeId];
  if (!srcNode) return null;
  // Same source-layer resolution as extractObjectToImageNode: prefer the mask's
  // real layer, else the active layer when it lives on this node, else first.
  const isRealLayer = editor.layers.some((l) => l.id === mask.layerId);
  const sourceLayerId = isRealLayer
    ? mask.layerId
    : (editor.activeLayerId && srcNode.layerIds.includes(editor.activeLayerId)
        ? editor.activeLayerId
        : srcNode.layerIds[0]);
  if (!sourceLayerId) {
    toast.info('Extract: no source layer available on this image node.');
    return null;
  }
  try {
    // cropToMaskBbox: false keeps the cutout at full source dimensions so it
    // stays aligned on top of the source rather than cropped to a floating box.
    const newLayerId = extractLayerFromMask({
      sourceLayerId,
      maskRef: maskId,
      cropToMaskBbox: false,
    });
    useEditorStore.setState((s) => {
      const node = s.imageNodes[sourceImageNodeId];
      if (node && !node.layerIds.includes(newLayerId)) {
        node.layerIds.push(newLayerId);
      }
    });
    editor.setActiveLayer(newLayerId);
    return newLayerId;
  } catch (err) {
    toast.info(`Extract failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Optimistic delete: filter the snapshot's masksIndex + clear ownership +
 *  reset activeObjectId locally, then ask the backend to drop the mask. */
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
