import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import { activeCanvasBus } from '@/lib/active-canvas-bus';

type DrawSource = CanvasImageSource & { width: number; height: number };

/**
 * Thumbnail of one layer, cover-cropped into a box. The active (edit-target)
 * layer gets an inset accent ring; others a hairline ring.
 *
 * When `imageNodeId` is given it LIVE-updates from that node's composite canvas
 * (adjustments baked) via `activeCanvasBus`, so edits show immediately — for a
 * single-layer node the composite is exactly this layer; multi-layer nodes show
 * the node composite. Otherwise it falls back to the raw source pixels and
 * redraws on `pixelVersion`.
 *
 * Cross-domain primitive (workspace LayerStrip + inspector LayerRow) → `ui/`.
 */
export function LayerThumb({
  layerId,
  active,
  imageNodeId,
  width = 52,
  height = 40,
}: {
  layerId: string;
  active: boolean;
  /** Live-update from this node's composite when provided. */
  imageNodeId?: string;
  /** Display size in CSS px. Backing canvas renders at 2× for retina. */
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);

  // Cover-crop any source canvas/bitmap into the thumb canvas.
  const draw = useCallback((src: DrawSource) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !src.width || !src.height) return;
    const ow = canvas.width;
    const oh = canvas.height;
    const scale = Math.max(ow / src.width, oh / src.height);
    const cropW = ow / scale;
    const cropH = oh / scale;
    ctx.clearRect(0, 0, ow, oh);
    ctx.drawImage(src, (src.width - cropW) / 2, (src.height - cropH) / 2, cropW, cropH, 0, 0, ow, oh);
    setDrawn(true);
  }, []);

  // Initial / fallback: the layer's raw source pixels (covers pre-first-render).
  useEffect(() => {
    setDrawn(false);
    const source = pixelStore.getSource(layerId);
    if (source) draw(source as unknown as DrawSource);
  }, [layerId, pixelVersion, draw]);

  // Live: redraw from the node's composite whenever that node re-renders.
  useEffect(() => {
    if (!imageNodeId) return;
    return activeCanvasBus.subscribe((nodeId, canvas) => {
      if (nodeId === imageNodeId) draw(canvas);
    });
  }, [imageNodeId, draw]);

  return (
    <span
      className={`relative flex flex-none items-center justify-center overflow-hidden rounded-[3px]
        bg-surface-secondary transition-shadow ${
          active
            ? 'ring-2 ring-inset ring-[var(--color-accent)]'
            : 'ring-1 ring-inset ring-[color-mix(in_srgb,var(--color-text-primary)_22%,transparent)]'
        }`}
      style={{ width, height }}
    >
      <canvas
        ref={canvasRef}
        width={width * 2}
        height={height * 2}
        className={`w-full h-full ${drawn ? 'opacity-100' : 'opacity-0'} transition-opacity`}
        aria-hidden
      />
      {!drawn && <ImageIcon size={14} className="absolute text-text-secondary opacity-60" aria-hidden />}
    </span>
  );
}
