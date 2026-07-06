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
import { hiBitStore } from '@/core/hibit-store';
import { applyGeometry, getInternalCanvas, getMemoisedScratchCanvas, type Crop, type Rotate } from './image-node-geometry';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { nodeToAdjustment } from './node-to-adjustment';
import { expandCompoundNodes } from './perceptual-dial/expand-compound';
import { matchesLayer } from './select-pipeline-nodes';
import {
  MASK_STYLES,
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
  /**
   * Live crop-tab preview overrides for rotate transform. `undefined` means
   * "use snapshot"; `null` suppresses the snapshot value; a value replaces it.
   */
  overrideRotate?: { angle: number; flip_h: boolean; flip_v: boolean } | null;
  /**
   * Live crop-tab preview overrides for crop transform. `undefined` means
   * "use snapshot"; `null` suppresses the snapshot value; a value replaces it.
   */
  overrideCrop?: { x: number; y: number; w: number; h: number } | null;
  /**
   * LOD render scale in (0, 1]. Internal cache canvas + WebGL pipeline + the
   * geometry pass all run at `source × renderScale` instead of full source
   * resolution. Defaults to 1 (no reduction). The caller quantizes zoom into a
   * small set of octaves so allocations / FBO resizes happen rarely.
   */
  renderScale?: number;
  /**
   * Op-graph nodes to splice into the per-layer pass on top of `opGraph.nodes`.
   * Used by the suggestion-chip eye toggle: the previewed widget's nodes are
   * injected here so the renderer applies the AI's proposed values even if the
   * canonical projection is stale or hadn't reached the snapshot yet. Each
   * extra node overrides any `opGraph.nodes` entry with the same id.
   */
  extraNodes?: OperationNode[];
  /**
   * Bake mode for "Merge visible layers". When true, stop after the per-layer
   * composite (per-layer adjustments + mask + blend + opacity) and write that to
   * `canvas` — skipping the node-scope pass, geometry (crop/rotate) and the
   * overlay pass. The result is the flat, appearance-true raster of the visible
   * layers in source space; whole-node adjustments stay live on the op-graph.
   * Use with `renderScale: 1` for a full-resolution bake.
   */
  bakePerLayerOnly?: boolean;
  /**
   * Whether the layer SOURCE pixels changed since the last paint. When false
   * (the common case — only an adjustment param moved), the per-layer WebGL
   * source upload is skipped: the pipeline's `sourceIdentity` guard reuses the
   * texture already on the GPU instead of re-`texImage2D`-ing the full source
   * (~64 MB for a 4 K layer, or a full uint16→float normalise for RAW) every
   * frame. Driven by `pixelVersion` in the caller. Defaults to `true` so any
   * caller that doesn't track pixel dirtiness stays correct (always re-uploads).
   * The node-scope composite-then-apply pass always uploads regardless — its
   * `internal` canvas keeps its identity but its pixels are re-composited each
   * frame.
   */
  sourceDirty?: boolean;
  /**
   * Skip the overlay pass (selection chrome, mask fills/outlines, segmentation
   * highlights). Set by export / bake callers that want the clean composite —
   * per-layer adjustments + node-scope + geometry — WITHOUT any of the editor's
   * on-canvas UI painted into the output bitmap.
   */
  skipOverlays?: boolean;
}

function clampRenderScale(scale: number | undefined): number {
  if (scale == null || !Number.isFinite(scale) || scale >= 1) return 1;
  return Math.max(scale, 1 / 64);
}


