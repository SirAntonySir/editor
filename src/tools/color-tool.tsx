import { Palette, RotateCcw } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function ColorPanel() {
  const [saturation, setSaturation] = useAdjustmentParam('basic', 'saturation', 0);
  const [hue, setHue] = useAdjustmentParam('basic', 'hue', 0);

  const isDefault = saturation === 0 && hue === 0;
  const reset = () => {
    setSaturation(0);
    setHue(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="Saturation" value={saturation} min={-100} max={100} defaultValue={0} onChange={setSaturation} />
      <AdjustmentSlider label="Hue" value={hue} min={0} max={360} defaultValue={0} onChange={setHue} formatValue={(v) => `${Math.round(v)}°`} />
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

export const ColorTool: ToolDefinition = {
  name: 'color',
  label: 'Color',
  icon: Palette,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: ColorPanel,
};
