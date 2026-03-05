import { useRef, useCallback, useMemo } from 'react';
import { Cropper, type CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import * as fabric from 'fabric';
import type { CanvasOverlayProps } from '@/types/tool';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';

export function CropOverlay({ ctx }: CanvasOverlayProps) {
  const cropperRef = useRef<CropperRef | null>(null);

  // Get the original image data URL from CanvasRegistry (not the canvas viewport)
  const src = useMemo(() => {
    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return '';
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return '';
    const tmp = document.createElement('canvas');
    tmp.width = offscreen.width;
    tmp.height = offscreen.height;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return '';
    tmpCtx.drawImage(offscreen, 0, 0);
    return tmp.toDataURL();
  }, []);

  const handleApply = useCallback(() => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    const coords = cropper.getCoordinates();
    const image = cropper.getImage();
    if (!coords || !image) return;

    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return;

    // The cropper works on the image at its natural size.
    // Map cropper coordinates to original pixel coordinates.
    const scaleX = offscreen.width / (image.width || offscreen.width);
    const scaleY = offscreen.height / (image.height || offscreen.height);

    const cropX = Math.round(coords.left * scaleX);
    const cropY = Math.round(coords.top * scaleY);
    const cropW = Math.round(coords.width * scaleX);
    const cropH = Math.round(coords.height * scaleY);

    // Crop the pixel data
    const croppedOffscreen = new OffscreenCanvas(cropW, cropH);
    const croppedCtx = croppedOffscreen.getContext('2d');
    if (!croppedCtx) return;
    croppedCtx.drawImage(offscreen, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Update CanvasRegistry
    CanvasRegistry.register(activeLayerId, croppedOffscreen);

    // Replace the Fabric image
    const tmp = document.createElement('canvas');
    tmp.width = cropW;
    tmp.height = cropH;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) return;
    tmpCtx.drawImage(croppedOffscreen, 0, 0);

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    const scale = Math.min(canvasWidth / cropW, canvasHeight / cropH) * 0.9;

    // Remove old objects and add cropped image
    canvas.clear();
    const newImg = new fabric.FabricImage(tmp, {
      scaleX: scale,
      scaleY: scale,
      left: (canvasWidth - cropW * scale) / 2,
      top: (canvasHeight - cropH * scale) / 2,
    });
    canvas.add(newImg);
    canvas.renderAll();

    ctx.setState({ activeTool: 'select' });
  }, [ctx]);

  const handleCancel = useCallback(() => {
    ctx.setState({ activeTool: 'select' });
  }, [ctx]);

  if (!src) return null;

  return (
    <div className="absolute inset-0 z-10 bg-canvas-bg">
      <Cropper
        ref={cropperRef}
        src={src}
        className="h-full w-full"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20">
        <button
          onClick={handleCancel}
          className="glass-panel px-4 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="bg-accent text-white px-4 py-2 text-sm hover:bg-accent-hover transition-colors"
          style={{ borderRadius: 'var(--radius-button)' }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
