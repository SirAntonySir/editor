import { Palette } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function ColorPanel() {
  const [saturation, setSaturation] = useAdjustmentParam('basic', 'saturation', 0);
  const [hue, setHue] = useAdjustmentParam('basic', 'hue', 0);

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider
        label="Saturation"
        value={saturation}
        min={-100}
        max={100}
        onChange={setSaturation}
      />
      <AdjustmentSlider
        label="Hue"
        value={hue}
        min={0}
        max={360}
        onChange={setHue}
        formatValue={(v) => `${Math.round(v)}°`}
      />
    </div>
  );
}

export const ColorTool: ToolDefinition = {
  name: 'color',
  label: 'Color',
  icon: Palette,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: ColorPanel,
};
