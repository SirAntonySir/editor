/**
 * useChromeScale — counter-scale factor for node UI at low workspace zoom.
 *
 * Returns a multiplier that makes node chrome (widget shells, image-node
 * header/footer/etc) stay readable when the React Flow workspace is zoomed
 * out. At zoom ≥ 1 the factor is 1 (no scaling); below that it's `1/zoom`
 * clamped to MAX_SCALE so chrome doesn't get absurd.
 *
 * Zoom is quantized to 0.05 steps so we don't re-subscribe on every wheel
 * tick — the scale only updates when the quantum crosses a step.
 */

import { useStore } from '@xyflow/react';

const MAX_SCALE = 6;
const QUANTUM = 0.05;

export function useChromeScale(): number {
  return useStore((s) => {
    const zoom = s.transform[2];
    const quantized = Math.max(QUANTUM, Math.round(zoom / QUANTUM) * QUANTUM);
    return Math.min(MAX_SCALE, Math.max(1, 1 / quantized));
  });
}
