import { backendTools } from '@/lib/backend-tools';
import { maskStore } from '@/core/mask-store';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { maskToPngBase64 } from '@/lib/segmentation/mask-png';
import { matchRegionLabelByBbox } from '@/lib/match-region-by-bbox';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import {
  extractObjectToImageNode,
  extractObjectToLayer,
} from '@/lib/segmentation/object-actions';
import { spawnGenfillFromMask } from '@/lib/genfill-spawn';
import { toast } from '@/components/ui/Toast';
import type { DecodedMask, SamPoint } from '@/lib/segmentation/mobile-sam-types';

/** A live selection — the transient mask the user is working with before
 *  committing it via an action verb. Produced by SAM (point mode) or by the
 *  client-side lasso rasterizer (no SAM involved). */
export interface LiveSelection {
  points: SamPoint[];
  mask: DecodedMask;
  label?: string;
  origin?: 'client_refinement' | 'client_new' | 'client_extracted' | 'client_lasso';
  /** Normalized vertex path(s) for lasso selections — shipped to the backend's
   *  `paths` field so the vector intent is preserved alongside the raster. */
  paths?: number[][][];
}

/**
 * Register a live selection as a real backend mask and return its id. This is
 * the commit side-effect shared by the action verbs (extract / convert): the
 * selection is only persisted once the user acts on it.
 *
 * Returns null on failure (the caller keeps the selection so the user's pick
 * isn't lost). Does NOT change active scope or image-node mode — the calling
 * verb owns post-action UX.
 */
export async function materializeCandidate(
  sel: LiveSelection,
  ctx: { sessionId: string; imageNodeId: string; existingCount: number },
): Promise<string | null> {
  const pngBase64 = await maskToPngBase64(sel.mask);
  const hasNegativePoint = sel.points.some((p) => p.label === 0);
  // Auto-name: inherit an AI-named region the mask overlaps, else "Object N".
  const aiRegions = useAiSession.getState().context?.candidateRegions;
  const regionLabel = matchRegionLabelByBbox(sel.mask, aiRegions);
  const autoName = sel.label ?? regionLabel ?? `Object ${ctx.existingCount + 1}`;
  const origin = sel.origin ?? (hasNegativePoint ? 'client_refinement' : 'client_new');

  const env = await backendTools.propose_mask(ctx.sessionId, {
    imageNodeId: ctx.imageNodeId,
    pngBase64,
    paths: sel.paths ?? [],
    label: autoName,
    origin,
  });
  if (!env.ok) {
    toast.info(`Segmentation failed: ${env.error?.message ?? 'unknown error'}`);
    return null;
  }
  const maskId = env.output?.maskId;
  if (!maskId) return null;

  objectOwnership.set(maskId, ctx.imageNodeId);
  // Inject locally with the bytes already in hand instead of waiting for the
  // SSE round-trip. layerId resolves to the node's first image layer so the
  // renderer's selected-mask overlay paints (it gates on layerSet.has).
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[ctx.imageNodeId];
  const layerId = node?.layerIds.find(
    (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
  );
  if (layerId) {
    maskStore.injectWithId({
      id: maskId,
      layerId,
      label: autoName,
      width: sel.mask.width,
      height: sel.mask.height,
      data: sel.mask.data,
      source: origin === 'client_lasso'
        ? 'lasso'
        : (hasNegativePoint ? 'sam-points' : 'sam-point'),
      createdAt: Date.now(),
    });
  }
  return maskId;
}

export type CandidateVerb = 'extract-node' | 'extract-layer' | 'genfill';

/** Run a committing verb on a live selection: materialize the mask, then run
 *  the matching object action with the new id. Returns the new mask id, or null
 *  if materialize failed (in which case no action runs and the caller keeps the
 *  selection). Select Inverted is NOT here — it stays transient (see invertMask). */
export async function runCandidateVerb(
  verb: CandidateVerb,
  sel: LiveSelection,
  ctx: { sessionId: string; imageNodeId: string; existingCount: number },
): Promise<string | null> {
  const id = await materializeCandidate(sel, ctx);
  if (!id) return null;
  if (verb === 'extract-node') extractObjectToImageNode(id, ctx.imageNodeId);
  else if (verb === 'extract-layer') extractObjectToLayer(id, ctx.imageNodeId);
  else if (verb === 'genfill') await spawnGenfillFromMask(id, ctx.imageNodeId);
  return id;
}

/** Build the inverse of a mask (0 ↔ 255). Pure — used by "Select Inverted" to
 *  transform the live selection into a new live selection (no commit). */
export function invertMask(mask: DecodedMask): DecodedMask {
  const data = new Uint8Array(mask.data.length);
  for (let i = 0; i < mask.data.length; i++) data[i] = 255 - mask.data[i];
  return { width: mask.width, height: mask.height, data };
}
