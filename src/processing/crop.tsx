import { Crop } from 'lucide-react';
import { useEditorStore } from '@/store';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

/** Compact display for crop node — shows region %, rotation info. */
function CropNodeCompact({ layerId }: ProcessingPanelProps) {
  const cropMeta = useEditorStore((s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    return layer?.cropMeta;
  });

  if (!cropMeta) {
    return (
      <div className="px-3 py-1.5">
        <span className="text-[10px] text-text-secondary">No crop</span>
      </div>
    );
  }

  const rotation = cropMeta.baseRotation + cropMeta.straighten;

  return (
    <div className="px-3 py-1.5 text-[10px] text-text-secondary space-y-0.5">
      <div className="flex justify-between">
        <span>Region</span>
        <span className="tabular-nums">
          {Math.round(cropMeta.rw * 100)}% &times; {Math.round(cropMeta.rh * 100)}%
        </span>
      </div>
      {rotation !== 0 && (
        <div className="flex justify-between">
          <span>Rotation</span>
          <span className="tabular-nums">{rotation.toFixed(1)}&deg;</span>
        </div>
      )}
    </div>
  );
}

export const cropProcessing: ProcessingDefinition = {
  id: 'crop',
  label: 'Crop',
  icon: Crop,
  category: 'transform',
  adjustmentType: 'crop',
  params: [],
  // Panel is not used directly — CropPanel is registered via NodeDefinition
  Panel: () => null,
  NodeCompactDisplay: CropNodeCompact,
};
