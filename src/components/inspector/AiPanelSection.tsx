import type { ReactElement } from 'react';
import { useEditorStore } from '@/store';
import { useProcessingParam } from '@/lib/use-processing-param';
import { AdjustmentSlider } from './AdjustmentSlider';
import { ReasoningBadge } from '@/components/ui/ReasoningBadge';
import type { PanelBinding } from '@/types/operation-graph';

interface AiPanelSectionProps {
  layerId: string;
}

interface BindingRowProps {
  layerId: string;
  adjustmentType: string;
  binding: PanelBinding;
}

/**
 * Wires a single `PanelBinding` to its underlying adjustment param via
 * `useProcessingParam`. Lives in its own component so each binding can call
 * the hook unconditionally without violating the rules of hooks.
 */
function BindingRow({ layerId, adjustmentType, binding }: BindingRowProps) {
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

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{binding.label}</span>
        {binding.reasoning && <ReasoningBadge reasoning={binding.reasoning} />}
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

/**
 * AI panel section rendered inside the inspector for `ai-panel` layers.
 *
 * Surfaces the layer's `panelBindings` (derived from its OperationGraph) as
 * standard `AdjustmentSlider` rows, each tagged with an optional reasoning
 * badge that explains the AI's choice.
 */
export function AiPanelSection({ layerId }: AiPanelSectionProps): ReactElement | null {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  if (!layer || layer.type !== 'ai-panel' || !layer.panelBindings) return null;

  const nodesById = new Map(layer.operationGraph?.nodes.map((n) => [n.id, n]) ?? []);

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-text-secondary">
        <span>AI suggestion:</span>
        <span className="text-text-primary">{layer.operationGraph?.userGoal ?? '—'}</span>
      </div>
      {layer.panelBindings.map((binding) => {
        const adjustmentType = nodesById.get(binding.nodeId)?.type ?? 'basic';
        return (
          <BindingRow
            key={`${binding.nodeId}-${binding.paramKey}`}
            layerId={layerId}
            adjustmentType={adjustmentType}
            binding={binding}
          />
        );
      })}
    </div>
  );
}
