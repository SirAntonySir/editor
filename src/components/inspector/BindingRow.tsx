import { useProcessingParam } from '@/lib/use-processing-param';
import { AdjustmentSlider } from './AdjustmentSlider';
import { ReasoningBadge } from '@/components/ui/ReasoningBadge';
import type { PanelBinding } from '@/types/operation-graph';
import type { AiSource } from '@/store/layer-slice';

interface BindingRowProps {
  layerId: string;
  adjustmentType: string;
  binding: PanelBinding;
  aiSource: AiSource | undefined;
}

export function BindingRow({ layerId, adjustmentType, binding, aiSource }: BindingRowProps) {
  const defaultNumber = typeof binding.default === 'number' ? binding.default : 0;
  const min = binding.min ?? 0;
  const max = binding.max ?? 100;
  const step = binding.step ?? 1;

  const [value, setValue] = useProcessingParam(
    layerId,
    adjustmentType,
    undefined,
    binding.paramKey,
    defaultNumber,
  );

  const reasoning = binding.reasoning ?? aiSource?.reasoning;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{binding.label}</span>
        {reasoning && (
          <ReasoningBadge
            reasoning={reasoning}
            modelName={aiSource?.modelName}
            modelVersion={aiSource?.modelVersion}
            timestamp={aiSource?.generatedAt}
          />
        )}
      </div>
      <AdjustmentSlider
        label={binding.label}
        value={value}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultNumber}
        onChange={setValue}
      />
    </div>
  );
}
