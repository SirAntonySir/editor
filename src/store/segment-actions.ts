import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { putSource } from '@/core/pixel-source-store';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
import { LayerCompositor } from '@/lib/layer-compositor';
import type { MaskRef } from '@/types/scope';

/**
 * Persist an OffscreenCanvas as a Blob in IDB so Cmd+R reload can rehydrate
 * the layer. Mirrors the openImage path where the source File is persisted
 * directly. Best-effort and fire-and-forget — failures are non-fatal.
 */
function persistCanvasSource(layerId: string, canvas: OffscreenCanvas): void {
  const sid =
    useAiSession.getState().sessionId ?? useBackendState.getState().sessionId;
  if (!sid) return;
  void canvas
    .convertToBlob({ type: 'image/png' })
    .then((blob) => putSource(sid, layerId, blob))
    .catch((err) => console.warn('[segment-actions] persist source failed:', err));
}

/**
 * Compute the inclusive pixel bbox of the white (255) region in a mask.
 * Returns null when the mask is empty. Exported so the SAM-commit flow
 * can match a freshly-painted mask against AI-named regions by bbox
 * overlap (auto-naming).
 */
export function computeMaskBbox(
  data: Uint8Array, width: number, height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] !== 255) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Extract the masked region of a layer into a fresh, fully independent layer.
 * Bakes the parent's current rendered pixels × the mask alpha into a new
 * source canvas registered in the pixel store. The resulting layer has its
 * own pixels — no parentLayerId / layerMask linkage — so it composites,
 * exports and thumbnails like any other image layer.
 *
 * `cropToMaskBbox` (opt-in): bake only the mask's bounding box into the new
 * layer, sized to the bbox (not the full source). The bbox origin is stored
 * on the new layer's `sourceOrigin` so the cutout can later be re-inserted
 * into the original at the right offset. Callers that need source-aligned
 * pixels (e.g. duplicating into the same image-node) should leave it off.
 */
export function extractLayerFromMask(args: {
  sourceLayerId: string;
  maskRef: MaskRef;
  name?: string;
  cropToMaskBbox?: boolean;
}): string {
  const editor = useEditorStore.getState();
  const source = editor.layers.find((l) => l.id === args.sourceLayerId);
  if (!source) throw new Error(`extractLayerFromMask: layer ${args.sourceLayerId} not found`);
  const mask = maskStore.get(args.maskRef);
  if (!mask) throw new Error(`extractLayerFromMask: mask ${args.maskRef} not found`);

  // Render the parent through its adjustment pipeline so the extracted region
  // captures the parent's current look.
  const rendered = LayerCompositor.renderLayer(source);
  if (!rendered) {
    throw new Error(`extractLayerFromMask: failed to render layer ${args.sourceLayerId}`);
  }

  // Bake rendered × mask into a fresh OffscreenCanvas.
  const baked = new OffscreenCanvas(rendered.width, rendered.height);
  const ctx = baked.getContext('2d');
  if (!ctx) throw new Error('extractLayerFromMask: unable to acquire 2D context');
  ctx.drawImage(rendered, 0, 0);

  // Build a white-on-transparent alpha canvas from the mask bytes, then clip
  // the baked pixels with `destination-in`. drawImage auto-scales the mask to
  // the rendered size, so masks coming from the SAM backend (which often arrive
  // at a different resolution than the layer's source canvas) align correctly.
  const maskCanvas = new OffscreenCanvas(mask.width, mask.height);
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('extractLayerFromMask: unable to acquire mask 2D context');
  const maskImg = maskCtx.createImageData(mask.width, mask.height);
  const md = maskImg.data;
  for (let i = 0; i < mask.data.length; i++) {
    const j = i * 4;
    md[j] = 255;
    md[j + 1] = 255;
    md[j + 2] = 255;
    md[j + 3] = mask.data[i];
  }
  maskCtx.putImageData(maskImg, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, baked.width, baked.height);
  ctx.restore();

  // Optional bbox crop: scale the mask-space bbox up to render-space, then
  // copy that subregion into a fresh canvas sized to the bbox. The cutout
  // ends up with its own aspect ratio (no transparent padding) and records
  // its source-space origin so it can be re-inserted later.
  let finalCanvas: OffscreenCanvas = baked;
  let sourceOrigin: { x: number; y: number } | undefined;
  if (args.cropToMaskBbox) {
    const bbox = computeMaskBbox(mask.data, mask.width, mask.height);
    if (bbox) {
      const sx = baked.width / mask.width;
      const sy = baked.height / mask.height;
      const x = Math.max(0, Math.floor(bbox.minX * sx));
      const y = Math.max(0, Math.floor(bbox.minY * sy));
      const w = Math.min(baked.width - x, Math.ceil((bbox.maxX - bbox.minX + 1) * sx));
      const h = Math.min(baked.height - y, Math.ceil((bbox.maxY - bbox.minY + 1) * sy));
      if (w > 0 && h > 0) {
        const cropped = new OffscreenCanvas(w, h);
        const cctx = cropped.getContext('2d');
        if (!cctx) throw new Error('extractLayerFromMask: unable to acquire crop 2D context');
        cctx.drawImage(baked, x, y, w, h, 0, 0, w, h);
        finalCanvas = cropped;
        sourceOrigin = { x, y };
      }
    }
  }

  const newId = crypto.randomUUID();
  pixelStore.register(newId, finalCanvas);
  persistCanvasSource(newId, finalCanvas);

  const name = args.name ?? (mask.label ? `${source.name} · ${mask.label}` : `${source.name} · cut`);
  editor.addLayer({
    id: newId,
    type: 'image',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    ...(sourceOrigin ? { sourceOrigin } : {}),
  });
  editor.setActiveLayer(newId);
  return newId;
}

/**
 * Duplicate an existing layer — copies the working pixel canvas into a new
 * entry in the pixel store and clones the adjustment stack so the new layer
 * is visually identical to the source. Without this, the previous inline
 * "addLayer with just metadata" path produced a layer with no pixels and a
 * blank composite.
 */
export function duplicateLayer(layerId: string): string | null {
  const editor = useEditorStore.getState();
  const source = editor.layers.find((l) => l.id === layerId);
  if (!source) return null;

  // Copy the working canvas (so destructive edits like brush strokes survive).
  const working = pixelStore.get(layerId);
  let newSource: OffscreenCanvas | null = null;
  if (working && working.width > 0 && working.height > 0) {
    newSource = new OffscreenCanvas(working.width, working.height);
    const ctx = newSource.getContext('2d');
    if (ctx) ctx.drawImage(working, 0, 0);
  }

  const newId = crypto.randomUUID();
  if (newSource) {
    pixelStore.register(newId, newSource);
    persistCanvasSource(newId, newSource);
  }

  editor.addLayer({
    id: newId,
    type: source.type,
    name: `${source.name} copy`,
    visible: source.visible,
    opacity: source.opacity,
    blendMode: source.blendMode,
    locked: false,
  });

  // Adjustment state is now owned by the backend snapshot — no client-side
  // adjustmentStack to clone. The duplicate layer starts with no adjustments.
  // TODO: T25 — trigger a backend duplicate-layer operation when available.

  editor.setActiveLayer(newId);
  return newId;
}
