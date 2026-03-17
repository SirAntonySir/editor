import { useRef, useCallback, useMemo, useState } from 'react';
import { Cropper, type CropperRef, ImageRestriction } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';
import * as fabric from 'fabric';
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
} from 'lucide-react';
import type { CanvasOverlayProps } from '@/types/tool';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { editorDocument } from '@/core/document';

const ASPECT_RATIOS = [
  { label: 'Free', value: 0 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '5:4', value: 5 / 4 },
  { label: '7:5', value: 7 / 5 },
] as const;

const btnClass =
  'flex items-center justify-center w-7 h-7 rounded-[var(--radius-button)] text-text-secondary hover:text-text-primary hover:bg-surface-secondary/60 transition-colors cursor-default';

export function CropOverlay({ ctx }: CanvasOverlayProps) {
  const cropperRef = useRef<CropperRef | null>(null);
  const [aspectRatio, setAspectRatio] = useState(0);

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

  const handleRotate = useCallback((degrees: number) => {
    cropperRef.current?.rotateImage(degrees);
  }, []);

  const handleFlip = useCallback((horizontal: boolean, vertical: boolean) => {
    cropperRef.current?.flipImage(horizontal, vertical);
  }, []);

  const handleApply = useCallback(async () => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    const resultCanvas = cropper.getCanvas();
    if (!resultCanvas) return;

    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;

    const cropW = resultCanvas.width;
    const cropH = resultCanvas.height;

    const croppedOffscreen = new OffscreenCanvas(cropW, cropH);
    const croppedCtx = croppedOffscreen.getContext('2d');
    if (!croppedCtx) return;
    croppedCtx.drawImage(resultCanvas, 0, 0);

    await editorDocument.beginTransaction('Crop', [activeLayerId]);
    CanvasRegistry.replaceSource(activeLayerId, croppedOffscreen);
    await editorDocument.commitTransaction();

    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    const scale = Math.min(canvasWidth / cropW, canvasHeight / cropH) * 0.9;

    canvas.clear();
    const newImg = new fabric.FabricImage(resultCanvas, {
      scaleX: scale,
      scaleY: scale,
      left: canvasWidth / 2,
      top: canvasHeight / 2,
    });
    newImg.setControlVisible('mtr', false);
    canvas.add(newImg);
    canvas.renderAll();

    ctx.setState({ activeTool: 'select' });
  }, [ctx]);

  const handleCancel = useCallback(() => {
    ctx.setState({ activeTool: 'select' });
  }, [ctx]);

  if (!src) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-canvas-bg">
      {/* Cropper */}
      <div className="flex-1 min-h-0">
        <Cropper
          ref={cropperRef}
          src={src}
          className="h-full w-full cropper-themed"
          backgroundClassName="cropper-themed"
          imageRestriction={ImageRestriction.stencil}
          stencilProps={{
            aspectRatio: aspectRatio || undefined,
            grid: true,
          }}
        />
      </div>

      {/* Floating HUD toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
        <div className="glass-panel flex items-center gap-3 px-3 py-1.5">
          {/* Aspect ratio pills */}
          <div className="flex items-center gap-0.5">
            {ASPECT_RATIOS.map((r) => (
              <button
                key={r.label}
                onClick={() => setAspectRatio(r.value)}
                className={`px-2 py-0.5 text-[11px] rounded-[var(--radius-button)] transition-colors cursor-default
                  ${aspectRatio === r.value
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary/60'
                  }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-separator" />

          {/* Rotate / Flip */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => handleRotate(-90)} className={btnClass} title="Rotate left">
              <RotateCcw size={15} />
            </button>
            <button onClick={() => handleRotate(90)} className={btnClass} title="Rotate right">
              <RotateCw size={15} />
            </button>
            <button onClick={() => handleFlip(true, false)} className={btnClass} title="Flip horizontal">
              <FlipHorizontal2 size={15} />
            </button>
            <button onClick={() => handleFlip(false, true)} className={btnClass} title="Flip vertical">
              <FlipVertical2 size={15} />
            </button>
          </div>

          <div className="w-px h-5 bg-separator" />

          {/* Cancel / Apply */}
          <button
            onClick={handleCancel}
            className="px-3 py-0.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-default"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="bg-accent text-white px-3 py-0.5 text-[11px] hover:bg-accent-hover transition-colors cursor-default"
            style={{ borderRadius: 'var(--radius-button)' }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
