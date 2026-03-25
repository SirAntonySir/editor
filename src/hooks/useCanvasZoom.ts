import { useCallback } from 'react';
import { Point } from 'fabric';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';

export function useCanvasZoom(canvasRef: React.RefObject<fabric.Canvas | null>) {
  const applyZoom = useCallback(
    (newZoom: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const clamped = Math.max(0.1, Math.min(32, newZoom));
      const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
      canvas.zoomToPoint(center, clamped);
      useEditorStore.getState().setZoom(clamped);
      canvas.requestRenderAll();
    },
    [canvasRef],
  );

  const fitOnScreen = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obj = canvas.getObjects()[0];
    if (!obj) return;

    // Reset viewport first
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    const canvasW = canvas.getWidth();
    const canvasH = canvas.getHeight();
    const objW = obj.width * (obj.scaleX ?? 1);
    const objH = obj.height * (obj.scaleY ?? 1);
    const zoom = Math.min(canvasW / objW, canvasH / objH) * 0.9;

    // Zoom to center
    const center = new Point(canvasW / 2, canvasH / 2);
    canvas.zoomToPoint(center, zoom);

    // Pan so object center is at canvas center
    const objCenter = obj.getCenterPoint();
    const vpt = canvas.viewportTransform;
    if (vpt) {
      vpt[4] = canvasW / 2 - objCenter.x * zoom;
      vpt[5] = canvasH / 2 - objCenter.y * zoom;
    }

    useEditorStore.getState().setZoom(zoom);
    useEditorStore.getState().setFitMode('fit');
    useEditorStore.getState().setPan(vpt?.[4] ?? 0, vpt?.[5] ?? 0);
    canvas.requestRenderAll();
  }, [canvasRef]);

  const zoomIn = useCallback(() => {
    const currentZoom = canvasRef.current?.getZoom() ?? 1;
    applyZoom(currentZoom * 1.25);
  }, [canvasRef, applyZoom]);

  const zoomOut = useCallback(() => {
    const currentZoom = canvasRef.current?.getZoom() ?? 1;
    applyZoom(currentZoom / 1.25);
  }, [canvasRef, applyZoom]);

  return { applyZoom, fitOnScreen, zoomIn, zoomOut };
}
