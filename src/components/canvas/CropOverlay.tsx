import { useRef, useCallback, useEffect } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { useCropEditingStore } from '@/store/crop-editing-slice';
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

/* ================================================================== */

export function CropCanvasOverlay({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
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

  // Read crop editing state from zustand
  const cropAspectRatio = useCropEditingStore((s) => s.cropAspectRatio);
  const cropStraighten = useCropEditingStore((s) => s.cropStraighten);
  const cropBaseRotation = useCropEditingStore((s) => s.cropBaseRotation);
  const cropFlipX = useCropEditingStore((s) => s.cropFlipX);
  const cropFlipY = useCropEditingStore((s) => s.cropFlipY);
  const setIsCropEditing = useCropEditingStore((s) => s.setIsCropEditing);
  const resetCropEditing = useCropEditingStore((s) => s.resetCropEditing);

  aspectRatioRef.current = cropAspectRatio;
  straightenRef.current = cropStraighten;
  baseRotationRef.current = cropBaseRotation;

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
      useCropEditingStore.getState().setCropStraighten(savedCrop.straighten);
      useCropEditingStore.getState().setCropBaseRotation(savedCrop.baseRotation);
      useCropEditingStore.getState().setCropFlipX(savedCrop.flipX);
      useCropEditingStore.getState().setCropFlipY(savedCrop.flipY);
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

  // ── React to aspect ratio changes from CropPanel ──────────────────
  useEffect(() => {
    const cropRect = cropRectRef.current;
    if (!cropRect || cropAspectRatio <= 0) return;

    const bounds = getCropBounds();
    const bw = bounds.right - bounds.left;
    const bh = bounds.bottom - bounds.top;
    let newW = bw;
    let newH = bw / cropAspectRatio;
    if (newH > bh) { newH = bh; newW = bh * cropAspectRatio; }

    const cx = (bounds.left + bounds.right) / 2;
    const cy = (bounds.top + bounds.bottom) / 2;
    cropRect.set({ left: cx - newW / 2, top: cy - newH / 2, width: newW, height: newH, scaleX: 1, scaleY: 1 });
    cropRect.setCoords();
    clampCropPosition(cropRect, bounds);
    syncOverlay();
    canvasRef.current?.requestRenderAll();
  }, [cropAspectRatio, getCropBounds, syncOverlay, canvasRef]);

  // ── React to straighten changes from CropPanel ─────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    if (!canvas || !img) return;

    straightenRef.current = cropStraighten;
    img.set({ angle: baseRotationRef.current + cropStraighten });
    img.setCoords();
    refitCropToInscribed();
    canvas.requestRenderAll();
  }, [cropStraighten, canvasRef, refitCropToInscribed]);

  // ── React to base rotation changes from CropPanel ──────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    if (!canvas || !img) return;

    baseRotationRef.current = cropBaseRotation;
    img.set({ angle: cropBaseRotation + straightenRef.current });
    img.setCoords();
    refitCropToInscribed();
    canvas.requestRenderAll();
  }, [cropBaseRotation, canvasRef, refitCropToInscribed]);

  // ── React to flip changes from CropPanel ───────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    if (!canvas || !img) return;

    img.set({ flipX: cropFlipX, flipY: cropFlipY });
    img.setCoords();
    canvas.requestRenderAll();
  }, [cropFlipX, cropFlipY, canvasRef]);

  // ── Apply crop (metadata only — no pixel manipulation!) ─────────────
  const handleApply = useCallback(() => {
    const canvas = canvasRef.current;
    const img = fabricImageRef.current;
    const cropRect = cropRectRef.current;
    if (!canvas || !img || !cropRect) return;

    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;

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

    editorDocument.recordAction('Crop', () => {
      useEditorStore.getState().updateLayer(activeLayerId, { cropMeta });
    });

    // Clean up crop UI objects
    if (overlayRef.current) { removeOverlayFromCanvas(canvas, overlayRef.current); overlayRef.current = null; }
    if (cropRectRef.current) { canvas.remove(cropRectRef.current); cropRectRef.current = null; }

    img.selectable = true;
    img.evented = true;

    resetCropEditing();
  }, [canvasRef, resetCropEditing]);

  // ── Cancel ──────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    resetCropEditing();
  }, [resetCropEditing]);

  // ── Keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); handleApply(); }
      else if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApply, handleCancel]);

  // No HUD — the panel is rendered separately via CropPanel
  return null;
}

// Legacy export for backwards compatibility during refactor
export { CropCanvasOverlay as CropOverlay };
