import { useEffect, useRef } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { useCropEditingStore } from '@/store/crop-editing-slice';
import { PipelineManager } from '@/lib/pipeline-manager';
import { LayerCompositor } from '@/lib/layer-compositor';
import { applyCropForExport } from '@/lib/crop-display';
import type { Adjustment, CropMeta } from '@/store/layer-slice';

/**
 * Connects the Zustand store to the WebGL pipeline and layer compositor.
 *
 * After the pipeline renders the full adjusted image, this hook applies
 * CropMeta (if any) by rendering the cropped+rotated result into the
 * display canvas. Source pixels in PixelStore are never touched — crop
 * is purely a display-time operation that also runs at export.
 */
export function useAdjustmentPipeline(canvasRef: React.RefObject<fabric.Canvas | null>) {
  const prevRef = useRef<{
    mode: string;
    layerId: string | null;
    adjustments: Adjustment[] | undefined;
    layerHash: string;
    pixelVersion: number;
    cropMeta: CropMeta | undefined;
  }>({
    mode: '',
    layerId: null,
    adjustments: undefined,
    layerHash: '',
    pixelVersion: -1,
    cropMeta: undefined,
  });

  /** Track the last displayed dimensions so we only re-fit when they change. */
  const lastDimsRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const updateFabricImage = (outputCanvas: HTMLCanvasElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const objects = canvas.getObjects();
      if (objects.length === 0) return;
      const fabricImg = objects[0] as fabric.FabricImage;
      if (!fabricImg) return;

      const state = useEditorStore.getState();
      const layer = state.layers.find((l) => l.id === state.activeLayerId);
      const cropMeta = layer?.cropMeta;
      const inCropMode = useCropEditingStore.getState().isCropEditing;

      let displayCanvas: HTMLCanvasElement | OffscreenCanvas;

      if (cropMeta && !inCropMode) {
        // ── Crop active: render cropped+rotated preview ──
        // Uses the same function as export so preview matches output exactly.
        displayCanvas = applyCropForExport(outputCanvas, cropMeta);
      } else {
        // ── No crop or in crop-editing mode: show full image ──
        displayCanvas = outputCanvas;
      }

      // Push to Fabric
      const tmp = document.createElement('canvas');
      tmp.width = displayCanvas.width;
      tmp.height = displayCanvas.height;
      const ctx = tmp.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(displayCanvas, 0, 0);

      fabricImg.setElement(tmp);
      // setElement resets width/height — ensure they match display dimensions
      fabricImg.width = tmp.width;
      fabricImg.height = tmp.height;
      // Clear any leftover cropX/cropY from previous states
      (fabricImg as unknown as Record<string, number>).cropX = 0;
      (fabricImg as unknown as Record<string, number>).cropY = 0;
      // Clear rotation — it's baked into the display canvas when crop is applied
      if (cropMeta && !inCropMode) {
        fabricImg.set({ angle: 0, flipX: false, flipY: false });
      }

      // Only re-fit when the visible dimensions actually change
      const newW = tmp.width;
      const newH = tmp.height;
      if (lastDimsRef.current.w !== newW || lastDimsRef.current.h !== newH) {
        lastDimsRef.current = { w: newW, h: newH };
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();
        const scale = Math.min(canvasW / newW, canvasH / newH) * 0.9;
        fabricImg.set({ scaleX: scale, scaleY: scale, left: canvasW / 2, top: canvasH / 2 });
      }

      fabricImg.setCoords();
      canvas.requestRenderAll();
    };

    // Set callbacks
    PipelineManager.setRenderCallback(updateFabricImage);
    LayerCompositor.setCompositeCallback(updateFabricImage);

    const unsubscribe = useEditorStore.subscribe((state) => {
      const { activeLayerId, editorMode, layers, pixelVersion } = state;
      const layer = layers.find((l) => l.id === activeLayerId);
      const cropMeta = layer?.cropMeta;

      if (editorMode === 'develop') {
        const adjustments = layer?.adjustmentStack.adjustments;

        if (
          prevRef.current.mode === editorMode &&
          prevRef.current.layerId === activeLayerId &&
          prevRef.current.adjustments === adjustments &&
          prevRef.current.pixelVersion === pixelVersion &&
          prevRef.current.cropMeta === cropMeta
        ) {
          return;
        }
        prevRef.current = {
          mode: editorMode,
          layerId: activeLayerId,
          adjustments,
          layerHash: '',
          pixelVersion,
          cropMeta,
        };

        if (!activeLayerId) return;

        const multipleVisibleLayers = layers.filter((l) => l.visible).length > 1;

        if (multipleVisibleLayers || !adjustments || adjustments.length === 0) {
          LayerCompositor.requestComposite();
          return;
        }

        PipelineManager.setSource(activeLayerId);
        PipelineManager.requestRender([...adjustments]);
      } else {
        // Compose / graph / crop modes
        const visibleLayers = layers.filter((l) => l.visible);
        const layerHash = visibleLayers
          .map((l) => `${l.id}:${l.opacity}:${l.blendMode}:${l.order}:${l.adjustmentStack.adjustments.length}`)
          .join('|');

        const activeAdj = layer?.adjustmentStack.adjustments;

        if (
          prevRef.current.mode === editorMode &&
          prevRef.current.layerHash === layerHash &&
          prevRef.current.adjustments === activeAdj &&
          prevRef.current.pixelVersion === pixelVersion &&
          prevRef.current.cropMeta === cropMeta
        ) {
          return;
        }
        prevRef.current = {
          mode: editorMode,
          layerId: activeLayerId,
          adjustments: activeAdj,
          layerHash,
          pixelVersion,
          cropMeta,
        };

        LayerCompositor.requestComposite();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [canvasRef]);
}
