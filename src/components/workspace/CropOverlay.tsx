import { useState } from 'react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

interface CropOverlayProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

interface CropRect { x: number; y: number; w: number; h: number; }

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
];

function applyCornerDelta(
  start: CropRect, corner: 'tl' | 'tr' | 'bl' | 'br',
  dx: number, dy: number, maxW: number, maxH: number,
): CropRect {
  let { x, y, w, h } = start;
  if (corner === 'tl') { x += dx; y += dy; w -= dx; h -= dy; }
  if (corner === 'tr') { y += dy; w += dx; h -= dy; }
  if (corner === 'bl') { x += dx; w -= dx; h += dy; }
  if (corner === 'br') { w += dx; h += dy; }
  x = Math.max(0, Math.min(x, maxW - 1));
  y = Math.max(0, Math.min(y, maxH - 1));
  w = Math.max(1, Math.min(w, maxW - x));
  h = Math.max(1, Math.min(h, maxH - y));
  return { x, y, w, h };
}

export function CropOverlay({ imageNodeId, layerIds, width, height }: CropOverlayProps) {
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: width, h: height });
  const [aspect, setAspect] = useState<number | null>(null);
  const [angle, setAngle] = useState(0);

  function handleAspect(ratio: number | null) {
    setAspect(ratio);
    if (ratio === null) return;
    const newH = Math.round(crop.w / ratio);
    setCrop({ ...crop, h: Math.min(newH, height - crop.y) });
  }

  function handleApply() {
    const sessionId = useBackendState.getState().sessionId;
    if (!sessionId) return;
    void backendTools.set_image_node_transform(sessionId, {
      image_node_id: imageNodeId,
      layer_ids: layerIds,
      crop,
      rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
    });
    useEditorStore.getState().setCropModal(null);
  }

  function handleCancel() {
    useEditorStore.getState().setCropModal(null);
  }

  function startDrag(e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = crop;
    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setCrop(applyCornerDelta(start, corner, dx, dy, width, height));
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div className="absolute inset-0 pointer-events-none" data-testid="crop-overlay">
      <div
        data-testid="crop-mask"
        className="absolute pointer-events-none border border-accent"
        style={{
          left: crop.x, top: crop.y, width: crop.w, height: crop.h,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          ['--crop-w' as string]: String(crop.w),
          ['--crop-h' as string]: String(crop.h),
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <div
            key={corner}
            data-handle={corner}
            className="absolute w-2.5 h-2.5 bg-surface border-[1.5px] border-accent pointer-events-auto cursor-nwse-resize"
            style={{
              left:   corner.endsWith('l') ? -5 : undefined,
              right:  corner.endsWith('r') ? -5 : undefined,
              top:    corner.startsWith('t') ? -5 : undefined,
              bottom: corner.startsWith('b') ? -5 : undefined,
            }}
            onPointerDown={(e) => startDrag(e, corner)}
          />
        ))}
      </div>
      <div className="overlay absolute left-1/2 -top-10 -translate-x-1/2 px-2 py-1 flex items-center gap-1 pointer-events-auto text-[10px]">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => handleAspect(a.ratio)}
            className={`px-1.5 py-0.5 rounded-[3px] ${aspect === a.ratio ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'}`}
          >
            {a.label}
          </button>
        ))}
        <span className="w-px h-3 bg-separator mx-1" />
        <label className="flex items-center gap-1 text-text-secondary">
          Straighten
          <input
            type="range"
            min={-45}
            max={45}
            step={0.1}
            value={angle}
            onChange={(e) => setAngle(parseFloat(e.target.value))}
            className="w-20"
          />
          <span className="num w-8 text-right">{angle.toFixed(1)}°</span>
        </label>
        <span className="w-px h-3 bg-separator mx-1" />
        <button
          type="button"
          onClick={handleApply}
          className="px-2 py-0.5 rounded-[3px] bg-accent text-white"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="px-2 py-0.5 rounded-[3px] bg-surface-secondary text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
