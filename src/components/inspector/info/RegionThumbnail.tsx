import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';

interface RegionThumbnailProps {
  /** Normalised [x, y, w, h] in [0, 1] coords (top-left origin). */
  bbox?: [number, number, number, number] | null;
  /** Fallback initial drawn when bbox is missing or source canvas isn't ready. */
  fallback: string;
  size?: number;
}

/**
 * Renders a small crop of the active image node's source canvas, masked to a
 * region's `bbox`. Falls back to an initial-on-surface tile when the bbox or
 * source isn't available. Redraws when the bbox or source pair changes.
 */
export function RegionThumbnail({ bbox, fallback, size = 36 }: RegionThumbnailProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Selecting the activeImageNodeId keeps the thumbnail in sync with whichever
  // image the inspector is bound to. The layer id is derived inside the effect
  // so we don't subscribe to layer churn.
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // Fill with surface-secondary so the cropped image sits on a tile that
    // matches the inspector aesthetic when the source isn't ready yet.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.fillRect(0, 0, size, size);

    if (!bbox || !activeImageNodeId) return;
    const imgNode = useEditorStore.getState().imageNodes[activeImageNodeId];
    const layerId = imgNode?.layerIds[0];
    if (!layerId) return;
    const source = pixelStore.getSource(layerId);
    if (!source) return;

    const [bx, by, bw, bh] = bbox;
    const sx = Math.max(0, bx * source.width);
    const sy = Math.max(0, by * source.height);
    const sw = Math.max(1, Math.min(source.width - sx, bw * source.width));
    const sh = Math.max(1, Math.min(source.height - sy, bh * source.height));

    // Fit-cover: pick the larger scale so the crop fills the square thumb.
    const scale = Math.max(size / sw, size / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  }, [bbox, activeImageNodeId, size]);

  return (
    <div className="relative shrink-0">
      <canvas
        ref={ref}
        style={{ width: size, height: size }}
        className="rounded-[3px] bg-surface-secondary"
        aria-hidden
      />
      {/* Fallback initial sits behind the canvas tile; visible only when the
          canvas hasn't painted (bbox missing or source not yet registered). */}
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-medium text-text-secondary -z-10"
      >
        {fallback}
      </span>
    </div>
  );
}
