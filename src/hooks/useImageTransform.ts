import { useCallback } from 'react';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';

export type TransformMode = 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';

export function useImageTransform() {
  const transformImage = useCallback((mode: TransformMode) => {
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

    // Bump pixelVersion so workspace ImageNode re-renders.
    useEditorStore.getState().bumpPixelVersion();
  }, []);

  return { transformImage };
}
