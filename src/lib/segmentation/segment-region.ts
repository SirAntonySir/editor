import { encode as samEncode, decode as samDecode } from './mobile-sam-client';
import type { EncoderEmbedding, SamPoint } from './mobile-sam-types';
import { bboxFromTuple, boxPrompt, isMaskAcceptable, type Bbox } from './magic-lasso';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { maskToPngBase64 } from './mask-png';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from './object-ownership';

// Per-image-node encoder embedding cache (mirrors useMobileSam's cache) so a
// batch of regions on one image encodes once.
const _embCache = new Map<string, EncoderEmbedding>();

/** Test/maintenance seam: drop the cached encoder embedding(s). */
export function clearSegmentEncoderCache(imageNodeId?: string): void {
  if (imageNodeId) _embCache.delete(imageNodeId);
  else _embCache.clear();
}

function imageLayerId(imageNodeId: string): string | null {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  if (!node) return null;
  const imgLayer = node.layerIds.find(
    (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
  );
  return imgLayer ?? node.layerIds[0] ?? null;
}

/**
 * Build the SAM prompt for a region selection. With a bounding box, SAM gets a
 * box+point prompt — the box corners (labels 2/3) bound the object and the
 * representative point (label 1) anchors it, which yields a tighter mask than
 * the point alone. Without a box, it degrades to the single positive point.
 */
export function buildRegionPrompt(point: [number, number], bbox?: Bbox): SamPoint[] {
  const positive: SamPoint = { x: point[0], y: point[1], label: 1 };
  return bbox ? [...boxPrompt(bbox), positive] : [positive];
}

/**
 * Segment a region client-side (MobileSAM/ONNX) from a normalized point and
 * commit it as an object mask — the same path an interactive click takes.
 * Returns the committed mask id, or null on any failure (no source, SAM
 * unavailable, empty mask, backend rejected, no session).
 *
 * When the region carries a bounding box, SAM is prompted with box+point for a
 * tighter mask. If that combined result looks like garbage (empty / full-frame /
 * sliver, per `isMaskAcceptable`), it retries with the point alone so box+point
 * is never worse than the point-only path.
 *
 * This is what makes the agent's forced-extraction work on Render, where the
 * backend has no server-side SAM, so analyze returns maskless candidate regions
 * (only labels + a representativePoint, optionally a bbox).
 */
export async function segmentRegionFromPoint(
  imageNodeId: string,
  point: [number, number],
  label: string,
  bbox?: [number, number, number, number],
): Promise<string | null> {
  const layerId = imageLayerId(imageNodeId);
  if (!layerId) return null;

  let emb = _embCache.get(imageNodeId);
  if (!emb) {
    const source = CanvasRegistry.getSource(layerId);
    if (!source) return null;
    const bitmap = await createImageBitmap(source);
    try {
      emb = await samEncode(bitmap);
      _embCache.set(imageNodeId, emb);
    } catch (err) {
      console.warn('[segment-region] encode failed', err);
      return null;
    } finally {
      bitmap.close();
    }
  }

  const corners = bbox ? bboxFromTuple(bbox) : undefined;
  let mask;
  try {
    mask = await samDecode(emb, buildRegionPrompt(point, corners));
    // Box+point can occasionally over/under-grab; if the combined mask fails
    // the confidence gate, fall back to the plain positive point so this never
    // does worse than the point-only path.
    if (corners && mask && !isMaskAcceptable(mask, corners)) {
      mask = await samDecode(emb, buildRegionPrompt(point));
    }
  } catch (err) {
    console.warn('[segment-region] decode failed', err);
    return null;
  }
  if (!mask || mask.data.every((v) => v === 0)) return null; // empty selection

  // Commit through the backend (stores the PNG, mints a mask id), then inject
  // locally — identical to SegmentHitLayer.commitCandidate.
  const sid = useBackendState.getState().sessionId;
  if (!sid) return null;
  const pngBase64 = await maskToPngBase64(mask);
  const env = await backendTools.propose_mask(sid, {
    imageNodeId,
    pngBase64,
    paths: [],
    label,
    origin: 'client_new',
  });
  const maskId = env.ok ? env.output?.maskId : undefined;
  if (!maskId) return null;

  objectOwnership.set(maskId, imageNodeId);
  maskStore.injectWithId({
    id: maskId,
    layerId,
    label,
    width: mask.width,
    height: mask.height,
    data: mask.data,
    source: 'sam-point',
    createdAt: Date.now(),
  });
  return maskId;
}
