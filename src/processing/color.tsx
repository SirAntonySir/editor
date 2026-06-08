import { RotateCcw } from 'lucide-react';
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const ColorIcon = createMaterialIcon('palette');
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useProcessingParam } from '@/lib/use-processing-param';

export function ColorPanel({ layerId, adjustmentId }: ProcessingPanelProps) {
  const [saturation, setSaturation] = useProcessingParam(layerId, 'basic', adjustmentId, 'saturation', 0);
  const [vibrance, setVibrance] = useProcessingParam(layerId, 'basic', adjustmentId, 'vibrance', 0);
  const [hue, setHue] = useProcessingParam(layerId, 'basic', adjustmentId, 'hue', 0);

  const isDefault = saturation === 0 && vibrance === 0 && hue === 0;
  const reset = () => {
    setSaturation(0);
    setVibrance(0);
    setHue(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="Saturation" value={saturation} min={-100} max={100} defaultValue={0} onChange={setSaturation} />
      <AdjustmentSlider label="Vibrance" value={vibrance} min={-100} max={100} defaultValue={0} onChange={setVibrance} />
      <AdjustmentSlider label="Hue" value={hue} min={0} max={360} defaultValue={0} onChange={setHue} formatValue={(v) => `${Math.round(v)}\u00B0`} />
      {!isDefault && (
        <button
          onClick={reset}
          className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary
            bg-surface-secondary hover:bg-surface-secondary/80 rounded transition-colors cursor-default"
        >
          <RotateCcw size={10} />
          Reset
        </button>
      )}
    </div>
  );
}

export const colorProcessing: ProcessingDefinition = {
  id: 'color',
  label: 'Color',
  icon: ColorIcon,
  category: 'adjust',
  adjustmentType: 'basic',
  paramKeys: ['saturation', 'vibrance', 'hue'],
  params: [
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, default: 0 },
    { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, default: 0 },
    { key: 'hue', label: 'Hue', min: 0, max: 360, default: 0, format: (v) => `${Math.round(v)}\u00B0` },
  ],
  Panel: ColorPanel,
};
