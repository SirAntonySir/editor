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
 * For a single-layer node the node composite IS this layer, so when
 * `imageNodeId` is given it LIVE-updates from that node's composite canvas
 * (adjustments baked) via `activeCanvasBus`, so edits show immediately. For a
 * multi-layer node the composite blends every layer and is NOT this layer, so
 * it draws the layer's own raw source pixels (redrawn on `pixelVersion`).
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
  // The node composite blends ALL of the node's layers, so it equals this
  // layer's pixels only when the node holds a single layer. For multi-layer
  // nodes the composite is NOT this layer — draw the layer's own source pixels
  // instead, otherwise every thumbnail shows the same full-image composite.
  const nodeIsSingleLayer = useEditorStore((s) =>
    imageNodeId ? (s.imageNodes[imageNodeId]?.layerIds.length ?? 1) <= 1 : false,
  );

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

  // The layer's raw source pixels. This is the authority for multi-layer nodes
  // (where the composite isn't this layer) and the pre-first-render fallback
  // for single-layer nodes. Re-runs on `nodeIsSingleLayer` so crossing the
  // single↔multi boundary (e.g. Extract to Layer) redraws from source.
  useEffect(() => {
    setDrawn(false);
    const source = pixelStore.getSource(layerId);
    if (source) draw(source as unknown as DrawSource);
  }, [layerId, pixelVersion, draw, nodeIsSingleLayer]);

  // Live: redraw from the node's composite whenever that node re-renders — but
  // ONLY for a single-layer node, where the composite equals this layer (so
  // adjustments show live). Multi-layer nodes stay on the source draw above.
  useEffect(() => {
    if (!imageNodeId || !nodeIsSingleLayer) return;
    return activeCanvasBus.subscribe((nodeId, canvas) => {
      if (nodeId === imageNodeId) draw(canvas);
    });
  }, [imageNodeId, nodeIsSingleLayer, draw]);

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
