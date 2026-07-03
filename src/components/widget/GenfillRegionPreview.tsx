import { useEffect, useMemo, useRef, useState } from 'react';
import type { Widget } from '@/types/widget';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { computeMaskBbox } from '@/lib/mask-bbox';
import { genfillNodeDims } from '@/store/genfill-actions';
import { genfillAssetUrl } from '@/lib/genfill-asset';

interface GenfillRegionPreviewProps {
  widget: Widget;
  sessionId: string;
}

/** Padding around the mask bbox, in SOURCE pixels, so the comparison shows a
 *  sliver of untouched context around the filled region. */
const PAD_SRC_PX = 16;

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop geometry: the mask bbox mapped from mask-space into source-image
 *  pixels, padded and clamped. Null when the mask or source is unavailable. */
function cropRectFor(
  maskId: string,
  imageNodeId: string,
): { rect: CropRect; srcDims: { width: number; height: number } } | null {
  const mask = maskStore.get(maskId);
  const srcDims = genfillNodeDims(imageNodeId);
  if (!mask || !srcDims) return null;
  const bbox = computeMaskBbox(mask.data, mask.width, mask.height);
  if (!bbox) return null;
  const kx = srcDims.width / mask.width;
  const ky = srcDims.height / mask.height;
  const x = Math.max(0, Math.floor(bbox.minX * kx) - PAD_SRC_PX);
  const y = Math.max(0, Math.floor(bbox.minY * ky) - PAD_SRC_PX);
  const w = Math.min(srcDims.width - x, Math.ceil((bbox.maxX - bbox.minX + 1) * kx) + 2 * PAD_SRC_PX);
  const h = Math.min(srcDims.height - y, Math.ceil((bbox.maxY - bbox.minY + 1) * ky) + 2 * PAD_SRC_PX);
  if (w <= 0 || h <= 0) return null;
  return { rect: { x, y, w, h }, srcDims };
}

/** Before/after comparison of ONLY the masked region, rendered at the same
 *  on-canvas scale as the source image node (display px per source px), so
 *  the preview reads as a magnifier over the exact spot being filled. */
export function GenfillRegionPreview({ widget, sessionId }: GenfillRegionPreviewProps) {
  const g = widget.genfill;
  const [mode, setMode] = useState<'before' | 'after'>('after');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Subscribe to the node so display-size changes rescale the preview live.
  const node = useEditorStore((s) => (g ? s.imageNodes[g.imageNodeId] : undefined));

  const geometry = useMemo(
    () => (g ? cropRectFor(g.maskId, g.imageNodeId) : null),
    [g],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const result = g?.result;
    if (!canvas || !g || !geometry || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / headless — geometry still testable
    const { rect, srcDims } = geometry;
    let cancelled = false;

    const drawBefore = () => {
      const editor = useEditorStore.getState();
      const layerId = editor.imageNodes[g.imageNodeId]?.layerIds.find(
        (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
      );
      const src = layerId ? pixelStore.get(layerId) : null;
      if (!src) return;
      ctx.clearRect(0, 0, rect.w, rect.h);
      ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    };

    const drawAfter = async () => {
      try {
        const resp = await fetch(genfillAssetUrl(sessionId, result.assetId));
        if (!resp.ok || cancelled) return;
        const bitmap = await createImageBitmap(await resp.blob());
        if (cancelled) { bitmap.close(); return; }
        // The result is the same framing at (usually) a capped resolution —
        // map the source-space crop into result pixels.
        const r = bitmap.width / srcDims.width;
        ctx.clearRect(0, 0, rect.w, rect.h);
        ctx.drawImage(
          bitmap,
          rect.x * r, rect.y * r, rect.w * r, rect.h * r,
          0, 0, rect.w, rect.h,
        );
        bitmap.close();
      } catch (err) {
        // Asset fetch/decode failure leaves the last-drawn frame in place —
        // the widget's error surface, not the preview, reports hard failures.
        console.warn('[genfill] region preview draw failed:', err);
      }
    };

    if (mode === 'before') drawBefore();
    else void drawAfter();
    return () => { cancelled = true; };
  }, [g, geometry, mode, sessionId]);

  if (!g || !geometry) return null;
  // Same scale as the image node on canvas: display px per source px.
  const displayScale = node ? node.size.w / node.sourceSize.w : 1;
  const cssW = geometry.rect.w * displayScale;
  const cssH = geometry.rect.h * displayScale;

  return (
    <div data-testid="genfill-region-preview" className="flex flex-col gap-1">
      <div className="inline-flex self-start items-center rounded-[3px] bg-surface-secondary p-px text-[10px]">
        <button
          type="button"
          aria-pressed={mode === 'before'}
          onClick={() => setMode('before')}
          className={`px-1.5 py-px rounded-[3px] transition-colors leading-tight ${
            mode === 'before' ? 'bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Before
        </button>
        <button
          type="button"
          aria-pressed={mode === 'after'}
          onClick={() => setMode('after')}
          className={`px-1.5 py-px rounded-[3px] transition-colors leading-tight ${
            mode === 'after' ? 'bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          After
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={geometry.rect.w}
        height={geometry.rect.h}
        style={{ width: `${cssW}px`, height: `${cssH}px` }}
        className="rounded-[3px] border border-separator"
      />
    </div>
  );
}
