import { Palette } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function HuePanel() {
  const [value, setValue] = useAdjustmentParam('basic', 'hue', 0);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="Hue"
        value={value}
        min={0}
        max={360}
        onChange={setValue}
        formatValue={(v) => `${Math.round(v)}°`}
      />
    </div>
  );
}

export const HueTool: ToolDefinition = {
  name: 'hue',
  label: 'Hue',
  icon: Palette,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: HuePanel,
};