/** Scale crop rect from source-pixel units into scaled-internal-pixel units. */
function scaleCrop(crop: Crop | undefined, scale: number): Crop | undefined {
  if (!crop || scale === 1) return crop;
  return {
    x: crop.x * scale,
    y: crop.y * scale,
    w: crop.w * scale,
    h: crop.h * scale,
  };
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

const PHANTOM_NODE_SCOPE = { kind: 'global' } as const;

/** Build phantom canonical nodes for `canon:<layer>:<op>` optimistic keys
 *  that aren't yet projected in `opGraph.nodes`. Without these, the first
 *  inspector edit of a (layer, op) — the one that creates canonical via the
 *  debounced backend write — would have nothing for `withOptimistic` to
 *  overlay, and the live preview would stay silent until the ~300 ms
 *  roundtrip lands. */
function phantomCanonicalNodes(
  optimistic: Map<string, OptimisticPatch> | undefined,
  existingIds: Set<string>,
): OperationNode[] {
  if (!optimistic || optimistic.size === 0) return [];
  const out: OperationNode[] = [];
  for (const [key, patch] of optimistic) {
    if (existingIds.has(key)) continue;
    if (!key.startsWith('canon:')) continue;
    const rest = key.slice('canon:'.length);
    const i = rest.indexOf(':');
    if (i <= 0 || i === rest.length - 1) continue;
    const layerId = rest.slice(0, i);
    const op = rest.slice(i + 1);
    const params: Record<string, unknown> = {};
    for (const b of patch.bindings) params[b.paramKey] = b.value;
    out.push({
      id: key,
      type: op,
      scope: PHANTOM_NODE_SCOPE,
      params: params as OperationNode['params'],
      inputs: [],
      layerId,
    });
  }
  return out;
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
  const sourceDirty = args.sourceDirty ?? true;
  const visibleCtx = visible.getContext('2d');
  if (!visibleCtx) return;

  const renderScale = clampRenderScale(args.renderScale);
  const scaledW = Math.max(1, Math.round(args.sourceWidth * renderScale));
  const scaledH = Math.max(1, Math.round(args.sourceHeight * renderScale));
  const internal = getInternalCanvas(args.imageNodeId, scaledW, scaledH);
  const ctx = internal.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, internal.width, internal.height);
  if (layerIds.length === 0) {
    visibleCtx.clearRect(0, 0, visible.width, visible.height);
    return;
  }

  const allLayers = useEditorStore.getState().layers;
  const layersById = new Map(allLayers.map((l) => [l.id, l] as const));
  // Compound nodes (e.g. Time-of-Day) split here into one virtual node per
  // adjustmentType ('basic', 'kelvin', 'hsl', …) so the WebGL pipeline can
  // dispatch them to the existing per-op shaders.
  //
  // Optimistic patches keyed by the compound node id (canon:<layer>:compound)
  // merge into the compound node's params *before* expansion so live drags
  // on the dial flow through to the virtual nodes' params. Per-node
  // `withOptimistic` below still handles non-compound widget patches.
  const projected = opGraph?.nodes ?? [];
  const compoundMerged = projected.map((n) => {
    if (n.type !== 'compound') return n;
    const patch = optimistic?.get(n.id);
    if (!patch) return n;
    const params = { ...n.params };
    for (const b of patch.bindings) params[b.paramKey] = b.value;
    return { ...n, params };
  });
  // Synthesise phantom canonical nodes for in-flight optimistic patches
  // whose backing canonical node hasn't been projected yet (first inspector
  // edit of a layer/op — see helper docstring).
  const projectedIds = new Set(projected.map((n) => n.id));
  const phantoms = phantomCanonicalNodes(optimistic, projectedIds);
  if (phantoms.length > 0) compoundMerged.push(...phantoms);
  // Splice in preview nodes (suggestion-chip eye toggle). Same-id collisions
  // are resolved by REPLACING the canonical node with the preview's copy, so
  // pending widgets whose canonical projection lags behind still light up the
  // canvas with the AI's proposed params.
  const baseNodes = (() => {
    const extras = args.extraNodes;
    if (!extras || extras.length === 0) return compoundMerged;
    const overrides = new Map(extras.map((n) => [n.id, n] as const));
    const merged = compoundMerged.map((n) => overrides.get(n.id) ?? n);
    for (const ex of extras) if (!merged.some((n) => n.id === ex.id)) merged.push(ex);
    return merged;
  })();
  const nodes = expandCompoundNodes(baseNodes);

  for (const layerId of layerIds) {
    const layer = layersById.get(layerId);
    if (!layer || !layer.visible) continue;

    const source = CanvasRegistry.get(layerId);

    if (!source) continue;

    // Broadcast widgets (`n.layerIds` is an array) are routed to the
    // composite-then-apply pass below. The per-layer pass handles only
    // single-layer pinned ops (`n.layerId`). For linear scalar adjustments
    // the two are visually equivalent; non-linear ops (curves, levels) on
    // multi-layer compositions with non-`source-over` blends will diverge —
    // revisit if/when multi-photo-layer compositions become a primary use
    // case. See docs/superpowers/specs/2026-06-17-visibility-driven-adjustments-design.md.
    const layerNodes = nodes.filter(
      (n) =>
        matchesLayer(n, layerId)
        && !Array.isArray(n.layerIds)
        && !hiddenNodeIds.has(n.id)
        && n.type !== 'crop'
        && n.type !== 'rotate',
    );
    const adjustments: Adjustment[] = bypassAdjustments
      ? []
      : layerNodes
          .map((n) => withOptimistic(n, optimistic))
          .map(nodeToAdjustment)
          .filter((a) => a.enabled);

    let rendered: HTMLCanvasElement | OffscreenCanvas;
    if (adjustments.length === 0) {
      // No shader pass — `drawImage` below downsamples the source directly
      // into the scaled internal canvas, so feeding the full-res source here
      // is fine (the GPU downsample is cheap and one-shot).
      rendered = source;
    } else if (
      layerIds.length === 1 &&
      hiBitStore.has(layerId) &&
      PipelineManager.supportsFloat()
    ) {
      // High-bit-depth (RAW-16) single-layer path. Edit in float (RGBA16F) so a
      // value an adjustment pushes past 1.0 survives for the next to pull back
      // (highlight/shadow recovery) instead of clipping at 8-bit. The LOD
      // target matches the 8-bit path's scaled dims; getDownscaled box-filters
      // the 16-bit source (and returns full-res when not downscaling).
      const tw = renderScale < 1 ? scaledW : source.width;
      const th = renderScale < 1 ? scaledH : source.height;
      const hi = hiBitStore.getDownscaled(layerId, tw, th);
      if (hi && PipelineManager.setHiBitSource(hi, sourceDirty)) {
        rendered = PipelineManager.renderSync(adjustments);
      } else {
        const pipelineInput = renderScale < 1
          ? getMemoisedScratchCanvas(args.imageNodeId, layerId, source, scaledW, scaledH)
          : source;
        PipelineManager.setSourceCanvas(pipelineInput, sourceDirty);
        rendered = PipelineManager.renderSync(adjustments);
      }
    } else {
      // Downscale the source bitmap into a scratch canvas first so the WebGL
      // pipeline allocates FBOs at `scaledW × scaledH` instead of full source
      // dims. Without this, every shader pass runs at full source resolution
      // even when the visible canvas is tiny — defeating the LOD entirely.
      const pipelineInput = renderScale < 1
        ? getMemoisedScratchCanvas(args.imageNodeId, layerId, source, scaledW, scaledH)
        : source;
      PipelineManager.setSourceCanvas(pipelineInput, sourceDirty);
      rendered = PipelineManager.renderSync(adjustments);
    }

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = BLEND_MODE_MAP[layer.blendMode] ?? 'source-over';
    ctx.drawImage(rendered, 0, 0, internal.width, internal.height);
    ctx.restore();
  }

  // ---- Bake mode: stop after the per-layer composite ----------------------
  // "Merge visible layers" wants the flat raster of the visible layers WITHOUT
  // node-scope adjustments, geometry, or overlays (those stay live on the
  // op-graph). Blit `internal` (source-space at renderScale=1) to the output.
  if (args.bakePerLayerOnly) {
    const out = visible.getContext('2d');
    if (out) {
      out.clearRect(0, 0, visible.width, visible.height);
      out.drawImage(internal, 0, 0, visible.width, visible.height);
    }
    return;
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
    const ids = n.layerIds;
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
  // `internal` is at scaled-source dims, so the crop rect (which is in source
  // pixel units) needs to be scaled too — otherwise applyGeometry samples the
  // wrong sub-window of the working canvas.
  const fromSnapshot = readTransforms(opGraph, args.imageNodeId);
  const rawCrop = args.overrideCrop !== undefined
    ? args.overrideCrop ?? undefined
    : fromSnapshot.crop;
  const transforms = {
    rotate: args.overrideRotate !== undefined ? args.overrideRotate ?? undefined : fromSnapshot.rotate,
    crop: scaleCrop(rawCrop, renderScale),
  };

  applyGeometry(internal, visible, transforms);

  // ---- Overlay pass on the visible (post-transform) canvas ----------------
  // Painted on top of the composite so chrome is always visible. State source:
  // maskStore + selection slice. Skipped for export / bake so the editor's
  // on-canvas UI (selection frame, mask fills, segment outlines) never bleeds
  // into the saved bitmap.
  if (!args.skipOverlays) {
    paintOverlays({ ctx: visibleCtx, canvas: visible, imageNodeId: args.imageNodeId, layerIds });
  }
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

  // (Previously: a hardcoded blue rectangle was painted around the active
  // image node when the scope was global. Removed — the drafting variant
  // already draws its own accent-coloured selection frame in CSS, and the
  // painted version baked an off-theme `#0071e3` into the canvas that
  // re-appeared on every pan/zoom redraw.)

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

  // Segmentation hover / selected outlines — `activeObjectId` indicates a
  // segment chosen by the user; `hoveredObjectId` mirrors the hover preview.
  // Both stay gated to layers in this node.
  if (isActiveNode) {
    if (state.hoveredObjectId !== null) {
      const m = maskStore.get(state.hoveredObjectId);
      if (m && layerSet.has(m.layerId) && m.id !== state.activeObjectId) {
        paintSegmentationOverlay(painterCtx, m, 'hover');
      }
    }
    if (state.activeObjectId !== null) {
      const m = maskStore.get(state.activeObjectId);
      if (m && layerSet.has(m.layerId)) {
        paintSegmentationOverlay(painterCtx, m, 'selected');
      }
    }
  }
}
