import { useCallback } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';

export type TransformMode = 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';

export function useImageTransform(canvasRef: React.RefObject<fabric.Canvas | null>) {
  const transformImage = useCallback(
    (mode: TransformMode) => {
      const { activeLayerId } = useEditorStore.getState();
      if (!activeLayerId) return;
      const source = CanvasRegistry.get(activeLayerId);
      if (!source) return;

      const srcW = source.width;
      const srcH = source.height;
      const isRotate = mode === 'rotateCW' || mode === 'rotateCCW';
      const dstW = isRotate ? srcH : srcW;
      const dstH = isRotate ? srcW : srcH;

      const dst = new OffscreenCanvas(dstW, dstH);
      const ctx = dst.getContext('2d')!;
      ctx.save();
      ctx.translate(dstW / 2, dstH / 2);

      if (mode === 'rotateCW') ctx.rotate(Math.PI / 2);
      else if (mode === 'rotateCCW') ctx.rotate(-Math.PI / 2);
      else if (mode === 'flipH') ctx.scale(-1, 1);
      else if (mode === 'flipV') ctx.scale(1, -1);

      ctx.drawImage(source, -srcW / 2, -srcH / 2);
      ctx.restore();

      CanvasRegistry.replaceSource(activeLayerId, dst);

      // Update Fabric image
      const canvas = canvasRef.current;
      if (!canvas) return;
      const fabricImg = canvas.getObjects()[0] as import('fabric').FabricImage | undefined;
      if (!fabricImg) return;

      const tmp = document.createElement('canvas');
      tmp.width = dstW;
      tmp.height = dstH;
      tmp.getContext('2d')!.drawImage(dst, 0, 0);

      fabricImg.setElement(tmp);
      const canvasW = canvas.getWidth();
      const canvasH = canvas.getHeight();
      const scale = Math.min(canvasW / dstW, canvasH / dstH) * 0.9;
      fabricImg.set({
        scaleX: scale,
        scaleY: scale,
        left: canvasW / 2,
        top: canvasH / 2,
      });
      fabricImg.setCoords();
      canvas.requestRenderAll();
    },
    [canvasRef],
  );

  return { transformImage };
}
