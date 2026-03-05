import { useEffect, useRef } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { PipelineManager } from '@/lib/pipeline-manager';
import type { Adjustment } from '@/store/layer-slice';

export function useAdjustmentPipeline(canvasRef: React.MutableRefObject<fabric.Canvas | null>) {
  const prevRef = useRef<{ layerId: string | null; adjustments: Adjustment[] | undefined }>({
    layerId: null,
    adjustments: undefined,
  });

  useEffect(() => {
    PipelineManager.setRenderCallback((outputCanvas) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();
      if (objects.length === 0) return;

      const fabricImg = objects[0] as fabric.FabricImage;
      if (!fabricImg) return;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = outputCanvas.width;
      tempCanvas.height = outputCanvas.height;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(outputCanvas, 0, 0);

      fabricImg.setElement(tempCanvas);
      canvas.requestRenderAll();
    });

    const unsubscribe = useEditorStore.subscribe((state) => {
      const { activeLayerId } = state;
      const layer = state.layers.find((l) => l.id === activeLayerId);
      const adjustments = layer?.adjustmentStack.adjustments;

      // Skip if nothing changed
      if (
        prevRef.current.layerId === activeLayerId &&
        prevRef.current.adjustments === adjustments
      ) {
        return;
      }
      prevRef.current = { layerId: activeLayerId, adjustments };

      if (!activeLayerId || !adjustments || adjustments.length === 0) return;

      PipelineManager.setSource(activeLayerId);
      PipelineManager.requestRender([...adjustments]);
    });

    return () => {
      unsubscribe();
    };
  }, [canvasRef]);
}
