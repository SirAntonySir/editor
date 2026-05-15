import type { ReactElement } from 'react';
import { useEditorStore } from '@/store';
import { BindingRow } from './BindingRow';

interface AiStepSectionProps {
  layerId: string;
  graphId: string;
}

export function AiStepSection({ layerId, graphId }: AiStepSectionProps): ReactElement | null {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));

  if (!layer || !layer.aiSteps?.[graphId]) return null;
  const step = layer.aiSteps[graphId];

  const adjustmentsByNode = new Map(
    layer.adjustmentStack.adjustments
      .filter((a) => a.aiSource?.graphId === graphId)
      .map((a) => [a.aiSource!.nodeId, a]),
  );
  const nodesById = new Map(step.operationGraph.nodes.map((n) => [n.id, n]));

  return (
    <div className="flex flex-col border-t border-border/40">
      <div className="px-3 py-2 flex items-center gap-2 text-[11px]">
        <span aria-hidden>✨</span>
        <span className="text-text-secondary">AI step:</span>
        <span className="text-text-primary">{step.operationGraph.userGoal}</span>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-2">
        {step.panelBindings.map((binding) => {
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
