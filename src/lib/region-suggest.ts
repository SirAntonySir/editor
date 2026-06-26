import { fuzzyScore } from './command-palette';

/** A region the palette can offer as an inline chip. */
export interface SuggestRegion {
  label: string;
  sourceId: string;
}

/** Minimum caret-word length before suggestions fire — 1-char words are too
 *  noisy to match against. */
const MIN_CHARS = 2;

/** Score floor for surfacing a region. `fuzzyScore` tiers are
 *  1000 prefix / 800 substring / 400+ subsequence / 200 Levenshtein.
 *  Floor at 400 so weak Levenshtein-only matches (common while typing prose)
 *  never pop the dropdown — only prefix/substring/subsequence hits do. */
const SCORE_FLOOR = 400;

/** Cap on how many suggestions to show under the caret. */
const MAX_RESULTS = 5;

/** Rank regions against the word currently under the caret. Empty when the
 *  word is too short or nothing clears the score floor. Best match first,
 *  capped at {@link MAX_RESULTS}. Pure — the caller supplies the region list. */
export function rankRegions(
  regions: ReadonlyArray<SuggestRegion>,
  word: string,
): SuggestRegion[] {
  const w = word.trim();
  if (w.length < MIN_CHARS) return [];
  return regions
    .map((r) => ({ r, score: fuzzyScore([r.label], w) }))
    .filter((x) => x.score >= SCORE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((x) => x.r);
}
