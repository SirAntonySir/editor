import { Contrast } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function ContrastPanel() {
  const [value, setValue] = useAdjustmentParam('basic', 'contrast', 0);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="Contrast"
        value={value}
        min={-100}
        max={100}
        onChange={setValue}
      />
    </div>
  );
}

export const ContrastTool: ToolDefinition = {
  name: 'contrast',
  label: 'Contrast',
  icon: Contrast,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: ContrastPanel,
};
