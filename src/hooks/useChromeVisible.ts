/**
 * useChromeVisible — LOD gate for workspace node chrome.
 *
 * Below this zoom threshold the user has zoomed so far out that the canvas
 * is meant to be a navigation overview; rendering header strips and widget
 * shells would visually swamp the tiny images. Returns false in that range
 * so consumers can suppress chrome and render only the image bitmaps.
 *
 * The threshold is paired with useChromeScale's unbounded counter-scale:
 * without the LOD, at zoom 0.05 the chrome would render at 20x flow size.
 */

import { useStore } from '@xyflow/react';

const LOD_THRESHOLD = 0.05;

export function useChromeVisible(): boolean {
  return useStore((s) => s.transform[2] >= LOD_THRESHOLD);
}
