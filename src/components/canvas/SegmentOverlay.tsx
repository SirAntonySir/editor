import { useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useSegmentSelection } from '@/store/segment-selection-slice';
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
  const hoveredId = useSegmentSelection((s) => s.hoveredSegmentId);
  const selectedId = useSegmentSelection((s) => s.selectedSegmentId);

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

      const fabricImage = f.getObjects().find(
        (o) => o instanceof fabric.FabricImage,
      ) as fabric.FabricImage | undefined;
      if (!fabricImage) return;

      const scaleX = fabricImage.scaleX ?? 1;
      const scaleY = fabricImage.scaleY ?? 1;
      const imgLeft = (fabricImage.left ?? 0) - ((fabricImage.width ?? 0) * scaleX) / 2;
      const imgTop = (fabricImage.top ?? 0) - ((fabricImage.height ?? 0) * scaleY) / 2;

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
        const cellW = scaleX;
        const cellH = scaleY;
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
