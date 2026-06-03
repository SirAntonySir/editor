import { useEffect, useState } from 'react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { CropPreview, type CropRect } from './CropPreview';

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

  // Re-seed local state whenever the active image-node changes.
  useEffect(() => {
    setCrop(snapshotCrop ?? { x: 0, y: 0, w: sw, h: sh });
    setAngle(snapshotAngle);
    setAspect(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageNodeId, sw, sh, snapshotCropX, snapshotCropY, snapshotCropW, snapshotCropH, snapshotAngle]);

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
        sourceBitmap={source as HTMLCanvasElement}
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
          className="flex-1 px-2 py-0.5 rounded-[3px] bg-accent text-white"
        >
          Apply
        </button>
        <button
          type="button"
          className="flex-1 px-2 py-0.5 rounded-[3px] bg-surface-secondary text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
