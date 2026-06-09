/**
 * useChromeVisible — LOD gate for workspace node chrome.
 *
 * Below 0.05 zoom, the canvas becomes a navigation overview and widget
 * chrome would visually swamp the tiny images. Returns false in that range
 * so consumers can suppress chrome and render only the image bitmaps
 * (replaced by MarkerDot at small sizes).
 */

import { useStore } from '@xyflow/react';

const LOD_THRESHOLD = 0.05;

export function useChromeVisible(): boolean {
  return useStore((s) => s.transform[2] >= LOD_THRESHOLD);
}
