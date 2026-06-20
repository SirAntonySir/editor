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
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import { computeEffectiveSize } from '@/lib/image-node-geometry';
import { activeCanvasBus } from '@/lib/active-canvas-bus';
import type { Widget } from '@/types/widget';
import type { Node as OperationNode } from '@/types/operation-graph';

const EMPTY_WIDGETS: Widget[] = [];

/** Quantized render scales (powers of 1/2). */
const RENDER_SCALES = [0.0625, 0.125, 0.25, 0.5, 1.0] as const;

/**
 * Snap an effective scale (target screen pixels / source pixels) up to the
 * next render scale, capped at 1 (never above source resolution). Returns
 * the scale to multiply source dims by.
 */
function quantizeRenderScale(targetOverSource: number): number {
  const target = Math.max(0, targetOverSource);
  if (target >= 1) return 1;
  for (const s of RENDER_SCALES) if (target <= s) return s;
  return 1;
}

export interface ImageNodeRenderInput {
  imageNodeId: string;
  layerIds: string[];
  sourceWidth: number;
  sourceHeight: number;
  /** Canvas-space display dims. Defaults to source dims (legacy behavior) when
   *  omitted so existing callers / tests keep working. */
  displayWidth?: number;
  displayHeight?: number;
  /** When true, the renderer skips every shader pass (press-and-hold compare). */
  bypassAdjustments?: boolean;
}

