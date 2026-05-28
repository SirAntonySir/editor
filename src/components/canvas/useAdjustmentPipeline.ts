import { useEffect, useRef } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { PipelineManager } from '@/lib/pipeline-manager';
import { LayerCompositor } from '@/lib/layer-compositor';
import type { Adjustment } from '@/types/adjustment';
import { selectPipelineNodes } from '@/lib/select-pipeline-nodes';
import { nodeToAdjustment } from '@/lib/node-to-adjustment';

/**
 * Connects the Zustand store to the WebGL pipeline and layer compositor.
 *
 * After the pipeline renders the full adjusted image, this hook pushes
 * the result to the Fabric canvas image object.
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

      const displayCanvas = outputCanvas;

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

    // Single source: backend operation_graph filtered by layer_id.
    // No dual-mode branching — always treat as 'develop'.
    function recompute(): void {
      const state = useEditorStore.getState();
      const { activeLayerId, layers, pixelVersion } = state;
      const layer = layers.find((l) => l.id === activeLayerId);
      if (!layer) return;

      // Single source: backend op_graph filtered by layer_id.
      const allNodes = selectPipelineNodes();
      const nodes = allNodes.filter((n) => n.layer_id === layer.id);
      const adjustments = nodes.map(nodeToAdjustment);

      const optSize = useBackendState.getState().optimistic.size;
      const sig = nodes
        .map((n) => `${n.id}:${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join(',')}`)
        .join('|');
      const combinedSig = `${activeLayerId}|n:${sig}|opt:${optSize}|pv:${pixelVersion}`;

      if (prevRef.current.layerHash === combinedSig) return;
      prevRef.current = {
        mode: 'develop',
        layerId: activeLayerId,
        adjustments,
        layerHash: combinedSig,
        pixelVersion,
      };

      const multipleVisible = layers.filter((l) => l.visible).length > 1;
      if (multipleVisible || adjustments.length === 0) {
        LayerCompositor.requestComposite();
        return;
      }

      PipelineManager.setSource(layer.id);
      PipelineManager.requestRender(adjustments);
    }

    const unsubA = useEditorStore.subscribe(recompute);
    const unsubB = useBackendState.subscribe(recompute);

    return () => {
      unsubA();
      unsubB();
    };
  }, [canvasRef]);
}
