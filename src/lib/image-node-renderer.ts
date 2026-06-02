/**
 * Image-node renderer — paints a per-image-node composite into a plain
 * HTMLCanvasElement.
 *
 * Pure orchestration: it wires together CanvasRegistry (per-layer source
 * bitmaps), the WebGL PipelineManager (per-layer adjustments from the backend
 * operation_graph) and the 2D blend pipeline used by LayerCompositor.
 *
 * After per-layer adjustments are composited, node-scope adjustments
 * (operation_graph nodes whose `layer_ids` cover layers in this image node)
 * are applied to the composite via composite-then-apply.
 *
 * Two-canvas split: per-layer composite is painted into an INTERNAL cache
 * canvas (via getInternalCanvas). The geometry pass (applyGeometry) then
 * draws the internal canvas onto the VISIBLE canvas, applying any rotate/crop
 * transforms. Overlays are finally painted on the visible canvas.
 */

import { CanvasRegistry } from './canvas-registry';
import { PipelineManager } from './pipeline-manager';
import { applyGeometry, getInternalCanvas, type Crop, type Rotate } from './image-node-geometry';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { nodeToAdjustment } from './node-to-adjustment';
import {
  MASK_STYLES,
  paintFullImageOutline,
  paintMaskFill,
  paintMaskOutline,
  paintSegmentationOverlay,
} from './overlay-painters';
import type { Adjustment, BlendMode } from '@/types/adjustment';
import type { OperationGraph } from '@/types/operation-graph';
import type { Widget } from '@/types/widget';
import type { OptimisticPatch } from '@/store/backend-state-slice';

type OperationNode = OperationGraph['nodes'][number];

const BLEND_MODE_MAP: Record<BlendMode, GlobalCompositeOperation> = {
  'normal': 'source-over',
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'soft-light': 'soft-light',
  'hard-light': 'hard-light',
};

export interface RenderImageNodeCompositeArgs {
  /** The visible canvas, pre-sized to effective output dims by the caller. */
  canvas: HTMLCanvasElement;
  /** Image-node id (reserved for future widget-scope routing — T17–T19). */
  imageNodeId: string;
  /** Layer ids that belong to this image node, ordered bottom → top. */
  layerIds: string[];
  /** Source dims — what the per-layer pipeline composites into the internal cache. */
  sourceWidth: number;
  sourceHeight: number;
  /** Backend operation graph; per-layer adjustments are filtered by layer_id. */
  opGraph: OperationGraph | undefined;
  /**
   * Widgets in the current snapshot. Threaded for future hooks; the actual
   * shader work is driven by `opGraph.nodes` (per-layer + node-scope).
   */
  widgets: Widget[];
  /**
   * Local optimistic patches keyed by op-graph node id. Param values from
   * a matching patch override `node.params` for the current paint, giving
   * sliders a live preview before the backend SSE roundtrip completes.
   */
  optimistic?: Map<string, OptimisticPatch>;
  /**
   * Adjustment-node ids to omit from both the per-layer pass and the
   * composite-then-apply pass. Used by widget visibility — when a widget is
   * hidden, all of its `widget.nodes[].id` go in this set.
   */
  hiddenNodeIds?: Set<string>;
  /**
   * Press-and-hold compare on an ImageNode. When true, skip every shader pass
   * and just composite the source bitmaps with blend modes and opacities. The
   * overlay pass still runs so selection chrome stays visible.
   */
  bypassAdjustments?: boolean;
}

/** Apply any optimistic patch to a node's params; returns the node unchanged when no patch matches. */
function withOptimistic(node: OperationNode, optimistic: Map<string, OptimisticPatch> | undefined): OperationNode {
  if (!optimistic) return node;
  const patch = optimistic.get(node.id);
  if (!patch) return node;
  const params = { ...node.params };
  for (const b of patch.bindings) params[b.paramKey] = b.value;
  return { ...node, params };
}

function readTransforms(
  opGraph: OperationGraph | undefined,
  imageNodeId: string,
): { rotate?: Rotate; crop?: Crop } {
  const nodes = opGraph?.nodes ?? [];
  const r = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
  const c = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
  const rotate = r ? (r.params as unknown as Rotate) : undefined;
  const crop = c ? (c.params as unknown as Crop) : undefined;
  return { rotate, crop };
}

/**
 * Apply each layer's adjustments and composite the results into `canvas`.
 * No-op when the operation can't proceed (missing pixels, missing 2d context, …).
 */
