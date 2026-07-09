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

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useBackendState, type OptimisticPatch } from '@/store/backend-state-slice';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import { frameThrottle } from '@/lib/frame-throttle';
import { computeEffectiveSize } from '@/lib/image-node-geometry';
import { activeCanvasBus } from '@/lib/active-canvas-bus';
import type { Widget } from '@/types/widget';
import type { Node as OperationNode } from '@/types/operation-graph';

const EMPTY_WIDGETS: Widget[] = [];

/** Quantized render scales (powers of 1/2). */
const RENDER_SCALES = [0.0625, 0.125, 0.25, 0.5, 1.0] as const;

/** A stable string signature of the optimistic patches that affect the given
 *  layers, so an image-node render effect can depend on ONLY the live-preview
 *  edits relevant to its own layers instead of the whole (per-tick-churning)
 *  optimistic map. The map is keyed by op-graph node id; per-layer canonical
 *  keys are `canon:<layerId>:<op>`, from which the layer is read directly. */
function scopedOptimisticSignature(
  optimistic: Map<string, OptimisticPatch>,
  layerIds: string[],
): string {
  if (optimistic.size === 0) return '';
  const layerSet = new Set(layerIds);
  let sig = '';
  for (const [key, patch] of optimistic) {
    let relevant: boolean;
    if (key.startsWith('canon:')) {
      const rest = key.slice('canon:'.length);
      const i = rest.indexOf(':');
      relevant = i > 0 && layerSet.has(rest.slice(0, i));
    } else {
      // Non-canonical key (e.g. a node-scope adjustment id) can't be attributed
      // to a layer from the key alone — include it so a live preview is never
      // missed. Rare, so the occasional spurious repaint is an acceptable trade.
      relevant = true;
    }
    if (!relevant) continue;
    sig += `${key}#${patch.baseRevision}#`;
    for (const b of patch.bindings) sig += `${b.paramKey}=${JSON.stringify(b.value)},`;
    sig += ';';
  }
  return sig;
}

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
  // identity changes on EVERY applyOptimistic (immer reproduces the map), so
  // subscribing to the whole map used to re-composite every image node on the
  // canvas for any widget's slider drag. Instead we subscribe to a SIGNATURE of
  // only the optimistic entries relevant to THIS node's layers — the map is
  // keyed by op-graph node id (`canon:<layerId>:<op>`), so relevance is read
  // straight off the key. The effect reads the live map via getState() at paint
  // time (rendering is unchanged); the signature only governs WHEN it re-fires,
  // so an unrelated node's slider no longer triggers this node's WebGL pass.
  const optimisticSignature = useBackendState((s) =>
    scopedOptimisticSignature(s.optimistic, layerIds),
  );
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  // Re-render when selection / mask overlays change. `maskStore` is not
  // reactive — these store fields are the SSoT the painters branch on, so
  // changes here are what trigger overlay repaint.
  // Masks are hover-only: the overlay pass paints just the in-progress draft
  // (activeMaskRef) and the hovered object's mask, so those are the only
  // selection fields this render effect needs to watch.
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const activeMaskRef = useEditorStore((s) => s.activeMaskRef);
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
  // One `useShallow` selector (single op-graph scan for both transform nodes)
  // instead of five separate subscriptions each re-scanning the whole graph —
  // returns primitives so it only re-renders when a transform value changes.
  const { rotateAngle, cropRectX, cropRectY, cropRectW, cropRectH } = useBackendState(
    useShallow((s) => {
      const nodes = s.snapshot?.operationGraph.nodes;
      let rotate: OperationNode | undefined;
      let crop: OperationNode | undefined;
      const rotateId = `transform:${imageNodeId}:rotate`;
      const cropId = `transform:${imageNodeId}:crop`;
      if (nodes) {
        for (const n of nodes) {
          if (n.id === rotateId) rotate = n;
          else if (n.id === cropId) crop = n;
          if (rotate && crop) break;
        }
      }
      const cp = crop?.params as { x?: number; y?: number; w?: number; h?: number } | undefined;
      const hasCrop = cp?.w != null && cp?.h != null;
      return {
        rotateAngle: rotate ? ((rotate.params.angle as number) ?? null) : null,
        cropRectX: hasCrop ? (cp!.x ?? 0) : null,
        cropRectY: hasCrop ? (cp!.y ?? 0) : null,
        cropRectW: hasCrop ? cp!.w! : null,
        cropRectH: hasCrop ? cp!.h! : null,
      };
    }),
  );

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

  // ── Mirror preview ────────────────────────────────────────────────────────
  // Signature of extracted children that point at THIS node and have the
  // "preview on source" toggle on. Re-runs the paint when a toggle flips or a
  // previewed child is added/removed/rejoined.
  const mirrorChildrenKey = useEditorStore((s) =>
    Object.values(s.imageNodes)
      .filter((n) => n.sourceImageNodeId === imageNodeId && s.mirrorPreview[n.id])
      .map((n) => n.id)
      .sort()
      .join('|'),
  );
  // Bumped when a previewed child republishes its canvas, so the source repaints
  // with the child's latest edits.
  const [previewTick, setPreviewTick] = useState(0);
  useEffect(() => {
    if (!mirrorChildrenKey) return; // no previewed children — nothing to watch
    return activeCanvasBus.subscribe((publishedId) => {
      const st = useEditorStore.getState();
      const n = st.imageNodes[publishedId];
      if (n?.sourceImageNodeId === imageNodeId && st.mirrorPreview[publishedId]) {
        setPreviewTick((t) => (t + 1) % 1_000_000);
      }
    });
  }, [imageNodeId, mirrorChildrenKey]);

  // Tracks the pixelVersion at the last paint, so the render effect can tell a
  // raw-pixel change (needs a GPU source re-upload) from a param-only change
  // (reuse the texture already uploaded).
  const lastPixelVersionRef = useRef<number | null>(null);

  // Coalesce param storms to display rate: the effect below re-fires per
  // optimistic patch (one per pointermove during a drag), and each run is a
  // FULL WebGL composite. The throttle runs the first paint synchronously
  // (leading) and folds same-frame re-fires into one trailing paint with the
  // LATEST closure — a repaint is idempotent, intermediate frames are dead
  // work. Curves drags were the worst case (LUT rebuild + 4 texture uploads
  // per move at pointer rate).
  const throttleRef = useRef<ReturnType<typeof frameThrottle> | null>(null);
  if (throttleRef.current === null) throttleRef.current = frameThrottle();
  useEffect(() => () => throttleRef.current?.cancel(), []);

  useEffect(() => {
    throttleRef.current?.schedule(paint);
    // The paint body reads everything from the surrounding closure; the deps
    // below are what invalidate it.
    function paint(): void {
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

    // The canonical id scheme is `canon:<layer>:<type>`, so multiple widgets of
    // the SAME (layer, op-type) share one node id — common when the AI proposes
    // several light/colour suggestions at once. The preview ("eye") and the
    // hide both key on that id, so they must be computed so they don't clobber
    // each other: a node any widget is actively previewing must NOT be hidden
    // by a sibling that shares its id, and multiple previewing siblings must
    // MERGE their params rather than overwrite.
    const nodeIdFor = (n: (typeof widgets)[number]['nodes'][number]): string =>
      n.layerId ? `canon:${n.layerId}:${n.type}` : n.id;

    // Pass 1 — previewing suggestions → one merged extra node per id. The
    // extra node REPLACES the canonical entry in the renderer, so previewing a
    // subset shows exactly those widgets' params (non-previewing siblings'
    // seeded params are excluded).
    const previewById = new Map<string, OperationNode>();
    for (const w of widgets) {
      if (!(pendingSuggestionIds.has(w.id) && previewingSuggestionIds.has(w.id))) continue;
      for (const n of w.nodes) {
        const id = nodeIdFor(n);
        const existing = previewById.get(id);
        if (existing) {
          existing.params = { ...existing.params, ...(n.params as OperationNode['params']) };
        } else {
          previewById.set(id, {
            id,
            type: n.type,
            scope: n.scope,
            params: { ...(n.params as OperationNode['params']) },
            inputs: n.inputs,
            layerId: n.layerId,
          });
        }
      }
    }

    // Pass 2 — hide nodes for explicitly-hidden widgets and pending,
    // not-previewing suggestions, but never an id that's being previewed.
    for (const w of widgets) {
      const isPending = pendingSuggestionIds.has(w.id);
      const isPreviewing = previewingSuggestionIds.has(w.id);
      const isPendingSilenced = isPending && !isPreviewing;
      if (!hiddenWidgetIds.has(w.id) && !isPendingSilenced) continue;
      for (const n of w.nodes) {
        const id = nodeIdFor(n);
        if (previewById.has(id)) continue; // actively previewed — keep it
        hiddenNodeIds.add(id);
      }
    }

    const extraNodes: OperationNode[] = [...previewById.values()];
    for (const id of hiddenCanonNodeIds) hiddenNodeIds.add(id);

    // Read the live optimistic map non-reactively at paint time. The effect's
    // re-fire is gated by `optimisticSignature` (scoped to this node's layers),
    // but the render applies the FULL map — irrelevant patches are filtered out
    // per-layer downstream, so passing all of them stays correctness-identical.
    const optimistic = useBackendState.getState().optimistic;
    // Only re-upload the layer source texture to the GPU when the raw pixels
    // actually changed since the last paint; a param-only change reuses the
    // texture (see RenderImageNodeCompositeArgs.sourceDirty).
    const sourceDirty = lastPixelVersionRef.current !== pixelVersion;
    lastPixelVersionRef.current = pixelVersion;

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
      sourceDirty,
    });
    // Publish post-render so listeners (Info-tab live mechanical, etc.) see
    // the composite. Always publish — the bus consumer filters by active id.
    // Published BEFORE the mirror overlay so the bus carries this node's own
    // composite (not a preview-overlaid one).
    activeCanvasBus.publish(imageNodeId, canvas);

    // Mirror preview: for each extracted child of this node with the toggle on,
    // draw its edited canvas back at the object's original spot (sourceOrigin),
    // scaled from source pixels to this canvas's backing dims. The cutout is
    // transparent outside the mask, so only the object footprint is overwritten
    // — you see the edited object in place, live, before rejoining.
    if (mirrorChildrenKey) {
      const st = useEditorStore.getState();
      const ctx2 = canvas.getContext('2d');
      const sx = sourceWidth > 0 ? canvas.width / sourceWidth : 1;
      const sy = sourceHeight > 0 ? canvas.height / sourceHeight : 1;
      if (ctx2) {
        for (const child of Object.values(st.imageNodes)) {
          if (child.sourceImageNodeId !== imageNodeId || !st.mirrorPreview[child.id]) continue;
          const childCanvas = activeCanvasBus.get(child.id);
          if (!childCanvas || childCanvas.width === 0 || childCanvas.height === 0) continue;
          const origin = st.layers.find((l) => l.id === child.layerIds[0])?.sourceOrigin;
          if (!origin) continue;
          ctx2.drawImage(
            childCanvas,
            origin.x * sx, origin.y * sy,
            child.sourceSize.w * sx, child.sourceSize.h * sy,
          );
        }
      }
    }
    }
  }, [
    imageNodeId,
    layerIds,
    sourceWidth,
    sourceHeight,
    mirrorChildrenKey,
    previewTick,
    eff.w,
    eff.h,
    cssW,
    cssH,
    renderScale,
    opGraph,
    widgets,
    optimisticSignature,
    pixelVersion,
    hoveredObjectId,
    activeMaskRef,
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
