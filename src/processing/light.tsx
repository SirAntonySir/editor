import { RotateCcw } from 'lucide-react';
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';

const LightIcon = createMaterialIcon('light_mode');
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useProcessingParam } from '@/lib/use-processing-param';

export function LightPanel({ layerId, adjustmentId }: ProcessingPanelProps) {
  const [exposure, setExposure] = useProcessingParam(layerId, 'basic', adjustmentId, 'exposure', 0);
  const [brightness, setBrightness] = useProcessingParam(layerId, 'basic', adjustmentId, 'brightness', 0);
  const [contrast, setContrast] = useProcessingParam(layerId, 'basic', adjustmentId, 'contrast', 0);
  const [highlights, setHighlights] = useProcessingParam(layerId, 'basic', adjustmentId, 'highlights', 0);
  const [shadows, setShadows] = useProcessingParam(layerId, 'basic', adjustmentId, 'shadows', 0);
  const [whites, setWhites] = useProcessingParam(layerId, 'basic', adjustmentId, 'whites', 0);
  const [blacks, setBlacks] = useProcessingParam(layerId, 'basic', adjustmentId, 'blacks', 0);

  const isDefault = exposure === 0 && brightness === 0 && contrast === 0 && highlights === 0 && shadows === 0 && whites === 0 && blacks === 0;
  const reset = () => {
    setExposure(0);
    setBrightness(0);
    setContrast(0);
    setHighlights(0);
    setShadows(0);
    setWhites(0);
    setBlacks(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="Exposure" value={exposure} min={-100} max={100} defaultValue={0} onChange={setExposure} />
      <AdjustmentSlider label="Brightness" value={brightness} min={-100} max={100} defaultValue={0} onChange={setBrightness} />
      <AdjustmentSlider label="Contrast" value={contrast} min={-100} max={100} defaultValue={0} onChange={setContrast} />
      <AdjustmentSlider label="Highlights" value={highlights} min={-100} max={100} defaultValue={0} onChange={setHighlights} />
      <AdjustmentSlider label="Shadows" value={shadows} min={-100} max={100} defaultValue={0} onChange={setShadows} />
      <AdjustmentSlider label="Whites" value={whites} min={-100} max={100} defaultValue={0} onChange={setWhites} />
      <AdjustmentSlider label="Blacks" value={blacks} min={-100} max={100} defaultValue={0} onChange={setBlacks} />
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

export const lightProcessing: ProcessingDefinition = {
  id: 'light',
  label: 'Light',
  icon: LightIcon,
  category: 'adjust',
  adjustmentType: 'basic',
  paramKeys: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  params: [
    { key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100, default: 0 },
    { key: 'shadows', label: 'Shadows', min: -100, max: 100, default: 0 },
    { key: 'whites', label: 'Whites', min: -100, max: 100, default: 0 },
    { key: 'blacks', label: 'Blacks', min: -100, max: 100, default: 0 },
  ],
  Panel: LightPanel,
};
