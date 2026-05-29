import { startTransition, useCallback, useEffect, useState } from 'react';
import { PipelineManager } from '@/lib/pipeline-manager';
import { LayerCompositor } from '@/lib/layer-compositor';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useEditorStore } from '@/store';

/**
 * Shared hook for rendering the composited output preview into a canvas element.
 * Used by OutputNode, GraphPreviewPanel, InspectorPanel, and GraphPropertiesPanel.
 *
 * Falls back to raw pixel data from CanvasRegistry when the pipeline hasn't
 * rendered yet (e.g. on initial mount or when no adjustments exist).
 */
export function useOutputPreview(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  width: number,
) {
  const [height, setHeight] = useState(Math.round(width * 0.625));
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  const drawToCanvas = useCallback((source: HTMLCanvasElement | OffscreenCanvas) => {
    const canvas = canvasRef.current;
    if (!canvas || source.width === 0 || source.height === 0) return;

    const aspect = source.height / source.width;
    const h = Math.round(width * aspect);
    canvas.width = width;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, width, h);
    // Defer the React state update — drawToCanvas may be called synchronously
    // inside an effect body, and calling setState directly there triggers a
    // cascading-render warning. startTransition defers the update without
    // changing the observable behaviour (height is a layout detail, not urgent).
    startTransition(() => setHeight(h));
  }, [canvasRef, width]);

  // Pipeline/compositor callback — always receives HTMLCanvasElement
  const drawOutput = useCallback((source: HTMLCanvasElement) => {
    drawToCanvas(source);
  }, [drawToCanvas]);

  useEffect(() => {
    // 1. Try pipeline output first
    const current = PipelineManager.getOutput();
    if (current && current.width > 0) {
      drawToCanvas(current);
    } else if (activeLayerId) {
      // 2. Fallback: read raw pixel data from CanvasRegistry
      const raw = CanvasRegistry.get(activeLayerId);
      if (raw && raw.width > 0) {
        drawToCanvas(raw);
      }
    }

    const unsubPipeline = PipelineManager.subscribe(drawOutput);
    const unsubCompositor = LayerCompositor.subscribe(drawOutput);
    return () => {
      unsubPipeline();
      unsubCompositor();
    };
  }, [drawToCanvas, drawOutput, activeLayerId, pixelVersion]);

  return { height };
}
