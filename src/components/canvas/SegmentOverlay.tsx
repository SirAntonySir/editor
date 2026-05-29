import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';

interface SegmentOverlayProps {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

/**
 * Renders hover + selected segment outlines on a sibling canvas absolutely
 * positioned over the Fabric image. Repaints on selection / hover changes
 * and on Fabric viewport transform changes (zoom / pan).
 */
export function SegmentOverlay({ fabricCanvasRef }: SegmentOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeScope = useEditorStore((s) => s.activeScope);
  const hoveredScope = useEditorStore((s) => s.hoveredScope);

  const hoveredId = hoveredScope?.kind === 'mask' ? hoveredScope.mask_id : null;
  const selectedId = activeScope.kind === 'mask' ? activeScope.mask_id : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const fcanvas = fabricCanvasRef.current;
    if (!canvas || !fcanvas) return;

    function repaint() {
      const c = canvasRef.current;
      const f = fabricCanvasRef.current;
      if (!c || !f) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      c.width = f.getWidth();
      c.height = f.getHeight();
      ctx.clearRect(0, 0, c.width, c.height);

      // Apply Fabric's viewport transform so pan/zoom tracks the image.
      const vpt = f.viewportTransform;
      if (vpt) {
        ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
      }

      const fabricImage = f.getObjects().find(
        (o) => o instanceof fabric.FabricImage,
      ) as fabric.FabricImage | undefined;
      if (!fabricImage) return;

      const scaleX = fabricImage.scaleX ?? 1;
      const scaleY = fabricImage.scaleY ?? 1;
      const imgNativeW = fabricImage.width ?? 0;
      const imgNativeH = fabricImage.height ?? 0;
      const imgLeft = (fabricImage.left ?? 0) - (imgNativeW * scaleX) / 2;
      const imgTop = (fabricImage.top ?? 0) - (imgNativeH * scaleY) / 2;

      function drawOutline(maskId: string, style: 'hover' | 'selected') {
        const c2 = canvasRef.current;
        if (!c2) return;
        const ctx2 = c2.getContext('2d');
        if (!ctx2) return;
        const mask = maskStore.get(maskId);
        if (!mask) return;
        ctx2.save();
        ctx2.lineWidth = style === 'selected' ? 2.5 : 1.5;
        ctx2.strokeStyle =
          style === 'selected' ? 'rgba(10,132,255,1)' : 'rgba(10,132,255,0.55)';
        ctx2.fillStyle =
          style === 'selected' ? 'rgba(10,132,255,0.12)' : 'rgba(10,132,255,0.08)';
        // One mask pixel covers (img.width / mask.width) image pixels in X,
        // and each image pixel is `scaleX` canvas pixels. So a mask pixel
        // spans (img.width / mask.width) * scaleX canvas pixels.
        const cellW = ((imgNativeW || mask.width) * scaleX) / mask.width;
        const cellH = ((imgNativeH || mask.height) * scaleY) / mask.height;
        // Fill pass — scan-line runs of set pixels
        for (let y = 0; y < mask.height; y++) {
          let runStart = -1;
          for (let x = 0; x < mask.width; x++) {
            const on = mask.data[y * mask.width + x] !== 0;
            if (on && runStart < 0) runStart = x;
            if ((!on || x === mask.width - 1) && runStart >= 0) {
              const xEnd = on ? x + 1 : x;
              const px = imgLeft + runStart * cellW;
              const py = imgTop + y * cellH;
              ctx2.fillRect(px, py, (xEnd - runStart) * cellW, cellH);
              runStart = -1;
            }
          }
        }
        // Outline pass — edge cells only
        ctx2.beginPath();
        for (let y = 0; y < mask.height; y++) {
          for (let x = 0; x < mask.width; x++) {
            const on = mask.data[y * mask.width + x] !== 0;
            if (!on) continue;
            const up = y > 0 && mask.data[(y - 1) * mask.width + x];
            const dn = y < mask.height - 1 && mask.data[(y + 1) * mask.width + x];
            const lt = x > 0 && mask.data[y * mask.width + x - 1];
            const rt = x < mask.width - 1 && mask.data[y * mask.width + x + 1];
            const px = imgLeft + x * cellW;
            const py = imgTop + y * cellH;
            if (!up) {
              ctx2.moveTo(px, py);
              ctx2.lineTo(px + cellW, py);
            }
            if (!dn) {
              ctx2.moveTo(px, py + cellH);
              ctx2.lineTo(px + cellW, py + cellH);
            }
            if (!lt) {
              ctx2.moveTo(px, py);
              ctx2.lineTo(px, py + cellH);
            }
            if (!rt) {
              ctx2.moveTo(px + cellW, py);
              ctx2.lineTo(px + cellW, py + cellH);
            }
          }
        }
        ctx2.stroke();
        ctx2.restore();
      }

      if (hoveredId && hoveredId !== selectedId) drawOutline(hoveredId, 'hover');
      if (selectedId) drawOutline(selectedId, 'selected');
    }

    repaint();
    fcanvas.on('after:render', repaint as never);
    return () => {
      fcanvas.off('after:render', repaint as never);
    };
  }, [hoveredId, selectedId, fabricCanvasRef]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 5 }}
    />
  );
}
