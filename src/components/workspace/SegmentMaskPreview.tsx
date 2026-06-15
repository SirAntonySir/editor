import { useEffect, useRef } from 'react';
import type { DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentMaskPreviewProps {
  mask: DecodedMask | null;
  widthPx: number;
  heightPx: number;
}

// Hardcoded accent — getComputedStyle would require theme propagation and re-paint
// on every theme switch. The preview is transient (lives <2 s) so a fixed tint is fine.
const TINT_R = 124;
const TINT_G = 58;
const TINT_B = 237;
const TINT_ALPHA = 115;

export function SegmentMaskPreview({ mask, widthPx, heightPx }: SegmentMaskPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!mask) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const on = mask.data[i] === 255;
      const j = i * 4;
      img.data[j] = TINT_R;
      img.data[j + 1] = TINT_G;
      img.data[j + 2] = TINT_B;
      img.data[j + 3] = on ? TINT_ALPHA : 0;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask]);

  if (!mask) return null;
  return (
    <canvas
      ref={canvasRef}
      width={mask.width}
      height={mask.height}
      className="pointer-events-none absolute inset-0"
      style={{
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        imageRendering: 'pixelated',
      }}
      aria-hidden
    />
  );
}
