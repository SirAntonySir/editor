import { useState, useCallback } from 'react';
import { Cropper, type CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import * as fabric from 'fabric';
import type { CanvasOverlayProps } from '@/types/tool';

export function CropOverlay({ ctx }: CanvasOverlayProps) {
  const [cropperRef, setCropperRef] = useState<CropperRef | null>(null);

  const handleApply = useCallback(() => {
    if (!cropperRef) return;
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    const coords = cropperRef.getCoordinates();
    if (!coords) return;

    const activeObj = canvas.getObjects()[0];
    if (!activeObj) return;

    const clipRect = new fabric.Rect({
      left: coords.left,
      top: coords.top,
      width: coords.width,
      height: coords.height,
      absolutePositioned: true,
    });

    activeObj.clipPath = clipRect;
    canvas.renderAll();

    ctx.setState({ activeTool: 'select' });
  }, [cropperRef, ctx]);

  const handleCancel = useCallback(() => {
    ctx.setState({ activeTool: 'select' });
  }, [ctx]);

  const canvas = ctx.canvasRef.current;
  const activeObj = canvas?.getObjects()[0];
  const src = activeObj
    ? (canvas?.toDataURL({ multiplier: 1, format: 'png' }) ?? '')
    : '';

  if (!src) return null;

  return (
    <div className="absolute inset-0 z-10">
      <Cropper
        ref={(ref) => setCropperRef(ref)}
        src={src}
        className="h-full w-full"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
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
