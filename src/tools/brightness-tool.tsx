import { Sun } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function BrightnessPanel() {
  const [value, setValue] = useAdjustmentParam('basic', 'brightness', 0);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="Brightness"
        value={value}
        min={-100}
        max={100}
        onChange={setValue}
      />
    </div>
  );
}

export const BrightnessTool: ToolDefinition = {
  name: 'brightness',
  label: 'Brightness',
  icon: Sun,
  category: 'adjust',
  shortcut: 'B',
  defaultConfig: {},
  OptionsPanel: BrightnessPanel,
};
