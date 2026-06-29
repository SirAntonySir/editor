import type { CandidateRegion } from '@/types/image-context';
import { resolveRegionMaskId } from './region-resolve';
import { extractObjectIds } from '@/lib/prompt-doc';

/** A plan for deterministically extracting attached region chips before the
 *  agent loop. `extractable` chips have a backing mask in the store and will be
 *  baked into their own image node; `fallbackIds` are the parsed object ids of
 *  the rest, passed to the backend as `attached_objects` (today's behaviour). */
export interface ForcedExtractionPlan {
  extractable: Array<{ sourceId: string; maskId: string }>;
  fallbackIds: string[];
}

export function planForcedExtractions(
  chipSourceIds: ReadonlyArray<string>,
  candidateRegions: ReadonlyArray<CandidateRegion>,
  maskExists: (maskId: string) => boolean,
): ForcedExtractionPlan {
  const extractable: Array<{ sourceId: string; maskId: string }> = [];
  const fallbackSources: Array<{ sourceId: string }> = [];
  for (const sourceId of chipSourceIds) {
    const maskId = resolveRegionMaskId(sourceId, candidateRegions);
    if (maskId && maskExists(maskId)) {
      extractable.push({ sourceId, maskId });
    } else {
      fallbackSources.push({ sourceId });
    }
  }
  return { extractable, fallbackIds: extractObjectIds(fallbackSources) };
}
