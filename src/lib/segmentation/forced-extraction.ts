import type { CandidateRegion } from '@/types/image-context';
import { resolveRegionMaskId } from './region-resolve';
import { extractObjectIds } from '@/lib/prompt-doc';

/** A plan for deterministically extracting attached region chips before the
 *  agent loop.
 *  - `extractable` chips already have a backing mask and are baked into their
 *    own image node.
 *  - `segmentable` chips are AI regions with NO mask but a `representativePoint`
 *    — segment them client-side (MobileSAM) first, then extract. This is the
 *    production (Render) path, where server-side SAM mask precompute is off so
 *    candidate regions arrive maskless.
 *  - `fallbackIds` are the parsed object ids of the rest, passed to the backend
 *    as `attached_objects`. */
export interface ForcedExtractionPlan {
  extractable: Array<{ sourceId: string; maskId: string }>;
  segmentable: Array<{
    sourceId: string;
    label: string;
    point: [number, number];
    /** Normalized [x, y, w, h] — lets segmentation build a box+point SAM prompt. */
    bbox?: [number, number, number, number];
  }>;
  fallbackIds: string[];
}

/** Resolve an `region:ai:<label>` source id to its candidate region. */
function aiRegionForSource(
  sourceId: string,
  candidateRegions: ReadonlyArray<CandidateRegion>,
): CandidateRegion | undefined {
  const prefix = 'region:ai:';
  if (!sourceId.startsWith(prefix)) return undefined;
  const label = sourceId.slice(prefix.length);
  return candidateRegions.find((r) => r.label.toLowerCase() === label.toLowerCase());
}

export function planForcedExtractions(
  chipSourceIds: ReadonlyArray<string>,
  candidateRegions: ReadonlyArray<CandidateRegion>,
  maskExists: (maskId: string) => boolean,
): ForcedExtractionPlan {
  const extractable: ForcedExtractionPlan['extractable'] = [];
  const segmentable: ForcedExtractionPlan['segmentable'] = [];
  const fallbackSources: Array<{ sourceId: string }> = [];
  for (const sourceId of chipSourceIds) {
    const maskId = resolveRegionMaskId(sourceId, candidateRegions);
    if (maskId && maskExists(maskId)) {
      extractable.push({ sourceId, maskId });
      continue;
    }
    // No usable mask. An AI region with a click point can be segmented
    // client-side (Render has no server-side mask precompute).
    const region = aiRegionForSource(sourceId, candidateRegions);
    if (region?.representativePoint) {
      segmentable.push({
        sourceId,
        label: region.label,
        point: region.representativePoint,
        bbox: region.bbox,
      });
    } else {
      fallbackSources.push({ sourceId });
    }
  }
  return { extractable, segmentable, fallbackIds: extractObjectIds(fallbackSources) };
}
