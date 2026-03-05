import { SlidersHorizontal } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function LevelsPanel() {
  const [inBlack, setInBlack] = useAdjustmentParam('levels', 'inBlack', 0);
  const [inWhite, setInWhite] = useAdjustmentParam('levels', 'inWhite', 255);
  const [gamma, setGamma] = useAdjustmentParam('levels', 'gamma', 1.0);
  const [outBlack, setOutBlack] = useAdjustmentParam('levels', 'outBlack', 0);
  const [outWhite, setOutWhite] = useAdjustmentParam('levels', 'outWhite', 255);

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="text-xs font-medium text-text-secondary">Input Levels</div>
      <AdjustmentSlider label="Black Point" value={inBlack} min={0} max={255} onChange={setInBlack} />
      <AdjustmentSlider
        label="Midtones"
        value={gamma}
        min={0.1}
        max={10}
        step={0.01}
        onChange={setGamma}
        formatValue={(v) => v.toFixed(2)}
      />
      <AdjustmentSlider label="White Point" value={inWhite} min={0} max={255} onChange={setInWhite} />

      <div className="h-px bg-separator" />

      <div className="text-xs font-medium text-text-secondary">Output Levels</div>
      <AdjustmentSlider label="Output Black" value={outBlack} min={0} max={255} onChange={setOutBlack} />
      <AdjustmentSlider label="Output White" value={outWhite} min={0} max={255} onChange={setOutWhite} />
    </div>
  );
}

export const LevelsTool: ToolDefinition = {
  name: 'levels',
  label: 'Levels',
  icon: SlidersHorizontal,
  category: 'adjust',
  OptionsPanel: LevelsPanel,
};
