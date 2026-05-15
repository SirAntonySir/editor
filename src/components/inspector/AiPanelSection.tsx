import type { ReactElement } from 'react';
import { useEditorStore } from '@/store';
import { useProcessingParam } from '@/lib/use-processing-param';
import { useAiSession } from '@/hooks/useImageContext';
import { AdjustmentSlider } from './AdjustmentSlider';
import { AiPanelHeader } from './AiPanelHeader';
import { ReasoningBadge } from '@/components/ui/ReasoningBadge';
import type { PanelBinding } from '@/types/operation-graph';
import type { AiSource } from '@/store/layer-slice';

interface AiPanelSectionProps { layerId: string; }

interface BindingRowProps {
  layerId: string;
  adjustmentType: string;
  binding: PanelBinding;
  aiSource: AiSource | undefined;
}

function BindingRow({ layerId, adjustmentType, binding, aiSource }: BindingRowProps) {
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

export function AiPanelSection({ layerId }: AiPanelSectionProps): ReactElement | null {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  const sessionId = useAiSession((s) => s.sessionId);

  if (!layer || layer.type !== 'ai-panel' || !layer.panelBindings) return null;

  const nodesById = new Map(layer.operationGraph?.nodes.map((n) => [n.id, n]) ?? []);
  const adjustmentsByNode = new Map(
    layer.adjustmentStack.adjustments
      .filter((a) => a.aiSource)
      .map((a) => [a.aiSource!.nodeId, a]),
  );

  return (
    <div className="flex flex-col">
      <AiPanelHeader layerId={layerId} sessionId={sessionId} />
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-1 text-[11px] text-text-secondary">
          <span>AI suggestion:</span>
          <span className="text-text-primary">{layer.operationGraph?.userGoal ?? '—'}</span>
        </div>
        {layer.panelBindings.map((binding) => {
          const adjustmentType = nodesById.get(binding.nodeId)?.type ?? 'basic';
          const aiSource = adjustmentsByNode.get(binding.nodeId)?.aiSource;
          return (
            <BindingRow
              key={`${binding.nodeId}-${binding.paramKey}`}
              layerId={layerId}
              adjustmentType={adjustmentType}
              binding={binding}
              aiSource={aiSource}
            />
          );
        })}
      </div>
    </div>
  );
}