export function renderImageNodeComposite(args: RenderImageNodeCompositeArgs): void {
  const { canvas: visible, layerIds, opGraph, widgets, optimistic } = args;
  const hiddenNodeIds = args.hiddenNodeIds ?? new Set<string>();
  const bypassAdjustments = args.bypassAdjustments ?? false;
  const visibleCtx = visible.getContext('2d');
  if (!visibleCtx) return;

  const internal = getInternalCanvas(args.imageNodeId, args.sourceWidth, args.sourceHeight);
  const ctx = internal.getContext('2d');
  if (!ctx) return;

  console.log(`[renderer] enter id=${args.imageNodeId} layers=${args.layerIds.length} srcW=${args.sourceWidth} srcH=${args.sourceHeight} visW=${visible.width} visH=${visible.height} bypass=${bypassAdjustments}`);

  ctx.clearRect(0, 0, internal.width, internal.height);
  if (layerIds.length === 0) {
    visibleCtx.clearRect(0, 0, visible.width, visible.height);
    return;
  }

  const allLayers = useEditorStore.getState().layers;
  const layersById = new Map(allLayers.map((l) => [l.id, l] as const));
  const nodes = opGraph?.nodes ?? [];

  for (const layerId of layerIds) {
    const layer = layersById.get(layerId);
    if (!layer || !layer.visible) continue;

    const source = CanvasRegistry.get(layerId);

    if (!source) continue;

    const srcW = (source as { width: number }).width;
    const srcH = (source as { height: number }).height;
    console.log(`[renderer] layer id=${layerId} visible=${layer.visible} hasSource=true srcDims=${srcW}x${srcH} internalDims=${internal.width}x${internal.height} adjustments=${nodes.filter((n) => n.layer_id === layerId && !hiddenNodeIds.has(n.id)).length}`);
    // Sample the source bitmap directly to verify it actually has pixels.
    try {
      const srcCtx = (source as unknown as { getContext: (type: '2d') => { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } } | null }).getContext('2d');
      if (srcCtx) {
        const sx = Math.floor(srcW / 2);
        const sy = Math.floor(srcH / 2);
        const p = srcCtx.getImageData(sx, sy, 1, 1).data;
        console.log(`[renderer] source pixel (mid) rgba=[${p[0]},${p[1]},${p[2]},${p[3]}]`);
      } else {
        console.log(`[renderer] source has NO 2d context — likely an OffscreenCanvas or transferred`);
      }
    } catch (e) {
      console.log(`[renderer] source sample failed: ${(e as Error).message}`);
    }

    const layerNodes = nodes.filter(
      (n) => n.layer_id === layerId && !hiddenNodeIds.has(n.id),
    );
    const adjustments: Adjustment[] = bypassAdjustments
      ? []
      : layerNodes
          .map((n) => withOptimistic(n, optimistic))
          .map(nodeToAdjustment)
          .filter((a) => a.enabled);

    let rendered: HTMLCanvasElement | OffscreenCanvas;
    if (adjustments.length === 0) {
      rendered = source;
    } else {
      PipelineManager.setSourceCanvas(source);
      rendered = PipelineManager.renderSync(adjustments);
    }

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode] ?? 'source-over';
    ctx.drawImage(rendered, 0, 0, internal.width, internal.height);
    ctx.restore();
    // Re-sample internal AFTER the per-layer drawImage to see whether the paint
    // actually reached the internal canvas.
    try {
      const ix = Math.floor(internal.width / 2);
      const iy = Math.floor(internal.height / 2);
      const ip = ctx.getImageData(ix, iy, 1, 1).data;
      console.log(`[renderer] post-layer internal pixel (mid) rgba=[${ip[0]},${ip[1]},${ip[2]},${ip[3]}]`);
    } catch (e) {
      console.log(`[renderer] post-layer internal sample failed: ${(e as Error).message}`);
    }
  }

  // ---- Composite-then-apply pass: node-scope adjustments ------------------
  // Backend stamps `node.layer_ids: string[]` for adjustments that target the
  // composite of multiple layers rather than a single layer. Filter to nodes
  // whose layer_ids are a subset of this image node's layers, then run their
  // shader pass against the composite. We pipe the internal canvas into the
  // WebGL pipeline, render, and blit the result back into the internal canvas.
  const layerSetForComposite = new Set(layerIds);
  const nodeScopeNodes = nodes.filter((n) => {
    if (hiddenNodeIds.has(n.id)) return false;
    if (n.type === 'crop' || n.type === 'rotate') return false;
    const ids = n.layer_ids;
    return Array.isArray(ids) && ids.length > 0 && ids.every((lid) => layerSetForComposite.has(lid));
  });

  if (!bypassAdjustments && nodeScopeNodes.length > 0) {
    const nodeAdjustments: Adjustment[] = nodeScopeNodes
      .map((n) => withOptimistic(n, optimistic))
      .map(nodeToAdjustment)
      .filter((a) => a.enabled);

    if (nodeAdjustments.length > 0) {
      PipelineManager.setSourceCanvas(internal);
      const final = PipelineManager.renderSync(nodeAdjustments);
      ctx.clearRect(0, 0, internal.width, internal.height);
      ctx.drawImage(final, 0, 0, internal.width, internal.height);
    }
  }

  void widgets; // widgets still passed through for future use

  // ---- Geometry pass: internal → visible at effective dims ----------------
  const transforms = readTransforms(opGraph, args.imageNodeId);

  console.log(`[renderer] before geometry internalDims=${internal.width}x${internal.height} visDims=${visible.width}x${visible.height} angle=${transforms.rotate?.angle ?? 0} flipH=${transforms.rotate?.flip_h ?? false} flipV=${transforms.rotate?.flip_v ?? false} crop=${JSON.stringify(transforms.crop ?? null)}`);
  try {
    const ip = internal.getContext('2d')?.getImageData(Math.floor(internal.width / 2), Math.floor(internal.height / 2), 1, 1).data;
    console.log(`[renderer] internal pixel pre-geom rgba=[${ip?.[0]},${ip?.[1]},${ip?.[2]},${ip?.[3]}]`);
  } catch (e) {
    console.log(`[renderer] internal sample failed: ${(e as Error).message}`);
  }

  applyGeometry(internal, visible, transforms);

  try {
    const vp = visibleCtx.getImageData(Math.floor(visible.width / 2), Math.floor(visible.height / 2), 1, 1).data;
    console.log(`[renderer] visible pixel post-geom rgba=[${vp[0]},${vp[1]},${vp[2]},${vp[3]}]`);
  } catch (e) {
    console.log(`[renderer] visible sample failed: ${(e as Error).message}`);
  }

  // ---- Overlay pass on the visible (post-transform) canvas ----------------
  // Painted on top of the composite so chrome is always visible. State source:
  // maskStore + selection slice.
  paintOverlays({ ctx: visibleCtx, canvas: visible, imageNodeId: args.imageNodeId, layerIds });
}

