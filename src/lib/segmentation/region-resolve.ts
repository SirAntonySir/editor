import type { CandidateRegion } from '@/types/image-context';

/** Resolve a palette region `sourceId` to a concrete mask id, ready for
 *  {@link copyObjectToImageNode}.
 *
 *  - `region:object:<maskId>` → the mask id verbatim (a committed Object).
 *  - `region:ai:<label>`      → the matching candidate region's `maskRef`,
 *    or null when the AI region has no backing mask.
 *  - anything else            → null.
 *
 *  Pure: the caller supplies the candidate regions (from the AI session). */
export function resolveRegionMaskId(
  sourceId: string,
  candidateRegions: ReadonlyArray<CandidateRegion>,
): string | null {
  if (sourceId.startsWith('region:object:')) {
    return sourceId.slice('region:object:'.length);
  }
  if (sourceId.startsWith('region:ai:')) {
    const label = sourceId.slice('region:ai:'.length);
    const region = candidateRegions.find((r) => r.label.toLowerCase() === label.toLowerCase());
    return region?.maskRef ?? null;
  }
  return null;
}
