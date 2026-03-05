import { Sun, RotateCcw } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function LightPanel() {
  const [brightness, setBrightness] = useAdjustmentParam('basic', 'brightness', 0);
  const [contrast, setContrast] = useAdjustmentParam('basic', 'contrast', 0);

  const isDefault = brightness === 0 && contrast === 0;
  const reset = () => {
    setBrightness(0);
    setContrast(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="Brightness" value={brightness} min={-100} max={100} defaultValue={0} onChange={setBrightness} />
      <AdjustmentSlider label="Contrast" value={contrast} min={-100} max={100} defaultValue={0} onChange={setContrast} />
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
