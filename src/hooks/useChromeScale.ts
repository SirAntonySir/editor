/**
 * useChromeScale — counter-scale factor for node UI so chrome stays at a
 * constant on-screen size at any workspace zoom.
 *
 * At zoom = 1 the factor is 1. At zoom = 0.5 it's 2 (chrome rendered at 2x
 * flow size → appears at native size on screen). At zoom = 2 it's 0.5
 * (chrome rendered at half flow size → still native size on screen). No
 * floor or ceiling; LOD hiding at extreme zoom-out lives in useChromeVisible.
 *
 * Zoom is quantized to 0.05 steps so the hook re-runs only when the quantum
 * crosses a step (not on every wheel tick).
 */

import { useStore } from '@xyflow/react';

const QUANTUM = 0.05;

export function useChromeScale(): number {
  return useStore((s) => {
    const zoom = s.transform[2];
    const quantized = Math.max(QUANTUM, Math.round(zoom / QUANTUM) * QUANTUM);
    return 1 / quantized;
  });
}
