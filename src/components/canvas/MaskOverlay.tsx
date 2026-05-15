import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';

interface MaskOverlayProps {
  canvasWidth: number;
  canvasHeight: number;
}

export function MaskOverlay({ canvasWidth, canvasHeight }: MaskOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useEditorStore((s) => s.activeMaskRef);
  const committedRef = useEditorStore((s) => s.committedMaskRef);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);
  const ref = activeRef ?? committedRef;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!ref) return;
    const mask = maskStore.get(ref);
    if (!mask) return;

    // Render mask as a translucent magenta fill onto an offscreen canvas at
    // the mask's native resolution, then scale-draw onto the visible overlay.
    const off = document.createElement('canvas');
    off.width = mask.width;
    off.height = mask.height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const img = offCtx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const a = mask.data[i];
      img.data[i * 4] = 255;        // R — magenta
      img.data[i * 4 + 1] = 64;     // G
      img.data[i * 4 + 2] = 200;    // B
      img.data[i * 4 + 3] = a * 0.4;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, c.width, c.height);
  }, [ref, pixelVersion, canvasWidth, canvasHeight]);

  if (!ref) return null;

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 9 }}
    />
  );
}
