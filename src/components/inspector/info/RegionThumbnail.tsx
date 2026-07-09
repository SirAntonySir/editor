import { useEffect, useRef } from 'react';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { maskStore } from '@/core/mask-store';

interface RegionThumbnailProps {
  /** Normalised [x, y, w, h] in [0, 1] coords (top-left origin). */
  bbox?: [number, number, number, number] | null;
  /** SAM mask ref for the region (maskStore id). When present, the thumbnail
   *  shows the MASKED cutout — the element itself — instead of the raw
   *  rectangular crop. */
  maskRef?: string | null;
  /** Fallback initial drawn when bbox is missing or source canvas isn't ready. */
  fallback: string;
  size?: number;
}

/**
 * Renders a small crop of the active image node's source canvas for a
 * region. When the region's SAM mask is registered (`maskRef`), the crop is
 * alpha-masked to the element's actual silhouette — a person thumb shows the
 * person, not the wall behind them. Falls back to the plain bbox crop when
 * no mask exists, and to an initial-on-surface tile when nothing is ready.
 */
export function RegionThumbnail({ bbox, maskRef, fallback, size = 36 }: RegionThumbnailProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Resolve the layer the thumbnail should crop from. Priority:
  //   1. the currently-selected ImageNode (if the user clicked one on canvas)
  //   2. the first ImageNode in the workspace (so thumbs paint even when
  //      nothing is selected — the Info tab is about THE image, not a
  //      selection)
  //   3. the active editor layer (covers the moment between image open and
  //      the auto-spawned ImageNode landing in the workspace state)
  // Subscribing to the resolved id means thumbnails repaint when the user
  // selects a different image or swaps the active layer, without churning
  // when other store fields change.
  const layerId = useEditorStore((s) => {
    if (s.activeImageNodeId) {
      const n = s.imageNodes[s.activeImageNodeId];
      if (n?.layerIds[0]) return n.layerIds[0];
    }
    const firstNode = Object.values(s.imageNodes)[0];
    if (firstNode?.layerIds[0]) return firstNode.layerIds[0];
    return s.activeLayerId;
  });

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

    if (!bbox || !layerId) return;
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

    const mask = maskRef ? maskStore.get(maskRef) : undefined;
    if (!mask) {
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }

    // Masked cutout: draw the crop on a scratch tile, punch it with the
    // mask's matching crop via destination-in, then place the cutout over
    // the neutral tile so the silhouette reads against the surface.
    const tile = document.createElement('canvas');
    tile.width = Math.round(size * dpr);
    tile.height = Math.round(size * dpr);
    const tctx = tile.getContext('2d');
    if (!tctx) {
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    tctx.scale(dpr, dpr);
    tctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);

    // The mask may be a different resolution than the source — map the bbox
    // into mask space, expand to an RGBA alpha canvas, and crop the same way.
    const alpha = document.createElement('canvas');
    alpha.width = mask.width;
    alpha.height = mask.height;
    const actx = alpha.getContext('2d');
    if (actx) {
      const img = actx.createImageData(mask.width, mask.height);
      for (let i = 0; i < mask.data.length; i++) {
        img.data[i * 4 + 3] = mask.data[i];
      }
      actx.putImageData(img, 0, 0);
      const mx = Math.max(0, bx * mask.width);
      const my = Math.max(0, by * mask.height);
      const mw = Math.max(1, Math.min(mask.width - mx, bw * mask.width));
      const mh = Math.max(1, Math.min(mask.height - my, bh * mask.height));
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(alpha, mx, my, mw, mh, dx, dy, dw, dh);
      tctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(tile, 0, 0, tile.width, tile.height, 0, 0, size, size);
  }, [bbox, maskRef, layerId, size]);

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
