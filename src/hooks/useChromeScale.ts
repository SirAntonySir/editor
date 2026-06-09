/**
 * Deprecated. Widgets, image chrome, and tether edges now live in canvas
 * space (Figma model). Counter-scaling is removed. This stub returns 1 for
 * any remaining callers; the file is deleted in Task 5 of the
 * `2026-06-09-figma-scaling` plan once no consumers reference it.
 */
export function useChromeScale(): number {
  return 1;
}
