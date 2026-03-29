import { useCallback } from 'react';
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Pencil,
} from 'lucide-react';
import { useCropEditingStore } from '@/store/crop-editing-slice';
import { useEditorStore } from '@/store';
import type { NodePanelProps } from '@/types/node-definition';

const ASPECT_RATIOS = [
  { label: 'Free', value: 0 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '5:4', value: 5 / 4 },
  { label: '7:5', value: 7 / 5 },
] as const;

const btnClass =
  'flex items-center justify-center w-7 h-7 rounded-[var(--radius-button)] text-text-secondary hover:text-text-primary hover:bg-surface-secondary/60 transition-colors cursor-default';

export function CropPanel({ node }: NodePanelProps) {
  const isCropEditing = useCropEditingStore((s) => s.isCropEditing);
  const cropAspectRatio = useCropEditingStore((s) => s.cropAspectRatio);
  const cropStraighten = useCropEditingStore((s) => s.cropStraighten);
  const cropBaseRotation = useCropEditingStore((s) => s.cropBaseRotation);
  const setCropAspectRatio = useCropEditingStore((s) => s.setCropAspectRatio);
  const setCropStraighten = useCropEditingStore((s) => s.setCropStraighten);
  const setCropBaseRotation = useCropEditingStore((s) => s.setCropBaseRotation);
  const cropFlipX = useCropEditingStore((s) => s.cropFlipX);
  const cropFlipY = useCropEditingStore((s) => s.cropFlipY);
  const setCropFlipX = useCropEditingStore((s) => s.setCropFlipX);
  const setCropFlipY = useCropEditingStore((s) => s.setCropFlipY);
  const setIsCropEditing = useCropEditingStore((s) => s.setIsCropEditing);

  // Read cropMeta from the layer
  const cropMeta = useEditorStore((s) => {
    if (!node.data.layerId) return undefined;
    return s.layers.find((l) => l.id === node.data.layerId)?.cropMeta;
  });

  const handleEditCrop = useCallback(() => {
    setIsCropEditing(true);
  }, [setIsCropEditing]);

  const handleRotate = useCallback((dir: 90 | -90) => {
    setCropBaseRotation(cropBaseRotation + dir);
  }, [cropBaseRotation, setCropBaseRotation]);

  const handleFlip = useCallback((axis: 'h' | 'v') => {
    if (axis === 'h') setCropFlipX(!cropFlipX);
    else setCropFlipY(!cropFlipY);
  }, [cropFlipX, cropFlipY, setCropFlipX, setCropFlipY]);

  // If not editing, show current crop info + Edit Crop button
  if (!isCropEditing) {
    return (
      <div className="p-3 flex flex-col gap-2">
        {cropMeta ? (
          <div className="text-[10px] text-text-secondary space-y-0.5">
            <div className="flex justify-between">
              <span>Region</span>
              <span className="tabular-nums">
                {Math.round(cropMeta.rw * 100)}% &times; {Math.round(cropMeta.rh * 100)}%
              </span>
            </div>
            {(cropMeta.baseRotation + cropMeta.straighten) !== 0 && (
              <div className="flex justify-between">
                <span>Rotation</span>
                <span className="tabular-nums">{(cropMeta.baseRotation + cropMeta.straighten).toFixed(1)}&deg;</span>
              </div>
            )}
            {(cropMeta.flipX || cropMeta.flipY) && (
              <div className="flex justify-between">
                <span>Flip</span>
                <span>{[cropMeta.flipX && 'H', cropMeta.flipY && 'V'].filter(Boolean).join('+')}</span>
              </div>
            )}
          </div>
        ) : (
          <span className="text-[10px] text-text-secondary">No crop applied</span>
        )}
        <button
          onClick={handleEditCrop}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-text-primary glass-panel hover:bg-surface-secondary/60 transition-colors cursor-default w-full justify-center"
        >
          <Pencil size={11} />
          Edit Crop
        </button>
      </div>
    );
  }

  // Editing mode — show full crop controls
  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Aspect ratio pills */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-text-secondary font-medium">Aspect Ratio</span>
        <div className="flex flex-wrap gap-0.5">
          {ASPECT_RATIOS.map((r) => (
            <button
              key={r.label}
              onClick={() => setCropAspectRatio(r.value)}
              className={`px-1.5 py-0.5 text-[10px] rounded-[var(--radius-button)] transition-colors cursor-default
                ${cropAspectRatio === r.value
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary/60'
                }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Straighten slider */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-text-secondary font-medium">Straighten</span>
          <span className="text-[10px] text-text-primary tabular-nums">
            {cropStraighten > 0 ? '+' : ''}{cropStraighten.toFixed(1)}&deg;
          </span>
        </div>
        <input
          type="range"
          min={-45}
          max={45}
          step={0.1}
          value={cropStraighten}
          onChange={(e) => setCropStraighten(parseFloat(e.target.value))}
          className="w-full h-1 accent-accent cursor-default"
        />
      </div>

      {/* Rotate / Flip */}
      <div className="flex items-center gap-0.5">
        <button onClick={() => handleRotate(-90)} className={btnClass} title="Rotate left">
          <RotateCcw size={14} />
        </button>
        <button onClick={() => handleRotate(90)} className={btnClass} title="Rotate right">
          <RotateCw size={14} />
        </button>
        <button onClick={() => handleFlip('h')} className={btnClass} title="Flip horizontal">
          <FlipHorizontal2 size={14} />
        </button>
        <button onClick={() => handleFlip('v')} className={btnClass} title="Flip vertical">
          <FlipVertical2 size={14} />
        </button>
      </div>

      {/* Info */}
      <span className="text-[10px] text-text-secondary">
        Press Enter to apply, Escape to cancel.
      </span>
    </div>
  );
}
