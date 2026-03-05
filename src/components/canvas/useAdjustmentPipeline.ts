import { useEffect, useRef } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { PipelineManager } from '@/lib/pipeline-manager';
import { LayerCompositor } from '@/lib/layer-compositor';
import type { Adjustment } from '@/store/layer-slice';

/**
 * Connects the Zustand store to the WebGL pipeline and layer compositor.
 * - Develop mode: renders the active layer through adjustments, updates Fabric image.
 * - Compose mode: composites all visible layers (each through its own adjustments), updates Fabric image.
 */
export function useAdjustmentPipeline(canvasRef: React.RefObject<fabric.Canvas | null>) {
  const prevRef = useRef<{
    mode: string;
    layerId: string | null;
    adjustments: Adjustment[] | undefined;
    layerHash: string;
    pixelVersion: number;
  }>({
    mode: '',
    layerId: null,
    adjustments: undefined,
    layerHash: '',
    pixelVersion: -1,
  });

  useEffect(() => {
    const updateFabricImage = (outputCanvas: HTMLCanvasElement) => {
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

      // Check if dimensions changed (e.g. after crop)
      const oldW = fabricImg.width;
      const oldH = fabricImg.height;

      fabricImg.setElement(tempCanvas);

      // If the source dimensions changed, re-fit and center
      if (fabricImg.width !== oldW || fabricImg.height !== oldH) {
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();
        const scale = Math.min(canvasW / fabricImg.width, canvasH / fabricImg.height) * 0.9;
        fabricImg.set({
          scaleX: scale,
          scaleY: scale,
          left: canvasW / 2,
          top: canvasH / 2,
        });
        fabricImg.setCoords();
      }

      canvas.requestRenderAll();
    };

    // Set callbacks
    PipelineManager.setRenderCallback(updateFabricImage);
    LayerCompositor.setCompositeCallback(updateFabricImage);

    const unsubscribe = useEditorStore.subscribe((state) => {
      const { activeLayerId, editorMode, layers, pixelVersion } = state;

      if (editorMode === 'develop') {
        // Develop mode: render only the active layer through its adjustment pipeline
        const layer = layers.find((l) => l.id === activeLayerId);
        const adjustments = layer?.adjustmentStack.adjustments;

        if (
          prevRef.current.mode === editorMode &&
          prevRef.current.layerId === activeLayerId &&
          prevRef.current.adjustments === adjustments &&
          prevRef.current.pixelVersion === pixelVersion
        ) {
          return;
        }
        prevRef.current = {
          mode: editorMode,
          layerId: activeLayerId,
          adjustments,
          layerHash: '',
          pixelVersion,
        };

        if (!activeLayerId) return;

        if (!adjustments || adjustments.length === 0) {
          // No adjustments — show working canvas directly
          LayerCompositor.requestComposite();
          return;
        }

        PipelineManager.setSource(activeLayerId);
        PipelineManager.requestRender([...adjustments]);
      } else {
        // Compose mode: composite all visible layers
        // Build a hash of layer states to detect changes
        const visibleLayers = layers.filter((l) => l.visible);
        const layerHash = visibleLayers
          .map((l) => `${l.id}:${l.opacity}:${l.blendMode}:${l.order}:${l.adjustmentStack.adjustments.length}`)
          .join('|');

        // Also check individual adjustment params by reference
        const activeAdj = layers.find((l) => l.id === activeLayerId)?.adjustmentStack.adjustments;

        if (
          prevRef.current.mode === editorMode &&
          prevRef.current.layerHash === layerHash &&
          prevRef.current.adjustments === activeAdj &&
          prevRef.current.pixelVersion === pixelVersion
        ) {
          return;
        }
        prevRef.current = {
          mode: editorMode,
          layerId: activeLayerId,
          adjustments: activeAdj,
          layerHash,
          pixelVersion,
        };

        LayerCompositor.requestComposite();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [canvasRef]);
}
