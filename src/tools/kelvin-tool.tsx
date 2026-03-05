import { Thermometer } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function KelvinPanel() {
  const [kelvin, setKelvin] = useAdjustmentParam('kelvin', 'kelvin', 6500);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="White Balance"
        value={kelvin}
        min={2000}
        max={12000}
        onChange={setKelvin}
        formatValue={(v) => `${Math.round(v)}K`}
      />
    </div>
  );
}

export const KelvinTool: ToolDefinition = {
  name: 'kelvin',
  label: 'White Balance',
  icon: Thermometer,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: KelvinPanel,
};
