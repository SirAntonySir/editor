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
import { usePreferencesStore } from '@/store/preferences-store';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import { computeEffectiveSize } from '@/lib/image-node-geometry';
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
  sourceWidth: number;
  sourceHeight: number;
  /** When true, the renderer skips every shader pass (press-and-hold compare). */
  bypassAdjustments?: boolean;
}

export function useImageNodeRender({
  imageNodeId,
  layerIds,
  sourceWidth,
  sourceHeight,
  bypassAdjustments = false,
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
  const hiddenWidgetIds = useEditorStore((s) => s.hiddenWidgetIds);
  const hiddenCanonNodeIds = useEditorStore((s) => s.hiddenCanonNodeIds);

  // Subscribe to the RF viewport zoom, quantized so the hook only re-runs
  // when we cross a render-scale octave (not on every wheel tick).
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const renderScale = useStore((s) => quantizeRenderScale(s.transform[2], dpr));

  // Effective output dims derived from the snapshot's rotate + crop nodes for
  // this image-node. The visible canvas is sized to these; `applyGeometry`
  // inside the renderer then maps the internal (source-dims) composite onto it.
  const rotateAngle = useBackendState((s) => {
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:rotate`,
    );
    if (!node) return null;
    return (node.params.angle as number) ?? null;
  });
  const cropRect = useBackendState((s) => {
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    if (p.w == null || p.h == null) return null;
    return { x: p.x ?? 0, y: p.y ?? 0, w: p.w, h: p.h };
  });
  const cropPreview = useEditorStore((s) => s.cropPreview);
  const inspectorTab = usePreferencesStore((s) => s.inspectorTab);
  const previewActive = inspectorTab === 'crop' && activeImageNodeId === imageNodeId;

  const effectiveRotateAngle =
    previewActive && cropPreview && cropPreview.rotate
      ? cropPreview.rotate.angle
      : rotateAngle;
  const effectiveCropRect =
    previewActive && cropPreview && cropPreview.crop
      ? cropPreview.crop
      : cropRect;

  const eff = computeEffectiveSize(
    { w: sourceWidth, h: sourceHeight },
    effectiveRotateAngle,
    effectiveCropRect,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const backingW = Math.max(1, Math.round(eff.w * renderScale));
    const backingH = Math.max(1, Math.round(eff.h * renderScale));
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;
    // Set CSS dims to effective size so layout matches the wrapper, regardless of
    // backing-store quantisation. Browser scales backing → CSS at display time.
    if (canvas.style.width !== `${eff.w}px`) canvas.style.width = `${eff.w}px`;
    if (canvas.style.height !== `${eff.h}px`) canvas.style.height = `${eff.h}px`;

    const hiddenNodeIds = new Set<string>();
    for (const w of widgets) {
      if (!hiddenWidgetIds.has(w.id)) continue;
      for (const n of w.nodes) {
        if (n.layer_id) {
          hiddenNodeIds.add(`canon:${n.layer_id}:${n.type}`);
        } else {
          // Node-scope or layerless nodes — fall back to the widget-internal id;
          // matches the snapshot's id when layer_id isn't set.
          hiddenNodeIds.add(n.id);
        }
      }
    }
    for (const id of hiddenCanonNodeIds) hiddenNodeIds.add(id);

    renderImageNodeComposite({
      canvas,
      imageNodeId,
      layerIds,
      sourceWidth,
      sourceHeight,
      opGraph,
      widgets,
      optimistic,
      hiddenNodeIds,
      bypassAdjustments,
      overrideRotate: previewActive && cropPreview ? cropPreview.rotate : undefined,
      overrideCrop:   previewActive && cropPreview ? cropPreview.crop   : undefined,
    });
  }, [
    imageNodeId,
    layerIds,
    sourceWidth,
    sourceHeight,
    eff.w,
    eff.h,
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
    hiddenWidgetIds,
    hiddenCanonNodeIds,
    bypassAdjustments,
    previewActive,
    cropPreview,
  ]);

  return { canvasRef };
}
