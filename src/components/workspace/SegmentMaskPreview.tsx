import { useEffect, useMemo, useRef } from 'react';
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

/** Walk the binary mask edges and stroke them in two passes (dark halo +
 *  white dashes) for contrast on any background. Animated marching ants on
 *  a pixelated boundary read as flicker (every dash jumps at every stair-
 *  step), so the outline is static — matches the existing committed-mask
 *  treatment from `lib/overlay-painters.ts`. */
function paintMask(mask: DecodedMask, ctx: CanvasRenderingContext2D): void {
  // Translucent fill.
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

  // Outline: trace cells that border an unset pixel.
  const { data, width: w, height: h } = mask;
  ctx.beginPath();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] !== 255) continue;
      const up = y > 0 && data[i - w] === 255;
      const dn = y < h - 1 && data[i + w] === 255;
      const lt = x > 0 && data[i - 1] === 255;
      const rt = x < w - 1 && data[i + 1] === 255;
      if (!up) { ctx.moveTo(x, y); ctx.lineTo(x + 1, y); }
      if (!dn) { ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y + 1); }
      if (!lt) { ctx.moveTo(x, y); ctx.lineTo(x, y + 1); }
      if (!rt) { ctx.moveTo(x + 1, y); ctx.lineTo(x + 1, y + 1); }
    }
  }
  // Dark soft halo.
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(0,0,0,0.40)';
  ctx.stroke();
  // White dashed top.
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

/** Build a white-on-transparent alpha image of the mask, as a data URL — used
 *  as a CSS `mask-image` so an animated shimmer layer is clipped to the segment
 *  shape. Regenerated only when the mask changes. */
function maskToAlphaUrl(mask: DecodedMask): string | null {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const cx = c.getContext('2d');
  if (!cx) return null;
  const img = cx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const j = i * 4;
    img.data[j] = 255;
    img.data[j + 1] = 255;
    img.data[j + 2] = 255;
    img.data[j + 3] = mask.data[i] === 255 ? 255 : 0;
  }
  cx.putImageData(img, 0, 0);
  return c.toDataURL();
}

export function SegmentMaskPreview({ mask, widthPx, heightPx }: SegmentMaskPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!mask) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintMask(mask, ctx);
  }, [mask]);

  const maskUrl = useMemo(() => (mask ? maskToAlphaUrl(mask) : null), [mask]);

  if (!mask) return null;
  return (
    <>
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
      {/* AI shimmer: a soft violet band drifts across the segment, clipped to
          its shape via the mask alpha. Purely additive over the static fill. */}
      {maskUrl && (
        <div
          aria-hidden
          className="segment-shimmer pointer-events-none absolute inset-0"
          style={{
            width: `${widthPx}px`,
            height: `${heightPx}px`,
            WebkitMaskImage: `url(${maskUrl})`,
            maskImage: `url(${maskUrl})`,
            WebkitMaskSize: '100% 100%',
            maskSize: '100% 100%',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
          }}
        />
      )}
    </>
  );
}
