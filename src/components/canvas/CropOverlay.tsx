import { useRef, useCallback, useState, useEffect } from 'react';
import * as fabric from 'fabric';
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
} from 'lucide-react';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { editorDocument } from '@/core/document';
import { computeInscribedRect } from '@/lib/crop-utils';
import {
  createCropRect,
  createOverlayRects,
  updateOverlayRects,
  addOverlayToCanvas,
  removeOverlayFromCanvas,
  getCropEdges,
  clampCropPosition,
  clampCropScale,
  type OverlayRects,
  type Bounds,
} from '@/lib/crop-rect';
import type { CropMeta } from '@/store/layer-slice';

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

/* ================================================================== */

export function CropOverlay({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const [aspectRatio, setAspectRatio] = useState(0);
  const [straighten, setStraighten] = useState(0);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);

  const cropRectRef = useRef<fabric.Rect | null>(null);
  const overlayRef = useRef<OverlayRects | null>(null);
  const fabricImageRef = useRef<fabric.FabricImage | null>(null);
  const aspectRatioRef = useRef(0);
  const baseRotationRef = useRef(0);
  const straightenRef = useRef(0);
  /** The CropMeta that was active when we entered crop mode (for cancel). */
  const prevCropMetaRef = useRef<CropMeta | undefined>(undefined);
  /** Source pixel dimensions (full, uncropped). */
  const sourceDimsRef = useRef({ w: 0, h: 0 });

  aspectRatioRef.current = aspectRatio;
  straightenRef.current = straighten;

  /** Total image angle = base90 turns + straighten. */
  const getTotalAngle = useCallback(() => {
    return baseRotationRef.current + straightenRef.current;
  }, []);

  /**
   * Crop bounds = inscribed axis-aligned rect inside the (possibly rotated) image.
   * When angle is 0, this equals the full image bounds.
   */
  const getCropBounds = useCallback((): Bounds => {
    const img = fabricImageRef.current;
    if (!img) return { left: 0, top: 0, right: 0, bottom: 0 };

    const cx = img.left ?? 0;
    const cy = img.top ?? 0;
    const s = img.scaleX ?? 1;
    const { w: origW, h: origH } = sourceDimsRef.current;

    const norm = ((baseRotationRef.current % 360) + 360) % 360;
    const isSwapped = norm === 90 || norm === 270;
    const effW = isSwapped ? origH : origW;
    const effH = isSwapped ? origW : origH;

    const inscribed = computeInscribedRect(effW, effH, straightenRef.current);
    const hw = (inscribed.width * s) / 2;
    const hh = (inscribed.height * s) / 2;

    return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
  }, []);

  /** Sync the 4 overlay rects to the current crop rect edges. */
  const syncOverlay = useCallback(() => {
    const cropRect = cropRectRef.current;
    const overlay = overlayRef.current;
    if (!cropRect || !overlay) return;
    const edges = getCropEdges(cropRect);
    updateOverlayRects(overlay, edges.left, edges.top, edges.right, edges.bottom);
  }, []);

  /** Refit the crop rect to the full inscribed area. */
  const refitCropToInscribed = useCallback(() => {
    const cropRect = cropRectRef.current;
    if (!cropRect) return;

    const bounds = getCropBounds();
    let newW = bounds.right - bounds.left;
    let newH = bounds.bottom - bounds.top;
    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;

    const ar = aspectRatioRef.current;
    if (ar > 0) {
      if (newW / ar <= newH) { newH = newW / ar; }
      else { newW = newH * ar; }
    }

    cropRect.set({ left: cx - newW / 2, top: cy - newH / 2, width: newW, height: newH, scaleX: 1, scaleY: 1 });
    cropRect.setCoords();
    syncOverlay();
  }, [getCropBounds, syncOverlay]);

  // ── Enter crop mode ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const image = canvas.getObjects().find(
      (o) => o instanceof fabric.FabricImage,
    ) as fabric.FabricImage | undefined;
    if (!image) return;

    fabricImageRef.current = image;

    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;

    // Get the source pixel dimensions (full, uncropped)
    const source = CanvasRegistry.get(activeLayerId);
    const srcW = source?.width ?? (image.getElement() as HTMLCanvasElement).width;
    const srcH = source?.height ?? (image.getElement() as HTMLCanvasElement).height;
    sourceDimsRef.current = { w: srcW, h: srcH };

    // Save the current cropMeta so we can restore on cancel
    const layer = useEditorStore.getState().layers.find((l) => l.id === activeLayerId);
    const savedCrop = layer?.cropMeta;
    prevCropMetaRef.current = savedCrop;

    // ── Show full uncropped image ──
    // The pipeline will also do this (it checks editorMode === 'crop'),
    // but we do it here immediately so the crop rect positioning below
    // can use the correct image dimensions and position.
    if (source) {
      const tmp = document.createElement('canvas');
      tmp.width = srcW;
      tmp.height = srcH;
      const tmpCtx = tmp.getContext('2d');
      if (tmpCtx) tmpCtx.drawImage(source, 0, 0);
      image.setElement(tmp);
      image.width = srcW;
      image.height = srcH;
      (image as unknown as Record<string, number>).cropX = 0;
      (image as unknown as Record<string, number>).cropY = 0;
    }

    // Refit the full image to the viewport
    const cw = canvas.getWidth();
    const ch = canvas.getHeight();
    const fitScale = Math.min(cw / srcW, ch / srcH) * 0.9;
    image.set({ scaleX: fitScale, scaleY: fitScale, left: cw / 2, top: ch / 2, angle: 0, flipX: false, flipY: false });

    // If re-entering with a previous crop, restore rotation
    if (savedCrop) {
      baseRotationRef.current = savedCrop.baseRotation;
      straightenRef.current = savedCrop.straighten;
      setStraighten(savedCrop.straighten);
      image.set({
        angle: savedCrop.baseRotation + savedCrop.straighten,
        flipX: savedCrop.flipX,
        flipY: savedCrop.flipY,
      });
    } else {
      baseRotationRef.current = 0;
      straightenRef.current = 0;
    }

    image.setCoords();

    // Disable normal interaction on the image
    image.selectable = false;
    image.evented = false;
    canvas.discardActiveObject();

    // ── Create crop rect ──
    const bounds = getCropBounds();
    let cropLeft: number, cropTop: number, cropW: number, cropH: number;

    if (savedCrop) {
      // Map saved fractions (of full source) → canvas coords
      const imgS = image.scaleX ?? 1;
      const imgCX = image.left ?? 0;
      const imgCY = image.top ?? 0;
      const imgW = srcW * imgS;
      const imgH = srcH * imgS;
      const imgLeft = imgCX - imgW / 2;
      const imgTop = imgCY - imgH / 2;
      cropLeft = imgLeft + savedCrop.rx * imgW;
      cropTop = imgTop + savedCrop.ry * imgH;
      cropW = savedCrop.rw * imgW;
      cropH = savedCrop.rh * imgH;

      // Clamp to inscribed bounds (in case of rotation)
      const bw = bounds.right - bounds.left;
      const bh = bounds.bottom - bounds.top;
      if (cropW > bw) cropW = bw;
      if (cropH > bh) cropH = bh;
    } else {
      cropLeft = bounds.left;
      cropTop = bounds.top;
      cropW = bounds.right - bounds.left;
      cropH = bounds.bottom - bounds.top;
    }

    const cropRect = createCropRect(cropLeft, cropTop, cropW, cropH);
    cropRectRef.current = cropRect;

    // Create overlay
    const overlay = createOverlayRects();
    overlayRef.current = overlay;
    const edges = getCropEdges(cropRect);
    updateOverlayRects(overlay, edges.left, edges.top, edges.right, edges.bottom);

    addOverlayToCanvas(canvas, overlay);
    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);

    // ── Event handlers ──

    const handleMoving = (e: { target: fabric.FabricObject }) => {
      if (e.target !== cropRect) return;
      clampCropPosition(cropRect, getCropBounds());
      syncOverlay();
    };

    const handleScaling = (e: { target: fabric.FabricObject }) => {
      if (e.target !== cropRect) return;
      const ar = aspectRatioRef.current;
      if (ar > 0) {
        const currentW = cropRect.getScaledWidth();
        cropRect.set({ scaleY: (currentW / ar) / (cropRect.height ?? 1) });
      }
      clampCropScale(cropRect, getCropBounds());
      syncOverlay();
    };

    const handleModified = (e: { target: fabric.FabricObject }) => {
      if (e.target !== cropRect) return;
      const w = cropRect.getScaledWidth();
      const h = cropRect.getScaledHeight();
      cropRect.set({ width: w, height: h, scaleX: 1, scaleY: 1 });
      cropRect.setCoords();
      syncOverlay();
    };

    canvas.on('object:moving', handleMoving as never);
    canvas.on('object:scaling', handleScaling as never);
    canvas.on('object:modified', handleModified as never);

    return () => {
      canvas.off('object:moving', handleMoving as never);
      canvas.off('object:scaling', handleScaling as never);
      canvas.off('object:modified', handleModified as never);

      if (overlayRef.current) { removeOverlayFromCanvas(canvas, overlayRef.current); overlayRef.current = null; }
      if (cropRectRef.current) { canvas.remove(cropRectRef.current); cropRectRef.current = null; }

      if (fabricImageRef.current) {
        fabricImageRef.current.selectable = true;
        fabricImageRef.current.evented = true;
      }
      canvas.requestRenderAll();
    };
  }, [canvasRef, getCropBounds, syncOverlay]);

  // ── Aspect ratio change ─────────────────────────────────────────────
  const handleAspectRatioChange = useCallback((value: number) => {
    setAspectRatio(value);
    const cropRect = cropRectRef.current;
    if (!cropRect) return;
    if (value <= 0) return;

    const bounds = getCropBounds();
    const bw = bounds.right - bounds.left;
    const bh = bounds.bottom - bounds.top;
    let newW = bw;
    let newH = bw / value;
    if (newH > bh) { newH = bh; newW = bh * value; }

    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    cropRect.set({ left: cx - newW / 2, top: cy - newH / 2, width: newW, height: newH, scaleX: 1, scaleY: 1 });
    cropRect.setCoords();
    clampCropPosition(cropRect, bounds);
    syncOverlay();
    canvasRef.current?.requestRenderAll();
  }, [getCropBounds, syncOverlay, canvasRef]);

  // ── Straighten ──────────────────────────────────────────────────────
  const handleStraighten = useCallback((degrees: number) => {
    setStraighten(degrees);
    straightenRef.current = degrees;
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    if (!canvas || !img) return;

    img.set({ angle: baseRotationRef.current + degrees });
    img.setCoords();
    refitCropToInscribed();
    canvas.requestRenderAll();
  }, [canvasRef, refitCropToInscribed]);

  // ── Rotate 90° ──────────────────────────────────────────────────────
  const handleRotate = useCallback((dir: 90 | -90) => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    if (!canvas || !img) return;

    baseRotationRef.current += dir;
    img.set({ angle: baseRotationRef.current + straightenRef.current });
    img.setCoords();
    refitCropToInscribed();
    canvas.requestRenderAll();
  }, [canvasRef, refitCropToInscribed]);

  // ── Flip ────────────────────────────────────────────────────────────
  const handleFlip = useCallback((axis: 'h' | 'v') => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    if (!canvas || !img) return;
    if (axis === 'h') img.set({ flipX: !img.flipX });
    else img.set({ flipY: !img.flipY });
    img.setCoords();
    canvas.requestRenderAll();
  }, [canvasRef]);

  // ── Apply crop (metadata only — no pixel manipulation!) ─────────────
  const handleApply = useCallback(() => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !img || !cropRect) return;

    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;

    // ── Compute CropMeta as fractions of the full source image ──
    const { w: srcW, h: srcH } = sourceDimsRef.current;
    const imgS = img.scaleX ?? 1;
    const imgCX = img.left ?? 0;
    const imgCY = img.top ?? 0;
    const imgW = srcW * imgS;
    const imgH = srcH * imgS;
    const imgLeft = imgCX - imgW / 2;
    const imgTop = imgCY - imgH / 2;

    const cl = cropRect.left ?? 0;
    const ct = cropRect.top ?? 0;
    const cw = cropRect.getScaledWidth();
    const ch = cropRect.getScaledHeight();

    const cropMeta: CropMeta = {
      rx: imgW > 0 ? (cl - imgLeft) / imgW : 0,
      ry: imgH > 0 ? (ct - imgTop) / imgH : 0,
      rw: imgW > 0 ? cw / imgW : 1,
      rh: imgH > 0 ? ch / imgH : 1,
      baseRotation: baseRotationRef.current,
      straighten: straightenRef.current,
      flipX: img.flipX ?? false,
      flipY: img.flipY ?? false,
    };

    // ── Record as undoable metadata action ──
    editorDocument.recordAction('Crop', () => {
      useEditorStore.getState().updateLayer(activeLayerId, { cropMeta });
    });

    // ── Clean up crop UI objects ──
    if (overlayRef.current) { removeOverlayFromCanvas(canvas, overlayRef.current); overlayRef.current = null; }
    if (cropRectRef.current) { canvas.remove(cropRectRef.current); cropRectRef.current = null; }

    // Restore image interaction — the pipeline will re-apply cropMeta via Fabric
    img.selectable = true;
    img.evented = true;

    setEditorMode('develop');
    // The useAdjustmentPipeline subscriber will detect the cropMeta change
    // and re-render with the crop applied via Fabric's cropX/cropY.
  }, [canvasRef, setEditorMode, getTotalAngle]);

  // ── Cancel ──────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    // Just exit crop mode — the pipeline will re-apply the previous cropMeta
    // (which is still on the layer, unchanged).
    setEditorMode('develop');
  }, [setEditorMode]);

  // ── Keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); handleApply(); }
      else if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApply, handleCancel]);

  // ── HUD ─────────────────────────────────────────────────────────────
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
      <div className="glass-panel flex items-center gap-3 px-3 py-1.5">
        {/* Aspect ratio pills */}
        <div className="flex items-center gap-0.5">
          {ASPECT_RATIOS.map((r) => (
            <button
              key={r.label}
              onClick={() => handleAspectRatioChange(r.value)}
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

        {/* Straighten slider */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-secondary w-[52px] text-right tabular-nums">
            {straighten > 0 ? '+' : ''}{straighten.toFixed(1)}°
          </span>
          <input
            type="range"
            min={-45}
            max={45}
            step={0.1}
            value={straighten}
            onChange={(e) => handleStraighten(parseFloat(e.target.value))}
            className="w-24 h-1 accent-accent cursor-default"
          />
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
          <button onClick={() => handleFlip('h')} className={btnClass} title="Flip horizontal">
            <FlipHorizontal2 size={15} />
          </button>
          <button onClick={() => handleFlip('v')} className={btnClass} title="Flip vertical">
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
  );
}
