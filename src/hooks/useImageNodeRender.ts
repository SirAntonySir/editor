/**
 * useImageNodeRender — React glue around `renderImageNodeComposite`.
 *
 * The hook owns a canvas ref and re-paints whenever its inputs (layer ids,
 * size, backend snapshot) change. Pure-function rendering lives in
 * `image-node-renderer.ts` so it stays test-friendly.
 *
 * Backing-store dimensions are zoom-aware: we render at the smallest power-
 * of-two source-fraction that's still ≥ the pixels actually visible on
 * screen. CSS dims stay at full source size so React Flow can scale the
 * node visually; quantization keeps re-renders coarse (one per zoom octave).
 */

import { useEffect, useRef } from 'react';
import { useStore } from '@xyflow/react';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import type { Widget } from '@/types/widget';

const EMPTY_WIDGETS: Widget[] = [];

/** Quantized render scales (powers of 1/2). */
const RENDER_SCALES = [0.0625, 0.125, 0.25, 0.5, 1.0] as const;

/**
 * Snap `zoom × dpr` up to the next render scale, capped at 1 (never above
 * source resolution). Returns the scale to multiply source dims by.
 */
function quantizeRenderScale(zoom: number, dpr: number): number {
  const target = Math.max(0, zoom) * dpr;
  if (target >= 1) return 1;
  for (const s of RENDER_SCALES) if (target <= s) return s;
  return 1;
}

export interface ImageNodeRenderInput {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

export function useImageNodeRender({
  imageNodeId,
  layerIds,
  width,
  height,
}: ImageNodeRenderInput) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const opGraph = useBackendState((s) => s.snapshot?.operation_graph);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  // Re-render when adjustment params or raw pixels change. The optimistic Map
  // identity changes on every applyOptimistic (immer reproduces the map), so
  // depending on it re-fires the effect for live slider preview.
  const optimistic = useBackendState((s) => s.optimistic);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  // Re-render when selection / mask overlays change. `maskStore` is not
  // reactive — these store fields are the SSoT the painters branch on, so
  // changes here are what trigger overlay repaint.
  const activeScope = useEditorStore((s) => s.activeScope);
  const hoveredScope = useEditorStore((s) => s.hoveredScope);
  const activeMaskRef = useEditorStore((s) => s.activeMaskRef);
  const committedMaskRef = useEditorStore((s) => s.committedMaskRef);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);

  // Subscribe to the RF viewport zoom, quantized so the hook only re-runs
  // when we cross a render-scale octave (not on every wheel tick).
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const renderScale = useStore((s) => quantizeRenderScale(s.transform[2], dpr));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const backingW = Math.max(1, Math.round(width * renderScale));
    const backingH = Math.max(1, Math.round(height * renderScale));
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;
    try {
      renderImageNodeComposite({
        canvas,
        imageNodeId,
        layerIds,
        opGraph,
        widgets,
        optimistic,
      });
    } catch {
      // Silently ignore render errors (e.g. WebGL not available in test envs).
    }
  }, [
    imageNodeId,
    layerIds,
    width,
    height,
    renderScale,
    opGraph,
    widgets,
    optimistic,
    pixelVersion,
    activeScope,
    hoveredScope,
    activeMaskRef,
    committedMaskRef,
    activeImageNodeId,
  ]);

  return { canvasRef };
}
