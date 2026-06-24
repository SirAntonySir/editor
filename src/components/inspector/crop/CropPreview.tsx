import { useEffect, useRef } from 'react';

export interface CropRect { x: number; y: number; w: number; h: number; }

export interface CropPreviewProps {
  sourceBitmap: HTMLCanvasElement | OffscreenCanvas;
  crop: CropRect;
  aspectRatio: number | null;
  previewWidth: number;
  previewHeight: number;
  rotateAngle?: number;
  onCropChange: (crop: CropRect) => void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Edge = 't' | 'b' | 'l' | 'r';
export type Handle = Corner | Edge;

function clampRect(r: CropRect, sw: number, sh: number): CropRect {
  let { x, y, w, h } = r;
  x = Math.max(0, Math.min(x, sw - 1));
  y = Math.max(0, Math.min(y, sh - 1));
  w = Math.max(1, Math.min(w, sw - x));
  h = Math.max(1, Math.min(h, sh - y));
  return { x, y, w, h };
}

export function applyCornerDelta(
  start: CropRect, corner: Corner, dsx: number, dsy: number,
  sw: number, sh: number, aspectRatio: number | null,
): CropRect {
  let { x, y, w, h } = start;
  if (aspectRatio != null) {
    // Determine the sign of each dimension change for this corner.
    const signX = (corner === 'tl' || corner === 'bl') ? -1 : 1;
    const signY = (corner === 'tl' || corner === 'tr') ? -1 : 1;
    // Compute candidate new dimensions driven by each axis independently.
    const newWByX = w + dsx * signX;
    const newHByY = h + dsy * signY;
    // |dsx| wins means x-axis drives the new size.
    const dxBy = Math.abs(dsx);
    const dyBy = Math.abs(dsy);
    if (dxBy >= dyBy) {
      // x wins: lock h to maintain aspect ratio relative to new w.
      const newW = newWByX;
      const newH = newW / aspectRatio;
      dsx = (newW - w) * signX;
      dsy = (newH - h) * signY;
    } else {
      // y wins: lock w to maintain aspect ratio relative to new h.
      const newH = newHByY;
      const newW = newH * aspectRatio;
      dsy = (newH - h) * signY;
      dsx = (newW - w) * signX;
    }
  }
  if (corner === 'tl') { x += dsx; y += dsy; w -= dsx; h -= dsy; }
  if (corner === 'tr') { y += dsy; w += dsx; h -= dsy; }
  if (corner === 'bl') { x += dsx; w -= dsx; h += dsy; }
  if (corner === 'br') { w += dsx; h += dsy; }
  return clampRect({ x, y, w, h }, sw, sh);
}

export function applyEdgeDelta(
  start: CropRect, edge: Edge, dsx: number, dsy: number, sw: number, sh: number,
): CropRect {
  let { x, y, w, h } = start;
  if (edge === 'l') { x += dsx; w -= dsx; }
  if (edge === 'r') { w += dsx; }
  if (edge === 't') { y += dsy; h -= dsy; }
  if (edge === 'b') { h += dsy; }
  return clampRect({ x, y, w, h }, sw, sh);
}

export function CropPreview({
  sourceBitmap, crop, aspectRatio, previewWidth, previewHeight, rotateAngle = 0, onCropChange,
}: CropPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const W = sourceBitmap.width;
  const H = sourceBitmap.height;
  const θ = rotateAngle * Math.PI / 180;
  const absCos = Math.abs(Math.cos(θ));
  const absSin = Math.abs(Math.sin(θ));
  const bbW = W * absCos + H * absSin;
  const bbH = W * absSin + H * absCos;
  // Scale factor: how many preview pixels correspond to one bbox pixel.
  const previewScale = Math.min(previewWidth / bbW, previewHeight / bbH);
  // Inverse: one source/bbox pixel = previewScale preview pixels → scaleX = 1/previewScale
  const scaleX = 1 / previewScale;
  const scaleY = 1 / previewScale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, previewWidth, previewHeight);
    ctx.save();
    // Render the rotated source centered in the preview. The source rotates
    // around its own centre, and the result fills a bbW × bbH bbox. We scale
    // the bbox to fit inside the preview, then center the bbox in the preview.
    ctx.translate(previewWidth / 2, previewHeight / 2);
    ctx.scale(previewScale, previewScale);
    ctx.rotate(θ);
    ctx.drawImage(sourceBitmap, -W / 2, -H / 2);
    ctx.restore();
  }, [sourceBitmap, previewWidth, previewHeight, previewScale, θ, W, H]);

  function startCornerDrag(e: React.PointerEvent, corner: Corner) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = crop;
    function onMove(ev: PointerEvent) {
      const dxScreen = ev.clientX - startX;
      const dyScreen = ev.clientY - startY;
      const dsx = dxScreen * scaleX;
      const dsy = dyScreen * scaleY;
      onCropChange(applyCornerDelta(start, corner, dsx, dsy, bbW, bbH, aspectRatio));
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startEdgeDrag(e: React.PointerEvent, edge: Edge) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = crop;
    function onMove(ev: PointerEvent) {
      const dxScreen = ev.clientX - startX;
      const dyScreen = ev.clientY - startY;
      onCropChange(applyEdgeDelta(start, edge, dxScreen * scaleX, dyScreen * scaleY, bbW, bbH));
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // Crop rect is in bbox coords. Map to preview pixels.
  // The bbox is centered in the preview canvas with offset (bbOffsetX, bbOffsetY).
  const bbOffsetX = (previewWidth - bbW * previewScale) / 2;
  const bbOffsetY = (previewHeight - bbH * previewScale) / 2;
  const rectLeftPx = bbOffsetX + crop.x * previewScale;
  const rectTopPx = bbOffsetY + crop.y * previewScale;
  const rectWPx = crop.w * previewScale;
  const rectHPx = crop.h * previewScale;

  return (
    <div className="relative" style={{ width: previewWidth, height: previewHeight }} data-testid="crop-preview">
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      <div
        className="absolute pointer-events-none border border-accent"
        style={{
          left: rectLeftPx, top: rectTopPx, width: rectWPx, height: rectHPx,
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <div
            key={corner}
            data-handle={corner}
            className="absolute w-2.5 h-2.5 bg-surface border-[1.5px] border-accent pointer-events-auto cursor-nwse-resize"
            style={{
              left:   corner.endsWith('l') ? -5 : undefined,
              right:  corner.endsWith('r') ? -5 : undefined,
              top:    corner.startsWith('t') ? -5 : undefined,
              bottom: corner.startsWith('b') ? -5 : undefined,
            }}
            onPointerDown={(e) => startCornerDrag(e, corner)}
          />
        ))}
        {(['t', 'b', 'l', 'r'] as const).map((edge) => (
          <div
            key={edge}
            data-handle={edge}
            className={`absolute pointer-events-auto bg-transparent ${
              edge === 't' || edge === 'b' ? 'cursor-ns-resize h-2.5 left-2 right-2' : 'cursor-ew-resize w-2.5 top-2 bottom-2'
            }`}
            style={{
              left:   edge === 'l' ? -5 : undefined,
              right:  edge === 'r' ? -5 : undefined,
              top:    edge === 't' ? -5 : undefined,
              bottom: edge === 'b' ? -5 : undefined,
            }}
            onPointerDown={(e) => startEdgeDrag(e, edge)}
          />
        ))}
      </div>
    </div>
  );
}
