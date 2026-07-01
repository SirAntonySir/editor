import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { pixelStore } from '@/core/pixel-store';
import { activeCanvasBus } from '@/lib/active-canvas-bus';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import { imageNodeLabel } from '@/lib/command-palette';

type DrawSource = CanvasImageSource & { width: number; height: number };

// Cap the backing canvas so a large photo doesn't allocate a full-res preview.
const MAX_DIM = 480;

/**
 * Live preview of the current edit target — the SELECTED LAYER only (its own
 * pixels through its own adjustment pipeline, transparent elsewhere), captioned
 * with the layer name and its image node.
 *
 * Renders the isolated layer through the CURRENT pipeline by calling
 * `renderImageNodeComposite` with just `[activeLayerId]` and `bakePerLayerOnly`
 * (per-layer adjustments + mask + blend + opacity, no node-scope/geometry) +
 * `skipOverlays` (no selection chrome). `optimistic` is threaded so slider
 * drags preview live. We repaint on every composite of the active node (the
 * signal a param changed), plus `pixelVersion`.
 *
 * (Deliberately NOT the legacy `LayerCompositor.renderLayer`, which reads the
 * stale `working` canvas the current pipeline no longer maintains — that
 * produced a blank preview.)
 *
 * Shared by the Adjustments and Info inspector tabs, so it lives in `ui/`
 * alongside the other cross-domain, store-reading primitive `LayerThumb`.
 * Renders nothing when no image node is active.
 */
export function EditTargetPreview() {
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const layers = useEditorStore((s) => s.layers);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const node = useEditorStore((s) =>
    activeImageNodeId ? s.imageNodes[activeImageNodeId] : undefined,
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Scratch canvas the pipeline renders into; copied into the visible preview.
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  // Size the backing canvas to the source aspect (capped) on each draw, so the
  // element has the right intrinsic aspect for `object-contain` — works for any
  // layer/composite dimensions (e.g. a bbox-cropped cutout layer).
  const draw = useCallback((src: DrawSource) => {
    const canvas = canvasRef.current;
    if (!canvas || !src.width || !src.height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = Math.min(1, MAX_DIM / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
    setDrawn(true);
  }, []);

  // Render the active layer in isolation through the CURRENT pipeline and draw
  // the result. `bakePerLayerOnly` keeps it to this layer's own adjustments
  // (no node-scope/geometry); `optimistic` makes slider drags preview live.
  const paint = useCallback(() => {
    const editor = useEditorStore.getState();
    const nodeId = editor.activeImageNodeId;
    const layerId = editor.activeLayerId;
    const activeNode = nodeId ? editor.imageNodes[nodeId] : undefined;
    if (!nodeId || !layerId || !activeNode) { setDrawn(false); return; }

    const srcW = activeNode.sourceSize.w;
    const srcH = activeNode.sourceSize.h;
    if (!srcW || !srcH) { setDrawn(false); return; }

    // Render at a reduced scale so the preview costs a fraction of a full pass.
    const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const scratch = scratchRef.current ?? (scratchRef.current = document.createElement('canvas'));
    scratch.width = w;
    scratch.height = h;

    const backend = useBackendState.getState();
    const snap = backend.snapshot;
    try {
      renderImageNodeComposite({
        canvas: scratch,
        imageNodeId: nodeId,
        layerIds: [layerId],
        sourceWidth: srcW,
        sourceHeight: srcH,
        opGraph: snap?.operationGraph,
        widgets: snap?.widgets ?? [],
        optimistic: backend.optimistic,
        bakePerLayerOnly: true, // just this layer's adjustments — no node-scope/geometry
        skipOverlays: true,     // no selection chrome painted into the preview
        renderScale: scale,
      });
      draw(scratch);
    } catch {
      // Fallback to the layer's raw source pixels if the pipeline pass fails.
      const src = pixelStore.getSource(layerId);
      if (src) draw(src as unknown as DrawSource);
      else setDrawn(false);
    }
  }, [draw]);

  // Repaint on mount, on layer/pixel changes, and on every composite of the
  // active node — the composite publish is the signal that an adjustment param
  // changed, so the isolated-layer preview stays live.
  useEffect(() => {
    paint();
    if (!activeImageNodeId) return;
    return activeCanvasBus.subscribe((nodeId) => {
      if (nodeId === activeImageNodeId) paint();
    });
  }, [activeImageNodeId, activeLayerId, pixelVersion, paint]);

  if (!node) return null;

  const nodeName = imageNodeLabel(node, layers);
  const layerName = layers.find((l) => l.id === activeLayerId)?.name ?? null;

  return (
    <div className="flex-none border-b border-separator p-2">
      <div className="relative flex items-center justify-center h-[132px] rounded-[4px] bg-surface-secondary overflow-hidden ring-1 ring-inset ring-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)]">
        <canvas
          ref={canvasRef}
          width={1}
          height={1}
          className={`max-w-full max-h-full object-contain ${drawn ? 'opacity-100' : 'opacity-0'} transition-opacity`}
          aria-label={layerName ? `Preview of layer ${layerName}` : `Preview of ${nodeName}`}
        />
        {!drawn && (
          <ImageIcon size={18} className="absolute text-text-secondary opacity-50" aria-hidden />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 px-0.5">
        <span className="text-[11px] text-text-primary truncate" title={layerName ? `Editing layer: ${layerName}` : undefined}>
          {layerName ?? nodeName}
        </span>
        <span className="text-[10px] text-text-secondary truncate shrink-0" title={`Image: ${nodeName}`}>
          {nodeName}
        </span>
      </div>
    </div>
  );
}
