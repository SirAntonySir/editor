import { loadRegistry } from '@/lib/registry/loader';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import { pixelStore } from '@/core/pixel-store';
import { useEditorStore } from '@/store';
import type { OptimisticPatch } from '@/store/backend-state-slice';
import type { ControlValue } from '@/types/widget';

/** Long edge of the rendered thumbnail bitmap — crisp at 48px CSS on 2×. */
const THUMB_LONG_EDGE = 96;

/**
 * Synthetic optimistic map for one preset: one `canon:<layerId>:<node_type>`
 * entry per preset op (op_id → engine.node_type, the same mapping
 * `routePresetToInspector` uses). With `opGraph: undefined` the renderer's
 * phantom-canonical path materialises these as op-graph nodes — original
 * pixels + preset only, no current edits.
 */
export function buildPresetOptimistic(
  presetId: string,
  layerId: string,
): Map<string, OptimisticPatch> {
  const reg = loadRegistry();
  const preset = reg.presets[presetId];
  const map = new Map<string, OptimisticPatch>();
  if (!preset) return map;
  for (const op of preset.ops) {
    const nodeType = reg.ops[op.op_id]?.engine?.node_type;
    if (!nodeType) continue;
    map.set(`canon:${layerId}:${nodeType}`, {
      bindings: Object.entries(op.params).map(([paramKey, value]) => ({
        paramKey,
        value: value as ControlValue,
      })),
      baseRevision: 0,
    });
  }
  return map;
}

// Cache is valid for exactly one (layerId, pixelVersion) pair — presets are
// static and thumbs are original-based, so nothing else can invalidate them.
let cacheLayerId: string | null = null;
let cachePixelVersion = -1;
const cache = new Map<string, Promise<ImageBitmap | null>>();

export function resetPresetThumbCache(): void {
  cacheLayerId = null;
  cachePixelVersion = -1;
  cache.clear();
}

/**
 * Thumbnail of `layerId`'s ORIGINAL source pixels with only `presetId`
 * applied, rendered through the real WebGL pipeline. Cached per preset until
 * the layer or its source pixels change. Returns null when the layer has no
 * source pixels or the pipeline pass fails.
 */
export function getPresetThumb(
  presetId: string,
  layerId: string,
): Promise<ImageBitmap | null> {
  const pixelVersion = useEditorStore.getState().pixelVersion;
  if (cacheLayerId !== layerId || cachePixelVersion !== pixelVersion) {
    cacheLayerId = layerId;
    cachePixelVersion = pixelVersion;
    cache.clear();
  }
  const hit = cache.get(presetId);
  if (hit) return hit;
  const pending = renderThumb(presetId, layerId);
  cache.set(presetId, pending);
  return pending;
}

async function renderThumb(
  presetId: string,
  layerId: string,
): Promise<ImageBitmap | null> {
  const source = pixelStore.getSource(layerId);
  if (!source || !source.width || !source.height) return null;

  const scale = Math.min(1, THUMB_LONG_EDGE / Math.max(source.width, source.height));
  const scratch = document.createElement('canvas');
  scratch.width = Math.max(1, Math.round(source.width * scale));
  scratch.height = Math.max(1, Math.round(source.height * scale));

  try {
    renderImageNodeComposite({
      canvas: scratch,
      // Namespaced so the thumb gets its OWN internal/scratch cache canvases —
      // sharing the live node's per-imageNodeId cache at a different scale
      // clobbers the main composite (see EditTargetPreview).
      imageNodeId: `preset-thumb:${presetId}`,
      layerIds: [layerId],
      sourceWidth: source.width,
      sourceHeight: source.height,
      opGraph: undefined, // original pixels — phantom nodes carry the preset
      widgets: [],
      optimistic: buildPresetOptimistic(presetId, layerId),
      bakePerLayerOnly: true,
      skipOverlays: true,
      renderScale: scale,
    });
    return await createImageBitmap(scratch);
  } catch {
    return null;
  }
}
