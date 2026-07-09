/**
 * Object (committed-mask) actions shared by the on-canvas label
 * ContextMenu and the image-node ContextMenu. Each helper is a thin wrapper
 * around the relevant backend tool + optimistic local state update.
 *
 * These mirror the menu items in `ImageNodeObjectsLayer`. The image-node
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

/** Canonical tool-session id. useBackendState carries it from the moment the
 *  backend connects; useAiSession only mirrors it after the user runs AI
 *  analyze. Reading the AI store alone made deleteObject/renameObject bail
 *  SILENTLY pre-analyze — the optimistic UI update ran, the backend call
 *  didn't, and every masksIndex refresh resurrected the "deleted" masks. */
function toolSessionId(): string | null {
  return useBackendState.getState().sessionId ?? useAiSession.getState().sessionId;
}

/** Clone a source layer's adjustments (operation-graph nodes + widgets) onto a
 *  freshly-copied layer as its OWN, independently-editable widgets — the backend
 *  half of a reversible Copy. Fire-and-forget: the cutout + raw pixels are
 *  already on the canvas; the cloned widgets stream in via SSE and reconcile
 *  onto the new layer. No-op offline (the copy stays raw pixels only). */
function cloneAdjustmentsToLayer(fromLayerId: string, toLayerId: string): void {
  const sessionId = toolSessionId();
  if (!sessionId) return;
  void backendTools.duplicate_layer_edits(sessionId, {
    mapping: [{ fromLayerId, toLayerId }],
  });
}

/** Trim, optimistic local update, then backend rename_mask. Caller is
 *  responsible for whatever inline-edit UI sourced the new label. */
export async function renameObject(maskId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) return;
  useBackendState.getState().pushMaskRename(maskId, trimmed);
  const sessionId = toolSessionId();
  if (!sessionId) {
    toast.info('Rename not saved — backend session not ready.');
    return;
  }
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

/** Bake the masked pixels into a new layer and place it on a new ImageNode
 *  positioned right-adjacent to the source. */
export function copyObjectToImageNode(
  maskId: string,
  sourceImageNodeId: string,
): { imageNodeId: string; layerId: string } | null {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Copy: mask no longer exists.');
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
    toast.info('Copy: no source layer available on this image node.');
    return null;
  }
  try {
    const newLayerId = extractLayerFromMask({
      sourceLayerId,
      maskRef: maskId,
      cropToMaskBbox: true,
      rawPixels: true,
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
    // Carry the object's name onto the new node: an analysis- or user-named
    // mask ("beer mug") beats inheriting the source photo's filename. The
    // layers panel keeps the fuller "<source> · <label>" layer name.
    if (mask.label) editor.setImageNodeName(newNodeId, mask.label);
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
    // Clone the source's adjustments onto the cutout as its OWN editable
    // widgets, so the copy carries the same grade but is edited independently.
    cloneAdjustmentsToLayer(sourceLayerId, newLayerId);
    return { imageNodeId: newNodeId, layerId: newLayerId };
  } catch (err) {
    toast.info(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Bake the masked pixels into a new layer on top of the source layer, in the
 *  SAME image node (a visible cutout, transparent elsewhere). Unlike
 *  copyObjectToImageNode this does NOT spawn a new node. Returns the new
 *  layer id, or null on failure. */
export function copyObjectToLayer(
  maskId: string,
  sourceImageNodeId: string,
): string | null {
  const mask = maskStore.get(maskId);
  if (!mask) {
    toast.info('Copy: mask no longer exists.');
    return null;
  }
  const editor = useEditorStore.getState();
  const srcNode = editor.imageNodes[sourceImageNodeId];
  if (!srcNode) return null;
  // Same source-layer resolution as copyObjectToImageNode: prefer the mask's
  // real layer, else the active layer when it lives on this node, else first.
  const isRealLayer = editor.layers.some((l) => l.id === mask.layerId);
  const sourceLayerId = isRealLayer
    ? mask.layerId
    : (editor.activeLayerId && srcNode.layerIds.includes(editor.activeLayerId)
        ? editor.activeLayerId
        : srcNode.layerIds[0]);
  if (!sourceLayerId) {
    toast.info('Copy: no source layer available on this image node.');
    return null;
  }
  try {
    // cropToMaskBbox: false keeps the cutout at full source dimensions so it
    // stays aligned on top of the source rather than cropped to a floating box.
    const newLayerId = extractLayerFromMask({
      sourceLayerId,
      maskRef: maskId,
      cropToMaskBbox: false,
      rawPixels: true,
    });
    useEditorStore.setState((s) => {
      const node = s.imageNodes[sourceImageNodeId];
      if (node && !node.layerIds.includes(newLayerId)) {
        node.layerIds.push(newLayerId);
      }
    });
    editor.setActiveLayer(newLayerId);
    // Clone the source's adjustments onto the cutout as its OWN editable
    // widgets — same grade, edited independently from the source.
    cloneAdjustmentsToLayer(sourceLayerId, newLayerId);
    return newLayerId;
  } catch (err) {
    toast.info(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Optimistic delete: filter the snapshot's masksIndex + clear ownership +
 *  reset activeObjectId locally, then ask the backend to drop the mask. */
export async function deleteObject(maskId: string): Promise<void> {
  useBackendState.getState().pushMaskDeleted(maskId);
  const sessionId = toolSessionId();
  if (!sessionId) {
    toast.info('Delete not saved — backend session not ready.');
    return;
  }
  const env = await backendTools.delete_mask(sessionId, { maskId });
  if (!env.ok) toast.info(`Delete failed: ${env.error?.message ?? 'unknown error'}`);
}

/** "Draw it myself": the post-result escape hatch when an automatic tag
 *  selection came out wrong. Drops the bad mask, then arms the node for a fresh
 *  manual magic-lasso draw (objects mode + magic tool) so the user can redraw
 *  the object by hand. */
export async function redrawObject(maskId: string, imageNodeId: string): Promise<void> {
  const editor = useEditorStore.getState();
  editor.setActiveImageNode(imageNodeId);
  editor.setImageNodeMode(imageNodeId, 'objects');
  editor.setObjectSelectTool('magic');
  await deleteObject(maskId);
}

/** Trigger the inline-rename input on the object's label chip. Switches the
 *  image-node into Objects mode (so the label is mounted) and stamps the
 *  pending-rename id the label consumes on mount. */
export function startObjectRename(maskId: string, imageNodeId: string): void {
  const editor = useEditorStore.getState();
  editor.setImageNodeMode(imageNodeId, 'objects');
  editor.requestObjectRename(maskId);
}
