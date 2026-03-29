import { Thermometer, RotateCcw } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useProcessingParam } from '@/lib/use-processing-param';

export function KelvinPanel({ layerId, adjustmentId }: ProcessingPanelProps) {
  const [kelvin, setKelvin] = useProcessingParam(layerId, 'kelvin', adjustmentId, 'kelvin', 6500);
  const [tint, setTint] = useProcessingParam(layerId, 'kelvin', adjustmentId, 'tint', 0);

  const isDefault = kelvin === 6500 && tint === 0;
  const reset = () => {
    setKelvin(6500);
    setTint(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="White Balance" value={kelvin} min={2000} max={12000} defaultValue={6500} onChange={setKelvin} formatValue={(v) => `${Math.round(v)}K`} />
      <AdjustmentSlider label="Tint" value={tint} min={-100} max={100} defaultValue={0} onChange={setTint} />
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

export const kelvinProcessing: ProcessingDefinition = {
  id: 'kelvin',
  label: 'White Balance',
  icon: Thermometer,
  category: 'adjust',
  adjustmentType: 'kelvin',
  params: [
    { key: 'kelvin', label: 'White Balance', min: 2000, max: 12000, default: 6500, format: (v) => `${Math.round(v)}K` },
    { key: 'tint', label: 'Tint', min: -100, max: 100, default: 0 },
  ],
  Panel: KelvinPanel,
};
