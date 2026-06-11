import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { backendTools } from '@/lib/backend-tools';
import { usePreferencesStore } from '@/store/preferences-store';
import { CropPreview, type CropRect } from './CropPreview';
import { largestInsetRect } from '@/lib/largest-inset-rect';
import { StraightenRuler } from './StraightenRuler';

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
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.x ?? 0) : null;
  });
  const snapshotCropY = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.w != null && p.h != null ? (p.y ?? 0) : null;
  });
  const snapshotCropW = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:crop`,
    );
    if (!node) return null;
    const p = node.params as { x?: number; y?: number; w?: number; h?: number };
    return p.w ?? null;
  });
  const snapshotCropH = useBackendState((s) => {
    if (!activeImageNodeId) return null;
    const node = s.snapshot?.operationGraph.nodes.find(
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
    const node = s.snapshot?.operationGraph.nodes.find(
      (n) => n.id === `transform:${activeImageNodeId}:rotate`,
    );
    if (!node) return 0;
    return (node.params.angle as number) ?? 0;
  });

  const imageNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
  // Crop geometry is expressed in *source pixel* coordinates. After the
  // figma-scaling split, `size` is the canvas-space display box (e.g. 600px
  // wide for a 6000px photo) and `sourceSize` is the natural bitmap. Reading
  // `size` here would clamp the crop rect to the display box.
  const sw = imageNode?.sourceSize.w ?? 0;
  const sh = imageNode?.sourceSize.h ?? 0;

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
    const θ = Math.abs(angle) * Math.PI / 180;
    const absCos = Math.abs(Math.cos(θ));
    const absSin = Math.abs(Math.sin(θ));
    const bbW = sw * absCos + sh * absSin;
    const bbH = sw * absSin + sh * absCos;
    const max = largestInsetRect(sw, sh, angle, ratio);
    setCrop({
      x: (bbW - max.w) / 2,
      y: (bbH - max.h) / 2,
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

  async function handleApply() {
    if (!imageNode) return;
    const sessionId = useBackendState.getState().sessionId;
    if (!sessionId) return;
    const startRev = useBackendState.getState().snapshot?.revision ?? 0;

    await backendTools.set_image_node_transform(sessionId, {
      imageNodeId: imageNode.id,
      layerIds: imageNode.layerIds,
      crop,
      rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
    });

    // Wait (max 2s) for the SSE event to bring the new crop node into the
    // snapshot. Without this hold, clearing cropPreview here would briefly leave
    // the renderer with neither preview nor snapshot crop, flashing the
    // uncropped image.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 2000);
      const unsubscribe = useBackendState.subscribe((s, prev) => {
        const newer = (s.snapshot?.revision ?? 0) > startRev;
        if (newer) {
          unsubscribe();
          clearTimeout(timeout);
          resolve();
        }
        // Touch prev so the unused-var lint stays happy.
        void prev;
      });
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
        void handleApply();
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
    <div data-testid="crop-tab" className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3 text-[11px]">
      <div className="flex justify-center">
        <CropPreview
          sourceBitmap={source}
          crop={crop}
          aspectRatio={aspect}
          previewWidth={previewWidth}
          previewHeight={previewHeight}
          rotateAngle={angle}
          onCropChange={setCrop}
        />
      </div>

      <div className="flex flex-wrap justify-center gap-1">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            type="button"
            aria-pressed={aspect === a.ratio}
            onClick={() => setAspect(a.ratio)}
            className={`px-2 py-1 text-[10px] rounded-[4px] border ${
              aspect === a.ratio
                ? 'bg-accent text-white border-accent'
                : 'bg-surface-secondary text-text-secondary border-separator hover:text-text-primary'
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={aspect === sw / sh}
          onClick={() => setAspect(sw / sh)}
          className={`px-2 py-1 text-[10px] rounded-[4px] border ${
            aspect === sw / sh
              ? 'bg-accent text-white border-accent'
              : 'bg-surface-secondary text-text-secondary border-separator hover:text-text-primary'
          }`}
        >
          Original
        </button>
      </div>

      <StraightenRuler value={angle} onChange={setAngle} />

      <div data-testid="crop-readout" className="text-center text-[10px] text-text-tertiary tabular-nums">
        {sw} × {sh} <span className="px-1 text-text-secondary">→</span>
        <span className="text-text-primary">{Math.round(crop.w)} × {Math.round(crop.h)}</span>
        <span className="ml-1">({aspectLabel})</span>
      </div>

      <div className="flex gap-1 mt-1">
        <button
          type="button"
          onClick={handleCancel}
          className="flex-1 px-2 py-1.5 text-[11px] rounded-[5px] bg-surface-secondary text-text-secondary border border-separator hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          className="flex-1 px-2 py-1.5 text-[11px] rounded-[5px] bg-accent text-white hover:bg-accent-hover"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
