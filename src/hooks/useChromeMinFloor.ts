import { useStore } from '@xyflow/react';

/**
 * Maximum counter-scale at extreme zoom-out. Bounds visual disruption when a
 * strip would otherwise grow to many times its natural size to reach the
 * minimum readable threshold.
 */
const MAX_COUNTER = 4;

/**
 * Returns a counter-scale that keeps a strip's on-screen size at least
 * `minPx` even when canvas zoom shrinks it. Returns 1 when the natural
 * on-screen size (`basePx * zoom`) is already ≥ minPx — chrome is left alone
 * at usable zooms. Below the floor, returns `minPx / (basePx * zoom)`, capped
 * at MAX_COUNTER.
 *
 * Apply via `transform: scale(counter)` plus `width: ${100 / counter}%` so
 * the strip's pre-scale width compensates and the post-scale layout still
 * fits the parent horizontally.
 */
export function useChromeMinFloor(basePx: number, minPx: number): number {
  return useStore((s) => {
    const zoom = Math.max(s.transform[2], 0.01);
    const natural = basePx * zoom;
    if (natural >= minPx) return 1;
    return Math.min(MAX_COUNTER, minPx / natural);
  });
}
