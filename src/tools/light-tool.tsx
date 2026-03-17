import { Sun, RotateCcw } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function LightPanel() {
  const [exposure, setExposure] = useAdjustmentParam('basic', 'exposure', 0);
  const [brightness, setBrightness] = useAdjustmentParam('basic', 'brightness', 0);
  const [contrast, setContrast] = useAdjustmentParam('basic', 'contrast', 0);
  const [highlights, setHighlights] = useAdjustmentParam('basic', 'highlights', 0);
  const [shadows, setShadows] = useAdjustmentParam('basic', 'shadows', 0);

  const isDefault = exposure === 0 && brightness === 0 && contrast === 0 && highlights === 0 && shadows === 0;
  const reset = () => {
    setExposure(0);
    setBrightness(0);
    setContrast(0);
    setHighlights(0);
    setShadows(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="Exposure" value={exposure} min={-100} max={100} defaultValue={0} onChange={setExposure} />
      <AdjustmentSlider label="Brightness" value={brightness} min={-100} max={100} defaultValue={0} onChange={setBrightness} />
      <AdjustmentSlider label="Contrast" value={contrast} min={-100} max={100} defaultValue={0} onChange={setContrast} />
      <AdjustmentSlider label="Highlights" value={highlights} min={-100} max={100} defaultValue={0} onChange={setHighlights} />
      <AdjustmentSlider label="Shadows" value={shadows} min={-100} max={100} defaultValue={0} onChange={setShadows} />
      {!isDefault && <ResetButton onClick={reset} />}
    </div>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary
        bg-surface-secondary hover:bg-surface-secondary/80 rounded transition-colors cursor-default"
    >
      <RotateCcw size={10} />
      Reset
    </button>
  );
}

export const LightTool: ToolDefinition = {
  name: 'light',
  label: 'Light',
  icon: Sun,
  category: 'adjust',
  shortcut: 'B',
  defaultConfig: {},
  OptionsPanel: LightPanel,
};
