import { useEffect, useRef } from 'react';
import type { DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentMaskPreviewProps {
  mask: DecodedMask | null;
  widthPx: number;
  heightPx: number;
}

// Hardcoded accent. The preview is transient (lives <2 s) so a fixed tint
// is fine; reading getComputedStyle would couple this to theme propagation.
const TINT_R = 124;
const TINT_G = 58;
const TINT_B = 237;
const TINT_ALPHA = 110;
const DASH = 4;
const GAP = 3;
const ANTS_SPEED_PX_PER_FRAME = 0.25;

/** Build a Path2D tracing the boundary of the binary mask — every set pixel
 *  emits an edge segment on each side that borders an unset pixel. */
function buildOutline(mask: DecodedMask): Path2D {
  const path = new Path2D();
  const { data, width: w, height: h } = mask;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] !== 255) continue;
      const up = y > 0 && data[i - w] === 255;
      const dn = y < h - 1 && data[i + w] === 255;
      const lt = x > 0 && data[i - 1] === 255;
      const rt = x < w - 1 && data[i + 1] === 255;
      if (!up) { path.moveTo(x, y); path.lineTo(x + 1, y); }
      if (!dn) { path.moveTo(x, y + 1); path.lineTo(x + 1, y + 1); }
      if (!lt) { path.moveTo(x, y); path.lineTo(x, y + 1); }
      if (!rt) { path.moveTo(x + 1, y); path.lineTo(x + 1, y + 1); }
    }
  }
  return path;
}

/** Pre-paint the translucent fill into an offscreen canvas so each animation
 *  frame just drawImages it instead of re-walking the mask buffer. */
function buildFillBitmap(mask: DecodedMask): HTMLCanvasElement | null {
  const off = document.createElement('canvas');
  off.width = mask.width;
  off.height = mask.height;
  const ctx = off.getContext('2d');
  if (!ctx) return null;
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
  return off;
}

export function SegmentMaskPreview({ mask, widthPx, heightPx }: SegmentMaskPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!mask) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fill = buildFillBitmap(mask);
    const path = buildOutline(mask);
    let offset = 0;
    let raf = 0;

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (fill) ctx.drawImage(fill, 0, 0);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([DASH, GAP]);
      // White ants moving forward.
      ctx.strokeStyle = '#ffffff';
      ctx.lineDashOffset = -offset;
      ctx.stroke(path);
      // Black ants interleaved (offset by half-period) for contrast on any background.
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineDashOffset = -offset + DASH;
      ctx.stroke(path);
      offset = (offset + ANTS_SPEED_PX_PER_FRAME) % (DASH + GAP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
