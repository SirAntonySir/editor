import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { LayerCompositor } from '@/lib/layer-compositor';
import type { MaskRef } from '@/types/scope';

/**
 * Extract the masked region of a layer into a fresh, fully independent layer.
 * Bakes the parent's current rendered pixels × the mask alpha into a new
 * source canvas registered in the pixel store. The resulting layer has its
 * own pixels — no parentLayerId / layerMask linkage — so it composites,
 * exports and thumbnails like any other image layer.
 */
export function extractLayerFromMask(args: {
  sourceLayerId: string;
  maskRef: MaskRef;
  name?: string;
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
  if (mask.width === rendered.width && mask.height === rendered.height) {
    const imgData = ctx.getImageData(0, 0, baked.width, baked.height);
    for (let i = 0; i < mask.data.length; i++) {
      imgData.data[i * 4 + 3] = (imgData.data[i * 4 + 3] * mask.data[i]) / 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  const newId = crypto.randomUUID();
  pixelStore.register(newId, baked);

  const name = args.name ?? (mask.label ? `${source.name} · ${mask.label}` : `${source.name} · cut`);
  editor.addLayer({
    id: newId,
    type: 'image',
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
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
  if (newSource) pixelStore.register(newId, newSource);

  editor.addLayer({
    id: newId,
    type: source.type,
    name: `${source.name} copy`,
    visible: source.visible,
    opacity: source.opacity,
    blendMode: source.blendMode,
    locked: false,
    cropMeta: source.cropMeta ? { ...source.cropMeta } : undefined,
    textMeta: source.textMeta ? { ...source.textMeta } : undefined,
  });

  // Copy the adjustment stack (deep clone with fresh adjustment IDs so
  // edits to the duplicate don't collide with the source's adjustments).
  if (source.adjustmentStack.adjustments.length > 0) {
    const clonedAdjustments = source.adjustmentStack.adjustments.map((adj) => ({
      ...adj,
      id: crypto.randomUUID(),
      params: { ...adj.params },
    }));
    editor.updateLayer(newId, {
      adjustmentStack: {
        ...source.adjustmentStack,
        adjustments: clonedAdjustments,
      },
    });
  }

  editor.setActiveLayer(newId);
  return newId;
}
