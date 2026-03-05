import { Droplets } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function SaturationPanel() {
  const [value, setValue] = useAdjustmentParam('basic', 'saturation', 0);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="Saturation"
        value={value}
        min={-100}
        max={100}
        onChange={setValue}
      />
    </div>
  );
}

export const SaturationTool: ToolDefinition = {
  name: 'saturation',
  label: 'Saturation',
  icon: Droplets,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: SaturationPanel,
};
