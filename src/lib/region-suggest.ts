import { fuzzyScore } from './command-palette';

/** A region the palette can offer as an inline chip. */
export interface SuggestRegion {
  label: string;
  sourceId: string;
}

/** A selectable element in the `@` picker: a region (committed object or AI
 *  region) OR a target (image node or layer). Extends {@link SuggestRegion}
 *  with a `kind` so the dropdown can show the right icon/tag and so submit can
 *  route targets to `forced_targets`. */
export interface PaletteElement extends SuggestRegion {
  kind: 'region' | 'target';
  /** Set when `kind === 'target'`. */
  targetKind?: 'node' | 'layer';
}

interface RankOpts {
  /** Return the top items (not []) when the query is empty — used by the `@`
   *  picker so a bare `@` lists everything. */
  allowEmpty?: boolean;
  /** Override the result cap (the `@` picker shows more than the inline one). */
  limit?: number;
  /** Override the minimum query length before any match fires. */
  minChars?: number;
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

/** Shared fuzzy ranker. Works over anything carrying a `label`, so it serves
 *  both the inline region picker and the `@` element picker. */
function rankBy<T extends SuggestRegion>(
  items: ReadonlyArray<T>,
  query: string,
  opts: RankOpts = {},
): T[] {
  const limit = opts.limit ?? MAX_RESULTS;
  const minChars = opts.minChars ?? MIN_CHARS;
  const q = query.trim();
  if (q.length === 0) return opts.allowEmpty ? items.slice(0, limit) : [];
  if (q.length < minChars) return [];
  return items
    .map((r) => ({ r, score: fuzzyScore([r.label], q) }))
    .filter((x) => x.score >= SCORE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.r);
}

/** Rank regions against the word currently under the caret. Empty when the
 *  word is too short or nothing clears the score floor. Best match first,
 *  capped at {@link MAX_RESULTS}. Pure — the caller supplies the region list. */
export function rankRegions(
  regions: ReadonlyArray<SuggestRegion>,
  word: string,
): SuggestRegion[] {
  return rankBy(regions, word);
}

/** Rank elements for the `@` picker. With `allowEmpty` a bare `@` lists the
 *  first `limit` elements; typing after `@` filters with the same fuzzy tiers.
 *  Pure — the caller supplies the element list. */
export function rankElements(
  elements: ReadonlyArray<PaletteElement>,
  query: string,
  opts: RankOpts = {},
): PaletteElement[] {
  return rankBy(elements, query, opts);
}