interface PaintOverlaysArgs {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  imageNodeId: string;
  layerIds: string[];
}

function paintOverlays({ ctx, canvas, imageNodeId, layerIds }: PaintOverlaysArgs): void {
  const state = useEditorStore.getState();
  const layerSet = new Set(layerIds);
  const isActiveNode = state.activeImageNodeId === imageNodeId;
  const painterCtx = { ctx, canvasWidth: canvas.width, canvasHeight: canvas.height };

  // Full-image outline: only on the active image node when the active scope
  // is global.
  if (isActiveNode && state.activeScope.kind === 'global') {
    paintFullImageOutline(ctx, canvas.width, canvas.height);
  }

  // Active draft mask (SAM preview / highlight_region) — only when its
  // owning layer belongs to this image node. Drawn before the committed
  // overlay so committed marks land on top.
  if (state.activeMaskRef) {
    const mask = maskStore.get(state.activeMaskRef);
    if (mask && layerSet.has(mask.layerId)) {
      paintMaskFill(painterCtx, mask, MASK_STYLES.active);
      paintMaskOutline(painterCtx, mask);
    }
  }

  // Committed mask — same gating. Slightly cooler tint to read as "settled".
  if (state.committedMaskRef && state.committedMaskRef !== state.activeMaskRef) {
    const mask = maskStore.get(state.committedMaskRef);
    if (mask && layerSet.has(mask.layerId)) {
      paintMaskFill(painterCtx, mask, MASK_STYLES.committed);
      paintMaskOutline(painterCtx, mask);
    }
  }

  // Segmentation hover / selected outlines — `activeScope.kind === 'mask'`
  // indicates a segment chosen by the user; `hoveredScope` mirrors the
  // hover preview. Both stay gated to layers in this node.
  if (isActiveNode) {
    if (state.hoveredScope?.kind === 'mask') {
      const m = maskStore.get(state.hoveredScope.mask_id);
      const selectedId = state.activeScope.kind === 'mask' ? state.activeScope.mask_id : null;
      if (m && layerSet.has(m.layerId) && m.id !== selectedId) {
        paintSegmentationOverlay(painterCtx, m, 'hover');
      }
    }
    if (state.activeScope.kind === 'mask') {
      const m = maskStore.get(state.activeScope.mask_id);
      if (m && layerSet.has(m.layerId)) {
        paintSegmentationOverlay(painterCtx, m, 'selected');
      }
    }
  }
}
