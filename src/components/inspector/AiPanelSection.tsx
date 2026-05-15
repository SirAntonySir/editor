import type { ReactElement } from 'react';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { AiPanelHeader } from './AiPanelHeader';
import { BindingRow } from './BindingRow';

interface AiPanelSectionProps { layerId: string; }

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
