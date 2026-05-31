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
 */

import { CanvasRegistry } from './canvas-registry';
import { PipelineManager } from './pipeline-manager';
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
  /** Target canvas to paint into. */
  canvas: HTMLCanvasElement;
  /** Image-node id (reserved for future widget-scope routing — T17–T19). */
  imageNodeId: string;
  /** Layer ids that belong to this image node, ordered bottom → top. */
  layerIds: string[];
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

/**
 * Apply each layer's adjustments and composite the results into `canvas`.
 * No-op when the operation can't proceed (missing pixels, missing 2d context, …).
 */
export function renderImageNodeComposite(args: RenderImageNodeCompositeArgs): void {
  const { canvas, layerIds, opGraph, widgets, optimistic } = args;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (layerIds.length === 0) return;

  const allLayers = useEditorStore.getState().layers;
  const layersById = new Map(allLayers.map((l) => [l.id, l] as const));
  const nodes = opGraph?.nodes ?? [];

  for (const layerId of layerIds) {
    const layer = layersById.get(layerId);
    if (!layer || !layer.visible) continue;

    const source = CanvasRegistry.get(layerId);
    if (!source) continue;

    const layerNodes = nodes.filter((n) => n.layer_id === layerId);
    const adjustments: Adjustment[] = layerNodes
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
    ctx.drawImage(rendered, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // ---- Composite-then-apply pass: node-scope adjustments ------------------
  // Backend stamps `node.layer_ids: string[]` for adjustments that target the
  // composite of multiple layers rather than a single layer. Filter to nodes
  // whose layer_ids are a subset of this image node's layers, then run their
  // shader pass against the composite. We pipe the 2D composite canvas into
  // the WebGL pipeline, render, and blit the result back over the canvas.
  const layerSetForComposite = new Set(layerIds);
  const nodeScopeNodes = nodes.filter((n) => {
    const ids = n.layer_ids;
    return Array.isArray(ids) && ids.length > 0 && ids.every((lid) => layerSetForComposite.has(lid));
  });

  if (nodeScopeNodes.length > 0) {
    const nodeAdjustments: Adjustment[] = nodeScopeNodes
      .map((n) => withOptimistic(n, optimistic))
      .map(nodeToAdjustment)
      .filter((a) => a.enabled);

    if (nodeAdjustments.length > 0) {
      PipelineManager.setSourceCanvas(canvas);
      const final = PipelineManager.renderSync(nodeAdjustments);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(final, 0, 0, canvas.width, canvas.height);
    }
  }

  void widgets; // widgets still passed through for future use

  // ---- Overlay pass --------------------------------------------------------
  // Painted on top of the composite so chrome is always visible. State source:
  // maskStore + selection slice.
  paintOverlays({ ctx, canvas, imageNodeId: args.imageNodeId, layerIds });
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