export function useImageNodeRender({
  imageNodeId,
  layerIds,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
  bypassAdjustments = false,
}: ImageNodeRenderInput) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const opGraph = useBackendState((s) => s.snapshot?.operationGraph);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  // Re-render when adjustment params or raw pixels change. The optimistic Map
  // identity changes on every applyOptimistic (immer reproduces the map), so
  // depending on it re-fires the effect for live slider preview.
  const optimistic = useBackendState((s) => s.optimistic);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  // Re-render when selection / mask overlays change. `maskStore` is not
  // reactive — these store fields are the SSoT the painters branch on, so
  // changes here are what trigger overlay repaint.
  const activeObjectId = useEditorStore((s) => s.activeObjectId);
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const activeMaskRef = useEditorStore((s) => s.activeMaskRef);
  const committedMaskRef = useEditorStore((s) => s.committedMaskRef);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const hiddenWidgetIds = useEditorStore((s) => s.hiddenWidgetIds);
  const hiddenCanonNodeIds = useEditorStore((s) => s.hiddenCanonNodeIds);
  // Re-render when composite-relevant layer fields change: visibility, opacity,
  // blend mode, layer mask, or ordering. The joined string changes whenever any
  // of these fields flip on any layer that belongs to this image-node, or when
  // layers are added / removed.
  const layersSignature = useEditorStore((s) => {
    const ids = new Set(layerIds);
    return s.layers
      .filter((l) => ids.has(l.id))
      .map((l) => `${l.id}:${l.visible ? 1 : 0}:${l.opacity}:${l.blendMode}:${l.layerMask ?? ''}:${l.order}`)
      .join('|');
  });
  // Pending suggestion widgets are hidden from the render so their adjustments
  // don't live-apply before the user clicks Allow on the chip — unless the
  // user is previewing one via the chip's eye icon, in which case its id sits
  // in previewingSuggestionIds and is unmuted here.
  const pendingSuggestionIds = useSuggestionsUi((s) => s.pendingSuggestionIds);
  const previewingSuggestionIds = useSuggestionsUi((s) => s.previewingSuggestionIds);

  // Subscribe to the RF viewport zoom. `renderScale` is derived from the ratio
  // of target screen pixels (display × zoom × dpr) to source pixels and
  // quantized to octaves so the effect only re-runs when we cross a level.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const zoom = useStore((s) => s.transform[2]);

  // Effective output dims derived from the snapshot's rotate + crop nodes for
  // this image-node. The visible canvas is sized to these; `applyGeometry`
  // inside the renderer then maps the internal (source-dims) composite onto it.
  const rotateAngle = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:rotate`,
    );
    if (!node) return null;
    return (node.params.angle as number) ?? null;
  });
  const cropRectX = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.x ?? 0) : null;
  });
  const cropRectY = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.y ?? 0) : null;
  });
  const cropRectW = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:crop`,
    );
    if (!node) return null;
    return (node.params as { w?: number }).w ?? null;
  });
  const cropRectH = useBackendState((s) => {
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:crop`,
    );
    if (!node) return null;
    return (node.params as { h?: number }).h ?? null;
  });

  const cropRect: { x: number; y: number; w: number; h: number } | null =
    cropRectW != null && cropRectH != null
      ? { x: cropRectX ?? 0, y: cropRectY ?? 0, w: cropRectW, h: cropRectH }
      : null;
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

  // CSS dims of the visible canvas. Defaults to effective source dims so any
  // existing caller that hasn't migrated keeps rendering as before. Once the
  // call site passes display dims (typical), the visible canvas occupies the
  // node's canvas-space box and the image-bitmap aspect comes from `eff`.
  const cssW = displayWidth ?? eff.w;
  const cssH = displayHeight ?? eff.h;

  // Quantize renderScale to the next octave so the backing has at least the
  // screen pixels we need (cssW × zoom × dpr), capped at full source res.
  const renderScale = quantizeRenderScale(
    eff.w > 0 ? (cssW * Math.max(0, zoom) * dpr) / eff.w : 1,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const backingW = Math.max(1, Math.round(eff.w * renderScale));
    const backingH = Math.max(1, Math.round(eff.h * renderScale));
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;
    // CSS dims are the node's display box; browser scales backing → CSS.
    if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
    if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;

    const hiddenNodeIds = new Set<string>();
    const extraNodes: OperationNode[] = [];
    for (const w of widgets) {
      // Hide if the user explicitly hid the widget, OR it's a pending
      // suggestion that the user isn't previewing.
      const isPending = pendingSuggestionIds.has(w.id);
      const isPreviewing = previewingSuggestionIds.has(w.id);
      const isPendingSilenced = isPending && !isPreviewing;
      // Preview path: splice the widget's own nodes into the render so the
      // AI's proposed adjustment lights up even if the snapshot's canonical
      // projection lags or doesn't carry them yet. Synthesize an
      // OperationNode-shaped record from each WidgetNode using the canonical
      // id scheme (`canon:<layer>:<type>`), so a co-existing canonical entry
      // is REPLACED by the preview values in the renderer.
      if (isPending && isPreviewing) {
        for (const n of w.nodes) {
          const id = n.layerId ? `canon:${n.layerId}:${n.type}` : n.id;
          extraNodes.push({
            id,
            type: n.type,
            scope: n.scope,
            params: n.params as OperationNode['params'],
            inputs: n.inputs,
            layerId: n.layerId,
          });
        }
      }
      if (!hiddenWidgetIds.has(w.id) && !isPendingSilenced) continue;
      for (const n of w.nodes) {
        if (n.layerId) {
          hiddenNodeIds.add(`canon:${n.layerId}:${n.type}`);
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
      extraNodes: extraNodes.length > 0 ? extraNodes : undefined,
      bypassAdjustments,
      overrideRotate: previewActive && cropPreview ? cropPreview.rotate : undefined,
      overrideCrop:   previewActive && cropPreview ? cropPreview.crop   : undefined,
      renderScale,
    });
    // Publish post-render so listeners (Info-tab live mechanical, etc.) see
    // the composite. Always publish — the bus consumer filters by active id.
    activeCanvasBus.publish(imageNodeId, canvas);
  }, [
    imageNodeId,
    layerIds,
    sourceWidth,
    sourceHeight,
    eff.w,
    eff.h,
    cssW,
    cssH,
    renderScale,
    opGraph,
    widgets,
    optimistic,
    pixelVersion,
    activeObjectId,
    hoveredObjectId,
    activeMaskRef,
    committedMaskRef,
    activeImageNodeId,
    hiddenWidgetIds,
    hiddenCanonNodeIds,
    pendingSuggestionIds,
    previewingSuggestionIds,
    bypassAdjustments,
    previewActive,
    cropPreview,
    layersSignature,
  ]);

  return { canvasRef };
}
