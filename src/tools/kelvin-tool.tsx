import { Thermometer, RotateCcw } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useAdjustmentParam } from '@/lib/use-adjustment';

function KelvinPanel() {
  const [kelvin, setKelvin] = useAdjustmentParam('kelvin', 'kelvin', 6500);
  const [tint, setTint] = useAdjustmentParam('kelvin', 'tint', 0);

  const isDefault = kelvin === 6500 && tint === 0;
  const reset = () => {
    setKelvin(6500);
    setTint(0);
  };

  return (
    <div className="p-3 flex flex-col gap-3">
      <AdjustmentSlider label="White Balance" value={kelvin} min={2000} max={12000} defaultValue={6500} onChange={setKelvin} formatValue={(v) => `${Math.round(v)}K`} />
      <AdjustmentSlider label="Tint" value={tint} min={-100} max={100} defaultValue={0} onChange={setTint} />
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

export const KelvinTool: ToolDefinition = {
  name: 'kelvin',
  label: 'White Balance',
  icon: Thermometer,
  category: 'adjust',
  defaultConfig: {},
  OptionsPanel: KelvinPanel,
};
