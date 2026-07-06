import { useEffect, useMemo, useRef } from 'react';
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

/** Absolute cap on the preview canvas backing (longest edge, px). A safety net
 *  so a source image node shown near 1:1 — or a large generated result — can't
 *  balloon the canvas (and, via the widget's max-content sizing, the whole
 *  widget) to full resolution. The image-node flow scale below does the real
 *  scaling; this just bounds the worst case. */
const MAX_PREVIEW_BACKING_PX = 384;

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
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);

  const geometry = useMemo(
    () => (g ? cropRectFor(g.maskId, g.imageNodeId) : null),
    [g],
  );

  // Scale the preview to the SAME flow scale as its source image node (display
  // px per source px), so the crop reads as a 1:1 magnifier and — crucially —
  // the canvas backing tracks the on-canvas size instead of the full generated
  // resolution (which used to blow the widget up, since WidgetNode sizes the
  // shell to `max-content`). Clamped to ≤ 1 (never upscale).
  const nodeScale = useEditorStore((s) => {
    const n = g ? s.imageNodes[g.imageNodeId] : undefined;
    return n && n.sourceSize.w > 0 ? Math.min(1, n.size.w / n.sourceSize.w) : 1;
  });

  // Backing-store dims: source-crop pixels down-scaled by the node's flow scale,
  // then bounded by the absolute cap. The `drawImage` calls already downsample
  // into this, so a smaller canvas just yields a smaller (crisp) preview.
  const backing = useMemo(() => {
    if (!geometry) return { w: 1, h: 1 };
    const { w, h } = geometry.rect;
    const scale = Math.min(nodeScale, MAX_PREVIEW_BACKING_PX / Math.max(w, h), 1);
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }, [geometry, nodeScale]);

  useEffect(() => {
    const result = g?.result;
    if (!g || !geometry || !result) return;
    const { rect, srcDims } = geometry;
    let cancelled = false;

    // BEFORE — the source crop (sync). jsdom returns a null ctx, so drawing is
    // skipped there; the two canvases still render for the geometry tests.
    const bctx = beforeRef.current?.getContext('2d') ?? null;
    if (bctx) {
      const editor = useEditorStore.getState();
      const layerId = editor.imageNodes[g.imageNodeId]?.layerIds.find(
        (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
      );
      const src = layerId ? pixelStore.get(layerId) : null;
      if (src) {
        bctx.clearRect(0, 0, backing.w, backing.h);
        bctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, backing.w, backing.h);
      }
    }

    // AFTER — the generated result crop (async fetch + decode).
    const actx = afterRef.current?.getContext('2d') ?? null;
    if (actx) {
      void (async () => {
        try {
          const resp = await fetch(genfillAssetUrl(sessionId, result.assetId));
          if (!resp.ok || cancelled) return;
          const bitmap = await createImageBitmap(await resp.blob());
          if (cancelled) { bitmap.close(); return; }
          // The result is the same framing at (usually) a capped resolution —
          // map the source-space crop into result pixels.
          const r = bitmap.width / srcDims.width;
          actx.clearRect(0, 0, backing.w, backing.h);
          actx.drawImage(
            bitmap,
            rect.x * r, rect.y * r, rect.w * r, rect.h * r,
            0, 0, backing.w, backing.h,
          );
          bitmap.close();
        } catch (err) {
          // Asset fetch/decode failure leaves the last-drawn frame in place —
          // the widget's error surface, not the preview, reports hard failures.
          console.warn('[genfill] region preview draw failed:', err);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [g, geometry, backing, sessionId]);

  if (!g || !geometry) return null;
  // Split the content width: each preview is flex-1 and keeps the crop's aspect
  // ratio via CSS, so the two sit side by side and scale to fit their half.
  const aspect = geometry.rect.w / geometry.rect.h;

  return (
    <div data-testid="genfill-region-preview" className="flex gap-1.5">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-[var(--font-mono)] text-[9px] tracking-[0.14em] uppercase text-text-secondary">
          Before
        </span>
        <canvas
          ref={beforeRef}
          width={backing.w}
          height={backing.h}
          style={{ width: '100%', aspectRatio: `${aspect}` }}
          className="rounded-[3px] border border-separator"
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-[var(--font-mono)] text-[9px] tracking-[0.14em] uppercase text-text-secondary">
          After
        </span>
        <canvas
          ref={afterRef}
          width={backing.w}
          height={backing.h}
          style={{ width: '100%', aspectRatio: `${aspect}` }}
          className="rounded-[3px] border border-separator"
        />
      </div>
    </div>
  );
}
