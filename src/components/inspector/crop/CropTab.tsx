import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { backendTools } from '@/lib/backend-tools';
import { usePreferencesStore } from '@/store/preferences-store';
import { CropPreview, type CropRect } from './CropPreview';
import { largestInsetRect } from '@/lib/largest-inset-rect';

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
];
const PREVIEW_MAX_WIDTH = 240;

export function CropTab() {
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const imageNodes = useEditorStore((s) => s.imageNodes);

  const snapshotCropX = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.x ?? 0) : null;
  });
  const snapshotCropY = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.y ?? 0) : null;
  });
  const snapshotCropW = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.w ?? null;
  });
  const snapshotCropH = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.h ?? null;
  });
  const snapshotCrop: CropRect | null =
    snapshotCropW != null && snapshotCropH != null
      ? { x: snapshotCropX ?? 0, y: snapshotCropY ?? 0, w: snapshotCropW, h: snapshotCropH }
      : null;
  const snapshotAngle = useBackendState((s) => {
    if (!activeImageNodeId) return 0;
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:rotate`,
    );
    if (!node) return 0;
    return (node.params.angle as number) ?? 0;
  });

  const imageNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
  const sw = imageNode?.size.w ?? 0;
  const sh = imageNode?.size.h ?? 0;

  const initialCrop: CropRect = snapshotCrop ?? { x: 0, y: 0, w: sw, h: sh };
  const [crop, setCrop] = useState<CropRect>(initialCrop);
  const [aspect, setAspect] = useState<number | null>(null);
  const [angle, setAngle] = useState(snapshotAngle);

  // Ref-based guard: skip the very first run of the auto-fit effect so we
  // don't disturb a saved crop when the user opens the Crop tab.
  const autoFitRanOnce = useRef(false);

  // Reset the guard whenever the active image-node changes so a fresh image
  // also gets its first render skipped (the re-seed effect below handles it).
  useEffect(() => {
    autoFitRanOnce.current = false;
  }, [activeImageNodeId]);

  // Auto-fit crop to the largest aspect-correct rect that fits inside the
  // rotated source. Triggers whenever angle or aspect changes (NOT on free
  // drag — that branch is gated by aspect ratio being null below).
  useEffect(() => {
    if (!autoFitRanOnce.current) {
      autoFitRanOnce.current = true;
      return;
    }
    if (!imageNode) return;
    if (sw === 0 || sh === 0) return;
    const ratio = aspect ?? crop.w / crop.h;
    if (!isFinite(ratio) || ratio <= 0) return;
    const max = largestInsetRect(sw, sh, angle, ratio);
    setCrop({
      x: (sw - max.w) / 2,
      y: (sh - max.h) / 2,
      w: max.w,
      h: max.h,
    });
    // Intentional: depend on angle + aspect only. Including `crop` would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle, aspect, sw, sh, imageNode?.id]);

  // Re-seed local state whenever the active image-node changes.
  useEffect(() => {
    setCrop(snapshotCrop ?? { x: 0, y: 0, w: sw, h: sh });
    setAngle(snapshotAngle);
    setAspect(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageNodeId, sw, sh, snapshotCropX, snapshotCropY, snapshotCropW, snapshotCropH, snapshotAngle]);

  useEffect(() => {
    useEditorStore.getState().setCropPreview({
      crop,
      rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
    });
    return () => { useEditorStore.getState().setCropPreview(null); };
  }, [crop, angle]);

  function handleApply() {
    if (!imageNode) return;
    const sessionId = useBackendState.getState().sessionId;
    if (!sessionId) return;
    void backendTools.set_image_node_transform(sessionId, {
      image_node_id: imageNode.id,
      layer_ids: imageNode.layerIds,
      crop,
      rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
    });
    useEditorStore.getState().setCropPreview(null);
    usePreferencesStore.setState({ inspectorTab: 'adjustments' });
  }

  function handleCancel() {
    useEditorStore.getState().setCropPreview(null);
    usePreferencesStore.setState({ inspectorTab: 'adjustments' });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (usePreferencesStore.getState().inspectorTab !== 'crop') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop, angle, imageNode?.id, imageNode?.layerIds]);

  const source = imageNode ? CanvasRegistry.get(imageNode.layerIds[0] ?? '') : undefined;

  if (!imageNode || !source || sw === 0 || sh === 0) {
    return <div data-testid="crop-tab" className="p-3 text-[11px] text-text-secondary">Select an image to crop.</div>;
  }

  const previewWidth = Math.min(PREVIEW_MAX_WIDTH, sw);
  const previewHeight = Math.round((previewWidth / sw) * sh);
  const aspectLabel = aspect == null ? 'Free' : aspect === 1 ? '1:1' : aspect === 1.5 ? '3:2' : aspect === 16 / 9 ? '16:9' : 'Original';

  return (
    <div data-testid="crop-tab" className="p-3 flex flex-col gap-2 text-[11px]">
      <CropPreview
        sourceBitmap={source}
        crop={crop}
        aspectRatio={aspect}
        previewWidth={previewWidth}
        previewHeight={previewHeight}
        onCropChange={setCrop}
      />
      <div className="flex gap-1">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-pressed={aspect === a.ratio}
            onClick={() => setAspect(a.ratio)}
            className={`px-1.5 py-0.5 rounded-[3px] ${
              aspect === a.ratio ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={aspect === sw / sh}
          onClick={() => setAspect(sw / sh)}
          className={`px-1.5 py-0.5 rounded-[3px] ${
            aspect === sw / sh ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'
          }`}
        >
          Original
        </button>
      </div>
      <label className="flex items-center gap-1 text-text-secondary">
        Straighten
        <input
          type="range"
          aria-label="Straighten"
          min={-45}
          max={45}
          step={0.1}
          value={angle}
          onChange={(e) => setAngle(parseFloat(e.target.value))}
          className="flex-1"
        />
        <span className="num w-10 text-right">{angle.toFixed(1)}°</span>
      </label>
      <div data-testid="crop-readout" className="text-text-secondary">
        {sw} × {sh} → {Math.round(crop.w)} × {Math.round(crop.h)} ({aspectLabel})
      </div>
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          onClick={handleApply}
          className="flex-1 px-2 py-0.5 rounded-[3px] bg-accent text-white"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="flex-1 px-2 py-0.5 rounded-[3px] bg-surface-secondary text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
