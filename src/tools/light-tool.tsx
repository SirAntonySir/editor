import { Sun } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function LightPanel() {
  const [brightness, setBrightness] = useAdjustmentParam('basic', 'brightness', 0);
  const [contrast, setContrast] = useAdjustmentParam('basic', 'contrast', 0);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="Brightness"
        value={brightness}
        min={-100}
        max={100}
        onChange={setBrightness}
      />
      <AdjustmentSlider
        label="Contrast"
        value={contrast}
        min={-100}
        max={100}
        onChange={setContrast}
      />
    </div>
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
