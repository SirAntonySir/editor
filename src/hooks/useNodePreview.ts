import { useCallback, useEffect, useRef, useState } from 'react';
import { PipelineManager } from '@/lib/pipeline-manager';
import { LayerCompositor } from '@/lib/layer-compositor';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';

/**
 * Render a node's output: the image after processing up to (and including)
 * this node in the layer's adjustment chain.
 *
 * Returns a canvas/offscreen that must be copied immediately — the pipeline's
 * output canvas is shared and overwritten on the next renderSync call.
 */
function renderNodeOutput(
  nodeType: string,
  layerId: string,
  adjustmentId: string | undefined,
): HTMLCanvasElement | OffscreenCanvas | null {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === layerId);

  // Source node: raw pixel data
  if (nodeType === 'source') {
    return CanvasRegistry.get(layerId) ?? null;
  }

  // Output / blend: final composite (use existing pipeline output)
  if (nodeType === 'output' || nodeType === 'blend') {
    return PipelineManager.getOutput();
  }

  if (!layer) return null;

  // Adjustment node: render the chain up to and including this adjustment
  if (adjustmentId) {
    const allAdjs = layer.adjustmentStack.adjustments;
    const adjIndex = allAdjs.findIndex((a) => a.id === adjustmentId);
    if (adjIndex >= 0) {
      const upTo = allAdjs.slice(0, adjIndex + 1).filter((a) => a.enabled);
      if (upTo.length > 0) {
        PipelineManager.setSource(layerId);
        return PipelineManager.renderSync(upTo);
      }
    }
  }

  // Fallback: raw pixel data
  return CanvasRegistry.get(layerId) ?? null;
}

/**
 * Hook that renders a per-node output preview into a canvas element.
 *
 * @param debounceMs - Delay before re-rendering after pipeline events.
 *   Use 0 for live inspector previews, ~300 for inline node thumbnails.
 */
export function useNodePreview(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  nodeType: string,
  layerId: string | undefined,
  adjustmentId: string | undefined,
  width: number,
  debounceMs = 0,
) {
  const [height, setHeight] = useState(Math.round(width * 0.625));
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layerId) return;

    const source = renderNodeOutput(nodeType, layerId, adjustmentId);
    if (!source || source.width === 0 || source.height === 0) return;

    const aspect = source.height / source.width;
    const h = Math.round(width * aspect);
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, width, h);
    setHeight(h);
  }, [canvasRef, nodeType, layerId, adjustmentId, width]);

  const scheduleRender = useCallback(() => {
    if (debounceMs > 0) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(draw, debounceMs);
    } else {
      draw();
    }
  }, [draw, debounceMs]);

  // Render on mount + when pixel data changes
  useEffect(() => {
    draw();
  }, [draw, pixelVersion]);

  // Re-render when pipeline or compositor produces new output
  useEffect(() => {
    const unsub1 = PipelineManager.subscribe(() => scheduleRender());
    const unsub2 = LayerCompositor.subscribe(() => scheduleRender());
    return () => {
      unsub1();
      unsub2();
      clearTimeout(timerRef.current);
    };
  }, [scheduleRender]);

  return { height };
}
